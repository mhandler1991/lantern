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
  MAX_ITEMS,
  MAX_JOURNAL_ENTRIES,
  MAX_JOURNAL_ENTRY_LENGTH,
  MAX_LIGHT_MINUTES,
  MAX_LIGHTS,
  MAX_LUCK,
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

/** DATA-MODEL.md §2. The six, in the order every sheet prints them. */
export const Stat = z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']);
export type Stat = z.infer<typeof Stat>;

export const Alignment = z.enum(['lawful', 'neutral', 'chaotic']);
export type Alignment = z.infer<typeof Alignment>;

/**
 * A reference into pack content — `core:class:thief`. The length cap is checked before
 * the pattern so a megabyte of text fails on its size rather than on a regex walking it.
 */
export const Ref = z.string().max(MAX_REF_LENGTH).regex(REF_PATTERN);
export type Ref = z.infer<typeof Ref>;

/** A bare pack id, as `packsUsed` carries them: `core`, not `core:class:thief`. */
export const PackId = z.string().regex(PACK_ID_PATTERN);
export type PackId = z.infer<typeof PackId>;

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

/** One inventory row. `qty` stacks; slot cost is the item's, and is computed. */
export const CarriedItem = z.strictObject({
  ref: Ref,
  qty: z.int().min(1).max(MAX_ITEM_QUANTITY),
  equipped: z.boolean(),
});
export type CarriedItem = z.infer<typeof CarriedItem>;

/** Knowing a spell is a reference and nothing more. Tier and range live in the pack. */
export const KnownSpell = z.strictObject({ ref: Ref });
export type KnownSpell = z.infer<typeof KnownSpell>;

/**
 * The one place a sheet keeps text rather than a reference, and the reason is the whole
 * design: the talent's words may have come from a pack that is later turned off, and
 * the sheet has to survive that intact. `source` records where it came from so the pack
 * can be re-offered; `rolled` is the face that produced it, or null when it was chosen.
 */
export const Talent = z.strictObject({
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
  ref: Ref,
  litAt: z.int().min(NONE).nullable(),
  minutes: z.int().min(1).max(MAX_LIGHT_MINUTES),
});
export type Light = z.infer<typeof Light>;

/** Free text, and shared — it is the one private field the public projection carries. */
export const Condition = z.string().min(1).max(MAX_CONDITION_LENGTH);
export type Condition = z.infer<typeof Condition>;

export const JournalEntry = z.strictObject({
  at: z.int().min(NONE),
  text: z.string().max(MAX_JOURNAL_ENTRY_LENGTH),
});
export type JournalEntry = z.infer<typeof JournalEntry>;

export const Quest = z.strictObject({
  text: z.string().max(MAX_QUEST_LENGTH),
  done: z.boolean(),
});
export type Quest = z.infer<typeof Quest>;

// ---------------------------------------------------------------------------
// The character
// ---------------------------------------------------------------------------

/**
 * `ancestry`, `class` and `alignment` are nullable because a character exists before it
 * has any of them. Creation writes a real character and fills it in; the sheet must
 * render a half-built one rather than refuse it (PRD.md principle 4).
 */
export const Character = z.strictObject({
  format: z.literal(CHARACTER_FORMAT),
  formatVersion: z.literal(CHARACTER_FORMAT_VERSION),

  id: z.string().regex(CHARACTER_ID_PATTERN),
  name: z.string().max(MAX_CHARACTER_NAME_LENGTH),

  ancestry: Ref.nullable(),
  class: Ref.nullable(),
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
 * A single thing wrong with a file, as `path — what was expected`. DATA-MODEL.md §9:
 * these are written to be pasted back into an AI along with the file, so the path has
 * to be exact and the message has to say what was expected rather than merely "invalid".
 */
export type CharacterProblem = {
  readonly path: string;
  readonly message: string;
};

/** Errors are values at every boundary. CLAUDE.md §2.5. */
export type CharacterParseResult =
  | { readonly ok: true; readonly character: Character }
  | { readonly ok: false; readonly problems: readonly CharacterProblem[] };

/** `items[3].qty`, and `(root)` for a problem with the file as a whole. */
function formatPath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === NONE) return '(root)';

  return path.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`;
    return acc === '' ? String(segment) : `${acc}.${String(segment)}`;
  }, '');
}

/**
 * Parse anything — a file the user picked, a string from localStorage, a peer's payload.
 * Never throws, and never returns a partially repaired character: a sheet that failed
 * validation is reported, not guessed at.
 */
export function parseCharacter(input: unknown): CharacterParseResult {
  const result = Character.safeParse(input);
  if (result.success) return { ok: true, character: result.data };

  return {
    ok: false,
    problems: result.error.issues.map((issue) => ({
      path: formatPath(issue.path),
      message: issue.message,
    })),
  };
}

/** The problems, one per line, ready to paste. DATA-MODEL.md §9. */
export function formatProblems(problems: readonly CharacterProblem[]): string {
  return problems.map((problem) => `  ${problem.path} — ${problem.message}`).join('\n');
}
