// What a player sees when a pack goes off: every row still there, the ones the pack
// answered for marked and read only, and everything they own still theirs to change.
//
// Component rendering detail is not worth testing during build-out (CLAUDE.md §7), and
// this file does not test any: it tests the one promise DESIGN.md §5 makes out loud —
// "anything already in use stays on the sheet, marked and read only" — which is a
// behaviour, and one nothing in `model/` can prove on its own.
//
// No @testing-library: React 18.3 exports `act`, and CLAUDE.md §12 forbids installing a
// package without asking.

import type { ReactElement } from 'react';
import { act, useState } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Character } from '../../model/character';
import { parseCharacter, reportProblems } from '../../model/character';
import { orphanReport } from '../../model/orphans';
import { parsePack, reportProblems as reportPackProblems, type Pack } from '../../model/pack';
import type { ResolvedStack } from '../../model/pack-resolver';
import { resolvePacks } from '../../model/pack-resolver';
import { CHARACTER_KEY } from '../../state/character-storage';
import { App } from '../App';
import { CharacterSheet } from './CharacterSheet';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function pack(fields: Record<string, unknown>): Pack {
  const result = parsePack({
    format: 'lantern-pack',
    formatVersion: 1,
    version: '1.0.0',
    ...fields,
  });
  if (!result.ok) throw new Error(reportPackProblems(result.problems, String(fields['name'])));

  return result.pack;
}

const CORE = pack({
  id: 'core',
  name: 'Core',
  items: [{ id: 'torch', name: 'Torch', slots: 1, cost: { amount: 5, currency: 'sp' } }],
});

const FROSTBOUND = pack({
  id: 'frostbound',
  name: 'Frostbound',
  ancestries: [{ id: 'thawborn', name: 'Thawborn' }],
  items: [{ id: 'rimeblade', name: 'Rimeblade', slots: 1, cost: { amount: 40, currency: 'gp' } }],
  spells: [
    {
      id: 'hoarfrost',
      name: 'Hoarfrost',
      tier: 1,
      classes: ['core:wizard'],
      range: 'near',
      duration: 'instant',
    },
  ],
});

const WITH_FROSTBOUND = resolvePacks([CORE, FROSTBOUND]);
const WITHOUT = resolvePacks([CORE]);

function fixture(): Character {
  const result = parseCharacter({
    format: 'lantern-character',
    formatVersion: 2,
    id: 'c_vess',
    name: 'Vess',
    ancestry: { ref: 'frostbound:ancestry:thawborn', name: '' },
    class: { ref: null, name: 'Thief' },
    alignment: null,
    level: 1,
    xp: 0,
    stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    hp: { current: 5, max: 5 },
    luck: 0,
    gold: { gp: 0, sp: 0, cp: 0 },
    items: [
      {
        id: 'r_blade',
        ref: 'frostbound:item:rimeblade',
        name: '',
        slots: 0,
        qty: 1,
        equipped: true,
      },
      { id: 'r_rope', ref: null, name: 'Rope', slots: 1, qty: 1, equipped: false },
    ],
    spells: [{ id: 'r_frost', ref: 'frostbound:spell:hoarfrost', name: '' }],
    talents: [
      {
        id: 'r_talent',
        text: 'A knack for the cold',
        source: 'frostbound:table:thawborn-talents',
        rolled: 5,
      },
    ],
    lights: [{ id: 'r_torch', ref: 'core:item:torch', name: '', litAt: null, minutes: 60 }],
    conditions: [],
    journal: [],
    quests: [],
    packsUsed: ['core', 'frostbound'],
  });
  if (!result.ok) throw new Error(reportProblems(result.problems, 'the fixture'));

  return result.character;
}

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

/** The sheet with a real setter behind it, so an edit that is allowed actually lands. */
function Harness({ stack }: { readonly stack: ResolvedStack }): ReactElement {
  const [character, setCharacter] = useState(fixture);

  return (
    <CharacterSheet
      character={character}
      setCharacter={setCharacter}
      orphans={orphanReport(character, stack)}
      stack={stack}
    />
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();

  // The whole app is mounted in the last test, and it fetches the core pack on mount.
  // Core answers; Frostbound is the pack that is not there.
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(CORE)),
    }),
  ) as unknown as typeof fetch;

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  // A mounted sheet keeps a debounced write in flight, and leaving one to fire during a
  // later test is what `portability.test.tsx` was bitten by.
  await act(async () => {
    root.unmount();
  });
  document.body.replaceChildren();
  localStorage.clear();
});

async function mount(stack: ResolvedStack): Promise<void> {
  await act(async () => {
    root.render(<Harness stack={stack} />);
  });
}

function rows(selector: string): readonly HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(selector)];
}

/** One row by the id its React key carries, found through the value it renders. */
function rowContaining(selector: string, text: string): HTMLElement {
  const found = rows(selector).find((row) =>
    [...row.querySelectorAll('input')].some((input) => input.value === text),
  );
  if (found === undefined) throw new Error(`no ${selector} showing ${text}`);

  return found;
}

function firstInput(row: HTMLElement): HTMLInputElement {
  const [input] = row.querySelectorAll('input');
  if (input === undefined) throw new Error('a row with no field');

  return input;
}

/** The control a label points at, whichever kind of control it turned out to be. */
function controlLabelled(label: string): HTMLElement {
  const found = [...container.querySelectorAll('label')].find(
    (element) => element.textContent === label,
  );
  const control = found === undefined ? null : document.getElementById(found.htmlFor);
  if (!(control instanceof HTMLElement)) throw new Error(`no control labelled ${label}`);

  return control;
}

function fieldLabelled(label: string): HTMLInputElement {
  const input = controlLabelled(label);
  if (!(input instanceof HTMLInputElement)) throw new Error(`no input labelled ${label}`);

  return input;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

// ---------------------------------------------------------------------------

describe('a pack turned off', () => {
  it('leaves every row on the sheet', async () => {
    await mount(WITHOUT);

    expect(rows('.row--item')).toHaveLength(2);
    expect(rows('.row--spell')).toHaveLength(1);
    expect(rows('.row--talent')).toHaveLength(1);
  });

  it('shows what an orphaned row points at rather than an empty box', async () => {
    await mount(WITHOUT);
    const row = rowContaining('.row--item', 'frostbound:item:rimeblade');

    expect(row.className).toContain('row--orphaned');
    expect(firstInput(row).readOnly).toBe(true);
  });

  it('names the pack to turn back on, beside the row', async () => {
    await mount(WITHOUT);

    expect(rowContaining('.row--item', 'frostbound:item:rimeblade').textContent).toContain(
      'needs frostbound',
    );
  });

  it('reads the ancestry back as its reference, read only', async () => {
    await mount(WITHOUT);
    const ancestry = fieldLabelled('Ancestry');

    expect(ancestry.value).toBe('frostbound:ancestry:thawborn');
    expect(ancestry.readOnly).toBe(true);
  });

  it('leaves a row the player typed in alone', async () => {
    await mount(WITHOUT);
    const row = rowContaining('.row--item', 'Rope');

    expect(row.className).not.toContain('row--orphaned');
    expect(firstInput(row).readOnly).toBe(false);
  });

  it('keeps the talent editable, because its words are on the sheet', async () => {
    await mount(WITHOUT);
    const talent = container.querySelector<HTMLTextAreaElement>('.row--talent textarea');

    expect(talent?.value).toBe('A knack for the cold');
    expect(talent?.readOnly).toBe(false);
    expect(rows('.row--talent')[0]?.className).not.toContain('row--orphaned');
  });

  it('keeps what the player owns live: quantity, equipped, and dropping the row', async () => {
    await mount(WITHOUT);
    const row = rowContaining('.row--item', 'frostbound:item:rimeblade');
    const [, quantity] = row.querySelectorAll('input');
    const checkbox = row.querySelector<HTMLInputElement>('.field__check');

    expect(quantity?.readOnly).toBe(false);
    expect(checkbox?.disabled).toBe(false);

    const remove = row.querySelector('button');
    if (remove === null) throw new Error('an orphaned row with no way out');
    await click(remove);

    // A pack being off must not trap a row on the sheet either.
    expect(rows('.row--item')).toHaveLength(1);
  });
});

describe('the pack back on', () => {
  it('marks nothing, and reads every row back in the pack\'s own words', async () => {
    await mount(WITH_FROSTBOUND);

    expect(rows('.row--orphaned')).toHaveLength(0);
    expect(rowContaining('.row--item', 'Rimeblade')).toBeDefined();

    // The ancestry is a picker again, sitting on the reference the sheet already held.
    const ancestry = controlLabelled('Ancestry');
    expect(ancestry).toBeInstanceOf(HTMLSelectElement);
    if (ancestry instanceof HTMLSelectElement) {
      expect(ancestry.value).toBe('frostbound:ancestry:thawborn');
      expect(ancestry.disabled).toBe(false);
    }
  });

  it('keeps a name the pack answers for read only, and the row itself live', async () => {
    await mount(WITH_FROSTBOUND);
    const row = rowContaining('.row--item', 'Rimeblade');
    const [name, quantity] = row.querySelectorAll('input');

    // A typed name would be discarded the moment the pack answered for it again, which
    // is the same reason an orphaned row's name is read only (DATA-MODEL.md §11).
    expect(name?.readOnly).toBe(true);
    expect(quantity?.readOnly).toBe(false);

    // The row the player typed in themselves is theirs to rename, packs or no packs.
    expect(firstInput(rowContaining('.row--item', 'Rope')).readOnly).toBe(false);
  });
});

describe('the whole app, opened on a sheet whose pack is not loaded', () => {
  it('warns, names the pack, and opens the sheet anyway', async () => {
    localStorage.setItem(CHARACTER_KEY, JSON.stringify(fixture()));

    await act(async () => {
      root.render(<App />);
    });

    const notice = [...container.querySelectorAll('.notice')].find((element) =>
      element.textContent?.includes('frostbound'),
    );

    expect(notice?.textContent).toContain('kept');
    expect(rows('.row--item')).toHaveLength(2);
    expect(rows('.row--orphaned').length).toBeGreaterThan(0);
  });
});
