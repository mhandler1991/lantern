/**
 * The character. DATA-MODEL.md §11 is the contract; this file is that contract, executable.
 *
 * Three things this file deliberately does not do:
 *
 *   - **It stores nothing derived.** There is no key for AC, slot count, an ability
 *     modifier, XP-to-next or spell DC, and because every object here is strict there
 *     cannot be one. A stored derived value disagrees with reality the moment anything
 *     it depends on changes; a rejected one cannot. CLAUDE.md §4.
 *   - **It holds no pack content.** A sheet stores references and the few strings it
 *     must survive without — never a copy of a spell or an item. Turning a pack off
 *     leaves the sheet whole and its rows orphaned, which is the point.
 *   - **It adjudicates nothing.** Every bound here is a bound on input, not a statement
 *     about what a character may do. `luck` is capped because a hostile file should not
 *     be able to claim 2^53 of it, not because the game says so.
 *
 * Types are inferred from the schemas and declared nowhere else (CLAUDE.md §5).
 */

import * as z from 'zod';
import { Alignment, Stat } from './enums';
import { formatProblems, reportProblems, validate, type Problem } from './problems';
import {
  CHARACTER_FORMAT,
  CHARACTER_FORMAT_VERSION,
  CHARACTER_ID_PATTERN,
  MAX_CHARACTER_LEVEL,
  MAX_CHARACTER_NAME_LENGTH,
  MAX_COIN,
  MAX_CONDITION_LENGTH,
  MAX_CONDITIONS,
  MAX_DIE_SIDES,
  MAX_HP,
  MAX_ITEM_QUANTITY,
  MAX_ITEM_SLOTS,
  MAX_ITEMS,
  MAX_JOURNAL_ENTRIES,
  MAX_JOURNAL_ENTRY_LENGTH,
  MAX_LIGHT_MINUTES,
  MAX_LIGHTS,
  MAX_LUCK,
  MAX_NAME_LENGTH,
  MAX_PACKS_LOADED,
  MAX_QUEST_LENGTH,
  MAX_QUESTS,
  MAX_REF_LENGTH,
  MAX_SPELLS_KNOWN,
  MAX_STAT,
  MAX_TALENTS,
  MAX_TEXT_LENGTH,
  MAX_XP,
  MIN_CHARACTER_LEVEL,
  MIN_STAT,
  PACK_ID_PATTERN,
  REF_PATTERN,
  ROW_ID_PATTERN,
} from '../constants';

/**
 * Zero is the floor of a count, not a rule of the game, so it is written here rather
 * than kept in `constants.ts` — there is no product decision behind "you cannot have
 * minus four torches". CLAUDE.md §2.10 is about business-rule numbers.
 */
const NONE = 0;

// ---------------------------------------------------------------------------
// Shared leaves
// ---------------------------------------------------------------------------

/**
 * DATA-MODEL.md §2. A sheet and a pack say these words the same way, so they are defined
 * once in `model/enums.ts` and re-exported here — every existing import of `Stat` or
 * `Alignment` from the character contract keeps working, and there is only ever one
 * spelling of either to keep correct.
 */
export { Alignment, Stat } from './enums';

/**
 * A reference into pack content — `core:class:thief`. The length cap is checked before
 * the pattern so a megabyte of text fails on its size rather than on a regex walking it.
 */
export const Ref = z.string().max(MAX_REF_LENGTH).regex(REF_PATTERN);
export type Ref = z.infer<typeof Ref>;

/** A bare pack id, as `packsUsed` carries them: `core`, not `core:class:thief`. */
export const PackId = z.string().regex(PACK_ID_PATTERN);
export type PackId = z.infer<typeof PackId>;

/**
 * A row's identity, generated locally. Two torches are two rows with the same `ref`, so
 * `ref` is not a key and an array index is not one either (CLAUDE.md §6) — a row that is
 * keyed by its own text remounts its field on every keystroke. This is that key, and
 * from Phase 6 it is also how a DM request names the row it is about.
 */
export const RowId = z.string().regex(ROW_ID_PATTERN);
export type RowId = z.infer<typeof RowId>;

/**
 * What a sheet points at, and what to call it when nothing points back.
 *
 * `ref` names pack content. `name` is **the player's own words** — the sheet must be
 * usable with no packs loaded at all (PRD.md principle 6), and a character built that
 * way has nothing to reference. It is a fallback, not a cache: nothing in the app copies
 * a pack's label into it, so turning a pack off still costs the sheet nothing it had.
 *
 * `{ ref: null, name: '' }` is a real, unchosen state — the same reading of zero that
 * lets a level-0 character exist.
 */
export const ContentRef = z.strictObject({
  ref: Ref.nullable(),
  name: z.string().max(MAX_NAME_LENGTH),
});
export type ContentRef = z.infer<typeof ContentRef>;

// ---------------------------------------------------------------------------
// The parts of a sheet
// ---------------------------------------------------------------------------

/**
 * A record keyed by the enum, so all six are required and a seventh is rejected —
 * the same guarantee six hand-written keys would give, without six chances to typo one.
 */
export const Stats = z.record(Stat, z.int().min(MIN_STAT).max(MAX_STAT));
export type Stats = z.infer<typeof Stats>;

/**
 * `current` may go below zero. A dying character is a state the sheet has to be able to
 * hold and show; refusing to load one would be losing player data to a validator.
 */
export const HitPoints = z.strictObject({
  current: z.int().min(-MAX_HP).max(MAX_HP),
  max: z.int().min(NONE).max(MAX_HP),
});
export type HitPoints = z.infer<typeof HitPoints>;

export const Gold = z.strictObject({
  gp: z.int().min(NONE).max(MAX_COIN),
  sp: z.int().min(NONE).max(MAX_COIN),
  cp: z.int().min(NONE).max(MAX_COIN),
});
export type Gold = z.infer<typeof Gold>;

/**
 * One inventory row. `qty` stacks, and the total cost of the row is computed, never
 * stored (`model/derived.ts`).
 *
 * `slots` is what **one** of these costs to carry, and it is the fallback half of the
 * rule above: a loaded pack's answer wins, and this is what the player wrote down when
 * no pack answers. A row that came from a pack leaves it at zero and never reads it.
 */
export const CarriedItem = z.strictObject({
  id: RowId,
  ref: Ref.nullable(),
  name: z.string().max(MAX_NAME_LENGTH),
  slots: z.int().min(NONE).max(MAX_ITEM_SLOTS),
  qty: z.int().min(1).max(MAX_ITEM_QUANTITY),
  equipped: z.boolean(),
});
export type CarriedItem = z.infer<typeof CarriedItem>;

/** Knowing a spell is a reference and a name. Tier, range and duration live in the pack. */
export const KnownSpell = z.strictObject({
  id: RowId,
  ref: Ref.nullable(),
  name: z.string().max(MAX_NAME_LENGTH),
});
export type KnownSpell = z.infer<typeof KnownSpell>;

/**
 * The one place a sheet keeps text rather than a reference, and the reason is the whole
 * design: the talent's words may have come from a pack that is later turned off, and
 * the sheet has to survive that intact. `source` records where it came from so the pack
 * can be re-offered; `rolled` is the face that produced it, or null when it was chosen.
 */
export const Talent = z.strictObject({
  id: RowId,
  text: z.string().max(MAX_TEXT_LENGTH),
  source: Ref.nullable(),
  rolled: z.int().min(1).max(MAX_DIE_SIDES).nullable(),
});
export type Talent = z.infer<typeof Talent>;

/**
 * `litAt` is the wall-clock moment it was lit, so remaining time is computed from the
 * clock every render (DESIGN.md §6). Null is unlit. Nothing here counts down — a stored
 * remainder is a derived value and would drift the first time a tab was backgrounded.
 */
export const Light = z.strictObject({
  id: RowId,
  ref: Ref.nullable(),
  name: z.string().max(MAX_NAME_LENGTH),
  litAt: z.int().min(NONE).nullable(),
  minutes: z.int().min(1).max(MAX_LIGHT_MINUTES),
});
export type Light = z.infer<typeof Light>;

/** Free text, and shared — it is the one private field the public projection carries. */
export const Condition = z.string().min(1).max(MAX_CONDITION_LENGTH);
export type Condition = z.infer<typeof Condition>;

export const JournalEntry = z.strictObject({
  id: RowId,
  at: z.int().min(NONE),
  text: z.string().max(MAX_JOURNAL_ENTRY_LENGTH),
});
export type JournalEntry = z.infer<typeof JournalEntry>;

export const Quest = z.strictObject({
  id: RowId,
  text: z.string().max(MAX_QUEST_LENGTH),
  done: z.boolean(),
});
export type Quest = z.infer<typeof Quest>;

// ---------------------------------------------------------------------------
// The character
// ---------------------------------------------------------------------------

/**
 * A character exists before it has an ancestry, a class or an alignment. `alignment` is
 * a closed enum and so is nullable; `ancestry` and `class` are `ContentRef`s and carry
 * their own unchosen state — `{ ref: null, name: '' }` — which is one fewer null to
 * unwrap at every use. The sheet must render a half-built character rather than refuse
 * it (PRD.md principle 4).
 */
export const Character = z.strictObject({
  format: z.literal(CHARACTER_FORMAT),
  formatVersion: z.literal(CHARACTER_FORMAT_VERSION),

  id: z.string().regex(CHARACTER_ID_PATTERN),
  name: z.string().max(MAX_CHARACTER_NAME_LENGTH),

  ancestry: ContentRef,
  class: ContentRef,
  alignment: Alignment.nullable(),

  level: z.int().min(MIN_CHARACTER_LEVEL).max(MAX_CHARACTER_LEVEL),
  xp: z.int().min(NONE).max(MAX_XP),

  stats: Stats,
  hp: HitPoints,
  luck: z.int().min(NONE).max(MAX_LUCK),
  gold: Gold,

  items: z.array(CarriedItem).max(MAX_ITEMS),
  spells: z.array(KnownSpell).max(MAX_SPELLS_KNOWN),
  talents: z.array(Talent).max(MAX_TALENTS),
  lights: z.array(Light).max(MAX_LIGHTS),
  conditions: z.array(Condition).max(MAX_CONDITIONS),
  journal: z.array(JournalEntry).max(MAX_JOURNAL_ENTRIES),
  quests: z.array(Quest).max(MAX_QUESTS),

  /** Which packs this sheet depends on, so a missing one warns instead of losing rows. */
  packsUsed: z.array(PackId).max(MAX_PACKS_LOADED),
});
export type Character = z.infer<typeof Character>;

// ---------------------------------------------------------------------------
// The boundary
// ---------------------------------------------------------------------------

/**
 * A single thing wrong with a file, as `path — what was expected`. The shape and the
 * formatting live in `model/problems.ts`, because a payload off the wire reports its
 * problems the same way and DATA-MODEL.md §9 makes that format a contract.
 */
export type CharacterProblem = Problem;

export { formatProblems, reportProblems };

/** Errors are values at every boundary. CLAUDE.md §2.5. */
export type CharacterParseResult =
  | { readonly ok: true; readonly character: Character }
  | { readonly ok: false; readonly problems: readonly CharacterProblem[] };

/**
 * Parse anything — a file the user picked, a string from localStorage, a peer's payload.
 * Never throws, and never returns a partially repaired character: a sheet that failed
 * validation is reported, not guessed at.
 */
export function parseCharacter(input: unknown): CharacterParseResult {
  const result = validate(Character, input);
  if (result.ok) return { ok: true, character: result.value };

  return { ok: false, problems: result.problems };
}
