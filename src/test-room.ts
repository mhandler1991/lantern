/**
 * `test-room.html` — the peer-discovery harness. PRD.md §5 Phase 0.
 *
 * Bare Trystero and nothing else: no sheet, no dice, no React, no app state. It joins
 * one hardcoded room on load and reports what it sees. This page is the first thing to
 * open when networking misbehaves, and it stays in the repo forever.
 *
 * It lives outside `src/{model,net,state,ui}` deliberately: those are what the smoke
 * test loads, and this module joins a real room the moment it is imported.
 *
 * The reasoning is in `net/peer-harness.ts`, which is pure and tested. This file is the
 * wiring — transport in, text nodes out.
 */

import './styles/tokens.css';
import './styles/test-room.css';
import { getRelaySockets, joinRoom, selfId } from 'trystero';
import {
  HARNESS_HEARTBEAT_MS,
  HARNESS_RECONCILE_MS,
  HARNESS_ROOM_ID,
  HARNESS_SETTLE_MS,
  HARNESS_SILENCE_MS,
  MAX_HARNESS_LOG_LINES,
  TRYSTERO_APP_ID,
} from './constants';
import {
  appendLogEntry,
  countOpenRelays,
  diagnose,
  formatLogEntry,
  idsSeenWithin,
  shortPeerId,
  type LogEntry,
  type LogLevel,
  type LogSource,
} from './net/peer-harness';

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Lantern harness: #${id} is missing from test-room.html`);
  }
  return element;
}

const ui = {
  selfId: requireElement('self-id'),
  roomId: requireElement('room-id'),
  relayCount: requireElement('relay-count'),
  peerCount: requireElement('peer-count'),
  diagnosis: requireElement('diagnosis'),
  peers: requireElement('peer-list'),
  log: requireElement('log'),
};

// ---------------------------------------------------------------------------
// The log. Text nodes only — CLAUDE.md §2.6 holds even on a debug page, because a
// peer id is peer-supplied data and this is exactly where that gets forgotten.
// ---------------------------------------------------------------------------

let log: readonly LogEntry[] = [];

function record(source: LogSource, level: LogLevel, message: string): void {
  const entry: LogEntry = { at: Date.now(), source, level, message };
  log = appendLogEntry(log, entry, MAX_HARNESS_LOG_LINES);

  // Whether to follow the tail is decided before the line lands, because appending
  // moves scrollHeight and the reader may have scrolled up to look at something.
  const wasAtTail = ui.log.scrollTop + ui.log.clientHeight >= ui.log.scrollHeight;

  const line = document.createElement('li');
  line.className = `log-line log-line--${level}`;
  line.textContent = formatLogEntry(entry);
  ui.log.appendChild(line);

  while (ui.log.childElementCount > MAX_HARNESS_LOG_LINES) {
    ui.log.firstElementChild?.remove();
  }

  if (wasAtTail) {
    ui.log.scrollTop = ui.log.scrollHeight;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Our layer's own bookkeeping. Kept deliberately separate from what the transport
// reports, so the two can disagree and the disagreement can be seen.
// ---------------------------------------------------------------------------

/** Peer ids we believe are here, because a join fired and no leave has. */
const tracked = new Set<string>();

/** When each peer's most recent application-level message arrived. */
const lastHeard = new Map<string, number>();

/** When each peer joined, so a peer that has not had time to beat is not called silent. */
const joinedAt = new Map<string, number>();

/** Most recent round-trip time per peer, milliseconds. */
const lastPing = new Map<string, number>();

// ---------------------------------------------------------------------------
// The transport
// ---------------------------------------------------------------------------

ui.selfId.textContent = selfId;
ui.roomId.textContent = HARNESS_ROOM_ID;
record('harness', 'info', `joining "${HARNESS_ROOM_ID}" as ${shortPeerId(selfId)}`);

const room = joinRoom({ appId: TRYSTERO_APP_ID }, HARNESS_ROOM_ID, {
  onJoinError: (details) => {
    record('relay', 'error', `join refused: ${details.error}`);
  },
});

room.onPeerJoin = (peerId) => {
  tracked.add(peerId);
  joinedAt.set(peerId, Date.now());
  record('transport', 'info', `peer joined ${shortPeerId(peerId)}`);
  void measurePing(peerId);
  reconcile();
};

room.onPeerLeave = (peerId) => {
  tracked.delete(peerId);
  joinedAt.delete(peerId);
  lastHeard.delete(peerId);
  lastPing.delete(peerId);
  record('transport', 'info', `peer left ${shortPeerId(peerId)}`);
  reconcile();
};

/**
 * The beat. Trystero reporting a peer proves a peer connection exists; only a message
 * that actually arrives proves the channel carries our traffic. Without this, "the
 * transport has no peers" and "our layer dropped them" are the same picture.
 *
 * The payload is validated on the way in even though we are its only sender — it comes
 * off the wire, so it is untrusted (CLAUDE.md §2.7). The sender is `context.peerId`,
 * never anything in the payload (§2.8).
 */
const beat = room.makeAction<number>('beat', {
  onMessage: (sentAt, { peerId }) => {
    if (typeof sentAt !== 'number' || !Number.isFinite(sentAt)) {
      record('layer', 'warn', `beat from ${shortPeerId(peerId)} was not a timestamp`);
      return;
    }

    const isFirst = !lastHeard.has(peerId);
    lastHeard.set(peerId, Date.now());

    if (isFirst) {
      record('layer', 'info', `first beat from ${shortPeerId(peerId)} — messages are crossing`);
      reconcile();
    }
  },
});

async function measurePing(peerId: string): Promise<void> {
  try {
    const rtt = await room.ping(peerId);
    lastPing.set(peerId, rtt);
  } catch (error) {
    lastPing.delete(peerId);
    record('transport', 'warn', `ping to ${shortPeerId(peerId)} failed: ${describeError(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Reconciliation — read all three views at one moment and compare them
// ---------------------------------------------------------------------------

let lastDiagnosisKind = '';

/**
 * The page's own settle window. At load there is no relay socket open yet, and saying
 * so would put "no signalling relay is connected" at the top of every log — the exact
 * kind of red herring this page exists to eliminate. The verdict is tracked from the
 * first moment and announced from the first reading past the window, so a signalling
 * failure that is real still reaches the log, just without the false start.
 */
const startedAt = Date.now();
let hasAnnouncedVerdict = false;

function reconcile(): void {
  const now = Date.now();
  const transportPeerIds = Object.keys(room.getPeers());
  const openRelays = countOpenRelays(getRelaySockets());

  const snapshot = {
    openRelays,
    transportPeerIds,
    trackedPeerIds: [...tracked],
    heardFromPeerIds: idsSeenWithin(lastHeard, now, HARNESS_SILENCE_MS),
    settlingPeerIds: idsSeenWithin(joinedAt, now, HARNESS_SETTLE_MS),
  };

  const diagnosis = diagnose(snapshot);

  ui.relayCount.textContent = String(openRelays);
  ui.peerCount.textContent = String(transportPeerIds.length);
  ui.diagnosis.textContent = diagnosis.summary;
  ui.diagnosis.className = `diagnosis diagnosis--${diagnosis.kind}`;

  renderPeers(snapshot.transportPeerIds, snapshot.heardFromPeerIds, now);

  // Log the verdict only when it changes. A line every two seconds buries the moment
  // the picture actually moved.
  const hasChanged = diagnosis.kind !== lastDiagnosisKind;
  lastDiagnosisKind = diagnosis.kind;

  if (now - startedAt < HARNESS_SETTLE_MS) {
    return;
  }

  if (hasChanged || !hasAnnouncedVerdict) {
    hasAnnouncedVerdict = true;
    record('harness', diagnosis.kind === 'healthy' ? 'info' : 'warn', diagnosis.summary);
  }
}

function renderPeers(
  transportPeerIds: readonly string[],
  heardFromPeerIds: readonly string[],
  now: number,
): void {
  const heard = new Set(heardFromPeerIds);
  const rows = [...new Set([...transportPeerIds, ...tracked])].map((peerId) => {
    const row = document.createElement('li');
    row.className = 'peer';

    const parts = [
      shortPeerId(peerId),
      transportPeerIds.includes(peerId) ? 'transport: yes' : 'transport: NO',
      tracked.has(peerId) ? 'layer: yes' : 'layer: NO',
      heard.has(peerId) ? `beat: ${now - (lastHeard.get(peerId) ?? now)}ms ago` : 'beat: NONE',
      lastPing.has(peerId) ? `ping: ${lastPing.get(peerId)}ms` : 'ping: —',
    ];

    row.textContent = parts.join('   ');
    return row;
  });

  ui.peers.replaceChildren(...rows);
}

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

setInterval(() => {
  if (tracked.size === 0) {
    return;
  }

  beat.send(Date.now()).catch((error: unknown) => {
    record('layer', 'error', `beat send failed: ${describeError(error)}`);
  });
}, HARNESS_HEARTBEAT_MS);

setInterval(() => {
  reconcile();
  Object.keys(room.getPeers()).forEach((peerId) => void measurePing(peerId));
}, HARNESS_RECONCILE_MS);

reconcile();
