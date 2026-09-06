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
import { describe, expect, it } from 'vitest';
import { MAX_PACKS_LOADED, PACK_FORMAT, PACK_FORMAT_VERSION } from '../constants';
import type { Pack, Ref } from '../model/pack';
import type { CorePackResult } from './core-pack';
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
// The hook
// ---------------------------------------------------------------------------

let latest: Packs | null = null;

function Probe({ load }: { readonly load: CorePackLoader }): ReactElement {
  latest = usePacks(load);
  return <span>{latest.core.kind}</span>;
}

function hook(): Packs {
  if (latest === null) throw new Error('the probe never rendered');
  return latest;
}

async function mount(load: CorePackLoader, strict = false): Promise<() => Promise<void>> {
  latest = null;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(strict ? <StrictMode><Probe load={load} /></StrictMode> : <Probe load={load} />);
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
