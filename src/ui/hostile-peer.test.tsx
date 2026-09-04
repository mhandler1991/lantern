// The other half of #40. `net/protocol.test.ts` proves the schemas refuse hostile input;
// this proves what the app does with the refusal, and what it does with the input it
// accepts — because "rejected" and "rendered as text" are both claims about the DOM and
// neither can be checked from a schema.
//
// Nothing is faked above Trystero. The fake is the library itself, so a payload here
// travels the whole real path: Trystero's `onMessage`, the transport's size wall,
// `receiveEvent`, the roster, and the lobby's own markup. What that path must do is
// PRD.md principle 4 — warn, degrade, keep going. A peer talking nonsense costs the
// table nothing, and a peer with a `<script>` in its name is a peer with an odd name.
//
// No @testing-library — CLAUDE.md §11 forbids installing a package without asking, and
// createRoot plus act is the whole harness (`ui/lobby.test.tsx` does the same).

import type { ReactElement } from 'react';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_CONDITIONS, MAX_EVENT_BYTES, PROTOCOL_VERSION } from '../constants';
import type { HelloEvent, PublicCharacter } from '../net/protocol';
import type { JsonValue, PeerId, TransportLogEntry, TransportLogger } from '../net/transport';
import { shortPeerId } from '../net/transport';
import type { ActionConfigLike, JoinRoomLike, RoomLike } from '../net/trystero';
import { joinTrysteroRoom } from '../net/trystero';
import type { JoinRoom, Presence } from '../state/use-presence';
import { usePresence } from '../state/use-presence';
import { useRoom } from '../state/use-room';
import { Lobby } from './Lobby';

declare global {
  // React reads this off the global to decide whether act() is legal here.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SELF: PeerId = 's'.repeat(64);
const PEER: PeerId = 'p'.repeat(64);
const ROOM = 'ABCDEF';

const US: PublicCharacter = {
  name: 'Vess',
  ancestry: 'Human',
  className: 'Thief',
  level: 1,
  hp: { current: 5, max: 5 },
  ac: 12,
  conditions: [],
  carryingLight: false,
  luck: 1,
};

/** A legitimate introduction, for the payloads that are only hostile in one place. */
function hello(character: PublicCharacter = US): HelloEvent {
  return { v: PROTOCOL_VERSION, t: 'hello', character, joinedAt: 1_700_000_000_000 };
}

// ---------------------------------------------------------------------------
// The fake library, and the app on top of it
// ---------------------------------------------------------------------------

/** Trystero, reduced to what `net/trystero.ts` calls and what a test needs to drive. */
type Fake = {
  readonly joinRoom: JoinRoomLike;
  /** The transport's own callback, as Trystero would call it. */
  readonly message: (data: JsonValue, from: PeerId) => void;
  readonly peerJoin: (id: PeerId) => void;
};

function makeFake(): Fake {
  let deliver: ActionConfigLike['onMessage'];
  let room: RoomLike | null = null;

  const joinRoom: JoinRoomLike = () => {
    const made: RoomLike = {
      makeAction: (_namespace, config) => {
        deliver = config?.onMessage;
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
    message: (data, from) => deliver?.(data, { peerId: from }),
    peerJoin: (id) => room?.onPeerJoin?.(id),
  };
}

let fake: Fake;
let log: TransportLogEntry[];
let container: HTMLDivElement;
let root: Root;
let latest: Presence | null = null;

/** Stable across renders, because the hook keeps it in an effect's dependencies. */
const capture: TransportLogger = (entry) => {
  log.push(entry);
};

const joinRoom: JoinRoom = (options) =>
  joinTrysteroRoom(options, { joinRoom: fake.joinRoom, selfId: SELF });

function Table(): ReactElement {
  const room = useRoom();
  const presence = usePresence(US, joinRoom, capture);
  latest = presence;

  return <Lobby room={room} presence={presence} />;
}

function presence(): Presence {
  if (latest === null) throw new Error('the lobby never rendered');
  return latest;
}

/** Open the room and put one peer in it, which is where every test below starts. */
async function joined(): Promise<void> {
  await act(async () => {
    root.render(<Table />);
  });
  await act(async () => {
    presence().join(ROOM);
  });
  await act(async () => {
    fake.peerJoin(PEER);
  });
}

/** One payload, delivered exactly as Trystero delivers one. */
async function deliver(data: unknown): Promise<void> {
  await act(async () => {
    // `data` is typed as JSON on the way in and is `unknown` by the time our code reads
    // it. A hostile peer is not bound by our types, so neither is this.
    fake.message(data as JsonValue, PEER);
  });
}

function warnings(): string {
  return [...container.querySelectorAll('.warning')].map((node) => node.textContent).join('\n');
}

function partyNames(): string[] {
  return [...container.querySelectorAll('.party__name')].map((node) => node.textContent ?? '');
}

function dropped(): TransportLogEntry[] {
  return log.filter((entry) => entry.message.includes('dropped a message'));
}

beforeEach(() => {
  fake = makeFake();
  log = [];
  latest = null;
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  document.title = 'lantern under test';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});

// ---------------------------------------------------------------------------

describe('a peer sending markup', () => {
  const MARKUP = '<img src=x onerror="document.title=\'pwned\'">';

  it('has it drawn as text, in a text node, with no element made', async () => {
    await joined();
    await deliver(hello({ ...US, name: MARKUP }));

    const [name] = [...container.querySelectorAll('.party__name')];
    expect(name?.textContent).toBe(MARKUP);
    expect([...(name?.childNodes ?? [])].every((node) => node.nodeType === Node.TEXT_NODE)).toBe(
      true,
    );

    // CLAUDE.md §2.6 is the whole point of this file: peer text reaches the DOM as text
    // nodes and nothing else, so there is no element to have run anything.
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(document.title).toBe('lantern under test');
  });

  it('is not turned away for it — a strange name is still a name', async () => {
    await joined();
    await deliver(hello({ ...US, name: MARKUP }));

    // PRD.md principle 4. Refusing this would cost a player their seat at the table.
    expect(partyNames()).toContain(MARKUP);
    expect(dropped()).toHaveLength(0);
  });

  it('cannot smuggle an element through a rejection message either', async () => {
    await joined();
    // The key is echoed back in the problem Zod raises, so the rejection text is peer
    // data too, and it is drawn by the same rule.
    await deliver({ ...hello(), '<script>alert(1)</script>': 1 });

    expect(warnings()).toContain('<script>alert(1)</script>');
    expect(container.querySelector('script')).toBeNull();
    expect(document.querySelectorAll('script')).toHaveLength(0);
  });
});

describe('a payload that is not a Lantern event', () => {
  it('is dropped, logged and shown, without reaching the roster', async () => {
    await joined();
    await deliver({ ...hello(), character: { ...US, level: 'high' } });

    expect(presence().rejection?.kind).toBe('malformed');
    expect(warnings()).toContain('Lantern could not read');
    expect(dropped()[0]?.level).toBe('warn');
    expect(dropped()[0]?.message).toContain('malformed');

    // The peer is still at the table — it is connected, it just has not said anything
    // we understood. Its row is its id, which is all we honestly have.
    expect(partyNames()).toHaveLength(2);
    expect(partyNames().some((name) => name.startsWith(shortPeerId(PEER)))).toBe(true);
  });

  it('says which version a peer is speaking when that is the problem', async () => {
    await joined();
    await deliver({ ...hello(), v: PROTOCOL_VERSION + 1 });

    expect(presence().rejection?.kind).toBe('version-mismatch');
    expect(warnings()).toContain(String(PROTOCOL_VERSION + 1));
    expect(dropped()[0]?.message).toContain('version-mismatch');
  });

  it('is dropped by the transport before parsing when it is oversized', async () => {
    await joined();
    await deliver('x'.repeat(MAX_EVENT_BYTES));

    // The size wall is the transport's, so this one never reaches the protocol at all.
    expect(presence().rejection).toBeNull();
    expect(presence().error?.kind).toBe('too-large');
    expect(log.some((entry) => entry.message.includes('too-large'))).toBe(true);
  });

  it('never throws into the UI, whatever it is', async () => {
    await joined();

    const hostile: readonly unknown[] = [
      null,
      undefined,
      'hello',
      42,
      [],
      [hello()],
      { v: PROTOCOL_VERSION },
      { v: PROTOCOL_VERSION, t: 'shutdown' },
      { v: 'one', t: 'hello' },
      { ...hello(), from: PEER },
      { ...hello(), joinedAt: -1 },
      JSON.parse('{"v":1,"t":"scene","location":"x","torch":"dim","__proto__":{"x":1}}'),
      { ...hello(), character: null },
      {
        ...hello(),
        character: { ...US, conditions: Array.from({ length: MAX_CONDITIONS + 1 }, () => 'x') },
      },
    ];

    for (const payload of hostile) {
      await deliver(payload);
    }

    // Still mounted, still in the room, still drawing everyone who is in it.
    expect(presence().status).toBe('joined');
    expect(partyNames()).toHaveLength(2);
    expect(container.textContent).toContain('At the table');
    expect(dropped().length).toBe(hostile.length);
  });

  it('leaves a good event after it working', async () => {
    await joined();
    await deliver({ ...hello(), character: 'nonsense' });
    await deliver(hello({ ...US, name: 'Ash' }));

    // A dropped payload is dropped, not a state the room has to be recovered from.
    expect(partyNames()).toContain('Ash');
    expect(presence().hostId).toBe(PEER);
  });
});
