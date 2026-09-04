// The host is derived, never assigned — so the thing worth testing is not "does it pick
// one" but "does every client pick the same one, from the same facts, in any order".
//
// So most of these tests build the same room from two or three different vantage points
// and assert the answers match. That is the acceptance criterion stated as an assertion:
// there is no election protocol to test, only agreement.

import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../constants';
import {
  beginPresence,
  electHost,
  peerArrived,
  peerDeparted,
  presenceMembers,
  receivePresence,
  type PresenceState,
} from './presence';
import type { HelloEvent, ProtocolEvent, PublicCharacter, RollEvent } from './protocol';
import type { PeerId } from './transport';

function publicCharacter(name: string): PublicCharacter {
  return {
    name,
    ancestry: 'Human',
    className: 'Thief',
    level: 1,
    hp: { current: 5, max: 5 },
    ac: 12,
    conditions: [],
    carryingLight: false,
    luck: 1,
  };
}

function hello(joinedAt: number, name = 'Someone'): HelloEvent {
  return { v: PROTOCOL_VERSION, t: 'hello', character: publicCharacter(name), joinedAt };
}

/** Apply a peer's hello: it connected, then it introduced itself. */
function announces(state: PresenceState, from: PeerId, event: HelloEvent): PresenceState {
  return receivePresence(peerArrived(state, from), { from, event });
}

/** What one client concludes, given its own id and arrival and everyone else's hello. */
function hostSeenBy(
  selfId: PeerId,
  joinedAt: number,
  others: readonly (readonly [PeerId, HelloEvent])[],
): PeerId | null {
  let state = beginPresence(selfId, joinedAt);
  for (const [id, event] of others) state = announces(state, id, event);

  return electHost(presenceMembers(state, publicCharacter('Us')));
}

describe('electHost', () => {
  it('seats the peer that has been present longest', () => {
    const state = announces(
      announces(beginPresence('self', 200), 'early', hello(100)),
      'late',
      hello(300),
    );

    expect(electHost(presenceMembers(state, publicCharacter('Us')))).toBe('early');
  });

  it('breaks a tie on peer id', () => {
    const state = announces(
      announces(beginPresence('self', 999), 'bbb', hello(100)),
      'aaa',
      hello(100),
    );

    expect(electHost(presenceMembers(state, publicCharacter('Us')))).toBe('aaa');
  });

  it('breaks a tie by code unit, not by locale', () => {
    // 'B' (0x42) sorts before 'a' (0x61) by code unit, and after it under an English
    // collator. A localeCompare here would seat a different host in a different locale,
    // which is exactly the disagreement the whole derivation exists to avoid.
    expect('B'.localeCompare('a')).toBeGreaterThan(0);

    const state = announces(
      announces(beginPresence('self', 999), 'aardvark', hello(100)),
      'Badger',
      hello(100),
    );

    expect(electHost(presenceMembers(state, publicCharacter('Us')))).toBe('Badger');
  });

  it('seats us when we are the one who has been here longest', () => {
    const state = announces(beginPresence('self', 10), 'other', hello(20));

    expect(electHost(presenceMembers(state, publicCharacter('Us')))).toBe('self');
  });

  it('ignores the order the members are given in', () => {
    const state = announces(
      announces(announces(beginPresence('self', 400), 'c', hello(300)), 'a', hello(100)),
      'b',
      hello(200),
    );

    const members = presenceMembers(state, publicCharacter('Us'));
    expect(electHost([...members].reverse())).toBe('a');
    expect(electHost(members)).toBe('a');
  });

  it('has no answer for a room nobody has introduced themselves in', () => {
    expect(electHost([])).toBeNull();
    expect(electHost([{ id: 'quiet', isSelf: false, joinedAt: null, character: null }])).toBeNull();
  });
});

describe('every client agrees', () => {
  // Three people at one table. Each knows its own arrival first-hand and everyone
  // else's from their hello, and they hear each other in whatever order the mesh
  // connects them — which is never the same order twice.
  const arrivals: readonly (readonly [PeerId, number])[] = [
    ['ash', 100],
    ['bram', 100],
    ['corvin', 250],
  ];

  function helloesFor(selfId: PeerId): readonly (readonly [PeerId, HelloEvent])[] {
    return arrivals
      .filter(([id]) => id !== selfId)
      .map(([id, at]) => [id, hello(at, id)] as const);
  }

  it('names the same host on every client, whatever order peers arrive in', () => {
    const hosts = arrivals.map(([selfId, joinedAt]) => {
      const others = helloesFor(selfId);
      return [
        hostSeenBy(selfId, joinedAt, others),
        hostSeenBy(selfId, joinedAt, [...others].reverse()),
      ];
    });

    // 'ash' and 'bram' arrived in the same millisecond; the id breaks it.
    expect(hosts.flat()).toEqual(['ash', 'ash', 'ash', 'ash', 'ash', 'ash']);
  });

  it('migrates on every client at once when the host leaves', () => {
    const before = arrivals.map(([selfId, joinedAt]) =>
      hostSeenBy(selfId, joinedAt, helloesFor(selfId)),
    );
    expect(before).toEqual(['ash', 'ash', 'ash']);

    // Ash closes the tab. Nobody announces anything; the roster simply loses a row.
    const after = arrivals
      .filter(([selfId]) => selfId !== 'ash')
      .map(([selfId, joinedAt]) => {
        let state = beginPresence(selfId, joinedAt);
        for (const [id, event] of helloesFor(selfId)) state = announces(state, id, event);
        state = peerDeparted(state, 'ash');

        return electHost(presenceMembers(state, publicCharacter('Us')));
      });

    expect(after).toEqual(['bram', 'bram']);
  });

  it('does not seat a peer whose hello has not arrived yet', () => {
    // Both clients hold the same two peers. One has heard ash's hello and one has not,
    // which is the ordinary state of a room for the first few hundred milliseconds.
    const heard = announces(beginPresence('self', 500), 'ash', hello(100));
    const notHeard = peerArrived(beginPresence('self', 500), 'ash');

    expect(electHost(presenceMembers(heard, publicCharacter('Us')))).toBe('ash');
    expect(electHost(presenceMembers(notHeard, publicCharacter('Us')))).toBe('self');

    // And the peer is still in the room either way — present, just not a candidate.
    expect(presenceMembers(notHeard, publicCharacter('Us')).map((member) => member.id)).toEqual([
      'self',
      'ash',
    ]);
  });
});

describe('the roster', () => {
  it('puts us in it, in seat order, with our current projection', () => {
    const state = announces(beginPresence('self', 200), 'early', hello(100, 'Early'));
    const members = presenceMembers(state, publicCharacter('Us'));

    expect(members.map((member) => [member.id, member.isSelf])).toEqual([
      ['early', false],
      ['self', true],
    ]);
    expect(members[1]?.character?.name).toBe('Us');
  });

  it('holds a peer that has not introduced itself, with no claims about it', () => {
    const members = presenceMembers(peerArrived(beginPresence('self', 1), 'quiet'), null);

    expect(members[1]).toEqual({ id: 'quiet', isSelf: false, joinedAt: null, character: null });
  });

  it('sorts peers that have said nothing after everyone who has', () => {
    let state = beginPresence('self', 900);
    state = peerArrived(state, 'quiet');
    state = announces(state, 'known', hello(100));

    expect(presenceMembers(state, null).map((member) => member.id)).toEqual([
      'known',
      'self',
      'quiet',
    ]);
  });

  it('is unchanged by a peer arriving twice or a stranger leaving', () => {
    const state = peerArrived(beginPresence('self', 1), 'ash');

    expect(peerArrived(state, 'ash')).toBe(state);
    expect(peerDeparted(state, 'nobody')).toBe(state);
  });

  it('never seats us twice, whatever a peer claims to be', () => {
    const state = peerArrived(beginPresence('self', 1), 'self');

    expect(state.peers).toEqual([]);
    expect(receivePresence(state, { from: 'self', event: hello(0) })).toBe(state);
  });

  it('takes a peer at its word when it says hello twice', () => {
    let state = announces(beginPresence('self', 1), 'ash', hello(500, 'Ash'));
    state = receivePresence(state, { from: 'ash', event: hello(100, 'Ash the Elder') });

    expect(state.peers).toEqual([
      { id: 'ash', joinedAt: 100, character: publicCharacter('Ash the Elder') },
    ]);
  });

  it('updates a projection from a state event without touching the seat', () => {
    let state = announces(beginPresence('self', 1), 'ash', hello(100, 'Ash'));
    state = receivePresence(state, {
      from: 'ash',
      event: { v: PROTOCOL_VERSION, t: 'state', character: publicCharacter('Ash, bloodied') },
    });

    expect(state.peers[0]?.joinedAt).toBe(100);
    expect(state.peers[0]?.character?.name).toBe('Ash, bloodied');
  });

  it('adds a peer we only ever heard a state event from, without seating it', () => {
    const state = receivePresence(beginPresence('self', 900), {
      from: 'ash',
      event: { v: PROTOCOL_VERSION, t: 'state', character: publicCharacter('Ash') },
    });

    expect(state.peers).toEqual([{ id: 'ash', joinedAt: null, character: publicCharacter('Ash') }]);
    expect(electHost(presenceMembers(state, null))).toBe('self');
  });

  it('leaves the roster alone for every event that is not about presence', () => {
    const state = announces(beginPresence('self', 1), 'ash', hello(100));

    const roll: RollEvent = {
      v: PROTOCOL_VERSION,
      t: 'roll',
      id: 'r1',
      label: 'Longsword',
      dice: [{ sides: 20, value: 17 }],
      modifier: 2,
      visibility: 'everyone',
      lookup: null,
    };
    const scene: ProtocolEvent = {
      v: PROTOCOL_VERSION,
      t: 'scene',
      location: 'The stair',
      torch: 'dim',
    };

    expect(receivePresence(state, { from: 'ash', event: roll })).toBe(state);
    expect(receivePresence(state, { from: 'ash', event: scene })).toBe(state);
  });
});
