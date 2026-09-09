// Issue #36: going back to any step, and being told what the change left behind.
//
// The first two criteria are structural rather than coded — a step writes to the sheet
// and there is no draft, so "later choices survive" is a property of the design
// (`ui/creation/creation.ts`). They are still asserted here, because a future change
// that introduced a draft would break them silently and every other test would pass.
//
// The third is the one with logic behind it. `consequences.test.ts` covers what counts
// as a flag; this covers that a player is actually shown one — in the progress list from
// anywhere, above the panel that owns it, and on the review with a way back.
//
// The packs are the real files off disk, like `step-roll.test.tsx`: which spells a
// wizard has is a claim about the shipped content, not about a fixture.
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
import type { Character } from '../../model/character';
import type { RandomWords } from '../../model/dice';
import { orphanReport } from '../../model/orphans';
import type { Pack } from '../../model/pack';
import { parsePack, reportProblems } from '../../model/pack';
import { resolvePacks } from '../../model/pack-resolver';
import { newSpell, newTalent } from '../../state/character-edits';
import { newCharacter } from '../../state/new-character';
import { useRolls } from '../../state/use-rolls';
import type { CreationStepId } from './creation';
import { Walkthrough } from './Walkthrough';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const repo = resolve(import.meta.dirname, '..', '..', '..');

function packFromDisk(...path: readonly string[]): Pack {
  const result = parsePack(JSON.parse(readFileSync(resolve(repo, ...path), 'utf8')));
  if (!result.ok) throw new Error(reportProblems(result.problems, path.join('/')));

  return result.pack;
}

const CORE = packFromDisk('public', 'packs', 'core.json');
const FROSTBOUND = packFromDisk('packs', 'example-pack.json');
const STACK = resolvePacks([CORE, FROSTBOUND]);

/** No die is thrown in this file; the source only has to exist. */
const NO_DICE: RandomWords = (into) => {
  into[0] = 0;
};

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

/**
 * The step is state here rather than a prop, because that is what `useCreation` makes it
 * in the app: the walkthrough asks to go somewhere and something above it moves. A test
 * that pinned the step could not tell a jump that worked from one that was ignored.
 */
function Harness({ from, at }: { readonly from: Character; readonly at: CreationStepId }): ReactElement {
  const [character, setCharacter] = useState(from);
  const [step, setStep] = useState<CreationStepId>(at);
  const rolls = useRolls(NO_DICE);

  latest = character;

  return (
    <Walkthrough
      step={step}
      onGo={setStep}
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

async function mount(from: Character, at: CreationStepId = 'abilities'): Promise<void> {
  await act(async () => {
    root.render(<Harness from={from} at={at} />);
  });
}

function character(): Character {
  if (latest === null) throw new Error('nothing mounted');
  return latest;
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** The progress list's own buttons — one per step, which is the point of it. */
function jumps(): readonly HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('.walkthrough__steps button')];
}

async function jumpTo(title: string): Promise<void> {
  const found = jumps().find((element) => element.textContent?.startsWith(title));
  if (found === undefined) throw new Error(`no step in the list called ${title}`);

  await click(found);
}

function position(): string {
  return container.querySelector('.walkthrough__position')?.textContent ?? '';
}

function stepPanelTitles(): readonly string[] {
  return [...container.querySelectorAll('.panel__title')].map((element) => element.textContent ?? '');
}

/** The flag strip, wherever it is on screen right now. */
function flagsShown(): readonly string[] {
  return [...container.querySelectorAll('.flags__list li')].map(
    (element) => element.textContent ?? '',
  );
}

/** Which steps the progress list is asking to be looked at again. */
function wanting(): readonly string[] {
  return [...container.querySelectorAll('.walkthrough__wants')].map(
    (element) => element.parentElement?.textContent ?? '',
  );
}

function fieldLabelled(label: string): HTMLInputElement {
  const found = [...container.querySelectorAll('label')].find(
    (element) => element.textContent === label,
  );
  const input = found === undefined ? null : document.getElementById(found.htmlFor);
  if (!(input instanceof HTMLInputElement)) throw new Error(`no input labelled ${label}`);
  return input;
}

/** React owns the value setter, so a real keystroke goes through the prototype. */
async function type(input: HTMLInputElement, value: string): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  await act(async () => {
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** A wizard who has learned two of the wizard's spells, the way the picker writes them. */
function wizard(): Character {
  const blank = newCharacter();
  return {
    ...blank,
    class: { ref: 'core:class:wizard', name: '' },
    spells: [
      { ...newSpell(), ref: 'core:spell:alarm' },
      { ...newSpell(), ref: 'core:spell:burning-hands' },
    ],
  };
}

describe('going back', () => {
  it('offers every step in the list, and goes straight to the one pressed', async () => {
    await mount(newCharacter());

    expect(jumps()).toHaveLength(8);
    expect(position()).toContain('Step 1 of 8');

    await jumpTo('Gear');
    expect(position()).toContain('Step 5 of 8');
    expect(stepPanelTitles()).toEqual(['Gear']);

    // Back to the first step in one press rather than four, which is the criterion.
    await jumpTo('Abilities');
    expect(position()).toContain('Step 1 of 8');
    expect(stepPanelTitles()).toEqual(['Abilities']);
  });

  it('keeps what a later step entered when an earlier one is revisited', async () => {
    await mount(newCharacter(), 'identity');

    await type(fieldLabelled('Name'), 'Vess of the Low Road');
    await jumpTo('Abilities');
    await type(fieldLabelled('Strength'), '15');

    await jumpTo('Who they are');
    expect(fieldLabelled('Name').value).toBe('Vess of the Low Road');
    expect(character().stats.str).toBe(15);
  });
});

describe('what the change left behind', () => {
  it('flags spells the class chosen instead does not cast, and removes none of them', async () => {
    const changed: Character = { ...wizard(), class: { ref: 'core:class:fighter', name: '' } };
    await mount(changed, 'spells');

    expect(flagsShown()).toHaveLength(2);
    expect(flagsShown()[0]).toContain('Alarm');
    expect(flagsShown()[0]).toContain('Fighter');

    // PRD.md principle 4. The rows are exactly where they were.
    expect(character().spells).toHaveLength(2);
  });

  it('says so in the progress list, from a step that is nowhere near it', async () => {
    const changed: Character = { ...wizard(), class: { ref: 'core:class:fighter', name: '' } };
    await mount(changed, 'abilities');

    // Nothing on screen belongs to the spells step, and the list still asks for it.
    expect(flagsShown()).toEqual([]);
    expect(wanting()).toEqual(['Spells — look again']);
  });

  it('flags a talent taken from a list this class is not offered', async () => {
    // Frostbound extends the fighter with Cold-Forged; the wizard was never offered it.
    const character: Character = {
      ...wizard(),
      talents: [newTalent('Cold-Forged', 'frostbound:talent:cold-forged')],
    };
    await mount(character, 'talents');

    expect(flagsShown()).toHaveLength(1);
    expect(flagsShown()[0]).toContain('Cold-Forged');
    expect(flagsShown()[0]).toContain('Wizard');
  });

  it('lists every one on the review, with a way back to the step that answers it', async () => {
    const changed: Character = {
      ...wizard(),
      class: { ref: 'core:class:fighter', name: '' },
      talents: [newTalent('Arcane something', 'frostbound:talent:cold-forged')],
    };
    await mount(changed, 'review');

    // The fighter *is* offered Cold-Forged, so only the spells are flagged.
    expect(flagsShown()).toHaveLength(2);

    const back = [...container.querySelectorAll('button')].find(
      (element) => element.textContent === 'Go to Spells',
    );
    expect(back).toBeDefined();

    await click(back as HTMLButtonElement);
    expect(position()).toContain('Step 7 of 8');
    expect(stepPanelTitles()).toEqual(['Spells']);
  });

  it('says nothing while the answers still agree', async () => {
    await mount(wizard(), 'review');

    expect(flagsShown()).toEqual([]);
    expect(wanting()).toEqual([]);
  });
});
