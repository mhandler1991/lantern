// Issue #35's three criteria: the roll half uses the Phase 3 dice, the choose half is
// the pack-driven picker, and every option says which pack supplied it.
//
// The randomness is scripted (`useRolls` takes its source as an argument), so these are
// assertions about *which* number was written down rather than about a number being in
// range. That is the only way to catch the failure this feature can actually have: a
// roll that lands on the corner and a different option landing on the sheet.
//
// The packs are the real files off disk, as `sheet/pack-content.test.tsx` reads them —
// a fixture would prove the wiring and nothing about the shipped content, and "content
// from any loaded pack appears" is a claim about the content.
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
import { ABILITY_ROLL_NOTATION } from '../../constants';
import type { Character } from '../../model/character';
import type { RandomWords } from '../../model/dice';
import { orphanReport } from '../../model/orphans';
import type { Pack } from '../../model/pack';
import { parsePack, reportProblems } from '../../model/pack';
import { resolvePacks } from '../../model/pack-resolver';
import { newCharacter } from '../../state/new-character';
import { useRolls } from '../../state/use-rolls';
import type { CreationStepId } from './creation';
import { Walkthrough } from './Walkthrough';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** The repository root. `import.meta.url` is an `http:` URL under jsdom, not a file one. */
const repo = resolve(import.meta.dirname, '..', '..', '..');

function packFromDisk(...path: readonly string[]): Pack {
  const result = parsePack(JSON.parse(readFileSync(resolve(repo, ...path), 'utf8')));
  if (!result.ok) throw new Error(reportProblems(result.problems, path.join('/')));

  return result.pack;
}

const CORE = packFromDisk('public', 'packs', 'core.json');
const FROSTBOUND = packFromDisk('packs', 'example-pack.json');
const STACK = resolvePacks([CORE, FROSTBOUND]);

/** Core's six ancestries plus Frostbound's one, and its four classes plus Frostbound's. */
const ANCESTRY_COUNT = 7;
const CLASS_COUNT = 5;

/**
 * A source that hands back one word over and over. Every face this app draws is
 * `word % sides + 1`, so one word fixes every die in a case — and a case that needs two
 * different faces uses two of these.
 */
function always(word: number): RandomWords {
  return (into) => {
    into[0] = word;
  };
}

let container: HTMLDivElement;
let root: Root;
let latest: Character | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  latest = null;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  document.body.replaceChildren();
});

function Harness({
  step,
  random,
  from,
}: {
  readonly step: CreationStepId;
  readonly random: RandomWords;
  readonly from: Character;
}): ReactElement {
  const [character, setCharacter] = useState(from);
  const rolls = useRolls(random);

  latest = character;

  return (
    <Walkthrough
      step={step}
      onGo={() => undefined}
      onLeave={() => undefined}
      canResume
      character={character}
      setCharacter={setCharacter}
      orphans={orphanReport(character, STACK)}
      stack={STACK}
      rolls={rolls}
    />
  );
}

async function mount(
  step: CreationStepId,
  random: RandomWords,
  from: Character = newCharacter(),
): Promise<void> {
  await act(async () => {
    root.render(<Harness step={step} random={random} from={from} />);
  });
}

/** The character as it stands right now. Non-null because the harness is mounted. */
function character(): Character {
  if (latest === null) throw new Error('nothing mounted');
  return latest;
}

function buttons(): readonly HTMLButtonElement[] {
  return [...container.querySelectorAll('button')];
}

/**
 * What a button reads as on screen. A `RollButton` carries the whole sentence as its
 * accessible name and the short word in an `aria-hidden` span (`ui/fields.tsx`), so its
 * `textContent` is both at once — matching on it would match the sentence too.
 */
function shownOn(element: HTMLButtonElement): string {
  const visible = element.querySelector('[aria-hidden="true"]');
  return (visible?.textContent ?? element.textContent ?? '').trim();
}

function find(text: string): HTMLButtonElement | undefined {
  return buttons().find((element) => shownOn(element) === text);
}

function press(text: string): Promise<void> {
  const found = find(text);
  if (!found) throw new Error(`no button reading ${text}`);

  return act(async () => {
    found.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function has(text: string): boolean {
  return find(text) !== undefined;
}

function fieldLabelled(label: string): HTMLInputElement {
  const found = [...container.querySelectorAll('label')].find(
    (element) => element.textContent === label,
  );
  const input = found === undefined ? null : document.getElementById(found.htmlFor);
  if (!(input instanceof HTMLInputElement)) throw new Error(`no input labelled ${label}`);
  return input;
}

function selectLabelled(label: string): HTMLSelectElement {
  const found = [...container.querySelectorAll('label')].find(
    (element) => element.textContent === label,
  );
  const control = found === undefined ? null : document.getElementById(found.htmlFor);
  if (!(control instanceof HTMLSelectElement)) throw new Error(`no picker labelled ${label}`);
  return control;
}

function optionsOf(label: string): readonly string[] {
  return [...selectLabelled(label).options].map((option) => option.textContent ?? '');
}

// ---------------------------------------------------------------------------
// Roll uses the Phase 3 dice
// ---------------------------------------------------------------------------

describe('rolling a step', () => {
  it('writes the score the dice actually showed into every ability', async () => {
    // 4 % 6 + 1 = 5 on every die, so 3d6 is 15 — a number no default and no clamp could
    // have produced by accident.
    await mount('abilities', always(4));
    await press('Roll all six');

    expect(ABILITY_ROLL_NOTATION).toBe('3d6');
    expect(character().stats).toEqual({ str: 15, dex: 15, con: 15, int: 15, wis: 15, cha: 15 });
    expect(fieldLabelled('Strength').value).toBe('15');
  });

  it('rolls one ability without touching the other five', async () => {
    await mount('abilities', always(0));
    await press('Dexterity');

    // 0 % 6 + 1 = 1, three times.
    expect(character().stats.dex).toBe(3);
    expect(character().stats.str).toBe(10);
  });

  it('keeps every roll in the feed, so the corner shows what was written down', async () => {
    await mount('abilities', always(4));
    await press('Roll all six');

    // Six rolls, six entries — the sheet's numbers came off these and nothing else.
    expect(fieldLabelled('Charisma').value).toBe('15');
  });

  it('rolls the class’s own hit die, and nothing when no pack says what it is', async () => {
    const fighter: Character = {
      ...newCharacter(),
      class: { ref: 'core:class:fighter', name: '' },
    };

    // Core's fighter rolls d8; 5 % 8 + 1 = 6.
    await mount('vitals', always(5), fighter);
    expect(has('Roll d8')).toBe(true);

    await press('Roll d8');
    expect(character().hp).toEqual({ current: 6, max: 6 });
    // The die goes down with the number, so a class changed afterwards can be reported
    // rather than guessed at (#161).
    expect(character().hpRolledOn).toBe('d8');
  });

  it('offers no hit die when no loaded pack answers for the class', async () => {
    await mount('vitals', always(0));

    // The strip is still there and says why there is nothing to throw; the navigation
    // buttons below it are the walkthrough's own.
    expect(container.querySelector('.step-roll__dice')).toBeNull();
    expect(container.querySelector('.step-roll')?.textContent).toContain('typed in');
  });

  it('leaves the talents step to the panel’s own table roll', async () => {
    const fighter: Character = {
      ...newCharacter(),
      class: { ref: 'core:class:fighter', name: '' },
    };
    await mount('talents', always(0), fighter);

    expect(container.querySelector('.step-roll')).toBeNull();
    expect(has('Roll on Fighter talents')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Choose uses the pack-driven pickers, and content from any pack appears
// ---------------------------------------------------------------------------

describe('rolling among what the packs offer', () => {
  it('can land on a supplement’s ancestry, not just the core ones', async () => {
    // Seven ancestries are loaded and Frostbound's is the last: 6 % 7 + 1 = 7.
    await mount('identity', always(ANCESTRY_COUNT - 1));
    await press('Roll ancestry');

    expect(character().ancestry).toEqual({ ref: 'frostbound:ancestry:frostborn', name: '' });
    // The picker below is showing the same thing the dice chose.
    expect(selectLabelled('Ancestry').value).toBe('frostbound:ancestry:frostborn');
  });

  it('can land on a supplement’s class', async () => {
    await mount('identity', always(CLASS_COUNT - 1));
    await press('Roll class');

    expect(character().class).toEqual({ ref: 'frostbound:class:rimewalker', name: '' });
  });

  it('rolls an alignment from the model’s own three', async () => {
    await mount('identity', always(1));
    await press('Roll alignment');

    // 1 % 3 + 1 = 2 — the second of `lawful`, `neutral`, `chaotic`.
    expect(character().alignment).toBe('neutral');
  });

  it('rolls a row onto the sheet as a reference, never as a copied name', async () => {
    await mount('gear', always(0));
    await press('Roll for an item');

    const [item] = character().items;
    expect(item?.ref).not.toBeNull();
    // DATA-MODEL.md §12 — `name` is a fallback, never a cache of the pack's word.
    expect(item?.name).toBe('');
  });

  it('rolls a spell the class can learn', async () => {
    const rimewalker: Character = {
      ...newCharacter(),
      class: { ref: 'frostbound:class:rimewalker', name: '' },
    };
    await mount('spells', always(0), rimewalker);
    await press('Roll for a spell');

    // Frostbound's two spells are the whole of what a rimewalker knows, so a roll here
    // cannot reach core's fifty-nine.
    expect(character().spells[0]?.ref).toMatch(/^frostbound:spell:/);
  });
});

// ---------------------------------------------------------------------------
// Labelled with its source
// ---------------------------------------------------------------------------

describe('where an option came from', () => {
  it('names the pack on every option, whether or not the name repeats', async () => {
    await mount('identity', always(0));

    expect(optionsOf('Ancestry')).toContain('Human (Core)');
    expect(optionsOf('Ancestry')).toContain('Frostborn (Frostbound)');
    expect(optionsOf('Class')).toContain('Rimewalker (Frostbound)');
  });

  it('says how many things a roll is choosing between, on the button itself', async () => {
    await mount('identity', always(0));

    expect(find('Roll ancestry')?.title).toContain(String(ANCESTRY_COUNT));
  });
});
