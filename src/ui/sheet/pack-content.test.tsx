// PRD.md §5, Phase 2: "the core pack drives every picker in the app, a homebrew pack
// adds a class". Issue #27's acceptance run, as far as a test can carry it.
//
// The packs are the real files off disk rather than fixtures — `public/packs/core.json`
// is what the app fetches on boot and `packs/example-pack.json` is the homebrew file an
// author copies first. A fixture would prove the wiring and nothing about the shipped
// content, and the criterion is about the shipped content.
//
// Component rendering detail is not worth testing during build-out (CLAUDE.md §7). What
// is tested here is the sentence Phase 2 is done when: a pack that is on reaches every
// picker, drives the numbers the sheet computes, and leaves the sheet intact when it
// goes off again.
//
// No @testing-library: React 18.3 exports `act`, and CLAUDE.md §12 forbids installing a
// package without asking.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { act, useState } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Pack } from '../../model/pack';
import { parsePack, reportProblems } from '../../model/pack';
import { orphanReport } from '../../model/orphans';
import type { ResolvedStack } from '../../model/pack-resolver';
import { resolvePacks } from '../../model/pack-resolver';
import { newCharacter } from '../../state/new-character';
import { CharacterSheet } from './CharacterSheet';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** The repository root. `import.meta.url` is an `http:` URL under jsdom, not a file one. */
const root_ = resolve(import.meta.dirname, '..', '..', '..');

/** The escape hatch every picker carries: the option that puts the field back to text. */
const OWN_WORDS = 1;

function packFromDisk(...path: readonly string[]): Pack {
  const result = parsePack(JSON.parse(readFileSync(resolve(root_, ...path), 'utf8')));
  if (!result.ok) throw new Error(reportProblems(result.problems, path.join('/')));

  return result.pack;
}

const CORE = packFromDisk('public', 'packs', 'core.json');
const FROSTBOUND = packFromDisk('packs', 'example-pack.json');

/** One kind out of a pack. Every array is optional in the schema (DATA-MODEL.md §1). */
function held<T>(entries: readonly T[] | undefined): readonly T[] {
  return entries ?? [];
}

const ONLY_CORE = resolvePacks([CORE]);
const WITH_FROSTBOUND = resolvePacks([CORE, FROSTBOUND]);

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

/** The sheet with a real setter behind it, and a stack that can be turned off under it. */
function Harness({ stack }: { readonly stack: ResolvedStack }): ReactElement {
  const [character, setCharacter] = useState(newCharacter);

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
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
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

/** One panel of the sheet, by the word on its banner. */
function panel(title: string): HTMLElement {
  const found = [...container.querySelectorAll<HTMLElement>('.panel')].find(
    (section) => section.querySelector('.panel__title')?.textContent === title,
  );
  if (found === undefined) throw new Error(`no panel titled ${title}`);

  return found;
}

/** The control a label points at, wherever on the sheet that label is. */
function control(label: string, within: ParentNode = container): HTMLElement {
  const found = [...within.querySelectorAll('label')].find(
    (element) => element.textContent === label,
  );
  const element = found === null || found === undefined ? null : document.getElementById(found.htmlFor);
  if (!(element instanceof HTMLElement)) throw new Error(`no control labelled ${label}`);

  return element;
}

function picker(label: string, within: ParentNode = container): HTMLSelectElement {
  const element = control(label, within);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`${label} is not a picker`);

  return element;
}

function optionLabels(select: HTMLSelectElement): readonly string[] {
  return [...select.options].slice(OWN_WORDS).map((option) => option.textContent ?? '');
}

/** A pick, the way the browser makes one: the value moves, then `change` fires. */
async function choose(select: HTMLSelectElement, value: string): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  await act(async () => {
    descriptor?.set?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/**
 * React installs its own value setter on the element, so assigning `.value` directly is
 * invisible to it. Going through the prototype descriptor is how a real keystroke looks.
 */
async function type(input: HTMLInputElement, value: string): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  await act(async () => {
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function button(label: string, within: ParentNode = container): HTMLButtonElement {
  const found = [...within.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no button labelled ${label}`);

  return found;
}

/** What each panel's pack list is labelled, which is also what it says while unpicked. */
const PACK_LIST: Readonly<Record<string, string>> = {
  Gear: 'Add gear from a pack',
  Spells: 'Add a spell from a pack',
  Light: 'Add a light from a pack',
};

function packList(title: string): HTMLSelectElement {
  return picker(PACK_LIST[title] ?? '', panel(title));
}

/** Pick something from a panel's pack list and press the button beside it. */
async function addFromPack(title: string, ref: string): Promise<void> {
  await choose(packList(title), ref);
  await click(button('Add', panel(title)));
}

function rows(selector: string): readonly HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(selector)];
}

// ---------------------------------------------------------------------------

describe('the core pack drives every picker', () => {
  it('offers every ancestry and every class it defines', async () => {
    await mount(ONLY_CORE);

    expect(optionLabels(picker('Ancestry'))).toHaveLength(held(CORE.ancestries).length);
    expect(optionLabels(picker('Class'))).toContain('Wizard');
    expect(optionLabels(picker('Class'))).toHaveLength(held(CORE.classes).length);
  });

  it('offers every item to the gear list and to the light list', async () => {
    await mount(ONLY_CORE);

    expect(optionLabels(packList('Gear'))).toHaveLength(held(CORE.items).length);
    expect(optionLabels(packList('Light'))).toContain('Torch');
  });

  it('offers every spell until a class narrows the list to its own', async () => {
    await mount(ONLY_CORE);
    const spells = () => optionLabels(packList('Spells'));

    expect(spells()).toHaveLength(held(CORE.spells).length);

    await choose(picker('Class'), 'core:class:wizard');

    const wizardSpells = held(CORE.spells).filter((spell) =>
      spell.classes.some((reference) => reference.endsWith('wizard')),
    );
    expect(spells()).toHaveLength(wizardSpells.length);
    expect(spells().length).toBeLessThan(held(CORE.spells).length);
  });

  it('says what the chosen class casts on, and the tier it has reached', async () => {
    await mount(ONLY_CORE);
    await choose(picker('Class'), 'core:class:wizard');

    // A new character is level 0, which is a real state and reaches no tier at all.
    expect(panel('Spells').textContent).toContain('No tier reached');

    const level = control('Level');
    if (!(level instanceof HTMLInputElement)) throw new Error('no level field');
    await type(level, '1');

    // Every stat is at the default 10, so the modifier is zero and printed as `0`.
    expect(panel('Spells').textContent).toContain('INT 0');
    expect(panel('Spells').textContent).toContain('Casting up to tier 1, DC 11');
  });

  it('leaves nothing to pick from, and every box to type in, with no packs at all', async () => {
    await mount(resolvePacks([]));

    expect(container.querySelectorAll('select')).toHaveLength(1); // Alignment, always.
    expect(control('Ancestry')).toBeInstanceOf(HTMLInputElement);
  });
});

describe('a row added from a pack', () => {
  it('stores the reference and reads its name back out of the pack', async () => {
    await mount(ONLY_CORE);
    await addFromPack('Gear', 'core:item:torch');

    const [name, quantity] = rows('.row--item')[0]?.querySelectorAll('input') ?? [];
    expect(name?.value).toBe('Torch');

    // The pack owns the word and the weight; the player owns how many are carried.
    expect(name?.readOnly).toBe(true);
    expect(quantity?.readOnly).toBe(false);
  });

  it('is counted at the pack\'s slots rather than at the zero on the row', async () => {
    await mount(ONLY_CORE);
    expect(panel('Gear').textContent).toContain('0 / 10 slots');

    await addFromPack('Gear', 'core:item:plate-mail');

    // Plate mail is 4 slots in core.json. The row itself carries none, so a sheet
    // reading the row rather than the pack would say one, or nothing at all.
    expect(panel('Gear').textContent).toContain('4 / 10 slots');
  });

  it('changes AC when armour is equipped, which is what a pack was needed for', async () => {
    await mount(ONLY_CORE);
    expect(panel('Vitals').textContent).toContain('AC 10');

    await addFromPack('Gear', 'core:item:leather-armor');
    const equipped = rows('.row--item')[0]?.querySelector<HTMLInputElement>('.field__check');
    if (!equipped) throw new Error('the item row has no equipped box');
    await click(equipped);

    // Leather armour is AC 11 and takes dexterity, which is +0 at the default score.
    expect(panel('Vitals').textContent).toContain('AC 11');
    expect(panel('Vitals').textContent).toContain('Armour worn');
  });

  it('shows the tier and DC a pack gives a spell', async () => {
    await mount(ONLY_CORE);
    await addFromPack('Spells', 'core:spell:magic-missile');

    // Tier 1, so DC 11 — arithmetic on what the pack said, and nothing adjudicated.
    expect(panel('Spells').textContent).toContain('tier 1 · DC 11');
  });
});

describe('a homebrew pack', () => {
  it('adds a class, and it appears beside the core ones', async () => {
    await mount(WITH_FROSTBOUND);

    expect(optionLabels(picker('Class'))).toContain('Rimewalker');
    expect(optionLabels(picker('Class'))).toHaveLength(held(CORE.classes).length + held(FROSTBOUND.classes).length);
  });

  it('brings its own spell list with the class that was picked', async () => {
    await mount(WITH_FROSTBOUND);
    await choose(picker('Class'), 'frostbound:class:rimewalker');

    expect(optionLabels(packList('Spells'))).toEqual([
      'Hoarfrost',
      'Glacial step',
    ]);
    expect(panel('Spells').textContent).toContain('WIS 0');
  });

  it('overrides a core item without moving it, so the sheet reads the new one', async () => {
    await mount(WITH_FROSTBOUND);
    await addFromPack('Light', 'core:item:torch');

    // `storm-torch` overrides `core:item:torch`, so the reference is unchanged and the
    // word on the row is the supplement's (DATA-MODEL.md §9).
    const [name] = rows('.row--light')[0]?.querySelectorAll('input') ?? [];
    expect(name?.value).toBe('Storm torch');
  });
});

describe('that pack turned off, with a character still using it', () => {
  it('keeps the class, marks it, and reads it back as its reference', async () => {
    await mount(WITH_FROSTBOUND);
    await choose(picker('Class'), 'frostbound:class:rimewalker');
    await addFromPack('Gear', 'frostbound:item:rimeblade');

    await mount(ONLY_CORE);

    const chosen = control('Class');
    expect(chosen).toBeInstanceOf(HTMLInputElement);
    if (chosen instanceof HTMLInputElement) {
      expect(chosen.value).toBe('frostbound:class:rimewalker');
      expect(chosen.readOnly).toBe(true);
    }

    expect(panel('Character').textContent).toContain('needs frostbound');
  });

  it('keeps the gear, and counts it at what the row was left holding', async () => {
    await mount(WITH_FROSTBOUND);
    await addFromPack('Gear', 'frostbound:item:rimeblade');
    await mount(ONLY_CORE);

    expect(rows('.row--item')).toHaveLength(1);
    expect(rows('.row--orphaned')).toHaveLength(1);
    expect(panel('Gear').textContent).toContain('frostbound:item:rimeblade');
  });
});
