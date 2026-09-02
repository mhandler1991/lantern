// Derived values are where a silent wrong answer lives: nothing throws, nothing looks
// broken, and the sheet prints a number that is off by one for a whole campaign
// (CLAUDE.md §7). So these tests are written around the boundaries — the score that
// rounds the wrong way, the slot that is exactly full, the level that has no next one —
// rather than around the happy path, which is the case that never breaks.

import { describe, expect, it } from 'vitest';
import {
  abilityModifier,
  abilityModifiers,
  computeArmorClass,
  computeCarry,
  computeLevelProgress,
  highestSpellTier,
  spellDC,
  spellcastingModifier,
  xpToAdvance,
  type ArmorFacts,
  type ItemFacts,
  type ItemLookup,
} from './derived';
import type { Character } from './character';
import {
  COINS_PER_SLOT,
  MAX_CHARACTER_LEVEL,
  MAX_SPELL_TIER,
  MAX_STAT,
  MIN_CARRY_SLOTS,
  MIN_SPELL_TIER,
  MIN_STAT,
  SPELL_DC_BASE,
  UNARMORED_AC,
  XP_PER_LEVEL,
} from '../constants';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE: Character = {
  format: 'lantern-character',
  formatVersion: 1,
  id: 'c_test',
  name: 'Test',
  ancestry: null,
  class: null,
  alignment: null,
  level: 1,
  xp: 0,
  stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  hp: { current: 5, max: 5 },
  luck: 0,
  gold: { gp: 0, sp: 0, cp: 0 },
  items: [],
  spells: [],
  talents: [],
  lights: [],
  conditions: [],
  journal: [],
  quests: [],
  packsUsed: ['core'],
};

function character(overrides: Partial<Character>): Character {
  return { ...BASE, ...overrides };
}

function equipped(ref: string): Character['items'][number] {
  return { ref, qty: 1, equipped: true };
}

function armor(over: Partial<ArmorFacts>): ItemFacts {
  return { slots: 1, armor: { type: 'light', ac: 12, addDex: true, ...over } };
}

/** A lookup over a plain table. Anything absent resolves to null, as a pack that is
 *  turned off would — which is the case the sheet has to survive. */
function lookup(table: Readonly<Record<string, ItemFacts>>): ItemLookup {
  return (ref) => table[ref] ?? null;
}

const NOTHING_KNOWN: ItemLookup = () => null;

// ---------------------------------------------------------------------------

describe('ability modifiers', () => {
  it.each([
    [MIN_STAT, -5],
    [3, -4],
    [8, -1],
    [9, -1],
    [10, 0],
    [11, 0],
    [12, 1],
    [18, 4],
    [MAX_STAT, 10],
  ])('scores %i as %i', (score, expectedModifier) => {
    expect(abilityModifier(score)).toBe(expectedModifier);
  });

  it('rounds down rather than toward zero, so odd low scores are not flattened to 0', () => {
    expect(abilityModifier(9)).toBe(-1);
    expect(abilityModifier(7)).toBe(-2);
  });

  it('never decreases as the score rises', () => {
    for (let score = MIN_STAT; score < MAX_STAT; score += 1) {
      expect(abilityModifier(score + 1)).toBeGreaterThanOrEqual(abilityModifier(score));
    }
  });

  it('maps each stat to its own score, not to a neighbour', () => {
    const stats = { str: 3, dex: 5, con: 7, int: 9, wis: 11, cha: 13 };
    expect(abilityModifiers(stats)).toEqual({
      str: -4,
      dex: -3,
      con: -2,
      int: -1,
      wis: 0,
      cha: 1,
    });
  });
});

describe('armour class', () => {
  it('is the unarmoured base plus dexterity when nothing is worn', () => {
    const result = computeArmorClass(character({ stats: { ...BASE.stats, dex: 16 } }), NOTHING_KNOWN);

    expect(result.ac).toBe(UNARMORED_AC + 3);
    expect(result.isUnarmored).toBe(true);
  });

  it('goes below the unarmoured base on a negative dexterity modifier', () => {
    const result = computeArmorClass(
      character({ stats: { ...BASE.stats, dex: MIN_STAT } }),
      NOTHING_KNOWN,
    );

    expect(result.ac).toBe(UNARMORED_AC - 5);
  });

  it('replaces the base with worn armour and adds dexterity when the entry allows it', () => {
    const result = computeArmorClass(
      character({ stats: { ...BASE.stats, dex: 16 }, items: [equipped('core:item:leather')] }),
      lookup({ 'core:item:leather': armor({ ac: 11 }) }),
    );

    expect(result.ac).toBe(11 + 3);
    expect(result.isUnarmored).toBe(false);
  });

  it('ignores dexterity when the entry says addDex: false', () => {
    const result = computeArmorClass(
      character({ stats: { ...BASE.stats, dex: 18 }, items: [equipped('core:item:plate')] }),
      lookup({ 'core:item:plate': armor({ type: 'heavy', ac: 15, addDex: false }) }),
    );

    expect(result.ac).toBe(15);
  });

  it('applies a negative dexterity modifier to armour that adds it', () => {
    const result = computeArmorClass(
      character({ stats: { ...BASE.stats, dex: 6 }, items: [equipped('core:item:leather')] }),
      lookup({ 'core:item:leather': armor({ ac: 11 }) }),
    );

    expect(result.ac).toBe(11 - 2);
  });

  it('adds a shield on top of worn armour and reports the bonus separately', () => {
    const result = computeArmorClass(
      character({ items: [equipped('core:item:leather'), equipped('core:item:shield')] }),
      lookup({
        'core:item:leather': armor({ ac: 11 }),
        'core:item:shield': armor({ type: 'shield', ac: 2, addDex: false }),
      }),
    );

    expect(result.ac).toBe(11 + 2);
    expect(result.shieldBonus).toBe(2);
    expect(result.isUnarmored).toBe(false);
  });

  it('adds a shield to the unarmoured base, and still calls that unarmoured', () => {
    const result = computeArmorClass(
      character({ items: [equipped('core:item:shield')] }),
      lookup({ 'core:item:shield': armor({ type: 'shield', ac: 2, addDex: false }) }),
    );

    expect(result.ac).toBe(UNARMORED_AC + 2);
    expect(result.isUnarmored).toBe(true);
  });

  it('takes the best of two worn armours rather than summing them', () => {
    const result = computeArmorClass(
      character({ items: [equipped('core:item:leather'), equipped('core:item:plate')] }),
      lookup({
        'core:item:leather': armor({ ac: 11 }),
        'core:item:plate': armor({ type: 'heavy', ac: 15, addDex: false }),
      }),
    );

    expect(result.ac).toBe(15);
  });

  it('takes the best of two shields rather than summing them', () => {
    const result = computeArmorClass(
      character({ items: [equipped('core:item:shield'), equipped('homebrew:item:aegis')] }),
      lookup({
        'core:item:shield': armor({ type: 'shield', ac: 2, addDex: false }),
        'homebrew:item:aegis': armor({ type: 'shield', ac: 3, addDex: false }),
      }),
    );

    expect(result.ac).toBe(UNARMORED_AC + 3);
    expect(result.shieldBonus).toBe(3);
  });

  it('counts armour only while it is equipped', () => {
    const result = computeArmorClass(
      character({ items: [{ ref: 'core:item:plate', qty: 1, equipped: false }] }),
      lookup({ 'core:item:plate': armor({ type: 'heavy', ac: 15, addDex: false }) }),
    );

    expect(result.ac).toBe(UNARMORED_AC);
    expect(result.isUnarmored).toBe(true);
  });

  it('ignores an equipped item that is not armour', () => {
    const result = computeArmorClass(
      character({ items: [equipped('core:item:shortsword')] }),
      lookup({ 'core:item:shortsword': { slots: 1, armor: null } }),
    );

    expect(result.ac).toBe(UNARMORED_AC);
    expect(result.unresolved).toEqual([]);
  });

  it('reports an equipped item no pack defines instead of guessing at it', () => {
    const result = computeArmorClass(
      character({ items: [equipped('frostbound:item:rimeplate')] }),
      NOTHING_KNOWN,
    );

    expect(result.ac).toBe(UNARMORED_AC);
    expect(result.unresolved).toEqual(['frostbound:item:rimeplate']);
  });

  it('reports each unresolved reference once, however many rows carry it', () => {
    const result = computeArmorClass(
      character({
        items: [equipped('frostbound:item:rimeplate'), equipped('frostbound:item:rimeplate')],
      }),
      NOTHING_KNOWN,
    );

    expect(result.unresolved).toEqual(['frostbound:item:rimeplate']);
  });
});

describe('carry slots', () => {
  it('is strength when strength is above the floor', () => {
    const result = computeCarry(character({ stats: { ...BASE.stats, str: 18 } }), NOTHING_KNOWN);

    expect(result.capacity).toBe(18);
  });

  it('is the floor when strength is below it', () => {
    const result = computeCarry(
      character({ stats: { ...BASE.stats, str: MIN_STAT } }),
      NOTHING_KNOWN,
    );

    expect(result.capacity).toBe(MIN_CARRY_SLOTS);
  });

  it('multiplies an item cost by the quantity in the row', () => {
    const result = computeCarry(
      character({ items: [{ ref: 'core:item:arrow-bundle', qty: 3, equipped: false }] }),
      lookup({ 'core:item:arrow-bundle': { slots: 2, armor: null } }),
    );

    expect(result.itemSlots).toBe(6);
  });

  it('rounds a stackable up per row, so one of it still fills a slot', () => {
    const rations: ItemFacts = { slots: 1 / 3, armor: null };

    const one = computeCarry(
      character({ items: [{ ref: 'core:item:rations', qty: 1, equipped: false }] }),
      lookup({ 'core:item:rations': rations }),
    );
    const three = computeCarry(
      character({ items: [{ ref: 'core:item:rations', qty: 3, equipped: false }] }),
      lookup({ 'core:item:rations': rations }),
    );
    const four = computeCarry(
      character({ items: [{ ref: 'core:item:rations', qty: 4, equipped: false }] }),
      lookup({ 'core:item:rations': rations }),
    );

    expect(one.itemSlots).toBe(1);
    expect(three.itemSlots).toBe(1);
    expect(four.itemSlots).toBe(2);
  });

  it('counts an item a pack declares weightless as nothing', () => {
    const result = computeCarry(
      character({ items: [{ ref: 'core:item:ring', qty: 5, equipped: false }] }),
      lookup({ 'core:item:ring': { slots: 0, armor: null } }),
    );

    expect(result.itemSlots).toBe(0);
  });

  it.each([
    [0, 0],
    [1, 1],
    [COINS_PER_SLOT, 1],
    [COINS_PER_SLOT + 1, 2],
    [COINS_PER_SLOT * 2, 2],
  ])('turns %i coins into %i slot(s)', (coins, expectedSlots) => {
    const result = computeCarry(
      character({ gold: { gp: coins, sp: 0, cp: 0 } }),
      NOTHING_KNOWN,
    );

    expect(result.coinSlots).toBe(expectedSlots);
  });

  it('counts every currency toward the same slots', () => {
    const result = computeCarry(
      character({ gold: { gp: 40, sp: 40, cp: 21 } }),
      NOTHING_KNOWN,
    );

    expect(result.coinSlots).toBe(2);
  });

  it('is not encumbered when the last slot is exactly filled', () => {
    const result = computeCarry(
      character({
        stats: { ...BASE.stats, str: 12 },
        items: [{ ref: 'core:item:crate', qty: 12, equipped: false }],
      }),
      lookup({ 'core:item:crate': { slots: 1, armor: null } }),
    );

    expect(result.used).toBe(12);
    expect(result.capacity).toBe(12);
    expect(result.isEncumbered).toBe(false);
  });

  it('is encumbered one slot past capacity', () => {
    const result = computeCarry(
      character({
        stats: { ...BASE.stats, str: 12 },
        items: [{ ref: 'core:item:crate', qty: 13, equipped: false }],
      }),
      lookup({ 'core:item:crate': { slots: 1, armor: null } }),
    );

    expect(result.isEncumbered).toBe(true);
  });

  it('counts coins toward encumbrance alongside gear', () => {
    const result = computeCarry(
      character({
        stats: { ...BASE.stats, str: MIN_CARRY_SLOTS },
        gold: { gp: COINS_PER_SLOT, sp: 0, cp: 0 },
        items: [{ ref: 'core:item:crate', qty: MIN_CARRY_SLOTS, equipped: false }],
      }),
      lookup({ 'core:item:crate': { slots: 1, armor: null } }),
    );

    expect(result.used).toBe(MIN_CARRY_SLOTS + 1);
    expect(result.isEncumbered).toBe(true);
  });

  it('costs nothing for an item no pack defines, and says which', () => {
    const result = computeCarry(
      character({ items: [{ ref: 'frostbound:item:sled', qty: 4, equipped: false }] }),
      NOTHING_KNOWN,
    );

    expect(result.itemSlots).toBe(0);
    expect(result.used).toBe(0);
    expect(result.unresolved).toEqual(['frostbound:item:sled']);
  });
});

describe('experience', () => {
  it('advances a level-0 character on the same threshold as a level-1 one', () => {
    expect(xpToAdvance(0)).toBe(XP_PER_LEVEL);
    expect(xpToAdvance(1)).toBe(XP_PER_LEVEL);
  });

  it('scales the threshold with the level', () => {
    expect(xpToAdvance(2)).toBe(2 * XP_PER_LEVEL);
    expect(xpToAdvance(MAX_CHARACTER_LEVEL - 1)).toBe((MAX_CHARACTER_LEVEL - 1) * XP_PER_LEVEL);
  });

  it('has no threshold at the level cap', () => {
    expect(xpToAdvance(MAX_CHARACTER_LEVEL)).toBeNull();

    const progress = computeLevelProgress(
      character({ level: MAX_CHARACTER_LEVEL, xp: 999 }),
    );
    expect(progress).toEqual({
      threshold: null,
      remaining: null,
      canLevelUp: false,
      isMaxLevel: true,
    });
  });

  it('counts down what is still needed', () => {
    const progress = computeLevelProgress(character({ level: 3, xp: 6 }));

    expect(progress.threshold).toBe(3 * XP_PER_LEVEL);
    expect(progress.remaining).toBe(3 * XP_PER_LEVEL - 6);
    expect(progress.canLevelUp).toBe(false);
  });

  it('allows levelling exactly at the threshold, not one short of it', () => {
    const threshold = 2 * XP_PER_LEVEL;

    expect(computeLevelProgress(character({ level: 2, xp: threshold - 1 })).canLevelUp).toBe(false);
    expect(computeLevelProgress(character({ level: 2, xp: threshold })).canLevelUp).toBe(true);
  });

  it('never reports a negative remainder when XP is past the threshold', () => {
    const progress = computeLevelProgress(character({ level: 2, xp: 99 }));

    expect(progress.remaining).toBe(0);
    expect(progress.canLevelUp).toBe(true);
  });
});

describe('spellcasting', () => {
  const CASTER = { stat: 'int', highestTierByLevel: [1, 1, 2, 2, 3, 3, 4, 4, 5, 5] } as const;

  it('sets the DC from the spell tier', () => {
    for (let tier = MIN_SPELL_TIER; tier <= MAX_SPELL_TIER; tier += 1) {
      expect(spellDC(tier)).toBe(SPELL_DC_BASE + tier);
    }
  });

  it('takes the modifier from the class stat, not from a fixed one', () => {
    const stats = { str: 18, dex: 10, con: 10, int: 14, wis: 8, cha: 10 };

    expect(spellcastingModifier(stats, CASTER)).toBe(2);
    expect(spellcastingModifier(stats, { ...CASTER, stat: 'wis' })).toBe(-1);
  });

  it('has no modifier and no tier for a class that does not cast', () => {
    expect(spellcastingModifier(BASE.stats, null)).toBeNull();
    expect(highestSpellTier(null, 5)).toBeNull();
  });

  it('indexes the tier list by level − 1', () => {
    expect(highestSpellTier(CASTER, 1)).toBe(1);
    expect(highestSpellTier(CASTER, 3)).toBe(2);
    expect(highestSpellTier(CASTER, MAX_CHARACTER_LEVEL)).toBe(MAX_SPELL_TIER);
  });

  it('has no tier at level 0, before a class is even chosen', () => {
    expect(highestSpellTier(CASTER, 0)).toBeNull();
  });

  it('has no tier past the end of a pack list, rather than reading off it', () => {
    expect(highestSpellTier({ stat: 'int', highestTierByLevel: [1, 1] }, 3)).toBeNull();
  });

  it('reads a zero in the list as not casting yet', () => {
    expect(highestSpellTier({ stat: 'int', highestTierByLevel: [0, 1] }, 1)).toBeNull();
    expect(highestSpellTier({ stat: 'int', highestTierByLevel: [0, 1] }, 2)).toBe(1);
  });
});

describe('purity', () => {
  const subject = character({
    stats: { str: 13, dex: 16, con: 11, int: 9, wis: 12, cha: 6 },
    level: 3,
    xp: 6,
    gold: { gp: 22, sp: 0, cp: 0 },
    items: [equipped('core:item:leather')],
  });
  const table = lookup({ 'core:item:leather': armor({ ac: 11 }) });

  it('leaves the character it was handed untouched', () => {
    const before = JSON.stringify(subject);

    computeArmorClass(subject, table);
    computeCarry(subject, table);
    computeLevelProgress(subject);

    expect(JSON.stringify(subject)).toBe(before);
  });

  it('answers the same for the same inputs', () => {
    expect(computeArmorClass(subject, table)).toEqual(computeArmorClass(subject, table));
    expect(computeCarry(subject, table)).toEqual(computeCarry(subject, table));
  });
});
