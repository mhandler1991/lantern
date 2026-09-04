/**
 * The room, joined. One hook: it owns the transport's whole life, feeds what comes off
 * the wire into the pure roster in `net/presence.ts`, and hands back the table in seat
 * order with the host derived.
 *
 * **Joining is an effect, and leaving is its cleanup.** A room is the outside world, so
 * an effect is exactly the right tool — and the cleanup mirroring the setup is what
 * makes it survive React 18's StrictMode double-mount in development, which joins,
 * leaves and joins again on purpose to prove the pair is symmetric.
 *
 * **`hello` is sent to each peer as it arrives, not broadcast on join.** Broadcasting at
 * the moment we join is a race we lose: the peer list is empty for as long as it takes
 * the first connection to establish, so the broadcast reaches nobody. `onPeerJoin` fires
 * on *both* sides of every new connection, so one directed `hello` per join tells
 * exactly the peer that needs telling, exactly once, and the peers already in the room
 * learn about us from their own side of the same event.
 *
 * **The projection goes out twice, for two different reasons.** `hello` carries it to
 * each peer as that peer arrives, because the host election needs the `joinedAt` that
 * travels with it. `state` broadcasts it afterwards whenever it changes — that is the
 * whole of how a party view stays current (DESIGN.md §2).
 *
 * The broadcast is debounced over `BROADCAST_DEBOUNCE_MS` and compared before it is
 * scheduled, because the sheet re-renders on every keystroke and almost none of those
 * keystrokes change any of the nine public fields. Trailing rather than leading: the
 * value worth sending is the one the player stopped on, not the first frame of a drag.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BROADCAST_DEBOUNCE_MS, PROTOCOL_VERSION } from '../constants';
import type { PresenceMember, PresenceState } from '../net/presence';
import { beginPresence, electHost, peerArrived, peerDeparted, presenceMembers, receivePresence } from '../net/presence';
import { samePublicCharacter, stateEvent } from '../net/projection';
import type { HelloEvent, ProtocolRejection, PublicCharacter } from '../net/protocol';
import { describeRejection, encodeEvent, receiveEvent } from '../net/protocol';
import type {
  PeerId,
  Result,
  Transport,
  TransportError,
  TransportLogger,
  TransportOptions,
} from '../net/transport';
import { shortPeerId } from '../net/transport';
import { consoleTransportLogger, joinTrysteroRoom } from '../net/trystero';

/**
 * Trystero hands back a room synchronously and peers arrive later, so there is no
 * "connecting" here to report. `failed` is the room that could not be created at all; a
 * join that signalling refuses afterwards arrives as an `error` while the status stays
 * `joined`, because the room object is real and may yet find peers.
 */
export type PresenceStatus = 'closed' | 'joined' | 'failed';

/** The transport seam, injectable so the hook tests without a relay or a real peer. */
export type JoinRoom = (options: TransportOptions) => Result<Transport>;

export type Presence = {
  readonly status: PresenceStatus;
  /** Our own peer id once we are in a room, null before. */
  readonly selfId: PeerId | null;
  /** The whole table in seat order — longest present first, ours included. */
  readonly members: readonly PresenceMember[];
  /** Derived on read from `members`, never assigned and never stored. */
  readonly hostId: PeerId | null;
  readonly isSelfHost: boolean;
  /** The most recent transport failure, or null. Shown, never swallowed. */
  readonly error: TransportError | null;
  /** The most recent payload a peer sent that was not a Lantern event. */
  readonly rejection: ProtocolRejection | null;
  readonly join: (roomId: string, password?: string) => void;
  readonly leave: () => void;
};

/** What one call to `join` asked for. A new object each time, which is what re-runs the effect. */
type Session = {
  readonly roomId: string;
  readonly password: string | undefined;
};

const NO_MEMBERS: readonly PresenceMember[] = [];

/**
 * `log` is the same sink the transport writes to, and it is one sink deliberately: a
 * peer that is not appearing is diagnosed from a single stream of lines, and a rejection
 * recorded somewhere else is a rejection nobody finds. Every dropped payload is written
 * there as well as shown, because the banner is gone the moment the next one arrives and
 * the console is what is still there afterwards (#40).
 */
export function usePresence(
  character: PublicCharacter,
  joinRoom: JoinRoom = joinTrysteroRoom,
  log: TransportLogger = consoleTransportLogger,
): Presence {
  const [session, setSession] = useState<Session | null>(null);
  const [presence, setPresence] = useState<PresenceState | null>(null);
  const [status, setStatus] = useState<PresenceStatus>('closed');
  const [error, setError] = useState<TransportError | null>(null);
  const [rejection, setRejection] = useState<ProtocolRejection | null>(null);

  /**
   * The projection as of the last render, for the transport callbacks to read. They are
   * created once per join and outlive every render after it, so closing over the value
   * would introduce whoever we were at the moment we joined to everyone who arrives
   * later. A ref kept current by an effect is synchronisation with the outside world,
   * which is what an effect is for (CLAUDE.md §6).
   */
  const characterRef = useRef(character);
  useEffect(() => {
    characterRef.current = character;
  }, [character]);

  /**
   * The room we are in, for the broadcast effect to reach. It is a ref rather than
   * state because a transport arriving is not something to re-render for — the status
   * beside it already is — and because the debounce timer has to read whichever room is
   * live when it *fires*, not whichever one was live when it was scheduled.
   */
  const transportRef = useRef<Transport | null>(null);

  /**
   * The projection the table has already been told about, and null when we are in no
   * room. It starts at whatever `hello` will carry, so joining a room and touching
   * nothing broadcasts nothing: every peer already has this exact projection from its
   * own introduction.
   */
  const broadcastRef = useRef<PublicCharacter | null>(null);

  /** One sink for everything this hook has to say. See the note on `log`. */
  const record = useCallback(
    (level: 'info' | 'warn' | 'error', message: string): void => {
      log({ at: Date.now(), level, message });
    },
    [log],
  );

  const join = useCallback((roomId: string, password?: string) => {
    setError(null);
    setRejection(null);
    setSession({ roomId, password: password === undefined || password === '' ? undefined : password });
  }, []);

  const leave = useCallback(() => {
    setSession(null);
  }, []);

  useEffect(() => {
    if (session === null) {
      // Not an unconditional write: React bails out when the value is unchanged, so
      // this settles on the first render and only runs again after an actual leave.
      setPresence(null);
      setStatus('closed');
      return;
    }

    /**
     * Our own arrival, read once per session. Everyone at the table compares this exact
     * number, because it is the one we put in every `hello` — which is what makes the
     * election agree across clients even though their clocks do not.
     */
    const joinedAt = Date.now();

    let transport: Transport | null = null;
    let isLive = true;

    /** Introduce ourselves to one peer. Failures are reported, never swallowed. */
    function announceTo(peerId: PeerId): void {
      if (transport === null) return;

      const hello: HelloEvent = {
        v: PROTOCOL_VERSION,
        t: 'hello',
        character: characterRef.current,
        joinedAt,
      };

      // CLAUDE.md §2.7 — outbound validation runs even when the table is empty. The bug
      // it catches is ours, and this is the last machine it can still be debugged on.
      const encoded = encodeEvent(hello);
      if (!encoded.ok) {
        // Ours, not theirs — an error rather than a warning, and on the one machine that
        // can still be debugged.
        record('error', `refused to send our own hello: ${describeRejection(encoded.rejection)}`);
        setRejection(encoded.rejection);
        return;
      }

      void transport.sendTo(peerId, encoded.payload).then((sent) => {
        if (!sent.ok && isLive) setError(sent.error);
      });
    }

    const joined = joinRoom({
      roomId: session.roomId,
      ...(session.password === undefined ? {} : { password: session.password }),
      log,
      handlers: {
        onPeerJoin: (peerId) => {
          if (!isLive) return;
          setPresence((current) => (current === null ? current : peerArrived(current, peerId)));
          announceTo(peerId);
        },

        onPeerLeave: (peerId) => {
          if (!isLive) return;
          // The whole of host migration: a row leaves the roster and the next read of
          // `electHost` names whoever is now longest present. Nothing is announced.
          setPresence((current) => (current === null ? current : peerDeparted(current, peerId)));
        },

        onMessage: ({ from, data }) => {
          if (!isLive) return;

          // `from` is the transport's word. Nothing inside `data` is consulted to decide
          // who sent it — the schemas have no such field to consult (CLAUDE.md §2.8).
          const received = receiveEvent(from, data);
          if (!received.ok) {
            // Dropped, recorded, and shown. PRD.md principle 4 — the roster is untouched
            // and the room carries on; a peer talking nonsense is not a reason to stop.
            record(
              'warn',
              `dropped a message from ${shortPeerId(from)}: ${describeRejection(received.rejection)}`,
            );
            setRejection(received.rejection);
            return;
          }

          setPresence((current) =>
            current === null ? current : receivePresence(current, received.received),
          );
        },

        onError: (failed) => {
          if (isLive) setError(failed);
        },
      },
    });

    if (!joined.ok) {
      setStatus('failed');
      setError(joined.error);
      return;
    }

    transport = joined.value;
    transportRef.current = transport;
    // The baseline the broadcast compares against: what every peer will be handed in
    // its own `hello`. Set here rather than at the first change, so a room joined and
    // left untouched puts one event on the wire per peer and no broadcasts at all.
    broadcastRef.current = characterRef.current;
    setPresence(beginPresence(transport.selfId, joinedAt));
    setStatus('joined');

    return () => {
      isLive = false;
      // Only if it is still ours. StrictMode tears the first room down after the second
      // is up, and clearing unconditionally would leave the live room unreachable.
      if (transportRef.current === transport) {
        transportRef.current = null;
        broadcastRef.current = null;
      }
      void joined.value.leave();
    };
  }, [session, joinRoom, log, record]);

  /**
   * The projection, re-broadcast on change (DESIGN.md §2).
   *
   * Nothing is scheduled unless one of the nine fields actually differs from what the
   * table was last told, so the common case — a journal entry being typed, a note being
   * edited — costs a comparison and no bytes. When something does differ, the timer is
   * restarted by every further change, so a run of edits coalesces into one event
   * carrying where the player ended up.
   *
   * A pending broadcast is dropped rather than flushed when the room closes. That is
   * the opposite of `usePersistentCharacter`, and deliberately: an unwritten save is
   * data the player loses, while an unsent projection is a message to a table we are
   * walking away from. There is no retry queue either — a send that fails is reported,
   * and the next real change carries the truth to whoever is still listening.
   */
  useEffect(() => {
    const sent = broadcastRef.current;
    if (transportRef.current === null || sent === null) return;
    if (samePublicCharacter(character, sent)) return;

    const timer = setTimeout(() => {
      // Read again rather than closing over it: the room may have been left in the
      // quarter second this was waiting, and a broadcast into a closed room is at best
      // an error to report.
      const live = transportRef.current;
      if (live === null) return;

      // CLAUDE.md §2.7 — the same wall the inbound path uses, on the way out, with an
      // empty table. What it catches is our own bug, on the machine that can debug it.
      const encoded = encodeEvent(stateEvent(character));
      if (!encoded.ok) {
        record('error', `refused to send our own state: ${describeRejection(encoded.rejection)}`);
        setRejection(encoded.rejection);
        return;
      }

      broadcastRef.current = character;
      void live.broadcast(encoded.payload).then((result) => {
        if (!result.ok) setError(result.error);
      });
    }, BROADCAST_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [character, record]);

  /**
   * Our own row is composed on read from the projection this render was given, so the
   * seat the party view draws for us cannot fall behind the sheet. Every other row is
   * whatever that peer last sent.
   */
  const members = useMemo(
    () => (presence === null ? NO_MEMBERS : presenceMembers(presence, character)),
    [presence, character],
  );

  const hostId = useMemo(() => electHost(members), [members]);

  return {
    status,
    selfId: presence === null ? null : presence.selfId,
    members,
    hostId,
    isSelfHost: hostId !== null && presence !== null && hostId === presence.selfId,
    error,
    rejection,
    join,
    leave,
  };
}
