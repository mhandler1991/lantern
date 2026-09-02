/**
 * The reasoning half of the peer-discovery harness (`test-room.html`, PRD.md §5 Phase 0).
 *
 * Everything here is pure: no DOM, no Trystero, no timers. `src/test-room.ts` owns the
 * transport and the page; this file owns the one question the harness exists to answer.
 *
 * **The question.** When nobody can see anybody, there are two failures and they look
 * identical from the outside:
 *
 *   1. *The transport has no peers.* Signalling never completed, so no peer connection
 *      was ever established. The fix is relays, NAT, or the network.
 *   2. *Our layer dropped them.* The peer connection is up and the transport reports
 *      it, but our bookkeeping lost the id, or application messages are not crossing.
 *      The fix is in our code.
 *
 * They need opposite fixes, and the predecessor project burned five rounds and four
 * wrong diagnoses guessing between them. So the harness records three views that are
 * gathered independently and compares them:
 *
 *   - **relay** — how many signalling sockets are open. Discovery is possible at all.
 *   - **transport** — the peer ids Trystero reports an active connection for.
 *   - **layer** — the peer ids our own join/leave bookkeeping holds, and which of
 *     those have sent us an application-level message recently.
 *
 * A disagreement between any two of them names the failure. Agreement means the
 * transport is genuinely fine and the bug is somewhere else entirely.
 */

import { PEER_ID_DISPLAY_LENGTH, shortPeerId } from './transport';

// Peer ids are shortened the same way everywhere they are printed, so a line from the
// harness and a line from the transport name the same peer identically.
export { PEER_ID_DISPLAY_LENGTH, shortPeerId };

/** Where a log line came from. The three views above, plus the page itself. */
export type LogSource = 'relay' | 'transport' | 'layer' | 'harness';

export type LogLevel = 'info' | 'warn' | 'error';

export type LogEntry = {
  at: number;
  source: LogSource;
  level: LogLevel;
  message: string;
};

/** One reading of all three views, taken at the same moment. */
export type HarnessSnapshot = {
  /** Open signalling sockets. Zero means nothing new can be discovered. */
  openRelays: number;
  /** Peer ids the transport reports an active connection for. */
  transportPeerIds: readonly string[];
  /** Peer ids our own join/leave bookkeeping holds. */
  trackedPeerIds: readonly string[];
  /** Of those, the ids that have sent an application-level message recently. */
  heardFromPeerIds: readonly string[];
  /**
   * Ids that joined too recently to have been expected to send anything yet. Silence
   * from these is not evidence of anything, and reporting it is a false alarm.
   */
  settlingPeerIds: readonly string[];
};

/**
 * What the three views, compared, say is wrong. `kind` is the diagnosis; `summary` is
 * the sentence the page shows; `peerIds` names the peers the diagnosis is about.
 */
export type Diagnosis =
  | { kind: 'no-signalling'; summary: string }
  | { kind: 'alone'; summary: string }
  | { kind: 'layer-missed-join'; summary: string; peerIds: readonly string[] }
  | { kind: 'layer-held-ghost'; summary: string; peerIds: readonly string[] }
  | { kind: 'silent-peers'; summary: string; peerIds: readonly string[] }
  | { kind: 'healthy'; summary: string };

const ALL_LOG_SOURCES: readonly LogSource[] = ['relay', 'transport', 'layer', 'harness'];

/** Derived rather than typed out, so adding a source cannot misalign the column. */
const SOURCE_COLUMN_WIDTH = ALL_LOG_SOURCES.reduce((widest, source) => {
  return Math.max(widest, source.length);
}, 0);

/** Ids the left side holds and the right side does not. Order follows the left side. */
function missingFrom(left: readonly string[], right: readonly string[]): string[] {
  const present = new Set(right);
  return left.filter((id) => !present.has(id));
}

function listPeers(peerIds: readonly string[]): string {
  return peerIds.map(shortPeerId).join(', ');
}

/**
 * Compare the three views and name the failure.
 *
 * Order matters: a missed join explains a silent peer, so the more fundamental
 * disagreement is reported first rather than reporting both and leaving the reader to
 * work out which one caused the other.
 */
export function diagnose(snapshot: HarnessSnapshot): Diagnosis {
  const { openRelays, transportPeerIds, trackedPeerIds, heardFromPeerIds, settlingPeerIds } =
    snapshot;

  if (transportPeerIds.length === 0 && trackedPeerIds.length === 0) {
    if (openRelays === 0) {
      return {
        kind: 'no-signalling',
        summary:
          'No signalling relay is connected, so no peer can be discovered. ' +
          'This is the network or the relays, not our code.',
      };
    }

    return {
      kind: 'alone',
      summary:
        `Signalling is up on ${openRelays} relay(s) and no peer has been seen. ` +
        'Either nobody else is here, or discovery is not completing.',
    };
  }

  const missedJoins = missingFrom(transportPeerIds, trackedPeerIds);
  if (missedJoins.length > 0) {
    return {
      kind: 'layer-missed-join',
      peerIds: missedJoins,
      summary:
        `The transport has ${missedJoins.length} peer(s) our layer never tracked ` +
        `(${listPeers(missedJoins)}). The connection is fine — a join was missed here.`,
    };
  }

  const ghosts = missingFrom(trackedPeerIds, transportPeerIds);
  if (ghosts.length > 0) {
    return {
      kind: 'layer-held-ghost',
      peerIds: ghosts,
      summary:
        `Our layer is holding ${ghosts.length} peer(s) the transport has dropped ` +
        `(${listPeers(ghosts)}). A leave was missed here.`,
    };
  }

  const silent = missingFrom(missingFrom(transportPeerIds, heardFromPeerIds), settlingPeerIds);
  if (silent.length > 0) {
    return {
      kind: 'silent-peers',
      peerIds: silent,
      summary:
        `${silent.length} peer(s) are connected but have sent nothing ` +
        `(${listPeers(silent)}). The peer connection is up and messages are not crossing.`,
    };
  }

  return {
    kind: 'healthy',
    summary:
      `${transportPeerIds.length} peer(s) connected, tracked, and sending. ` +
      'The transport is not the problem.',
  };
}

/**
 * Ids whose recorded moment falls inside `windowMs` of `now`.
 *
 * Both time-based views are this shape: peers heard from recently, and peers that
 * joined recently enough to still be settling. One function so the boundary is decided
 * in one place — a peer exactly on the edge is inside the window in both readings.
 */
export function idsSeenWithin(
  times: ReadonlyMap<string, number>,
  now: number,
  windowMs: number,
): string[] {
  return [...times.entries()].filter(([, at]) => now - at <= windowMs).map(([id]) => id);
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

const HOUR_DIGITS = 2;
const MILLISECOND_DIGITS = 3;

/** `HH:MM:SS.mmm`, local time. Wall-clock, because it is read against a second tab. */
export function formatTimestamp(at: number): string {
  const date = new Date(at);
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => pad(part, HOUR_DIGITS))
    .join(':');

  return `${time}.${pad(date.getMilliseconds(), MILLISECOND_DIGITS)}`;
}

/** One log line: time, the view it came from, and what happened. */
export function formatLogEntry(entry: LogEntry): string {
  const source = entry.source.padEnd(SOURCE_COLUMN_WIDTH, ' ');
  const level = entry.level === 'info' ? '' : `${entry.level.toUpperCase()}: `;

  return `${formatTimestamp(entry.at)}  ${source}  ${level}${entry.message}`;
}

/**
 * Append to a bounded log, dropping the oldest lines past `limit`. A harness left open
 * overnight is a normal thing to do and must not exhaust the tab.
 */
export function appendLogEntry(
  log: readonly LogEntry[],
  entry: LogEntry,
  limit: number,
): LogEntry[] {
  const appended = [...log, entry];
  return appended.length > limit ? appended.slice(appended.length - limit) : appended;
}

/**
 * How many signalling sockets are open.
 *
 * Trystero's `getRelaySockets` is typed `any` upstream, so what it returns is `unknown`
 * as far as we are concerned and is narrowed here rather than trusted (CLAUDE.md §2.4).
 * A shape we do not recognise counts as zero open relays, which reads on the page as
 * "signalling is down" — the honest answer when we cannot tell.
 */
export function countOpenRelays(sockets: unknown): number {
  if (typeof sockets !== 'object' || sockets === null) {
    return 0;
  }

  return Object.values(sockets).filter((socket: unknown) => {
    return (
      typeof socket === 'object' &&
      socket !== null &&
      'readyState' in socket &&
      socket.readyState === WebSocket.OPEN
    );
  }).length;
}
