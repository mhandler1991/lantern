// The enums are a whitelist, and a whitelist is only as good as the list. These tests
// spell out every member of every one of them, copied from DATA-MODEL.md §2 — so a
// value quietly added to the code, or a row quietly added to the doc, fails here rather
// than in a pack somebody authored against whichever of the two they read.

import { describe, expect, it } from 'vitest';
import {
  MAX_DIE_NOTATION_LENGTH,
  MAX_SPELL_TIER,
  MAX_TABLE_DIE_COUNT,
  MIN_SPELL_TIER,
} from '../constants';
import {
  Alignment,
  ArmorType,
  Currency,
  DamageNotation,
  Die,
  DieNotation,
  Duration,
  Range,
  Stat,
  Tier,
  WeaponType,
  dieNotationParts,
} from './enums';

describe('the vocabulary of DATA-MODEL.md §2', () => {
  it.each([
    ['stat', Stat, ['str', 'dex', 'con', 'int', 'wis', 'cha']],
    ['range', Range, ['self', 'close', 'near', 'far']],
    ['duration', Duration, ['instant', 'focus', 'round', 'minute', 'hour', 'day', 'permanent']],
    ['die', Die, ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100']],
    ['armorType', ArmorType, ['none', 'light', 'medium', 'heavy', 'shield']],
    ['weaponType', WeaponType, ['melee', 'ranged', 'both']],
    ['alignment', Alignment, ['lawful', 'neutral', 'chaotic']],
    ['currency', Currency, ['gp', 'sp', 'cp']],
  ])('%s admits exactly the documented values', (_name, schema, values) => {
    expect(schema.options).toEqual(values);
    for (const value of values) expect(schema.safeParse(value).success).toBe(true);
  });

  it.each([
    ['stat', Stat, 'strength'],
    ['range', Range, 'medium'],
    ['duration', Duration, 'concentration'],
    ['die', Die, '2d6'],
    ['armorType', ArmorType, 'plate'],
    ['weaponType', WeaponType, 'thrown'],
    ['alignment', Alignment, 'good'],
    ['currency', Currency, 'ep'],
  ])('%s rejects a plausible near miss', (_name, schema, near) => {
    expect(schema.safeParse(near).success).toBe(false);
  });

  it('matches enums exactly rather than by case or whitespace', () => {
    for (const value of ['Near', 'NEAR', ' near', 'near ']) {
      expect(Range.safeParse(value).success).toBe(false);
    }
  });

  it('admits every spell tier and nothing either side of them', () => {
    for (let tier = MIN_SPELL_TIER; tier <= MAX_SPELL_TIER; tier += 1) {
      expect(Tier.safeParse(tier).success).toBe(true);
    }
    expect(Tier.safeParse(MIN_SPELL_TIER - 1).success).toBe(false);
    expect(Tier.safeParse(MAX_SPELL_TIER + 1).success).toBe(false);
  });

  it('reads a tier as the number it is in the JSON, not the string', () => {
    expect(Tier.safeParse('2').success).toBe(false);
    expect(Tier.safeParse(2.5).success).toBe(false);
  });
});

// A notation is not an enum — it carries a count — but it is checked against one, which
// is what keeps the set of dice a table may name identical to the set a class may have.

describe('dice notation', () => {
  it('reads a count and a die out of every form DATA-MODEL.md §8 allows', () => {
    expect(dieNotationParts('2d6')).toEqual({ count: 2, die: 'd6' });
    expect(dieNotationParts('1d20')).toEqual({ count: 1, die: 'd20' });
    expect(dieNotationParts('d100')).toEqual({ count: 1, die: 'd100' });
  });

  it('names only dice the Die enum has', () => {
    for (const die of Die.options) {
      expect(dieNotationParts(die)).toEqual({ count: 1, die });
    }
    expect(dieNotationParts('d7')).toBeNull();
    expect(dieNotationParts('d0')).toBeNull();
    expect(dieNotationParts('d200')).toBeNull();
  });

  it('bounds how many dice one notation may name', () => {
    expect(dieNotationParts(`${MAX_TABLE_DIE_COUNT}d6`)).not.toBeNull();
    expect(dieNotationParts(`${MAX_TABLE_DIE_COUNT + 1}d6`)).toBeNull();
    expect(dieNotationParts('0d6')).toBeNull();
  });

  it.each(['', 'd', '6', '2 d6', 'd6 ', 'D6', '2d6+1', '2d6/1d4', 'alert(1)'])(
    'refuses %s as a notation',
    (notation) => {
      expect(dieNotationParts(notation)).toBeNull();
      expect(DieNotation.safeParse(notation).success).toBe(false);
    },
  );

  it('bounds the string before picking it apart', () => {
    expect(DieNotation.safeParse('9'.repeat(MAX_DIE_NOTATION_LENGTH + 1)).success).toBe(false);
  });
});

describe('damage notation', () => {
  it.each(['1d8', 'd6', '2d6', '1d4/1d8', 'd4/d8'])('takes %s', (damage) => {
    expect(DamageNotation.safeParse(damage).success).toBe(true);
  });

  it.each(['1d8 + level/2', '1d8+1', 'd8/d10/d12', '1d7', 'the usual', '', '/'])(
    'refuses %s — never an expression',
    (damage) => {
      expect(DamageNotation.safeParse(damage).success).toBe(false);
    },
  );
});
