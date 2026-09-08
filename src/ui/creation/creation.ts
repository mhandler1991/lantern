/**
 * The creation sequence: what the steps are, what order they come in, and what is still
 * blank at the end of them. Pure — no React, no DOM, no storage.
 *
 * The walkthrough is a **guided ordering over the sheet**, not a second editor. Each
 * step names one panel the sheet already has, and `ui/creation/Walkthrough.tsx` renders
 * that panel with a prompt above it. That is the decision the rest of the feature hangs
 * off: there is no draft character, no commit step and no second copy of the editing
 * rules, so what a step writes is saved and validated by exactly the path an edit made
 * on the sheet takes. "Produces a valid `Character`" is then a property of the sheet
 * rather than a promise the walkthrough makes at the end.
 *
 * 🚫 Nothing here adjudicates (PRD.md principle 1). `outstanding` reports which fields
 * are still empty, and empty is not the same as wrong: a character with no gear and no
 * name is a valid character the schema loads happily, and finishing is never refused
 * over one (PRD.md principle 4).
 *
 * 🚫 No rules text. A prompt says what the control in front of it does, in our words.
 */

import { DEFAULT_STAT_SCORE } from '../../constants';
import type { Character, ContentRef } from '../../model/character';

/** Nothing on a list, and nothing recorded. A floor, not a business rule. */
const NONE = 0;

/** Where a step is not in the sequence at all. */
const NOT_FOUND = -1;

/** The first position, as a player counts them: "step 1 of 8". */
const FIRST_POSITION = 1;

export type CreationStepId =
  | 'abilities'
  | 'identity'
  | 'vitals'
  | 'talents'
  | 'gear'
  | 'light'
  | 'spells'
  | 'review';

export type CreationStep = {
  readonly id: CreationStepId;
  /** The word in the progress list, and in the button that goes to it. */
  readonly title: string;
  /** One sentence above the panel, saying what this step is for. */
  readonly prompt: string;
};

/**
 * The order. Abilities first because the rest is easier to decide once they are on the
 * page, identity next because it is what the pickers below it narrow on, and review
 * last — it is the only step that is not a panel.
 */
export const CREATION_STEPS: readonly CreationStep[] = [
  {
    id: 'abilities',
    title: 'Abilities',
    prompt:
      'Six scores, made however your table makes them. Type in what you rolled, or set them by hand — the modifiers are worked out beside each one.',
  },
  {
    id: 'identity',
    title: 'Who they are',
    prompt:
      'A name, an ancestry, a class and an alignment. Each picker offers what the loaded packs hold, and each one also takes your own words instead.',
  },
  {
    id: 'vitals',
    title: 'Vitals',
    prompt:
      'Hit points and luck. Armour class is not a field here — it is worked out from what is worn, so it changes when the gear does.',
  },
  {
    id: 'talents',
    title: 'Talents',
    prompt:
      'Anything this character starts with, in words. A talent is text on a sheet: recording one never changes a number elsewhere.',
  },
  {
    id: 'gear',
    title: 'Gear',
    prompt:
      'What they carry. Add rows from a loaded pack or type your own; the slots each one costs are counted for you.',
  },
  {
    id: 'light',
    title: 'Light',
    prompt:
      'What they have to see by. Nothing needs lighting yet — a light starts burning when it is lit at the table, not when it is written down.',
  },
  {
    id: 'spells',
    title: 'Spells',
    prompt:
      'Only if they cast. Once a pack says what the chosen class knows, the picker narrows to it.',
  },
  {
    id: 'review',
    title: 'Review',
    prompt:
      'Everything you entered is already on the sheet and already saved. Anything still blank is listed below — none of it stops you finishing.',
  },
];

/** The ids alone, in order, for the parts that only navigate. */
export const CREATION_STEP_IDS: readonly CreationStepId[] = CREATION_STEPS.map((step) => step.id);

export function stepAt(id: CreationStepId): CreationStep {
  const found = CREATION_STEPS.find((step) => step.id === id);

  // Unreachable through the type, and cheaper than making every caller handle a null:
  // the id union and the array are written together in this file.
  if (found === undefined) throw new Error(`unknown creation step: ${id}`);
  return found;
}

/** 1-based, so it prints as "step 3 of 8" without arithmetic at the call site. */
export function positionOf(id: CreationStepId): number {
  return CREATION_STEP_IDS.indexOf(id) + FIRST_POSITION;
}

export function stepCount(): number {
  return CREATION_STEPS.length;
}

/** The step after this one, or null at the end of the sequence. */
export function nextOf(id: CreationStepId): CreationStepId | null {
  const index = CREATION_STEP_IDS.indexOf(id);
  if (index === NOT_FOUND) return null;

  return CREATION_STEP_IDS[index + FIRST_POSITION] ?? null;
}

/** The step before this one, or null at the start. */
export function previousOf(id: CreationStepId): CreationStepId | null {
  const index = CREATION_STEP_IDS.indexOf(id);
  if (index <= NONE) return null;

  return CREATION_STEP_IDS[index - FIRST_POSITION] ?? null;
}

function isUnchosen(held: ContentRef): boolean {
  return held.ref === null && held.name.trim() === '';
}

/**
 * Whether this sheet looks like one nobody has touched: the character `newCharacter()`
 * makes, and nothing since. It decides how loudly the walkthrough is offered and
 * nothing else — a player with a half-built character is offered it just as readily,
 * only more quietly.
 */
export function isUnstarted(character: Character): boolean {
  return (
    character.name.trim() === '' &&
    isUnchosen(character.ancestry) &&
    isUnchosen(character.class) &&
    character.alignment === null &&
    Object.values(character.stats).every((score) => score === DEFAULT_STAT_SCORE) &&
    character.hp.max === NONE &&
    character.items.length === NONE &&
    character.spells.length === NONE &&
    character.talents.length === NONE &&
    character.lights.length === NONE
  );
}

/**
 * What is still empty, named the way a player would name it. Ordered as the sequence is,
 * so the list reads as a route back rather than a scolding.
 *
 * 🚫 Not validation. Every one of these is a legal state the schema loads, and the
 * review step prints them beside a Finish button that works regardless.
 */
export function outstanding(character: Character): readonly string[] {
  const missing: string[] = [];

  if (Object.values(character.stats).every((score) => score === DEFAULT_STAT_SCORE)) {
    missing.push('ability scores — every one is still at its starting value');
  }
  if (character.name.trim() === '') missing.push('a name');
  if (isUnchosen(character.ancestry)) missing.push('an ancestry');
  if (isUnchosen(character.class)) missing.push('a class');
  if (character.alignment === null) missing.push('an alignment');
  if (character.hp.max === NONE) missing.push('hit points');
  if (character.items.length === NONE) missing.push('anything to carry');

  return missing;
}
