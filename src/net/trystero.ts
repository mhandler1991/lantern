/**
 * The Trystero implementation of `Transport`. DESIGN.md §1 — WebRTC data channels,
 * signalling over public Nostr relays, no server.
 *
 * This is the only file in the app that imports Trystero. DESIGN.md §8 records why that
 * matters: 0.25.4 split the library across `@trystero-p2p/core` and `@trystero-p2p/nostr`,
 * moved `onJoinError` into a third `joinRoom` argument and made `leave()` async, and the
 * README and every trained-on example are behind it. The `.d.mts` files under
 * `node_modules/@trystero-p2p/core/dist` are the truth and were read before this file
 * was written.
 *
 * **The seam.** `RoomLike` and `JoinRoomLike` below describe only the parts of Trystero
 * we use, and `trysteroJoinRoom` is assigned to `JoinRoomLike` at module load. That
 * assignment is the point: if an upgrade changes one of those signatures, `npm run
 * typecheck` fails here rather than a room silently failing to join in a browser. It is
 * also the seam the tests substitute, so join, leave, send and peer bookkeeping are
 * exercised without needing real peers — which is the one thing a unit test cannot have
 * (CLAUDE.md §7; real peers are `test-room.html`).
 *
 * 🚫 No TURN configuration. Trystero ships STUN only, and DESIGN.md §8 is explicit:
 * dead relay credentials stall ICE gathering and are worse than none.
 */

import { joinRoom as trysteroJoinRoom, selfId as trysteroSelfId } from 'trystero';
import { TRYSTERO_ACTION_NAMESPACE, TRYSTERO_APP_ID } from '../constants';
import {
  checkEventSize,
  describeError,
  failure,
  isPeerId,
  ok,
  shortPeerId,
  type JsonValue,
  type PeerId,
  type Result,
  type Transport,
  type TransportError,
  type TransportLogEntry,
  type TransportLogger,
  type TransportOptions,
} from './transport';

// ---------------------------------------------------------------------------
// The seam — the slice of Trystero this file depends on, and nothing more
// ---------------------------------------------------------------------------

export type RoomConfigLike = {
  appId: string;
  password?: string;
};

export type JoinCallbacksLike = {
  onJoinError?: (details: { error: string }) => void;
};

export type ActionLike = {
  send: (data: JsonValue, options?: { target?: string }) => Promise<void>;
};

export type ActionConfigLike = {
  onMessage?: (data: JsonValue, context: { peerId: string }) => void;
};

export type RoomLike = {
  makeAction: (namespace: string, config?: ActionConfigLike) => ActionLike;
  getPeers: () => Record<string, unknown>;
  leave: () => Promise<void>;
  onPeerJoin: ((peerId: string) => void) | null;
  onPeerLeave: ((peerId: string) => void) | null;
};

export type JoinRoomLike = (
  config: RoomConfigLike,
  roomId: string,
  callbacks?: JoinCallbacksLike,
) => RoomLike;

/**
 * The compile-time proof that the seam above still matches the library. Nothing reads
 * this constant at runtime; it exists so that a Trystero upgrade that moves one of
 * these signatures is a type error in one file.
 */
const trysteroJoin: JoinRoomLike = trysteroJoinRoom;

/** What the implementation needs from the outside world. Substituted wholesale in tests. */
export type TrysteroDeps = {
  joinRoom: JoinRoomLike;
  selfId: PeerId;
};

export const defaultTrysteroDeps: TrysteroDeps = {
  joinRoom: trysteroJoin,
  selfId: trysteroSelfId,
};

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const LOG_PREFIX = 'lantern:net';

/**
 * The default log sink. Peer bugs are diagnosed from the browser console — often on
 * somebody else's machine, over a call, after the fact — so every peer event goes there
 * unless the caller supplies somewhere better.
 *
 * `console.info` rather than `console.log`: CLAUDE.md §9 bans `log` so that a stray
 * debugging print cannot reach a commit, and `info` is visible at the console's default
 * level where `debug` is not.
 */
export const consoleTransportLogger: TransportLogger = (entry: TransportLogEntry): void => {
  const line = `[${LOG_PREFIX}] ${entry.message}`;

  if (entry.level === 'error') {
    console.error(line);
  } else if (entry.level === 'warn') {
    console.warn(line);
  } else {
    console.info(line);
  }
};

// ---------------------------------------------------------------------------
// The implementation
// ---------------------------------------------------------------------------

/**
 * Join a room and return a `Transport` over it.
 *
 * Joining is synchronous in Trystero: the room object exists immediately and peers
 * arrive later. So two different failures are reported two different ways, and they are
 * not interchangeable — the room could not be created at all (`join-failed`, returned
 * here), or signalling refused the join afterwards (`join-refused`, delivered to
 * `handlers.onError`).
 */
export function joinTrysteroRoom(
  options: TransportOptions,
  deps: TrysteroDeps = defaultTrysteroDeps,
): Result<Transport> {
  const { roomId, password, handlers = {}, log = consoleTransportLogger } = options;

  function record(level: TransportLogEntry['level'], message: string): void {
    log({ at: Date.now(), level, message });
  }

  function report(error: TransportError): void {
    record(error.kind === 'unknown-peer' ? 'warn' : 'error', `${error.kind}: ${error.message}`);
    handlers.onError?.(error);
  }

  /**
   * Our own bookkeeping, fed by the transport's join and leave events. It is what
   * `getPeers()` answers with and what `sendTo` checks against, deliberately: Trystero's
   * `send` only prints a console warning when a target has gone (`action-wire.mjs`,
   * `iterate`), so without this check a message to a departed peer resolves as if it
   * had been delivered.
   */
  const peers = new Set<PeerId>();

  /** Peers we have received at least one message from. Only logged the first time. */
  const heardFrom = new Set<PeerId>();

  let hasLeft = false;
  let room: RoomLike;
  let action: ActionLike;

  record('info', `joining room "${roomId}" as ${shortPeerId(deps.selfId)}`);

  try {
    room = deps.joinRoom(
      { appId: TRYSTERO_APP_ID, ...(password === undefined ? {} : { password }) },
      roomId,
      {
        onJoinError: (details) => {
          report({ kind: 'join-refused', message: `${details.error} (room "${roomId}")` });
        },
      },
    );

    action = room.makeAction(TRYSTERO_ACTION_NAMESPACE, {
      onMessage: (data, context) => {
        receive(data, context.peerId);
      },
    });
  } catch (error) {
    const message = describeError(error);
    record('error', `join-failed: ${message}`);
    return failure('join-failed', message);
  }

  /**
   * Is this something the library gave us an id for? Trystero types `peerId` as a
   * `string` and always has one, so this is a contract check rather than a suspicion —
   * but it is the contract the whole identity rule rests on, and an id we cannot use is
   * a message we cannot attribute. Nothing is guessed and nothing is passed upward:
   * `''` in the roster would be one nameless row that every later message joined.
   */
  function attributable(peerId: unknown, what: string): peerId is PeerId {
    if (isPeerId(peerId)) return true;

    report({
      kind: 'unattributable',
      message: `${what} with no usable peer id — the transport reported ${JSON.stringify(peerId)}`,
    });
    return false;
  }

  /**
   * CLAUDE.md §2.8 — the sender is `peerId`, the id the transport reports, and nothing
   * inside `data` is consulted to decide who sent it. `data` stays `unknown` on the way
   * up: it is untrusted until `net/protocol.ts` parses it (#39).
   *
   * The one thing a peer cannot choose is which connection its message arrives on. It
   * picks the id it announces itself by — Trystero reads that out of a signalling
   * payload the peer wrote (`topic-strategy.mjs`) — so the id is not a credential and
   * is not treated as one. It is a name for a connection, and the connection is what
   * attribution actually is.
   */
  function receive(data: JsonValue, peerId: PeerId): void {
    if (hasLeft) {
      return;
    }

    if (!attributable(peerId, 'dropped a message')) {
      return;
    }

    const size = checkEventSize(data);
    if (!size.ok) {
      report({
        kind: size.error.kind,
        message: `dropped a message from ${shortPeerId(peerId)}: ${size.error.message}`,
      });
      return;
    }

    if (!heardFrom.has(peerId)) {
      heardFrom.add(peerId);
      record('info', `first message from ${shortPeerId(peerId)} — messages are crossing`);
    }

    handlers.onMessage?.({ from: peerId, data });
  }

  room.onPeerJoin = (peerId) => {
    if (!attributable(peerId, 'a peer joined')) return;

    peers.add(peerId);
    record('info', `peer joined ${shortPeerId(peerId)} (${peers.size} connected)`);
    handlers.onPeerJoin?.(peerId);
  };

  room.onPeerLeave = (peerId) => {
    if (!attributable(peerId, 'a peer left')) return;

    peers.delete(peerId);
    heardFrom.delete(peerId);
    record('info', `peer left ${shortPeerId(peerId)} (${peers.size} connected)`);
    handlers.onPeerLeave?.(peerId);
  };

  async function send(payload: JsonValue, target?: PeerId): Promise<Result> {
    const addressed = target === undefined ? 'everyone' : shortPeerId(target);

    if (hasLeft) {
      const error: TransportError = {
        kind: 'not-joined',
        message: `send to ${addressed} after leaving room "${roomId}"`,
      };
      report(error);
      return { ok: false, error };
    }

    const size = checkEventSize(payload);
    if (!size.ok) {
      report({
        kind: size.error.kind,
        message: `refused to send to ${addressed}: ${size.error.message}`,
      });
      return { ok: false, error: size.error };
    }

    if (target !== undefined && !peers.has(target)) {
      const error: TransportError = {
        kind: 'unknown-peer',
        message: `no connected peer ${shortPeerId(target)}`,
      };
      report(error);
      return { ok: false, error };
    }

    try {
      await action.send(payload, target === undefined ? undefined : { target });
      return ok(undefined);
    } catch (caught) {
      const error: TransportError = {
        kind: 'transport-failed',
        message: `send to ${addressed} failed: ${describeError(caught)}`,
      };
      report(error);
      return { ok: false, error };
    }
  }

  const transport: Transport = {
    selfId: deps.selfId,
    roomId,

    getPeers: () => [...peers],

    broadcast: (payload) => send(payload),

    sendTo: (peerId, payload) => send(payload, peerId),

    /**
     * Idempotent, and detaches the peer callbacks first so a leave that arrives while
     * Trystero is tearing the room down cannot call back into a transport that no
     * longer exists. Departing peers are not synthesised as leave events: leaving is a
     * deliberate local act, and the caller already knows the room is gone.
     */
    leave: async () => {
      if (hasLeft) {
        return ok(undefined);
      }

      hasLeft = true;
      room.onPeerJoin = null;
      room.onPeerLeave = null;
      peers.clear();
      heardFrom.clear();
      record('info', `leaving room "${roomId}"`);

      try {
        await room.leave();
        return ok(undefined);
      } catch (caught) {
        const error: TransportError = {
          kind: 'transport-failed',
          message: `leaving room "${roomId}" failed: ${describeError(caught)}`,
        };
        report(error);
        return { ok: false, error };
      }
    },
  };

  return ok(transport);
}
