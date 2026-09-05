// The enums are a whitelist, and a whitelist is only as good as the list. These tests
// spell out every member of every one of them, copied from DATA-MODEL.md §2 — so a
// value quietly added to the code, or a row quietly added to the doc, fails here rather
// than in a pack somebody authored against whichever of the two they read.

import { describe, expect, it } from 'vitest';
import { MAX_SPELL_TIER, MIN_SPELL_TIER } from '../constants';
import { Alignment, ArmorType, Die, Duration, Range, Stat, Tier, WeaponType } from './enums';

describe('the vocabulary of DATA-MODEL.md §2', () => {
  it.each([
    ['stat', Stat, ['str', 'dex', 'con', 'int', 'wis', 'cha']],
    ['range', Range, ['self', 'close', 'near', 'far']],
    ['duration', Duration, ['instant', 'focus', 'round', 'minute', 'hour', 'day', 'permanent']],
    ['die', Die, ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100']],
    ['armorType', ArmorType, ['none', 'light', 'medium', 'heavy', 'shield']],
    ['weaponType', WeaponType, ['melee', 'ranged', 'both']],
    ['alignment', Alignment, ['lawful', 'neutral', 'chaotic']],
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
