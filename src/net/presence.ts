/**
 * Who is in the room, and who holds the chair. DESIGN.md §3.
 *
 * **The host is derived, never assigned.** Longest present, ties broken by peer id.
 * There is no election protocol, no announcement and no handover: every client computes
 * the same answer from the same facts, so a host that leaves is replaced the moment its
 * departure is noticed and nobody has to agree to anything.
 *
 * Three rules make "every client agrees" true rather than hopeful:
 *
 *   - **Only a peer that has said `hello` can hold the chair.** `joinedAt` arrives in
 *     that event and nowhere else. A peer whose connection is up but whose `hello` has
 *     not landed is *present* — it is in the roster and it is drawn — but it is not a
 *     candidate, because whether we have heard from it yet is a fact about our machine
 *     and not about the room. Making it eligible would seat a different host on every
 *     client for as long as one hello was in flight.
 *   - **The tie-break compares code units, never locales.** `localeCompare` orders
 *     strings differently under different locales and ICU builds, which is precisely
 *     how two browsers at one table would disagree about which of two peers is first.
 *     `<` on a string is the same everywhere.
 *   - **Nothing is timed out locally.** A peer leaves when the transport says it left.
 *     An idle-eviction timer would fire at a different moment on every client and split
 *     the roster, which costs more than the stale row it would clean up.
 *
 * A peer can lie about `joinedAt` to claim the chair. DESIGN.md §3 accepts that
 * knowingly: the host is a cosmetic role with no authority over anyone's dice, and a
 * consensus protocol would cost more than the chair is worth.
 *
 * 🚫 Pure. No React, no transport, no clock — every timestamp here arrives as an
 * argument, so the same inputs give the same roster on any machine at any time.
 */

import type { PeerId } from './transport';
import type { PublicCharacter, ReceivedEvent, Timestamp } from './protocol';

/**
 * One remote peer as we currently know it. `joinedAt` and `character` are null until
 * that peer's own `hello` supplies them — a connection is not an introduction.
 */
export type RemotePeer = {
  readonly id: PeerId;
  /** What the peer said about when it arrived. Null until its `hello` lands. */
  readonly joinedAt: Timestamp | null;
  readonly character: PublicCharacter | null;
};

/**
 * The room as this client sees it. Remote peers only: our own projection is not stored
 * here, because it is the sheet's and reading it from two places is how the two drift.
 * `presenceMembers` composes it in on read.
 */
export type PresenceState = {
  readonly selfId: PeerId;
  /** Our own `joinedAt` — the one value we broadcast, and the one everyone compares. */
  readonly joinedAt: Timestamp;
  readonly peers: readonly RemotePeer[];
};

/** A seat at the table, ours included. What the party view draws. */
export type PresenceMember = {
  readonly id: PeerId;
  readonly isSelf: boolean;
  /** Null for a peer that is connected but has not introduced itself yet. */
  readonly joinedAt: Timestamp | null;
  readonly character: PublicCharacter | null;
};

/**
 * The room, from the moment we joined it. `joinedAt` is read from the clock by the
 * caller rather than here, so this module has no clock to disagree with a test's.
 */
export function beginPresence(selfId: PeerId, joinedAt: Timestamp): PresenceState {
  return { selfId, joinedAt, peers: [] };
}

/** Where a peer sits in the list, or -1. */
function indexOfPeer(state: PresenceState, id: PeerId): number {
  return state.peers.findIndex((peer) => peer.id === id);
}

function withPeers(state: PresenceState, peers: readonly RemotePeer[]): PresenceState {
  return { selfId: state.selfId, joinedAt: state.joinedAt, peers };
}

function replacePeer(state: PresenceState, at: number, peer: RemotePeer): PresenceState {
  const peers = [...state.peers];
  peers[at] = peer;
  return withPeers(state, peers);
}

/**
 * The transport reports a connection. The peer is present immediately and anonymous
 * until its `hello` arrives — a row with no name is honest, and a row that appears only
 * once a hello lands makes a slow peer look like a broken one.
 *
 * Idempotent: a repeat join for a peer we already hold returns the same state object,
 * so React does not re-render for an event that changed nothing.
 */
export function peerArrived(state: PresenceState, id: PeerId): PresenceState {
  if (id === state.selfId || indexOfPeer(state, id) !== -1) return state;

  return withPeers(state, [...state.peers, { id, joinedAt: null, character: null }]);
}

/**
 * The transport reports a peer gone. This is the whole of host migration: the roster
 * loses a row, and the next `electHost` names whoever is now longest present.
 */
export function peerDeparted(state: PresenceState, id: PeerId): PresenceState {
  const at = indexOfPeer(state, id);
  if (at === -1) return state;

  return withPeers(
    state,
    state.peers.filter((peer) => peer.id !== id),
  );
}

/**
 * A protocol event, already parsed and already attributed to the peer the transport
 * named (CLAUDE.md §2.8 — `from` is never read off the payload, because no event has
 * such a field to read).
 *
 * `hello` introduces a peer; `state` updates one. A `state` from a peer we have no
 * `hello` for still puts it in the roster with what it sent: dropping traffic from a
 * peer whose introduction was lost would hide a player who is demonstrably here. It
 * stays out of the election until its `hello` arrives, which is the rule above.
 *
 * Every other event type is somebody else's business and leaves the roster untouched.
 */
export function receivePresence(state: PresenceState, received: ReceivedEvent): PresenceState {
  const { from, event } = received;

  // Nothing a peer sends can make it us. A duplicate of our own id would seat us twice.
  if (from === state.selfId) return state;

  if (event.t === 'hello') {
    const at = indexOfPeer(state, from);
    const peer: RemotePeer = { id: from, joinedAt: event.joinedAt, character: event.character };

    // A second hello is the peer correcting itself, and its own arrival time is its own
    // to state. Taking the newer one keeps one writer per character (DESIGN.md §2).
    return at === -1 ? withPeers(state, [...state.peers, peer]) : replacePeer(state, at, peer);
  }

  if (event.t === 'state') {
    const at = indexOfPeer(state, from);
    if (at === -1) {
      return withPeers(state, [
        ...state.peers,
        { id: from, joinedAt: null, character: event.character },
      ]);
    }

    const existing = state.peers[at];
    if (existing === undefined) return state;

    return replacePeer(state, at, { ...existing, character: event.character });
  }

  return state;
}

/**
 * Longest present first, ties broken by peer id; a peer that has not introduced itself
 * sits after everyone who has.
 *
 * Plain comparisons rather than `localeCompare`, and subtraction rather than a
 * numeric-aware collator: this order has to be identical in every browser at the table,
 * because it is the order the chair is handed out in.
 */
function compareSeats(a: PresenceMember, b: PresenceMember): number {
  if (a.joinedAt === null || b.joinedAt === null) {
    if (a.joinedAt !== null) return -1;
    if (b.joinedAt !== null) return 1;
  } else if (a.joinedAt !== b.joinedAt) {
    return a.joinedAt - b.joinedAt;
  }

  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * The whole table in seat order, ours included.
 *
 * Our own projection is passed in rather than stored, so the row the party view draws
 * for us is the same object the sheet renders from and cannot fall behind it.
 */
export function presenceMembers(
  state: PresenceState,
  self: PublicCharacter | null,
): readonly PresenceMember[] {
  const members: PresenceMember[] = [
    { id: state.selfId, isSelf: true, joinedAt: state.joinedAt, character: self },
    ...state.peers.map((peer) => ({
      id: peer.id,
      isSelf: false,
      joinedAt: peer.joinedAt,
      character: peer.character,
    })),
  ];

  return members.sort(compareSeats);
}

/**
 * Who holds the chair, from the roster and nothing else. Null when nobody in the room
 * has introduced themselves — which cannot happen while we are in it, since we know our
 * own arrival, and is the honest answer for a roster read before joining.
 *
 * Takes any order of members and does not assume `presenceMembers` sorted them, because
 * "every client agrees" has to survive two clients holding the same people in different
 * orders — which is the normal case, since peers arrive in whatever order they connect.
 */
export function electHost(members: readonly PresenceMember[]): PeerId | null {
  let host: PresenceMember | null = null;

  for (const member of members) {
    if (member.joinedAt === null) continue;
    if (host === null || compareSeats(member, host) < 0) host = member;
  }

  return host === null ? null : host.id;
}
