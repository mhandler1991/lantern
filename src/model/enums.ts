/**
 * The closed vocabulary of DATA-MODEL.md §2, in one place.
 *
 * These are the same words on a sheet and in a pack — a spell's `range` is the enum a
 * character's spell points at — so they are defined once and imported by both. Two
 * copies would eventually disagree about which of them spells `armorType: 'shield'`.
 *
 * Every one of them is an exact match, deliberately (DATA-MODEL.md §10). Free text is
 * allowed in exactly three fields — `name`, `text` and `description` — and nowhere
 * else, which is what makes a pack validatable, sortable, and small enough to put in a
 * prompt (DESIGN.md §5).
 */

import * as z from 'zod';
import {
  MAX_DAMAGE_LENGTH,
  MAX_DAMAGE_NOTATION_PARTS,
  MAX_DIE_NOTATION_LENGTH,
  MAX_SPELL_TIER,
  MAX_TABLE_DIE_COUNT,
  MIN_SPELL_TIER,
} from '../constants';

/** The six, in the order every sheet prints them. */
export const Stat = z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']);
export type Stat = z.infer<typeof Stat>;

/** Distance is a band, never a number of feet. `"near"`, not `"60 feet"`. */
export const Range = z.enum(['self', 'close', 'near', 'far']);
export type Range = z.infer<typeof Range>;

export const Duration = z.enum([
  'instant',
  'focus',
  'round',
  'minute',
  'hour',
  'day',
  'permanent',
]);
export type Duration = z.infer<typeof Duration>;

/**
 * Written as a bounded integer rather than `z.enum` because it is one in the JSON —
 * `"tier": 2`, not `"tier": "2"` — and because the bounds are already product decisions
 * in `constants.ts`. The set it admits is exactly §2's `1 2 3 4 5`.
 */
export const Tier = z.int().min(MIN_SPELL_TIER).max(MAX_SPELL_TIER);
export type Tier = z.infer<typeof Tier>;

/**
 * A single die, as a class's hit die names one. A table names its dice differently —
 * `2d6` carries a count — and that notation is the table schema's problem, not this
 * enum's.
 */
export const Die = z.enum(['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100']);
export type Die = z.infer<typeof Die>;

/**
 * A table names its dice as a notation rather than a single die — `2d6` carries a count
 * the `Die` enum has no room for (DATA-MODEL.md §8). It is picked apart here rather than
 * matched by a regex that lists the faces again, so the set of dice a notation may name
 * is the enum above and cannot drift from it.
 *
 * 🚫 Nothing evaluates a notation. This reads two numbers out of a string; rolling them
 * is `model/dice.ts` and looking a result up is `model/tables.ts`.
 */
const DIE_NOTATION = /^([0-9]{1,2})?d([0-9]{1,3})$/;

/** A notation with no count in front of the `d` means one die. */
const IMPLIED_DIE_COUNT = 1;

/** How many dice, and of what size. `null` when the string is not a notation at all. */
export function dieNotationParts(notation: string): { count: number; die: Die } | null {
  const matched = DIE_NOTATION.exec(notation);
  if (matched === null) return null;

  const [, writtenCount, sides] = matched;
  const count = writtenCount === undefined ? IMPLIED_DIE_COUNT : Number(writtenCount);
  if (count < IMPLIED_DIE_COUNT || count > MAX_TABLE_DIE_COUNT) return null;

  const die = Die.safeParse(`d${sides}`);
  return die.success ? { count, die: die.data } : null;
}

/** `2d6`, `1d20`, `d100`. Length is checked before the string is picked apart. */
export const DieNotation = z
  .string()
  .max(MAX_DIE_NOTATION_LENGTH)
  .refine((notation) => dieNotationParts(notation) !== null, {
    message: `expected dice notation such as 2d6 or d20, at most ${MAX_TABLE_DIE_COUNT} dice`,
  });
export type DieNotation = z.infer<typeof DieNotation>;

/**
 * What a weapon deals: one notation, or two separated by `/` for a weapon used in one
 * hand or two (DATA-MODEL.md §4). **Never an expression.** `1d8` and `1d4/1d8` pass;
 * `1d8 + level/2` does not, and nothing in this app would evaluate it if it did.
 */
export const DamageNotation = z
  .string()
  .max(MAX_DAMAGE_LENGTH)
  .refine((damage) => {
    const parts = damage.split('/');
    if (parts.length > MAX_DAMAGE_NOTATION_PARTS) return false;
    return parts.every((part) => dieNotationParts(part) !== null);
  }, { message: 'expected damage such as 1d8, or 1d4/1d8 — never a formula' });
export type DamageNotation = z.infer<typeof DamageNotation>;

export const ArmorType = z.enum(['none', 'light', 'medium', 'heavy', 'shield']);
export type ArmorType = z.infer<typeof ArmorType>;

export const WeaponType = z.enum(['melee', 'ranged', 'both']);
export type WeaponType = z.infer<typeof WeaponType>;

export const Alignment = z.enum(['lawful', 'neutral', 'chaotic']);
export type Alignment = z.infer<typeof Alignment>;

/** The three coins a price is quoted in, and the three a sheet keeps. DATA-MODEL.md §4. */
export const Currency = z.enum(['gp', 'sp', 'cp']);
export type Currency = z.infer<typeof Currency>;
