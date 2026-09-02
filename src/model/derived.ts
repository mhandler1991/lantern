/**
 * Every value a sheet shows but never stores. CLAUDE.md §4 — AC, slots, modifiers,
 * XP-to-next and spell DC are computed on read, because a stored copy disagrees with
 * reality the moment anything under it changes.
 *
 * Three properties hold for everything in this file:
 *
 *   - **Pure.** No React, no DOM, no clock, no randomness. Same inputs, same answer.
 *   - **Non-mutating.** Nothing here writes to the character it was handed.
 *   - **Warn, do not block.** A reference no loaded pack defines is *reported* in the
 *     result and costs nothing, never thrown and never guessed at (PRD.md principle 4).
 *     A player who turned a pack off sees a warning, not a broken sheet.
 *
 * A character stores references, so these calculations need a few facts that live in
 * pack content — an item's slot cost, an armour entry's AC. Rather than import the pack
 * resolver (which does not exist until Phase 2, and would drag the model into pack load
 * order), the caller passes a lookup. `pack.ts` will satisfy `ItemLookup` as it stands.
 *
 * One rule decides every lookup below: **a loaded pack's answer wins, and the row's own
 * value is the fallback.** A row with no `ref` at all is a thing the player wrote down
 * with no pack loaded (PRD.md principle 6) — it is answered from the row and is not
 * *unresolved*. Only a `ref` that no loaded pack defines is unresolved, and that one is
 * reported.
 *
 * 🚫 Nothing here adjudicates. These are arithmetic over numbers a pack supplied; no
 * function reads a talent, and none of them modify a stat. CLAUDE.md §4.
 */

import {
  ABILITY_POINTS_PER_MODIFIER,
  ABILITY_SCORE_BASELINE,
  COINS_PER_SLOT,
  MAX_CHARACTER_LEVEL,
  MIN_CARRY_SLOTS,
  MIN_SPELL_TIER,
  SPELL_DC_BASE,
  UNARMORED_AC,
  XP_PER_LEVEL,
} from '../constants';
import type { Character, Ref, Stat, Stats } from './character';

/** Nothing carried, nothing worn, nothing owed. A floor, not a business rule. */
const NONE = 0;

// ---------------------------------------------------------------------------
// What a computation needs from pack content
// ---------------------------------------------------------------------------

/** DATA-MODEL.md §2. `shield` is additive; everything else is worn. */
export type ArmorType = 'none' | 'light' | 'medium' | 'heavy' | 'shield';

/** DATA-MODEL.md §4 — the `armor` block of an item entry. */
export type ArmorFacts = {
  readonly type: ArmorType;
  readonly ac: number;
  readonly addDex: boolean;
};

/** The only two things a derived value asks of an item. Packs carry far more. */
export type ItemFacts = {
  readonly slots: number;
  readonly armor: ArmorFacts | null;
};

/** Resolves a sheet's reference to pack content. `null` means no loaded pack has it. */
export type ItemLookup = (ref: Ref) => ItemFacts | null;

/** DATA-MODEL.md §5 — the `spellcasting` block of a class. `null` for non-casters. */
export type SpellcastingFacts = {
  readonly stat: Stat;
  readonly highestTierByLevel: readonly number[];
};

// ---------------------------------------------------------------------------
// Ability modifiers
// ---------------------------------------------------------------------------

/**
 * Rounded **down**, which is what makes the negative half work: a score of 9 is −1 and
 * a score of 1 is −5. Rounding toward zero would give 9 → 0 and is the classic bug.
 */
export function abilityModifier(score: number): number {
  return Math.floor((score - ABILITY_SCORE_BASELINE) / ABILITY_POINTS_PER_MODIFIER);
}

/** All six at once, for a sheet that prints the row. */
export function abilityModifiers(stats: Stats): Record<Stat, number> {
  return {
    str: abilityModifier(stats.str),
    dex: abilityModifier(stats.dex),
    con: abilityModifier(stats.con),
    int: abilityModifier(stats.int),
    wis: abilityModifier(stats.wis),
    cha: abilityModifier(stats.cha),
  };
}

// ---------------------------------------------------------------------------
// Armour class
// ---------------------------------------------------------------------------

export type ArmorClass = {
  readonly ac: number;
  /** True when no equipped item supplied a worn armour entry. */
  readonly isUnarmored: boolean;
  /** Included in `ac`; broken out because sheets print it separately. */
  readonly shieldBonus: number;
  /** Equipped items no loaded pack defines. They contributed nothing. */
  readonly unresolved: readonly Ref[];
};

/**
 * Worn armour replaces the unarmoured base; a shield adds to whatever that came to.
 *
 * When several of either are equipped the **best** applies rather than the sum. Summing
 * would let two shields in one row of an inventory produce an AC nobody could wear, and
 * an inventory is free-form: the sheet cannot stop a player equipping both. Taking the
 * best is the reading that never invents armour. Dexterity applies to the base only,
 * and only when the entry says so — `addDex: false` is how heavy armour is expressed.
 */
export function computeArmorClass(character: Character, lookup: ItemLookup): ArmorClass {
  const dex = abilityModifier(character.stats.dex);
  const unresolved = new Set<Ref>();

  let worn: number | null = null;
  let shieldBonus = NONE;

  for (const item of character.items) {
    if (!item.equipped) continue;

    // A free-text row carries no armour facts, so it contributes nothing and is not a
    // broken reference. Only a ref no pack answers for is reported.
    if (item.ref === null) continue;

    const facts = lookup(item.ref);
    if (facts === null) {
      unresolved.add(item.ref);
      continue;
    }
    if (facts.armor === null) continue;

    if (facts.armor.type === 'shield') {
      shieldBonus = Math.max(shieldBonus, facts.armor.ac);
      continue;
    }

    const candidate = facts.armor.ac + (facts.armor.addDex ? dex : NONE);
    worn = worn === null ? candidate : Math.max(worn, candidate);
  }

  const base = worn ?? UNARMORED_AC + dex;

  return {
    ac: base + shieldBonus,
    isUnarmored: worn === null,
    shieldBonus,
    unresolved: [...unresolved],
  };
}

// ---------------------------------------------------------------------------
// Carry slots
// ---------------------------------------------------------------------------

export type Carry = {
  /** Strength, or the floor, whichever is larger. */
  readonly capacity: number;
  readonly used: number;
  readonly itemSlots: number;
  readonly coinSlots: number;
  /** Strictly over capacity. Filling the last slot exactly is not encumbrance. */
  readonly isEncumbered: boolean;
  /** Carried items no loaded pack defines. They were counted at the row's own `slots`. */
  readonly unresolved: readonly Ref[];
};

/**
 * A row costs its item's slots times its quantity, **rounded up per row**: an item that
 * stacks several to a slot fills one as soon as there is a single one of it. Two rows of
 * the same stackable therefore cost two slots — the arithmetic follows the inventory as
 * the player arranged it rather than silently merging rows behind them.
 *
 * The cost of one of a thing comes from the loaded pack when there is one, and from the
 * row's own `slots` otherwise — which is both how a sheet built with no packs at all
 * still counts its gear, and what an orphaned row falls back to when its pack is turned
 * off. A row whose `ref` no pack answers for is still reported, so a player can see why
 * a number moved.
 */
export function computeCarry(character: Character, lookup: ItemLookup): Carry {
  const unresolved = new Set<Ref>();

  let itemSlots = NONE;
  for (const item of character.items) {
    const facts = item.ref === null ? null : lookup(item.ref);
    if (facts === null && item.ref !== null) unresolved.add(item.ref);

    itemSlots += Math.ceil((facts?.slots ?? item.slots) * item.qty);
  }

  const coins = character.gold.gp + character.gold.sp + character.gold.cp;
  const coinSlots = Math.ceil(coins / COINS_PER_SLOT);
  const used = itemSlots + coinSlots;
  const capacity = Math.max(character.stats.str, MIN_CARRY_SLOTS);

  return {
    capacity,
    used,
    itemSlots,
    coinSlots,
    isEncumbered: used > capacity,
    unresolved: [...unresolved],
  };
}

// ---------------------------------------------------------------------------
// Experience
// ---------------------------------------------------------------------------

export type LevelProgress = {
  /** XP that advances a character at this level, or `null` at the cap. */
  readonly threshold: number | null;
  /** How much more is needed. Never negative; `null` at the cap. */
  readonly remaining: number | null;
  readonly canLevelUp: boolean;
  readonly isMaxLevel: boolean;
};

/**
 * XP is counted **per level and reset**, not accumulated — which is what lets a sheet
 * hold `level: 3, xp: 6` (DATA-MODEL.md §11). Level 0 is a real state and advances on
 * the same threshold as level 1.
 */
export function xpToAdvance(level: number): number | null {
  if (level >= MAX_CHARACTER_LEVEL) return null;
  return Math.max(level, 1) * XP_PER_LEVEL;
}

/** Records that a character *may* advance. Advancing is a player action, never this. */
export function computeLevelProgress(character: Character): LevelProgress {
  const threshold = xpToAdvance(character.level);

  if (threshold === null) {
    return { threshold: null, remaining: null, canLevelUp: false, isMaxLevel: true };
  }

  return {
    threshold,
    remaining: Math.max(NONE, threshold - character.xp),
    canLevelUp: character.xp >= threshold,
    isMaxLevel: false,
  };
}

// ---------------------------------------------------------------------------
// Spellcasting
// ---------------------------------------------------------------------------

/** The target for casting a spell of this tier. Tier is bounded by pack validation. */
export function spellDC(tier: number): number {
  return SPELL_DC_BASE + tier;
}

/** The modifier a caster adds to the check. `null` when the class does not cast. */
export function spellcastingModifier(
  stats: Stats,
  spellcasting: SpellcastingFacts | null,
): number | null {
  if (spellcasting === null) return null;
  return abilityModifier(stats[spellcasting.stat]);
}

/**
 * `highestTierByLevel` is indexed by level − 1 (DATA-MODEL.md §5). A level-0 character,
 * a level past the end of a pack's list, and an entry below the first tier all mean the
 * same thing to a sheet — nothing castable yet — so all three answer `null`.
 */
export function highestSpellTier(
  spellcasting: SpellcastingFacts | null,
  level: number,
): number | null {
  if (spellcasting === null || level < 1) return null;

  const tier = spellcasting.highestTierByLevel[level - 1];
  if (tier === undefined || tier < MIN_SPELL_TIER) return null;

  return tier;
}
