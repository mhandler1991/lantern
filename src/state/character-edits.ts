/**
 * Every edit the sheet makes to a character, as pure functions.
 *
 * They live here rather than inside the components for one reason: what a component
 * does to a character is exactly the part worth testing, and none of it needs React.
 * A panel is then a layout and a call.
 *
 * Two rules hold throughout, and both come from `state/character-storage.ts` writing
 * the character back out through the schema on every save:
 *
 *   - **Nothing here can produce a character the schema would reject.** Numbers are
 *     clamped to the bounds `constants.ts` declares, text is cut to its cap, and a list
 *     at its limit is returned unchanged rather than grown past it. An edit that made a
 *     sheet unsaveable would look like a silent data loss to the player.
 *   - **Nothing here adjudicates.** These move the player's own values around. No
 *     function reads a talent, and none of them changes a stat on anything's behalf
 *     (PRD.md principle 1).
 *
 * 🚫 Nothing here is a derived value. AC, slots and XP-to-next are computed on read in
 * `model/derived.ts` and never written back.
 */

import {
  DEFAULT_ITEM_QUANTITY,
  DEFAULT_ITEM_SLOTS,
  DEFAULT_LIGHT_MINUTES,
  MAX_CONDITION_LENGTH,
  MAX_CONDITIONS,
} from '../constants';
import type {
  CarriedItem,
  Character,
  Condition,
  JournalEntry,
  KnownSpell,
  Light,
  Quest,
  Ref,
  Talent,
} from '../model/character';
import { newRowId } from './new-character';

/** Nothing typed, nothing carried. A floor, not a business rule. */
const NONE = 0;

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/**
 * A whole number inside its bounds. Every number a player can type goes through this,
 * because an input is free to hold `1e309` and the schema is not.
 *
 * A value that is not a number at all falls back to `min`: a field that has been emptied
 * is the sheet's business to display, never the character's to store.
 */
export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Text at its cap. Cut rather than refused — a paste that is too long is not an error. */
export function clampText(value: string, max: number): string {
  return value.length > max ? value.slice(NONE, max) : value;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** Anything a sheet keeps a list of. The id is what a key and an edit both address. */
type Row = { readonly id: string };

/** True when a list cannot take another row without failing validation on save. */
export function isAtLimit(rows: readonly unknown[], limit: number): boolean {
  return rows.length >= limit;
}

/**
 * Append, or return the list untouched at its limit. The caller shows why.
 *
 * These take and return the arrays the character actually holds rather than readonly
 * views of them, because `Character` is inferred from the schema and its lists are
 * mutable. Nothing here mutates one: every return is a new array or the original.
 */
export function appendRow<T extends Row>(rows: T[], row: T, limit: number): T[] {
  if (isAtLimit(rows, limit)) return rows;
  return [...rows, row];
}

/** Replace the fields named in `patch` on one row, by id. Order is preserved. */
export function updateRow<T extends Row>(
  rows: T[],
  id: string,
  patch: Partial<Omit<T, 'id'>>,
): T[] {
  return rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
}

export function removeRow<T extends Row>(rows: T[], id: string): T[] {
  return rows.filter((row) => row.id !== id);
}

// ---------------------------------------------------------------------------
// New rows
// ---------------------------------------------------------------------------

/**
 * A row added by hand has no `ref`: nothing referenced it into being, so its name and
 * its slot cost are the player's own — which is what makes the sheet usable with no
 * packs loaded at all (PRD.md principle 6).
 *
 * A row added from a picker is the other half: it carries the reference and **nothing
 * else**. The name stays empty because `name` is a fallback and never a cache, and the
 * slots stay at zero because a loaded pack's answer wins and the row's own number is
 * never read while one does (DATA-MODEL.md §11).
 */
export function newItem(ref: Ref | null = null): CarriedItem {
  return {
    id: newRowId(),
    ref,
    name: '',
    slots: ref === null ? DEFAULT_ITEM_SLOTS : NONE,
    qty: DEFAULT_ITEM_QUANTITY,
    equipped: false,
  };
}

export function newSpell(ref: Ref | null = null): KnownSpell {
  return { id: newRowId(), ref, name: '' };
}

/** `source` and `rolled` stay null: this one was written in, not rolled for. */
export function newTalent(): Talent {
  return { id: newRowId(), text: '', source: null, rolled: null };
}

/**
 * Unlit. `litAt` is set to the clock when the player lights it, never counted down.
 *
 * `minutes` is the row's own however it was added: nothing in a pack says how long a
 * light burns (DATA-MODEL.md §4), so a torch picked off a pack list starts at the same
 * default a typed-in one does and stays the player's to change.
 */
export function newLight(ref: Ref | null = null): Light {
  return {
    id: newRowId(),
    ref,
    name: '',
    litAt: null,
    minutes: DEFAULT_LIGHT_MINUTES,
  };
}

/** `at` is passed in rather than read from the clock, so this stays pure. */
export function newJournalEntry(at: number): JournalEntry {
  return { id: newRowId(), at, text: '' };
}

export function newQuest(): Quest {
  return { id: newRowId(), text: '', done: false };
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

/**
 * Conditions are bare strings rather than rows, so the string is the key — which is
 * only sound while they are unique. Adding trims, cuts to the cap, ignores an empty
 * one, and ignores a repeat regardless of case. There is no in-place edit: a condition
 * is added and removed, never retyped, which is also how it reads at a table.
 */
export function addCondition(conditions: Condition[], text: string): Condition[] {
  const condition = clampText(text.trim(), MAX_CONDITION_LENGTH);
  if (condition === '') return conditions;
  if (isAtLimit(conditions, MAX_CONDITIONS)) return conditions;

  const folded = condition.toLocaleLowerCase();
  if (conditions.some((existing) => existing.toLocaleLowerCase() === folded)) return conditions;

  return [...conditions, condition];
}

export function removeCondition(conditions: Condition[], text: string): Condition[] {
  return conditions.filter((existing) => existing !== text);
}

// ---------------------------------------------------------------------------
// The character
// ---------------------------------------------------------------------------

/**
 * Hit points, kept consistent as a pair. `current` may exceed `max` — a blessing or a
 * potion can put a character over, and the sheet records what the player says rather
 * than deciding it cannot be so. It may also go negative: a dying character is a state
 * the sheet has to hold.
 */
export function setHitPoints(
  character: Character,
  hp: Partial<Character['hp']>,
): Character {
  return { ...character, hp: { ...character.hp, ...hp } };
}

/** One of the six. The other five are untouched, and no modifier is written anywhere. */
export function setStat(
  character: Character,
  stat: keyof Character['stats'],
  score: number,
): Character {
  return { ...character, stats: { ...character.stats, [stat]: score } };
}
