// The wiring between a room and the roster: who gets told we are here, what a peer
// leaving does to the chair, and what happens when the same hook is mounted twice — the
// StrictMode case, which is the one that leaves a room open in a browser and nowhere
// else.
//
// The transport is substituted at its own seam, so none of this needs a relay or a real
// peer. Real peers are `test-room.html` (CLAUDE.md §7).

import type { ReactElement } from 'react';
import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BROADCAST_DEBOUNCE_MS, PROTOCOL_VERSION } from '../constants';
import type { HelloEvent, PublicCharacter, StateEvent } from '../net/protocol';
import type {
  JsonValue,
  PeerId,
  Result,
  Transport,
  TransportHandlers,
  TransportOptions,
} from '../net/transport';
import { failure, ok } from '../net/transport';
import type { JoinRoom, Presence } from './use-presence';
import { usePresence } from './use-presence';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SELF: PeerId = 'self0000';

const us: PublicCharacter = {
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

function hello(joinedAt: number, name: string): HelloEvent {
  return { v: PROTOCOL_VERSION, t: 'hello', character: { ...us, name }, joinedAt };
}

/** One substituted room: what it was asked for, what went out of it, and its callbacks. */
type FakeRoom = {
  readonly options: TransportOptions;
  readonly handlers: TransportHandlers;
  readonly sent: { readonly to: PeerId | 'everyone'; readonly payload: JsonValue }[];
  leaves: number;
};

let rooms: FakeRoom[] = [];

/** The seam. Every join is recorded so a test can drive it from the outside. */
const joinRoom: JoinRoom = (options: TransportOptions): Result<Transport> => {
  const room: FakeRoom = { options, handlers: options.handlers ?? {}, sent: [], leaves: 0 };
  rooms.push(room);

  const transport: Transport = {
    selfId: SELF,
    roomId: options.roomId,
    getPeers: () => [],
    broadcast: async (payload) => {
      room.sent.push({ to: 'everyone', payload });
      return ok(undefined);
    },
    sendTo: async (peerId, payload) => {
      room.sent.push({ to: peerId, payload });
      return ok(undefined);
    },
    leave: async () => {
      room.leaves += 1;
      return ok(undefined);
    },
  };

  return ok(transport);
};

const open = (): FakeRoom[] => rooms.filter((room) => room.leaves === 0);

function current(): FakeRoom {
  const live = open()[0];
  if (live === undefined) throw new Error('no room is open');
  return live;
}

let latest: Presence | null = null;

function Probe({ character = us }: { character?: PublicCharacter }): ReactElement {
  latest = usePresence(character, joinRoom);
  return <span>{latest.status}</span>;
}

function hook(): Presence {
  if (latest === null) throw new Error('the probe never rendered');
  return latest;
}

type Mounted = { readonly unmount: () => Promise<void> };

async function mount(strict = false): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(strict ? <StrictMode><Probe /></StrictMode> : <Probe />);
  });

  return {
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

/** The same mount, plus the one thing the broadcast tests need: a changed sheet. */
type Editable = Mounted & { readonly edit: (character: PublicCharacter) => Promise<void> };

async function mountEditable(): Promise<Editable> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  const render = async (character: PublicCharacter): Promise<void> => {
    await act(async () => {
      root.render(<Probe character={character} />);
    });
  };

  await render(us);

  return {
    edit: render,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

/** Drive one of the transport's callbacks the way a real room would. */
async function fire(run: (handlers: TransportHandlers) => void): Promise<void> {
  await act(async () => {
    run(current().handlers);
  });
}

beforeEach(() => {
  rooms = [];
  latest = null;
  document.body.replaceChildren();
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('usePresence', () => {
  it('is in no room until asked, and reports so', async () => {
    const mounted = await mount();

    expect(hook().status).toBe('closed');
    expect(hook().members).toEqual([]);
    expect(hook().hostId).toBeNull();
    expect(rooms).toHaveLength(0);

    await mounted.unmount();
  });

  it('joins, seats us, and holds the chair while we are alone', async () => {
    const mounted = await mount();
    await act(async () => {
      hook().join('ABCDEF', 'moonlight');
    });

    expect(current().options.roomId).toBe('ABCDEF');
    expect(current().options.password).toBe('moonlight');
    expect(hook().status).toBe('joined');
    expect(hook().selfId).toBe(SELF);
    expect(hook().hostId).toBe(SELF);
    expect(hook().isSelfHost).toBe(true);
    expect(hook().members.map((member) => member.character?.name)).toEqual(['Vess']);

    await mounted.unmount();
  });

  it('introduces us to each peer as it arrives, once, with our own arrival time', async () => {
    const mounted = await mount();
    await act(async () => {
      hook().join('ABCDEF');
    });

    // Nothing goes out at join: the peer list is empty then, so a broadcast would
    // reach nobody. The introduction rides on the connection itself.
    expect(current().sent).toEqual([]);

    await fire((handlers) => handlers.onPeerJoin?.('ash00000'));

    expect(current().sent).toHaveLength(1);
    const [first] = current().sent;
    expect(first?.to).toBe('ash00000');

    const payload = first?.payload as HelloEvent;
    expect(payload.t).toBe('hello');
    expect(payload.v).toBe(PROTOCOL_VERSION);
    expect(payload.character).toEqual(us);
    expect(payload.joinedAt).toBe(hook().members[0]?.joinedAt);

    // The peer is in the room immediately, anonymous until its own hello lands, and
    // not a candidate for the chair while it is.
    expect(hook().members.map((member) => member.id)).toEqual([SELF, 'ash00000']);
    expect(hook().hostId).toBe(SELF);

    await mounted.unmount();
  });

  it('hands the chair to a peer that was here first, and takes it back when it goes', async () => {
    const mounted = await mount();
    await act(async () => {
      hook().join('ABCDEF');
    });

    await fire((handlers) => handlers.onPeerJoin?.('ash00000'));
    await fire((handlers) =>
      handlers.onMessage?.({ from: 'ash00000', data: hello(0, 'Ash') }),
    );

    expect(hook().hostId).toBe('ash00000');
    expect(hook().isSelfHost).toBe(false);
    expect(hook().members.map((member) => member.character?.name)).toEqual(['Ash', 'Vess']);

    // Ash closes the tab. Nothing is announced and nothing is asked — the roster loses
    // a row and the next read of the derivation names us.
    await fire((handlers) => handlers.onPeerLeave?.('ash00000'));

    expect(hook().members.map((member) => member.id)).toEqual([SELF]);
    expect(hook().hostId).toBe(SELF);
    expect(hook().isSelfHost).toBe(true);

    await mounted.unmount();
  });

  it('attributes an event to the peer the transport named, never to the payload', async () => {
    const mounted = await mount();
    await act(async () => {
      hook().join('ABCDEF');
    });

    await fire((handlers) => handlers.onPeerJoin?.('ash00000'));

    // A peer bolting a `from` onto its own hello, claiming to be somebody else. The
    // field is not in the schema, so this is refused outright rather than believed.
    await fire((handlers) =>
      handlers.onMessage?.({
        from: 'ash00000',
        data: { ...hello(0, 'Ash'), from: 'bram0000' },
      }),
    );

    expect(hook().rejection?.kind).toBe('malformed');
    expect(hook().members.map((member) => member.id)).toEqual([SELF, 'ash00000']);

    await mounted.unmount();
  });

  it('shows a peer speaking another protocol version rather than swallowing it', async () => {
    const mounted = await mount();
    await act(async () => {
      hook().join('ABCDEF');
    });

    await fire((handlers) =>
      handlers.onMessage?.({
        from: 'ash00000',
        data: { ...hello(0, 'Ash'), v: PROTOCOL_VERSION + 1 },
      }),
    );

    expect(hook().rejection?.kind).toBe('version-mismatch');
    expect(hook().members.map((member) => member.id)).toEqual([SELF]);

    await mounted.unmount();
  });

  it('reports a room that could not be joined at all', async () => {
    const refuse: JoinRoom = () => failure('join-failed', 'no relay answered');

    function Failing(): ReactElement {
      latest = usePresence(us, refuse);
      return <span>{latest.status}</span>;
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Failing />);
    });
    await act(async () => {
      hook().join('ABCDEF');
    });

    expect(hook().status).toBe('failed');
    expect(hook().error?.kind).toBe('join-failed');
    expect(hook().members).toEqual([]);

    await act(async () => {
      root.unmount();
    });
  });

  it('leaves the room when asked, and empties the roster with it', async () => {
    const mounted = await mount();
    await act(async () => {
      hook().join('ABCDEF');
    });
    await fire((handlers) => handlers.onPeerJoin?.('ash00000'));

    const joined = current();
    await act(async () => {
      hook().leave();
    });

    expect(joined.leaves).toBe(1);
    expect(hook().status).toBe('closed');
    expect(hook().members).toEqual([]);
    expect(hook().hostId).toBeNull();

    await mounted.unmount();
  });

  it('leaves the room on unmount, and leaves exactly one open under StrictMode', async () => {
    const mounted = await mount(true);
    await act(async () => {
      hook().join('ABCDEF');
    });

    // StrictMode sets the Effect up, tears it down and sets it up again on purpose.
    // However many rooms that produced, one is open — a second live room would be a
    // duplicate seat at the table for as long as the tab stayed open.
    expect(open()).toHaveLength(1);

    await mounted.unmount();

    expect(open()).toHaveLength(0);
    for (const room of rooms) expect(room.leaves).toBe(1);
  });
});

describe('usePresence — the public projection, broadcast', () => {
  // Real timers everywhere else in this file; the debounce is the one thing here that
  // is about *when*, and a quarter second of real waiting per test buys nothing.
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Let the debounce window pass, and whatever it scheduled run. */
  async function settle(ms: number = BROADCAST_DEBOUNCE_MS): Promise<void> {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  }

  /** Every `state` event this room has been given, in order. */
  function broadcasts(): StateEvent[] {
    return current()
      .sent.filter((message) => (message.payload as StateEvent).t === 'state')
      .map((message) => message.payload as StateEvent);
  }

  it('sends nothing while no field a peer can see has changed', async () => {
    const mounted = await mountEditable();
    await act(async () => {
      hook().join('ABCDEF');
    });

    // A fresh object every render — what a memo miss or an unrelated edit produces —
    // saying exactly what the last one said.
    await mounted.edit({ ...us, conditions: [...us.conditions] });
    await mounted.edit({ ...us, hp: { ...us.hp } });
    await settle();

    expect(current().sent).toEqual([]);

    await mounted.unmount();
  });

  it('broadcasts the projection after the debounce, and not before it', async () => {
    const mounted = await mountEditable();
    await act(async () => {
      hook().join('ABCDEF');
    });

    await mounted.edit({ ...us, hp: { current: 2, max: 5 } });

    // The value the player stopped on is the one worth sending, so nothing goes out
    // while the window is still open.
    await settle(BROADCAST_DEBOUNCE_MS - 1);
    expect(broadcasts()).toEqual([]);

    await settle(1);

    expect(broadcasts()).toHaveLength(1);
    expect(current().sent[0]?.to).toBe('everyone');
    expect(broadcasts()[0]).toEqual({
      v: PROTOCOL_VERSION,
      t: 'state',
      character: { ...us, hp: { current: 2, max: 5 } },
    });

    await mounted.unmount();
  });

  it('coalesces a run of changes into one event carrying where the player ended up', async () => {
    const mounted = await mountEditable();
    await act(async () => {
      hook().join('ABCDEF');
    });

    // Six damage arriving as six renders, the way a keystroke-by-keystroke edit does.
    for (let hp = 5; hp > 1; hp -= 1) {
      await mounted.edit({ ...us, hp: { current: hp - 1, max: 5 } });
      await settle(BROADCAST_DEBOUNCE_MS - 1);
    }
    await settle();

    expect(broadcasts()).toHaveLength(1);
    expect(broadcasts()[0]?.character.hp).toEqual({ current: 1, max: 5 });

    await mounted.unmount();
  });

  it('broadcasts each further change, once per change', async () => {
    const mounted = await mountEditable();
    await act(async () => {
      hook().join('ABCDEF');
    });

    await mounted.edit({ ...us, conditions: ['bleeding'] });
    await settle();
    await mounted.edit({ ...us, conditions: [] });
    await settle();

    expect(broadcasts().map((event) => event.character.conditions)).toEqual([['bleeding'], []]);

    await mounted.unmount();
  });

  it('puts nothing on any wire while there is no room', async () => {
    const mounted = await mountEditable();

    await mounted.edit({ ...us, luck: 2 });
    await settle();

    expect(rooms).toEqual([]);

    await mounted.unmount();
  });

  it('drops a pending broadcast when the room is left rather than sending it after', async () => {
    const mounted = await mountEditable();
    await act(async () => {
      hook().join('ABCDEF');
    });

    const room = current();
    await mounted.edit({ ...us, luck: 2 });

    await act(async () => {
      hook().leave();
    });
    await settle();

    // An unsent projection is a message to a table we walked away from, not data the
    // player loses. Nothing is flushed on the way out.
    expect(room.sent).toEqual([]);
    expect(room.leaves).toBe(1);

    await mounted.unmount();
  });

  it('drops a pending broadcast on unmount', async () => {
    const mounted = await mountEditable();
    await act(async () => {
      hook().join('ABCDEF');
    });

    const room = current();
    await mounted.edit({ ...us, luck: 2 });
    await mounted.unmount();
    await settle();

    expect(room.sent).toEqual([]);
  });

  it('introduces a peer that arrives later to the sheet as it stands now', async () => {
    const mounted = await mountEditable();
    await act(async () => {
      hook().join('ABCDEF');
    });

    const edited: PublicCharacter = { ...us, level: 2, hp: { current: 9, max: 9 } };
    await mounted.edit(edited);
    await settle();

    await fire((handlers) => handlers.onPeerJoin?.('ash00000'));
    await settle();

    // The introduction already carries the current projection, so nothing follows it:
    // a `state` broadcast for a peer that has just been told would be the same 200
    // bytes twice.
    const introduction = current().sent.find((message) => message.to === 'ash00000');
    expect((introduction?.payload as HelloEvent).character).toEqual(edited);
    expect(broadcasts()).toHaveLength(1);

    await mounted.unmount();
  });
});
