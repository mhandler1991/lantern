// Reading a face as an option is where "roll or choose" could quietly pick the wrong
// thing: every number is in range, every option exists, and the only symptom is that the
// ancestry on the sheet is not the one the corner showed. So the mismatch guard is the
// point of this file, not the happy path.

import { describe, expect, it } from 'vitest';
import { MAX_DIE_SIDES, MIN_DIE_SIDES } from '../../constants';
import type { RollEntry } from '../../state/use-rolls';
import { canRollAmong, pickedBy } from './rolling';

const OPTIONS = ['human', 'elf', 'dwarf', 'halfling', 'goblin', 'half-orc'];

/** An entry as `rollAmong` produces one: a single die, with as many faces as options. */
function drew(sides: number, value: number): RollEntry {
  return {
    id: 'r_test',
    at: 0,
    origin: { kind: 'mine' },
    label: 'Ancestry',
    visibility: 'everyone',
    roll: { dice: [{ sides, value }], modifier: 0 },
    lookup: null,
    warnings: [],
  };
}

describe('what a draw picked', () => {
  it('reads the face as a position in the list, counting from one', () => {
    expect(pickedBy(OPTIONS, drew(6, 1))).toBe('human');
    expect(pickedBy(OPTIONS, drew(6, 6))).toBe('half-orc');
  });

  // The guard that matters. A pack turned on between the throw and the read would leave
  // a 4 meaning a different entry, and indexing anyway would put content on the sheet
  // that the corner never showed.
  it('refuses to read a die whose faces do not match the list', () => {
    expect(pickedBy(OPTIONS, drew(7, 4))).toBeNull();
    expect(pickedBy(OPTIONS.slice(0, 4), drew(6, 4))).toBeNull();
  });

  it('refuses anything that is not a single die', () => {
    const pool: RollEntry = {
      ...drew(6, 3),
      roll: { dice: [{ sides: 6, value: 3 }, { sides: 6, value: 5 }], modifier: 0 },
    };
    const nothing: RollEntry = { ...drew(6, 3), roll: { dice: [], modifier: 0 } };

    expect(pickedBy(OPTIONS, pool)).toBeNull();
    expect(pickedBy(OPTIONS, nothing)).toBeNull();
  });

  it('answers null for a face past the end of the list rather than undefined', () => {
    expect(pickedBy([], drew(0, 1))).toBeNull();
  });
});

describe('whether there is anything to roll', () => {
  it('refuses a list of one — a choice with one option is not a choice', () => {
    expect(canRollAmong(1)).toBe(false);
    expect(canRollAmong(0)).toBe(false);
  });

  it('takes anything between the protocol’s own bounds', () => {
    expect(canRollAmong(MIN_DIE_SIDES)).toBe(true);
    expect(canRollAmong(MAX_DIE_SIDES)).toBe(true);
    expect(canRollAmong(MAX_DIE_SIDES + 1)).toBe(false);
  });
});
