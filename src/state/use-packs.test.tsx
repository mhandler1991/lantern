// Load order is the whole of what this hook owns, so these tests are about order: where
// core lands, where a picked pack lands, what a second copy of a pack does to the one
// already there, and what moving a pack does to which override wins.
//
// The transitions are a pure reducer, so most of this needs no component at all. The two
// that do — the fetch on mount, and the same fetch under StrictMode's double-mount — are
// the ones a reducer cannot answer.

import type { ReactElement } from 'react';
import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  KEPT_PACKS_FORMAT,
  KEPT_PACKS_FORMAT_VERSION,
  MAX_KEPT_PACKS,
  MAX_PACKS_LOADED,
  PACK_FORMAT,
  PACK_FORMAT_VERSION,
} from '../constants';
import type { Pack, Ref } from '../model/pack';
import type { CorePackResult } from './core-pack';
import { KEPT_PACKS_KEY } from './pack-storage';
import type { StorageDriver } from './storage';
import type { CorePackLoader, LoadedPack, Packs, PacksState } from './use-packs';
import { INITIAL_PACKS, packsReducer, usePacks } from './use-packs';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A pack with one spell in it, which is all any of these tests need to see move. */
function pack(id: string, options: { name?: string; version?: string; spell?: string; overrides?: string } = {}): Pack {
  const { name = id, version = '1.0.0', spell = 'ember', overrides } = options;

  return {
    format: PACK_FORMAT,
    formatVersion: PACK_FORMAT_VERSION,
    id,
    name,
    version,
    spells: [
      {
        id: 'ember',
        name: spell,
        tier: 1,
        duration: 'instant',
        range: 'near',
        classes: [],
        ...(overrides === undefined ? {} : { overrides }),
      },
    ],
  } as Pack;
}

const core = pack('core', { name: 'Core' });

const ids = (state: PacksState): readonly string[] => state.loaded.map((held) => held.pack.id);

/** Apply a run of actions to the initial state, so a test reads as the sequence it is. */
function run(...actions: readonly Parameters<typeof packsReducer>[1][]): PacksState {
  return actions.reduce(packsReducer, INITIAL_PACKS);
}

const loadedFromFile = (id: string, name = `${id}.json`) =>
  ({ type: 'read-loaded', name, pack: pack(id) }) as const;

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

describe('the load order', () => {
  it('puts core in front, whatever arrived while it was in flight', () => {
    const state = run(loadedFromFile('frostbound'), { type: 'core-loaded', pack: core });

    // Everything else is written against core, so a homebrew pack overriding a core
    // entry must find core already defined when resolution runs.
    expect(ids(state)).toEqual(['core', 'frostbound']);
  });

  it('appends a picked pack, because the last pack loaded wins', () => {
    const state = run(
      { type: 'core-loaded', pack: core },
      loadedFromFile('frostbound'),
      loadedFromFile('cursed-scroll'),
    );

    expect(ids(state)).toEqual(['core', 'frostbound', 'cursed-scroll']);
  });

  it('replaces a pack with its own id in place, and says which version went', () => {
    const state = run(
      { type: 'core-loaded', pack: core },
      loadedFromFile('frostbound'),
      loadedFromFile('cursed-scroll'),
      { type: 'read-loaded', name: 'frostbound-1.2.json', pack: pack('frostbound', { version: '1.2.0' }) },
    );

    expect(ids(state), 'an updated pack jumped to the end of the order').toEqual([
      'core',
      'frostbound',
      'cursed-scroll',
    ]);
    expect(state.loaded[1]?.pack.version).toBe('1.2.0');
    expect(state.pick).toMatchObject({ kind: 'loaded', packName: 'frostbound', replaced: '1.0.0' });
  });

  it('leaves a replaced pack turned off if that is how it was', () => {
    const state = run(
      loadedFromFile('frostbound'),
      { type: 'toggle', id: 'frostbound' },
      { type: 'read-loaded', name: 'frostbound-1.2.json', pack: pack('frostbound', { version: '1.2.0' }) },
    );

    // Turning a pack off is a decision about the pack, not about the version.
    expect(state.loaded[0]?.isEnabled).toBe(false);
    expect(state.loaded[0]?.pack.version).toBe('1.2.0');
  });

  it('replaces core with itself when the fetch resolves twice, as StrictMode makes it', () => {
    const state = run({ type: 'core-loaded', pack: core }, { type: 'core-loaded', pack: core });

    expect(ids(state)).toEqual(['core']);
  });

  it('keeps what it has at the cap, and says so rather than dropping anything', () => {
    const filled = Array.from({ length: MAX_PACKS_LOADED }, (_, index) =>
      loadedFromFile(`pack-${index}`),
    );
    const state = run(...filled, loadedFromFile('one-too-many'));

    expect(state.loaded).toHaveLength(MAX_PACKS_LOADED);
    expect(ids(state)).not.toContain('one-too-many');
    expect(state.pick).toEqual({ kind: 'full', name: 'one-too-many.json' });
  });

  it('lets an update through at the cap, because it replaces rather than adds', () => {
    const filled = Array.from({ length: MAX_PACKS_LOADED }, (_, index) =>
      loadedFromFile(`pack-${index}`),
    );
    const state = run(...filled, {
      type: 'read-loaded',
      name: 'again.json',
      pack: pack('pack-0', { version: '2.0.0' }),
    });

    expect(state.loaded).toHaveLength(MAX_PACKS_LOADED);
    expect(state.loaded[0]?.pack.version).toBe('2.0.0');
  });

  it('moves a pack one place, and does nothing at either end', () => {
    const three = run(loadedFromFile('a'), loadedFromFile('b'), loadedFromFile('c'));

    expect(ids(packsReducer(three, { type: 'move', id: 'c', by: -1 }))).toEqual(['a', 'c', 'b']);
    expect(ids(packsReducer(three, { type: 'move', id: 'a', by: -1 }))).toEqual(['a', 'b', 'c']);
    expect(ids(packsReducer(three, { type: 'move', id: 'c', by: 1 }))).toEqual(['a', 'b', 'c']);
    expect(ids(packsReducer(three, { type: 'move', id: 'nobody', by: 1 }))).toEqual(['a', 'b', 'c']);
  });

  it('keeps a pack in its place when it is turned off', () => {
    const state = run(loadedFromFile('a'), loadedFromFile('b'), { type: 'toggle', id: 'a' });

    expect(ids(state), 'a pack that was turned off moved').toEqual(['a', 'b']);
    expect(state.loaded[0]?.isEnabled).toBe(false);
    expect(packsReducer(state, { type: 'toggle', id: 'a' }).loaded[0]?.isEnabled).toBe(true);
  });

  it('removes a pack outright', () => {
    const state = run(loadedFromFile('a'), loadedFromFile('b'), { type: 'remove', id: 'a' });

    expect(ids(state)).toEqual(['b']);
  });

  it('reports a file that would not parse without touching what is loaded', () => {
    const state = run(loadedFromFile('a'), {
      type: 'read-failed',
      name: 'broken.json',
      problems: [{ path: 'id', message: 'expected text matching /^[a-z0-9-]{2,32}$/ — got "A"' }],
    });

    expect(ids(state), 'a bad file changed what was loaded').toEqual(['a']);
    expect(state.pick).toMatchObject({ kind: 'failed', name: 'broken.json' });
  });

  it('records a core pack that never arrived without failing anything else', () => {
    const state = run(loadedFromFile('a'), {
      type: 'core-failed',
      problems: [{ path: 'packs/core.json', message: 'expected to be served — got HTTP 404' }],
    });

    expect(state.core.kind).toBe('failed');
    expect(ids(state)).toEqual(['a']);
  });
});

// ---------------------------------------------------------------------------
// The opt-in to keep a pack
// ---------------------------------------------------------------------------

describe('keeping a pack', () => {
  it('keeps nothing by default — the opt-in is a press, not an assumption', () => {
    const state = run({ type: 'core-loaded', pack: core }, loadedFromFile('frostbound'));

    expect(state.loaded.every((held) => !held.isKept)).toBe(true);
  });

  it('turns the opt-in on and off again without moving the pack or turning it off', () => {
    const on = run(loadedFromFile('frostbound'), { type: 'keep', id: 'frostbound' });
    expect(on.loaded[0]?.isKept).toBe(true);
    expect(on.loaded[0]?.isEnabled).toBe(true);

    const off = packsReducer(on, { type: 'keep', id: 'frostbound' });
    expect(off.loaded[0]?.isKept).toBe(false);
    expect(off.loaded[0]?.isEnabled).toBe(true);
  });

  it('never keeps core, which is fetched on boot and has no file to remember', () => {
    const state = run({ type: 'core-loaded', pack: core }, { type: 'keep', id: 'core' });

    expect(state.loaded[0]?.isKept).toBe(false);
  });

  it('carries the opt-in across an update, the way it carries the on/off state', () => {
    const state = run(
      loadedFromFile('frostbound'),
      { type: 'keep', id: 'frostbound' },
      { type: 'toggle', id: 'frostbound' },
      { type: 'read-loaded', name: 'frostbound-1.2.json', pack: pack('frostbound', { version: '1.2.0' }) },
    );

    // Both were decisions somebody made about the pack rather than about the version.
    expect(state.loaded[0]?.pack.version).toBe('1.2.0');
    expect(state.loaded[0]?.isKept).toBe(true);
    expect(state.loaded[0]?.isEnabled).toBe(false);
  });

  it('refuses the opt-in past the bound and leaves the pack loaded and working', () => {
    const loads = Array.from({ length: MAX_KEPT_PACKS + 1 }, (_unused, index) =>
      loadedFromFile(`pack-${index}`),
    );
    const keeps = loads.map((load) => ({ type: 'keep', id: load.pack.id }) as const);
    const state = run(...loads, ...keeps);

    const last = `pack-${MAX_KEPT_PACKS}`;
    expect(state.loaded.filter((held) => held.isKept)).toHaveLength(MAX_KEPT_PACKS);
    expect(state.loaded.find((held) => held.pack.id === last)?.isKept).toBe(false);
    expect(state.keep).toEqual({ kind: 'refused', name: last, reason: 'count' });

    // PRD.md principle 4: refused the opt-in, not the pack.
    expect(ids(state)).toContain(last);
  });
});

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

let latest: Packs | null = null;

function Probe({
  load,
  driver,
}: {
  readonly load: CorePackLoader;
  readonly driver: StorageDriver | null;
}): ReactElement {
  latest = usePacks(load, driver);
  return <span>{latest.core.kind}</span>;
}

function hook(): Packs {
  if (latest === null) throw new Error('the probe never rendered');
  return latest;
}

async function mount(
  load: CorePackLoader,
  strict = false,
  driver: StorageDriver | null = localStorage,
): Promise<() => Promise<void>> {
  latest = null;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      strict ? (
        <StrictMode>
          <Probe load={load} driver={driver} />
        </StrictMode>
      ) : (
        <Probe load={load} driver={driver} />
      ),
    );
  });

  return async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  };
}

const found = (id: string): LoadedPack | undefined =>
  hook().loaded.find((held) => held.pack.id === id);

describe('the packs hook', () => {
  it('fetches the core pack on mount and labels where it came from', async () => {
    const unmount = await mount(() => Promise.resolve({ ok: true, pack: core } as CorePackResult));

    expect(hook().core.kind).toBe('ready');
    expect(found('core')?.source).toEqual({ kind: 'core' });
    expect(hook().stack.classes.length + hook().stack.spells.length).toBeGreaterThan(0);

    await unmount();
  });

  it('holds one core pack under StrictMode, which mounts every effect twice', async () => {
    let calls = 0;
    const unmount = await mount(() => {
      calls += 1;
      return Promise.resolve({ ok: true, pack: core } as CorePackResult);
    }, true);

    expect(calls, 'StrictMode stopped double-invoking the effect').toBeGreaterThan(1);
    expect(hook().loaded.filter((held) => held.pack.id === 'core')).toHaveLength(1);

    await unmount();
  });

  it('keeps the sheet working when the core pack cannot be fetched', async () => {
    const problems = [{ path: 'packs/core.json', message: 'expected to be served — got HTTP 404' }];
    const unmount = await mount(() => Promise.resolve({ ok: false, problems } as CorePackResult));

    expect(hook().core).toEqual({ kind: 'failed', problems });
    expect(hook().loaded).toEqual([]);
    expect(hook().stack.classes).toEqual([]);

    await unmount();
  });

  it('loads a picked file and resolves it alongside core', async () => {
    const unmount = await mount(() => Promise.resolve({ ok: true, pack: core } as CorePackResult));

    const text = JSON.stringify(pack('frostbound', { name: 'Frostbound', spell: 'Hoarfrost' }));
    await act(async () => {
      await hook().addFile({ name: 'frostbound.json', size: text.length, text: () => Promise.resolve(text) });
    });

    expect(found('frostbound')?.source).toEqual({ kind: 'file', name: 'frostbound.json' });
    expect(hook().stack.spells.map((spell) => spell.entry.name)).toContain('Hoarfrost');

    await unmount();
  });

  it('drops a pack out of the stack when it is turned off, and keeps its place', async () => {
    const unmount = await mount(() => Promise.resolve({ ok: true, pack: core } as CorePackResult));

    const text = JSON.stringify(pack('frostbound', { spell: 'Hoarfrost' }));
    await act(async () => {
      await hook().addFile({ name: 'frostbound.json', size: text.length, text: () => Promise.resolve(text) });
    });
    await act(async () => {
      hook().toggle('frostbound');
    });

    expect(hook().stack.packs.map((summary) => summary.id)).toEqual(['core']);
    expect(hook().loaded.map((held) => held.pack.id)).toEqual(['core', 'frostbound']);

    await unmount();
  });

  it('changes which override wins when the order changes', async () => {
    const unmount = await mount(() => Promise.resolve({ ok: true, pack: core } as CorePackResult));
    const ember: Ref = 'core:spell:ember';

    for (const [id, name] of [
      ['red', 'Red ember'],
      ['blue', 'Blue ember'],
    ] as const) {
      const text = JSON.stringify(pack(id, { spell: name, overrides: ember }));
      await act(async () => {
        await hook().addFile({ name: `${id}.json`, size: text.length, text: () => Promise.resolve(text) });
      });
    }

    // core, red, blue — the last pack loaded wins.
    expect(hook().stack.byRef.get(ember)?.entry.name).toBe('Blue ember');

    await act(async () => {
      hook().moveUp('blue');
    });

    // core, blue, red — and now it is red's.
    expect(hook().loaded.map((held) => held.pack.id)).toEqual(['core', 'blue', 'red']);
    expect(hook().stack.byRef.get(ember)?.entry.name).toBe('Red ember');

    await unmount();
  });

  it('removes a pack and everything it contributed', async () => {
    const unmount = await mount(() => Promise.resolve({ ok: true, pack: core } as CorePackResult));

    const text = JSON.stringify(pack('frostbound', { spell: 'Hoarfrost' }));
    await act(async () => {
      await hook().addFile({ name: 'frostbound.json', size: text.length, text: () => Promise.resolve(text) });
    });
    await act(async () => {
      hook().remove('frostbound');
    });

    expect(hook().loaded.map((held) => held.pack.id)).toEqual(['core']);
    expect(hook().stack.spells.map((spell) => spell.entry.name)).not.toContain('Hoarfrost');

    await unmount();
  });

  it('reports a file that is not a pack and loads nothing', async () => {
    const unmount = await mount(() => Promise.resolve({ ok: true, pack: core } as CorePackResult));

    await act(async () => {
      await hook().addFile({ name: 'notes.json', size: 2, text: () => Promise.resolve('{}') });
    });

    expect(hook().pick.kind).toBe('failed');
    expect(hook().loaded.map((held) => held.pack.id)).toEqual(['core']);

    await unmount();
  });
});

describe('a pack that was kept', () => {
  const corePack = (): Promise<CorePackResult> =>
    Promise.resolve({ ok: true, pack: core } as CorePackResult);

  /** Whatever a previous visit left behind, written the way `saveKeptPacks` writes it. */
  function stored(entries: readonly { id: string; isEnabled: boolean }[]): void {
    localStorage.setItem(
      KEPT_PACKS_KEY,
      JSON.stringify({
        format: KEPT_PACKS_FORMAT,
        formatVersion: KEPT_PACKS_FORMAT_VERSION,
        packs: entries.map((entry) => ({
          name: `${entry.id}.json`,
          isEnabled: entry.isEnabled,
          pack: pack(entry.id),
        })),
      }),
    );
  }

  afterEach(() => {
    localStorage.clear();
  });

  it('comes back on the next visit, in its stored order and on/off state', async () => {
    stored([
      { id: 'frostbound', isEnabled: true },
      { id: 'cursed-scroll', isEnabled: false },
    ]);

    const unmount = await mount(corePack);

    // Core is still placed in front of everything, restored packs included.
    expect(hook().loaded.map((held) => held.pack.id)).toEqual(['core', 'frostbound', 'cursed-scroll']);
    expect(found('cursed-scroll')?.isEnabled).toBe(false);
    expect(found('frostbound')?.isKept).toBe(true);
    expect(hook().restore.problems).toEqual([]);

    await unmount();
  });

  it('is written the moment it is kept, and the key is cleared when it is not', async () => {
    const unmount = await mount(corePack);

    const text = JSON.stringify(pack('frostbound', { name: 'Frostbound' }));
    await act(async () => {
      await hook().addFile({ name: 'frostbound.json', size: text.length, text: () => Promise.resolve(text) });
    });

    expect(localStorage.getItem(KEPT_PACKS_KEY), 'a loaded pack is not a kept one').toBeNull();

    await act(async () => {
      hook().toggleKept('frostbound');
    });
    expect(localStorage.getItem(KEPT_PACKS_KEY)).toContain('frostbound');
    expect(hook().store).toEqual({ ok: true, count: 1 });

    await act(async () => {
      hook().toggleKept('frostbound');
    });
    expect(localStorage.getItem(KEPT_PACKS_KEY)).toBeNull();

    await unmount();
  });

  it('leaves a pack that was not kept behind, which is the default', async () => {
    const unmount = await mount(corePack);

    const text = JSON.stringify(pack('frostbound', { name: 'Frostbound' }));
    await act(async () => {
      await hook().addFile({ name: 'frostbound.json', size: text.length, text: () => Promise.resolve(text) });
    });
    await unmount();

    const second = await mount(corePack);
    expect(hook().loaded.map((held) => held.pack.id)).toEqual(['core']);
    await second();
  });

  it('reports a stored pack it can no longer read and restores the rest', async () => {
    localStorage.setItem(
      KEPT_PACKS_KEY,
      JSON.stringify({
        format: KEPT_PACKS_FORMAT,
        formatVersion: KEPT_PACKS_FORMAT_VERSION,
        packs: [
          { name: 'frostbound.json', isEnabled: true, pack: pack('frostbound') },
          { name: 'broken.json', isEnabled: true, pack: { id: 'broken' } },
        ],
      }),
    );

    const unmount = await mount(corePack);

    expect(hook().loaded.map((held) => held.pack.id)).toEqual(['core', 'frostbound']);
    expect(hook().restore.problems.length).toBeGreaterThan(0);
    expect(hook().restore.quarantined).toBe(true);

    await unmount();
  });

  it('keeps working when the browser will not store anything', async () => {
    const blocked: StorageDriver = {
      getItem() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
      setItem() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
      removeItem: () => undefined,
    };

    const unmount = await mount(corePack, false, blocked);

    expect(hook().restore.failure?.kind).toBe('unavailable');
    expect(hook().core.kind).toBe('ready');

    const text = JSON.stringify(pack('frostbound', { name: 'Frostbound' }));
    await act(async () => {
      await hook().addFile({ name: 'frostbound.json', size: text.length, text: () => Promise.resolve(text) });
    });
    await act(async () => {
      hook().toggleKept('frostbound');
    });

    // The pack is loaded and resolved; only the keeping failed, and it says so.
    expect(found('frostbound')?.isKept).toBe(true);
    expect(hook().store?.ok).toBe(false);
    expect(hook().stack.spells.length).toBeGreaterThan(0);

    await unmount();
  });
});
