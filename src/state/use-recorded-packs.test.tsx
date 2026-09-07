// The failure this hook exists to prevent, written as a test: load a supplement that
// overrides `core:item:torch`, touch nothing, and the sheet's record of what it was
// built against must already say so. Nothing on the sheet can say it otherwise — the
// reference still reads `core:item:torch` — so a record written only on edit is a record
// that is missing exactly when the pack is kept across a reload (DESIGN.md §7).
//
// The rest is about the pattern rather than the record: adjusting state during render
// has two ways to go wrong, a loop and a stale first paint, so both are asserted, and
// StrictMode's double render is here because it is the one that would surface either.
//
// The packs are built through `parsePack`, for the reason `orphans.test.ts` gives: a
// fixture the schema would refuse proves nothing.
//
// No @testing-library: CLAUDE.md §12 forbids installing a package without asking, and
// createRoot plus React's own act() is the harness the other hook tests use.

import type { ReactElement } from 'react';
import { StrictMode, act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Character } from '../model/character';
import { parsePack, reportProblems, type Pack } from '../model/pack';
import type { ResolvedStack } from '../model/pack-resolver';
import { resolvePacks } from '../model/pack-resolver';
import { newItem } from './character-edits';
import { createCharacter } from './new-character';
import { useRecordedPacks } from './use-recorded-packs';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function loaded(fields: Record<string, unknown>): Pack {
  const result = parsePack({
    format: 'lantern-pack',
    formatVersion: 1,
    version: '1.0.0',
    ...fields,
  });
  if (!result.ok) throw new Error(reportProblems(result.problems, String(fields['name'])));

  return result.pack;
}

const CORE = loaded({
  id: 'core',
  name: 'Core',
  items: [{ id: 'torch', name: 'Torch', slots: 1, cost: { amount: 5, currency: 'sp' } }],
});

/** Overrides core's torch and defines nothing of its own — the whole point of the case. */
const FROSTBOUND = loaded({
  id: 'frostbound',
  name: 'Frostbound',
  items: [
    {
      id: 'rime-torch',
      name: 'Torch',
      slots: 1,
      cost: { amount: 5, currency: 'sp' },
      overrides: 'core:item:torch',
    },
  ],
});

/** Answers for nothing this sheet points at. A pack being loaded is not a dependency. */
const OUTLANDS = loaded({
  id: 'outlands',
  name: 'Outlands',
  items: [{ id: 'sled', name: 'Sled', slots: 2, cost: { amount: 3, currency: 'gp' } }],
});

const TORCH = 'core:item:torch';

/** A sheet carrying one torch from core, and knowing only about core. */
function sheetWithTorch(): Character {
  return {
    ...createCharacter('c_test'),
    items: [{ ...newItem(TORCH), id: 'r_torch' }],
    packsUsed: ['core'],
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** What the probe held on its most recent render, and how many renders that took. */
let latest: Character | null = null;
let renders = 0;

function Probe({
  stack,
  initial,
}: {
  readonly stack: ResolvedStack;
  readonly initial: Character;
}): ReactElement {
  const [character, setCharacter] = useState(initial);
  useRecordedPacks(setCharacter, stack);

  latest = character;
  renders += 1;

  // Rendered, so a stale record would reach the DOM rather than hide in a variable.
  return <span>{character.packsUsed.join(' ')}</span>;
}

type Mounted = {
  readonly container: HTMLElement;
  readonly rerender: (stack: ResolvedStack) => Promise<void>;
  readonly unmount: () => Promise<void>;
};

async function mount(
  stack: ResolvedStack,
  initial: Character,
  strict = false,
): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  const draw = (next: ResolvedStack): ReactElement =>
    strict ? (
      <StrictMode>
        <Probe stack={next} initial={initial} />
      </StrictMode>
    ) : (
      <Probe stack={next} initial={initial} />
    );

  await act(async () => {
    root.render(draw(stack));
  });

  return {
    container,
    rerender: async (next: ResolvedStack) => {
      await act(async () => {
        root.render(draw(next));
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

function record(): readonly string[] {
  if (latest === null) throw new Error('the probe never rendered');
  return latest.packsUsed;
}

beforeEach(() => {
  latest = null;
  renders = 0;
  document.body.replaceChildren();
});

afterEach(() => {
  document.body.replaceChildren();
});

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

describe('useRecordedPacks', () => {
  it('records an overriding pack with no edit at all', async () => {
    const view = await mount(resolvePacks([CORE]), sheetWithTorch());
    expect(record()).toEqual(['core']);

    await view.rerender(resolvePacks([CORE, FROSTBOUND]));

    // Nothing touched the sheet: the pack arriving is the whole of what happened.
    expect(record()).toContain('frostbound');
    await view.unmount();
  });

  it('leaves the record in the DOM, not one render behind it', async () => {
    const view = await mount(resolvePacks([CORE]), sheetWithTorch());
    await view.rerender(resolvePacks([CORE, FROSTBOUND]));

    // The render-phase adjustment is what buys this: an effect would have painted the
    // stale record first, and this assertion would see it.
    expect(view.container.textContent).toContain('frostbound');
    await view.unmount();
  });

  it('records a pack the sheet resolves through on the first render', async () => {
    const view = await mount(resolvePacks([CORE, FROSTBOUND]), sheetWithTorch());

    expect(record()).toContain('frostbound');
    await view.unmount();
  });

  it('carries the record forward when the pack goes away again', async () => {
    const view = await mount(resolvePacks([CORE, FROSTBOUND]), sheetWithTorch());
    await view.rerender(resolvePacks([CORE]));

    // The reload story: the supplement is gone and the sheet still says it needs it,
    // which is what the missing-pack warning is built on (PRD.md principle 4).
    expect(record()).toContain('frostbound');
    await view.unmount();
  });

  it('does not write when the stack changes but the record does not', async () => {
    const view = await mount(resolvePacks([CORE]), sheetWithTorch());
    const before = latest;

    await view.rerender(resolvePacks([CORE, OUTLANDS]));
    await view.rerender(resolvePacks([CORE]));

    expect(latest).toBe(before);
    await view.unmount();
  });

  it('settles rather than looping', async () => {
    const view = await mount(resolvePacks([CORE]), sheetWithTorch());
    const settled = renders;

    await view.rerender(resolvePacks([CORE, FROSTBOUND]));

    // One render for the new stack and one retry after the adjustment. A loop would
    // have exhausted React's update depth instead of arriving here.
    expect(renders - settled).toBeLessThanOrEqual(2);
    await view.unmount();
  });

  it('records once under StrictMode, which renders everything twice', async () => {
    const view = await mount(resolvePacks([CORE, FROSTBOUND]), sheetWithTorch(), true);

    expect(record()).toEqual(['core', 'frostbound']);
    await view.unmount();
  });
});
