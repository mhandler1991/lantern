// The sheet writes through these, and the sheet writes to storage on a debounce. So the
// claim worth testing is not "the helper returned the right array" — it is that nothing
// a player can do through them produces a character that will not save.

import { describe, expect, it } from 'vitest';
import {
  MAX_CONDITION_LENGTH,
  MAX_CONDITIONS,
  MAX_ITEMS,
  MAX_STAT,
  MIN_STAT,
} from '../constants';
import type { CarriedItem } from '../model/character';
import { parseCharacter } from '../model/character';
import {
  addCondition,
  appendRow,
  clampInt,
  clampText,
  isAtLimit,
  newItem,
  newJournalEntry,
  newLight,
  newQuest,
  newSpell,
  newTalent,
  removeCondition,
  removeRow,
  setHitPoints,
  setStat,
  updateRow,
} from './character-edits';
import { createCharacter } from './new-character';

const blank = createCharacter('c_test');

describe('clamping', () => {
  it('holds a number inside its bounds', () => {
    expect(clampInt(5, 1, 10)).toBe(5);
    expect(clampInt(99, 1, 10)).toBe(10);
    expect(clampInt(-99, 1, 10)).toBe(1);
  });

  it('keeps a whole number, because the schema will not take a fraction', () => {
    expect(clampInt(3.7, 1, 10)).toBe(3);
    expect(clampInt(-3.7, -10, 10)).toBe(-3);
  });

  it('falls back to the floor for anything that is not a number', () => {
    expect(clampInt(Number.NaN, 1, 10)).toBe(1);
    expect(clampInt(Number.POSITIVE_INFINITY, 1, 10)).toBe(1);
  });

  it('cuts text to its cap rather than refusing it', () => {
    expect(clampText('abcdef', 3)).toBe('abc');
    expect(clampText('ab', 3)).toBe('ab');
  });
});

describe('rows', () => {
  const rows: CarriedItem[] = [newItem(), newItem()];

  it('appends until the list is at its limit, then stops', () => {
    expect(appendRow(rows, newItem(), MAX_ITEMS)).toHaveLength(rows.length + 1);

    const full = Array.from({ length: MAX_ITEMS }, newItem);
    expect(appendRow(full, newItem(), MAX_ITEMS)).toBe(full);
    expect(isAtLimit(full, MAX_ITEMS)).toBe(true);
  });

  it('patches one row by id and leaves the rest as they were', () => {
    const patched = updateRow(rows, rows[1]!.id, { name: 'Rope' });

    expect(patched[1]?.name).toBe('Rope');
    expect(patched[0]).toBe(rows[0]);
    expect(patched.map((row) => row.id)).toEqual(rows.map((row) => row.id));
  });

  it('does not mutate what it was given', () => {
    updateRow(rows, rows[0]!.id, { name: 'Changed' });
    expect(rows[0]?.name).toBe('');
  });

  it('removes by id', () => {
    expect(removeRow(rows, rows[0]!.id).map((row) => row.id)).toEqual([rows[1]!.id]);
  });
});

describe('a row added by hand', () => {
  // Every one of these is a row nothing referenced into being: no pack is loaded, and
  // the sheet still has to save. PRD.md principle 6.
  it('leaves the character valid, whichever list it went into', () => {
    const filled = {
      ...blank,
      items: [newItem()],
      spells: [newSpell()],
      talents: [newTalent()],
      lights: [newLight()],
      journal: [newJournalEntry(1735689600000)],
      quests: [newQuest()],
    };

    const parsed = parseCharacter(filled);
    if (!parsed.ok) throw new Error(parsed.problems.map((p) => p.path).join(', '));
    expect(parsed.ok).toBe(true);
  });

  it('references nothing, because nothing is loaded to reference', () => {
    expect(newItem().ref).toBeNull();
    expect(newSpell().ref).toBeNull();
    expect(newLight().ref).toBeNull();
  });

  it('is not a rolled talent — it was written in', () => {
    expect(newTalent().source).toBeNull();
    expect(newTalent().rolled).toBeNull();
  });

  it('gets an id of its own, so two of a thing are two rows', () => {
    expect(newItem().id).not.toBe(newItem().id);
  });
});

describe('conditions', () => {
  it('trims what was typed', () => {
    expect(addCondition([], '  blessed  ')).toEqual(['blessed']);
  });

  it('ignores an empty one', () => {
    expect(addCondition([], '   ')).toEqual([]);
  });

  it('ignores a repeat, whatever case it was typed in', () => {
    const one = addCondition([], 'blessed');
    expect(addCondition(one, 'Blessed')).toBe(one);
  });

  it('cuts one that is too long, so the sheet still saves', () => {
    const long = 'c'.repeat(MAX_CONDITION_LENGTH + 10);
    const added = addCondition([], long);

    expect(added[0]).toHaveLength(MAX_CONDITION_LENGTH);
    expect(parseCharacter({ ...blank, conditions: added }).ok).toBe(true);
  });

  it('stops at the limit rather than growing past it', () => {
    const full = Array.from({ length: MAX_CONDITIONS }, (_unused, index) => `c${index}`);
    expect(addCondition(full, 'one more')).toBe(full);
  });

  it('removes exactly the one named', () => {
    expect(removeCondition(['blessed', 'poisoned'], 'blessed')).toEqual(['poisoned']);
  });
});

describe('the character itself', () => {
  it('changes one stat and no others, and writes no modifier anywhere', () => {
    const changed = setStat(blank, 'str', 16);

    expect(changed.stats.str).toBe(16);
    expect(changed.stats.dex).toBe(blank.stats.dex);
    expect(blank.stats.str).not.toBe(16);
    expect(parseCharacter(changed).ok).toBe(true);
  });

  it('holds a stat at either bound', () => {
    expect(parseCharacter(setStat(blank, 'str', MIN_STAT)).ok).toBe(true);
    expect(parseCharacter(setStat(blank, 'str', MAX_STAT)).ok).toBe(true);
  });

  it('records a dying character rather than refusing to', () => {
    const dying = setHitPoints(blank, { current: -3, max: 8 });

    expect(dying.hp).toEqual({ current: -3, max: 8 });
    expect(parseCharacter(dying).ok).toBe(true);
  });

  it('lets current sit above max, because a sheet records rather than decides', () => {
    const blessed = setHitPoints(blank, { current: 12, max: 8 });
    expect(parseCharacter(blessed).ok).toBe(true);
  });
});
