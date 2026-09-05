/**
 * The closed vocabulary of DATA-MODEL.md §2, in one place.
 *
 * These are the same words on a sheet and in a pack — a spell's `range` is the enum a
 * character's spell points at — so they are defined once and imported by both. Two
 * copies would eventually disagree about which of them spells `armorType: 'shield'`.
 *
 * Every one of them is an exact match, deliberately (DATA-MODEL.md §9). Free text is
 * allowed in exactly three fields — `name`, `text` and `description` — and nowhere
 * else, which is what makes a pack validatable, sortable, and small enough to put in a
 * prompt (DESIGN.md §5).
 */

import * as z from 'zod';
import { MAX_SPELL_TIER, MIN_SPELL_TIER } from '../constants';

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

export const ArmorType = z.enum(['none', 'light', 'medium', 'heavy', 'shield']);
export type ArmorType = z.infer<typeof ArmorType>;

export const WeaponType = z.enum(['melee', 'ranged', 'both']);
export type WeaponType = z.infer<typeof WeaponType>;

export const Alignment = z.enum(['lawful', 'neutral', 'chaotic']);
export type Alignment = z.infer<typeof Alignment>;
