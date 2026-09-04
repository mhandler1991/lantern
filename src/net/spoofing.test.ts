// Issue #41 — identity comes from the transport, never the payload (CLAUDE.md §2.8,
// DESIGN.md §3). The rule is spread over four files, and each of them is tested on its
// own: the schemas have no sender field (`protocol.test.ts`), the transport reports the
// peer id it was given (`trystero.test.ts`), the roster keys on `from` (`presence.test.ts`).
//
// None of that is the claim. The claim is about the *path* — that a peer sending
// whatever it likes cannot end up acting as another peer — and a property that holds in
// four files separately can still fail where they meet. So nothing here is stubbed
// above the fake Trystero: a payload travels the library callback, the transport's
// attribution and size wall, `receiveEvent`, and the roster, exactly as it does in
// `state/use-presence.ts`, and what is asserted is the table at the end of it.
//
// 📌 What a peer *can* do is lie about its numbers, and it stays able to: it owns its
// own row. The rule is only that its lies land on its own row and nobody else's.

import { describe, expect, it } from 'vitest';
import { MAX_PEER_ID_LENGTH, PROTOCOL_VERSION } from '../constants';
import type { PresenceMember, PresenceState } from './presence';
import {
  beginPresence,
  electHost,
  peerArrived,
  peerDeparted,
  presenceMembers,
  receivePresence,
} from './presence';
import type { ProtocolEvent, ProtocolRejection, PublicCharacter } from './protocol';
import { identityClaimsIn, receiveEvent } from './protocol';
import type { JsonValue, PeerId, TransportLogEntry } from './transport';
import type { ActionConfigLike, JoinRoomLike, RoomLike } from './trystero';
import { joinTrysteroRoom } from './trystero';

// Trystero's own ids are twenty characters of `[0-9A-Za-z]` (`genId(20)`), so the ids
// here are that shape rather than anything this app would have chosen.
const US: PeerId = 'aQ3kR9tLm2Xv7BnW4pZs';
const MALLORY: PeerId = 'bH8jT1cY6qNd0FgU5eRk';
const BRANN: PeerId = 'cV2wS7xM4hK9zP3nD6tB';

const ROOM = 'FIRELIT';

function character(name: string, overrides: Partial<PublicCharacter> = {}): PublicCharacter {
  return {
    name,
    ancestry: 'Human',
    className: 'Thief',
    level: 1,
    hp: { current: 5, max: 5 },
    ac: 12,
    conditions: [],
    carryingLight: false,
    luck: 0,
    ...overrides,
  };
}

const VESS = character('Vess');

function hello(who: PublicCharacter, joinedAt: number): ProtocolEvent {
  return { v: PROTOCOL_VERSION, t: 'hello', character: who, joinedAt };
}

function state(who: PublicCharacter): ProtocolEvent {
  return { v: PROTOCOL_VERSION, t: 'state', character: who };
}

// ---------------------------------------------------------------------------
// One seat at the table, wired the way the app wires it
// ---------------------------------------------------------------------------

/**
 * Trystero, reduced to what `net/trystero.ts` calls. `deliver` is the library handing a
 * payload up with the peer id it arrived from — the one thing a peer does not choose.
 */
type Library = {
  readonly joinRoom: JoinRoomLike;
  readonly deliver: (data: JsonValue, from: string) => void;
  readonly join: (id: string) => void;
  readonly leave: (id: string) => void;
};

function fakeLibrary(): Library {
  let onMessage: ActionConfigLike['onMessage'];
  let room: RoomLike | null = null;

  const joinRoom: JoinRoomLike = () => {
    const made: RoomLike = {
      makeAction: (_namespace, config) => {
        onMessage = config?.onMessage;
        return { send: async () => undefined };
      },
      getPeers: () => ({}),
      leave: async () => undefined,
      onPeerJoin: null,
      onPeerLeave: null,
    };

    room = made;
    return made;
  };

  return {
    joinRoom,
    deliver: (data, from) => onMessage?.(data, { peerId: from }),
    join: (id) => room?.onPeerJoin?.(id),
    leave: (id) => room?.onPeerLeave?.(id),
  };
}

type Seat = Library & {
  readonly members: () => readonly PresenceMember[];
  readonly rowFor: (id: PeerId) => PresenceMember | undefined;
  readonly host: () => PeerId | null;
  readonly rejections: readonly ProtocolRejection[];
  readonly log: readonly TransportLogEntry[];
};

const OUR_ARRIVAL = 1_700_000_000_000;

/**
 * Us, in a room. The handlers below are `state/use-presence.ts` with React taken out —
 * same calls, same order — because what is being tested is the path and a shortcut
 * through it would be a test of nothing.
 */
function sit(selfId: PeerId = US): Seat {
  const library = fakeLibrary();
  const log: TransportLogEntry[] = [];
  const rejections: ProtocolRejection[] = [];

  let presence: PresenceState = beginPresence(selfId, OUR_ARRIVAL);

  const joined = joinTrysteroRoom(
    {
      roomId: ROOM,
      log: (entry) => log.push(entry),
      handlers: {
        onPeerJoin: (peerId) => {
          presence = peerArrived(presence, peerId);
        },
        onPeerLeave: (peerId) => {
          presence = peerDeparted(presence, peerId);
        },
        onMessage: ({ from, data }) => {
          // The whole rule, in one line. `from` is the transport's word; `data` gets no
          // say in it and no chance to supply one.
          const received = receiveEvent(from, data);
          if (!received.ok) {
            rejections.push(received.rejection);
            return;
          }

          presence = receivePresence(presence, received.received);
        },
      },
    },
    { joinRoom: library.joinRoom, selfId },
  );

  if (!joined.ok) throw new Error(`could not join: ${joined.error.kind}`);

  const members = (): readonly PresenceMember[] => presenceMembers(presence, VESS);

  return {
    ...library,
    members,
    rowFor: (id) => members().find((member) => member.id === id),
    host: () => electHost(members()),
    rejections,
    log,
  };
}

/** Every event type, each one carrying a claim about who sent it. */
function spoofs(claimed: PeerId): readonly { readonly what: string; readonly payload: JsonValue }[] {
  const mine = character('Mallory');

  return [
    { what: 'hello with a from', payload: { ...hello(mine, 1), from: claimed } },
    { what: 'hello with a peerId', payload: { ...hello(mine, 1), peerId: claimed } },
    { what: 'hello with a sender', payload: { ...hello(mine, 1), sender: claimed } },
    { what: 'hello with an author', payload: { ...hello(mine, 1), author: claimed } },
    { what: 'state with a from', payload: { ...state(mine), from: claimed } },
    {
      what: 'state whose character claims a seat',
      payload: { ...state(mine), character: { ...mine, id: claimed } },
    },
    {
      what: 'hello whose character claims a seat',
      payload: { ...hello(mine, 1), character: { ...mine, id: claimed } },
    },
    {
      what: 'roll with a from',
      payload: {
        v: PROTOCOL_VERSION,
        t: 'roll',
        id: 'r_2b4801',
        label: 'Shortsword',
        dice: [{ sides: 6, value: 4 }],
        modifier: 0,
        visibility: 'everyone',
        lookup: null,
        from: claimed,
      },
    },
    {
      what: 'scene with a from',
      payload: { v: PROTOCOL_VERSION, t: 'scene', location: 'The Ossuary', torch: 'dim', from: claimed },
    },
  ];
}

// ---------------------------------------------------------------------------

describe('a peer that lies about who it is', () => {
  it('is attributed to the connection it arrived on, not to the id it claimed', () => {
    const table = sit();
    table.join(MALLORY);
    table.deliver({ ...hello(character('Mallory'), 1), from: BRANN } as JsonValue, MALLORY);

    // The claim buys nothing in either direction: no row appears for the peer it named,
    // and the row it does hold is its own.
    expect(table.rowFor(BRANN)).toBeUndefined();
    expect(table.rowFor(MALLORY)?.id).toBe(MALLORY);
    expect(table.members().map((member) => member.id).sort()).toEqual([MALLORY, US].sort());
  });

  it('cannot act as another peer, in any event and under any name for the sender', () => {
    for (const spoof of spoofs(BRANN)) {
      const table = sit();

      // Brann is genuinely here, introduced from Brann's own connection.
      table.join(BRANN);
      table.deliver(hello(character('Brann', { hp: { current: 9, max: 9 } }), 10) as JsonValue, BRANN);

      table.join(MALLORY);
      table.deliver(spoof.payload, MALLORY);

      const brann = table.rowFor(BRANN);
      expect(brann?.character?.name, spoof.what).toBe('Brann');
      expect(brann?.character?.hp.current, spoof.what).toBe(9);
      expect(brann?.joinedAt, spoof.what).toBe(10);

      // Refused whole rather than half-read: Mallory is still the anonymous row its own
      // connection earned, and the rejection is a value the caller was handed.
      expect(table.rowFor(MALLORY)?.character, spoof.what).toBeNull();
      expect(table.rejections.length, spoof.what).toBe(1);
    }
  });

  it('cannot take the chair by naming the peer that holds it', () => {
    const table = sit();

    table.join(BRANN);
    table.deliver(hello(character('Brann'), 1) as JsonValue, BRANN);
    expect(table.host()).toBe(BRANN);

    // Arriving first is the only way to hold it, and `joinedAt` is Mallory's own to
    // state — for Mallory's row. Claiming Brann's id does not move Brann's.
    table.join(MALLORY);
    table.deliver({ ...hello(character('Mallory'), 0), from: BRANN } as JsonValue, MALLORY);

    expect(table.host()).toBe(BRANN);
    expect(table.rowFor(BRANN)?.joinedAt).toBe(1);
  });

  it('cannot become us by sending our own id', () => {
    const table = sit();

    table.join(MALLORY);
    table.deliver({ ...hello(character('Not Vess'), 1), from: US } as JsonValue, MALLORY);
    // And the same payload without the claim, arriving on a connection Trystero would
    // never open — our own id — is still not us.
    table.deliver(hello(character('Not Vess'), 1) as JsonValue, US);

    const ours = table.members().filter((member) => member.id === US);
    expect(ours).toHaveLength(1);
    expect(ours[0]?.isSelf).toBe(true);
    expect(ours[0]?.character?.name).toBe('Vess');
  });

  it('is told apart from a peer running a different build', () => {
    const table = sit();
    table.join(MALLORY);

    table.deliver({ ...hello(character('Mallory'), 1), from: BRANN } as JsonValue, MALLORY);
    const [spoof] = table.rejections;

    expect(spoof?.kind).toBe('malformed');
    // A spoof and a typo are both "unrecognized key" to Zod, and they are not the same
    // thing to whoever is reading the log at the time (#41).
    expect(spoof?.message).toContain('from');
    expect(spoof?.message).toContain('identity comes from the transport');
  });
});

describe('a peer that lies about everything else', () => {
  it('keeps its own row, because that is the one thing it owns', () => {
    const table = sit();
    table.join(MALLORY);

    // A ninth-level 30 AC thief with maximum luck is a peer lying about its numbers,
    // and DESIGN.md §2 lets it: the numbers are its own to state. Only the seat is not.
    table.deliver(
      hello(character('Mallory', { level: 9, ac: 30, luck: 9, hp: { current: 99, max: 99 } }), 1) as JsonValue,
      MALLORY,
    );

    expect(table.rowFor(MALLORY)?.character?.ac).toBe(30);
    expect(table.rejections).toHaveLength(0);
    // Nothing it said touched anyone else's row.
    expect(table.rowFor(US)?.character).toEqual(VESS);
  });
});

describe('the transport as the source of identity', () => {
  it('drops a message the library gave no usable peer id for', () => {
    const table = sit();

    table.deliver(hello(character('Nobody'), 1) as JsonValue, '');
    table.deliver(hello(character('Nobody'), 1) as JsonValue, 'x'.repeat(MAX_PEER_ID_LENGTH + 1));

    // Nothing was attributed to a guess, and nothing reached the roster to be attributed.
    expect(table.members()).toHaveLength(1);
    expect(table.rejections).toHaveLength(0);

    const dropped = table.log.filter((entry) => entry.message.includes('unattributable'));
    expect(dropped).toHaveLength(2);
  });

  it('refuses to attribute an event when there is no transport id to attribute it to', () => {
    // Not reachable through the transport, which checks first. It is the floor under a
    // later caller that forgets: the message is lost, never filed under a made-up peer.
    const refused = receiveEvent('', hello(VESS, 1));

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.rejection.message).toContain('cannot be attributed');
  });

  it('keeps a peer id out of the roster that the library never reported', () => {
    const table = sit();

    table.join(MALLORY);
    table.leave(MALLORY);
    // Gone by the transport's word. A message that arrives afterwards is attributed to
    // the connection it came on and puts that peer back — which is honest, because the
    // message is evidence the peer is here — and it still is not Brann.
    table.deliver(hello(character('Mallory'), 1) as JsonValue, MALLORY);

    expect(table.rowFor(MALLORY)?.character?.name).toBe('Mallory');
    expect(table.rowFor(BRANN)).toBeUndefined();
  });
});

describe('identityClaimsIn', () => {
  it('names every place a payload tried to say who sent it', () => {
    expect(identityClaimsIn({ from: 'a', peerId: 'b' })).toEqual(['from', 'peerId']);
    expect(identityClaimsIn({ character: { id: 'a', from: 'b' } })).toEqual([
      'character.id',
      'character.from',
    ]);
  });

  it('says nothing about an honest payload, or about something that is not one', () => {
    expect(identityClaimsIn(hello(VESS, 1))).toEqual([]);
    expect(identityClaimsIn(state(VESS))).toEqual([]);
    expect(identityClaimsIn(null)).toEqual([]);
    expect(identityClaimsIn(['from'])).toEqual([]);
    expect(identityClaimsIn('from')).toEqual([]);
  });

  it('reads own keys only, so a prototype cannot supply the claim', () => {
    const payload = Object.create({ from: BRANN }) as Record<string, unknown>;
    payload['v'] = PROTOCOL_VERSION;

    expect(identityClaimsIn(payload)).toEqual([]);
  });
});
