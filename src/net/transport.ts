/**
 * The transport contract. DESIGN.md §1 — WebRTC data channels between browsers, with
 * signalling over public relays and no server anywhere.
 *
 * 🚫 Nothing in this file imports Trystero, and nothing in it touches the DOM. It is
 * the shape the rest of the app codes against; `net/trystero.ts` is the one place that
 * knows which library is underneath. DESIGN.md §8 flags Trystero's API as churning
 * across 0.25.x, and this boundary is what keeps that churn to a single file.
 *
 * Two rules from CLAUDE.md are structural here rather than advisory:
 *
 *   - **§2.8 — identity comes from the transport, never the payload.** An inbound
 *     message is delivered as `{ from, data }` where `from` is the peer id the
 *     transport itself reports. `data` is `unknown`: it came off the wire, so it is
 *     not a protocol event until `net/protocol.ts` (#39) has parsed it.
 *   - **§2.5 — errors are values.** Joining, sending and leaving return a `Result`.
 *     A send that could not happen is a value the caller can act on, never a throw
 *     and never a silent success.
 */

import { MAX_EVENT_BYTES, MAX_PEER_ID_LENGTH } from '../constants';

/**
 * A peer id as the transport reports it — an opaque per-session string, not a name and
 * not an account. Trystero's own is `genId(20)`, twenty characters of `[0-9A-Za-z]`
 * (`@trystero-p2p/core/dist/utils.mjs`), but nothing here depends on that shape: the id
 * is checked for being usable (`isPeerId`) and never for looking like anything.
 *
 * 📌 A peer chooses the id it announces itself by. What it cannot choose is which
 * *connection* a message arrives on, and that is where attribution comes from — which
 * is the whole of CLAUDE.md §2.8.
 */
export type PeerId = string;

/** What may be sent. The wire is JSON, so the type says so rather than allowing `unknown`. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/**
 * One inbound message. `from` is the transport's word, not the sender's — a peer can
 * put any id it likes inside `data` and it will not be believed (CLAUDE.md §2.8).
 */
export type TransportMessage = {
  from: PeerId;
  data: unknown;
};

/**
 * Why something did not happen. Each kind is a different fix, which is the only reason
 * to distinguish them: `unknown-peer` is a stale peer list, `too-large` is our own bug,
 * `join-refused` is the network.
 */
export type TransportErrorKind =
  /** Signalling refused the join. Reported asynchronously, after the room exists. */
  | 'join-refused'
  /** The room could not be created at all. */
  | 'join-failed'
  /** Sent after `leave()`. The room is gone and nothing was transmitted. */
  | 'not-joined'
  /** No connected peer has that id. Nothing was transmitted. */
  | 'unknown-peer'
  /** Over `MAX_EVENT_BYTES`. Dropped rather than transmitted or parsed. */
  | 'too-large'
  /** Not serialisable as JSON — a cycle, or something that is not data. */
  | 'malformed'
  /**
   * The transport reported no usable peer id for something it delivered. Identity comes
   * from the transport (CLAUDE.md §2.8), so there is nothing else to fall back on and
   * the event is dropped rather than attributed to a guess.
   */
  | 'unattributable'
  /** The transport itself failed while sending or leaving. */
  | 'transport-failed';

export type TransportError = {
  kind: TransportErrorKind;
  message: string;
};

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: TransportError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function failure<T = void>(kind: TransportErrorKind, message: string): Result<T> {
  return { ok: false, error: { kind, message } };
}

/**
 * What the app is told about. Every one of these is also logged (see `TransportLogger`),
 * because a peer bug is diagnosed from the console and a handler that forgot to log
 * leaves nothing behind.
 */
export type TransportHandlers = {
  onPeerJoin?: (peerId: PeerId) => void;
  onPeerLeave?: (peerId: PeerId) => void;
  onMessage?: (message: TransportMessage) => void;
  /** Failures that arrive on their own schedule rather than as a call's return value. */
  onError?: (error: TransportError) => void;
};

export type TransportLogLevel = 'info' | 'warn' | 'error';

export type TransportLogEntry = {
  at: number;
  level: TransportLogLevel;
  message: string;
};

/**
 * Where peer events go. Injectable so a test can read them and the lobby can show them,
 * defaulting to the console — issue #38: peer bugs are diagnosed from the console, and
 * an event that was handled but never printed is invisible when it matters.
 */
export type TransportLogger = (entry: TransportLogEntry) => void;

export type TransportOptions = {
  /** The room code. Namespaced by `TRYSTERO_APP_ID`, so it collides with nothing else. */
  roomId: string;
  /** Optional, and a courtesy lock rather than a security boundary. DESIGN.md §2. */
  password?: string;
  handlers?: TransportHandlers;
  log?: TransportLogger;
};

/**
 * A joined room.
 *
 * `broadcast` and `sendTo` are the same wire in both directions; the difference is only
 * whether the transport addresses one peer or all of them. Both resolve once the data
 * has been handed to the data channel — that is delivery to the peer's browser, not
 * acknowledgement by the peer's code.
 */
export type Transport = {
  /** Our own peer id. The one every other client will see as `from`. */
  readonly selfId: PeerId;
  readonly roomId: string;
  /** Peers currently connected, as our own bookkeeping holds them. */
  getPeers: () => readonly PeerId[];
  broadcast: (payload: JsonValue) => Promise<Result>;
  sendTo: (peerId: PeerId, payload: JsonValue) => Promise<Result>;
  /** Idempotent. Leaving twice is not an error, and neither is leaving a dead room. */
  leave: () => Promise<Result>;
};

/** Whole peer ids make a log unreadable, and nothing is identified by eye; the head is enough. */
export const PEER_ID_DISPLAY_LENGTH = 8;

/**
 * Is this something we can attribute a message to?
 *
 * The transport's word is the only identity there is (CLAUDE.md §2.8), so it is worth
 * one check that the transport actually said something. A missing or empty id is a
 * library contract we no longer recognise, and attributing a message to `''` would put
 * a nameless row in the roster that every later message joins. The length bound is
 * `MAX_PEER_ID_LENGTH` because the id is a string a remote peer chose (see there).
 *
 * 🚫 Not a format check. Refusing an id for not looking like Trystero's would break the
 * table the day Trystero changes its generator, and the shape was never the guarantee.
 */
export function isPeerId(value: unknown): value is PeerId {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PEER_ID_LENGTH;
}

export function shortPeerId(peerId: PeerId): string {
  return peerId.slice(0, PEER_ID_DISPLAY_LENGTH);
}

/** Anything can be thrown. This is the one place that turns it into a sentence. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const encoder = new TextEncoder();

/**
 * How large this value is on the wire, or `null` if it is not JSON at all.
 *
 * `JSON.stringify` returns `undefined` for a bare `undefined` or a function, and throws
 * on a cycle or a BigInt. Both are "this is not data", and both must be a value rather
 * than an exception at a boundary that hostile input reaches.
 */
export function measureEventBytes(value: unknown): number | null {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? null : encoder.encode(json).byteLength;
  } catch {
    return null;
  }
}

/**
 * The size wall, run on the way out and on the way in (CLAUDE.md §2.7).
 *
 * Outbound it catches our own bug before a peer sees it. Inbound it bounds what is
 * handed upward — the transport has already decoded the payload by the time we see it,
 * so this is not a limit on what may be *received*, only on what may be parsed and
 * kept. That distinction matters: it means the cap protects the app, not the tab.
 */
export function checkEventSize(value: unknown): Result<number> {
  const bytes = measureEventBytes(value);

  if (bytes === null) {
    return failure('malformed', 'payload is not JSON-serialisable');
  }

  if (bytes > MAX_EVENT_BYTES) {
    return failure('too-large', `payload is ${bytes} bytes, over the ${MAX_EVENT_BYTES} limit`);
  }

  return ok(bytes);
}
