// The sequence, the navigation off each end of it, and what "still blank" means.
//
// These are the silent-wrong-answer parts of the walkthrough (CLAUDE.md §7): a step
// that appears twice in the list, a `next` that walks off the end, or an outstanding
// report that calls a legal character incomplete are all things that look fine on
// screen and are wrong. The shell itself is tested where it is used, in
// `walkthrough.test.tsx`.

import { describe, expect, it } from 'vitest';
import { DEFAULT_STAT_SCORE, MAX_CHARACTER_ID_LENGTH } from '../../constants';
import type { Character } from '../../model/character';
import { parseCharacter } from '../../model/character';
import { newItem } from '../../state/character-edits';
import { createCharacter } from '../../state/new-character';
import type { CreationStepId } from './creation';
import {
  CREATION_STEPS,
  CREATION_STEP_IDS,
  isUnstarted,
  nextOf,
  outstanding,
  positionOf,
  previousOf,
  stepAt,
  stepCount,
} from './creation';

const FIRST: CreationStepId = 'abilities';
const LAST: CreationStepId = 'review';

function blank(): Character {
  return createCharacter('c_walkthrough');
}

/** A character with something in every field `outstanding` looks at. */
function filled(): Character {
  const character = blank();
  return {
    ...character,
    name: 'Vess',
    ancestry: { ref: null, name: 'Marsh-born' },
    class: { ref: null, name: 'Thief' },
    alignment: 'neutral',
    stats: { ...character.stats, str: DEFAULT_STAT_SCORE + 1 },
    hp: { current: 5, max: 5 },
    items: [{ ...newItem(), name: 'Rope' }],
  };
}

describe('the creation sequence', () => {
  it('has no repeated step, and ends on the review', () => {
    expect(new Set(CREATION_STEP_IDS).size).toBe(CREATION_STEPS.length);
    expect(CREATION_STEP_IDS[CREATION_STEP_IDS.length - 1]).toBe(LAST);
    expect(CREATION_STEP_IDS[0]).toBe(FIRST);
    expect(stepCount()).toBe(CREATION_STEPS.length);
  });

  it('gives every step a title and a prompt, and no rulebook to read', () => {
    for (const step of CREATION_STEPS) {
      expect(stepAt(step.id)).toBe(step);
      expect(step.title.trim()).not.toBe('');
      expect(step.prompt.trim()).not.toBe('');
    }
  });

  // The stored bookmark caps the step id at the character id's length. A longer id
  // would parse fine here and be dropped on the way back in, which is a resume that
  // silently stops working rather than a test that fails.
  it('keeps every step id inside what the stored position will accept', () => {
    for (const id of CREATION_STEP_IDS) {
      expect(id.length).toBeLessThanOrEqual(MAX_CHARACTER_ID_LENGTH);
    }
  });

  it('counts positions the way a player reads them', () => {
    expect(positionOf(FIRST)).toBe(1);
    expect(positionOf(LAST)).toBe(CREATION_STEPS.length);
  });

  it('walks forward and back, and stops at both ends', () => {
    expect(previousOf(FIRST)).toBeNull();
    expect(nextOf(LAST)).toBeNull();

    let step: CreationStepId | null = FIRST;
    const walked: CreationStepId[] = [];
    while (step !== null) {
      walked.push(step);
      step = nextOf(step);
    }
    expect(walked).toEqual(CREATION_STEP_IDS);

    for (const id of CREATION_STEP_IDS) {
      const back = previousOf(id);
      if (back !== null) expect(nextOf(back)).toBe(id);
    }
  });
});

describe('what is still blank', () => {
  it('names every empty field on an untouched sheet', () => {
    const missing = outstanding(blank());

    expect(missing).toHaveLength(7);
    expect(missing.join(' ')).toContain('a name');
    expect(missing.join(' ')).toContain('an ancestry');
    expect(missing.join(' ')).toContain('a class');
  });

  it('says nothing about a character who has been filled in', () => {
    expect(outstanding(filled())).toEqual([]);
  });

  // PRD.md principle 4, and the point of the review step: blank is not invalid. A sheet
  // with every one of these outstanding still parses, and finishing is never refused.
  it('reports blanks on a character that validates perfectly well', () => {
    const parsed = parseCharacter(blank());

    expect(parsed.ok).toBe(true);
    expect(outstanding(blank()).length).toBeGreaterThan(0);
  });

  it('counts a typed-in ancestry as chosen, with no pack in sight', () => {
    const typed = { ...blank(), ancestry: { ref: null, name: 'Marsh-born' } };

    expect(outstanding(typed).join(' ')).not.toContain('an ancestry');
  });
});

describe('whether a sheet has been started', () => {
  it('is true for the character a first visit opens', () => {
    expect(isUnstarted(blank())).toBe(true);
  });

  it('is false once anything at all is on it', () => {
    expect(isUnstarted({ ...blank(), name: 'Vess' })).toBe(false);
    expect(isUnstarted({ ...blank(), items: [newItem()] })).toBe(false);
    expect(isUnstarted(filled())).toBe(false);
  });
});
