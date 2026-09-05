/**
 * A content pack. DATA-MODEL.md §1 is the contract; this file is the envelope of that
 * contract, executable — and DATA-MODEL.md §9 is why it is shaped the way it is.
 *
 * **A pack arrives from another peer. It is hostile input.** Everything that follows is
 * that one sentence, applied:
 *
 *   - **Unknown keys are rejected, never stripped.** Every object here is strict. A
 *     stripped key is a key the author cannot see went missing and an attacker can keep
 *     trying; a rejected one is a line of the report they paste back into a model.
 *   - **Every string and every array is bounded**, from `constants.ts`, before anything
 *     holds it. Length is checked before any pattern, so a megabyte of junk fails on
 *     its size rather than on a regex walking it.
 *   - **Enums are exact matches**, and they live in `model/enums.ts` because a sheet
 *     says the same words.
 *   - **Nothing here is evaluated.** No formulas, no expressions. `"1d8"` is a string
 *     that a die roller parses, never something this file executes.
 *
 * `text` is optional in every place it appears, and that is not a convenience. Core
 * ships without it and falls back to a page reference; a pack a DM authored for their
 * own table may carry it. That single decision is what makes the licensing position
 * work, so it is in the schema from the first day rather than retrofitted (DESIGN.md
 * §5, §7). 🚫 Nothing in this repository ships rules text.
 *
 * Scope: this file validates **the envelope**. The entries inside each content array
 * are bounded and counted here but not yet described — the spell, item, class, ancestry
 * and table schemas are #20, and resolution of define/extend/override is #22.
 */

import * as z from 'zod';
import { formatProblems, problemsFrom, type Problem } from './problems';
import {
  ENTRY_ID_MAX_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_ENTRIES_PER_ARRAY,
  MAX_EXTENDS_PER_PACK,
  MAX_NAME_LENGTH,
  MAX_PAGE_NUMBER,
  MAX_REF_LENGTH,
  MAX_TEXT_LENGTH,
  ENTRY_ID_PATTERN,
  PACK_AUTHOR_MAX_LENGTH,
  PACK_DESCRIPTION_MAX_LENGTH,
  PACK_FORMAT,
  PACK_FORMAT_VERSION,
  PACK_ID_MAX_LENGTH,
  PACK_ID_PATTERN,
  PACK_NAME_MAX_LENGTH,
  PACK_VERSION_MAX_LENGTH,
  PACK_VERSION_PATTERN,
  REF_PATTERN,
} from '../constants';

/** A page is numbered from one; a name is not empty. Neither is a rule of the game. */
const FIRST_PAGE = 1;
const NOT_EMPTY = 1;

// ---------------------------------------------------------------------------
// The leaves every entry is built from. DATA-MODEL.md §§3-8 assemble these; #20.
// ---------------------------------------------------------------------------

/**
 * A pack's own id — `frostbound`. It namespaces every id inside the pack, which is what
 * lets two packs both define a Skald without colliding (DATA-MODEL.md §1).
 */
export const PackId = z.string().max(PACK_ID_MAX_LENGTH).regex(PACK_ID_PATTERN);
export type PackId = z.infer<typeof PackId>;

/** An id inside a pack, written bare: `hoarfrost`, never `frostbound:hoarfrost`. */
export const EntryId = z.string().max(ENTRY_ID_MAX_LENGTH).regex(ENTRY_ID_PATTERN);
export type EntryId = z.infer<typeof EntryId>;

/** The full form of a cross-pack reference — `core:class:wizard`. */
export const Ref = z.string().max(MAX_REF_LENGTH).regex(REF_PATTERN);
export type Ref = z.infer<typeof Ref>;

/** One of the three fields free text is allowed in, and it is required on an entry. */
export const EntryName = z.string().min(NOT_EMPTY).max(MAX_NAME_LENGTH);
export type EntryName = z.infer<typeof EntryName>;

/**
 * The second. Optional everywhere, always — DESIGN.md §5. Absent and `null` both mean
 * "this pack does not carry the words", because an author writing JSON by hand and a
 * model generating it disagree about which one they reach for, and neither is wrong.
 */
export const EntryText = z.string().max(MAX_TEXT_LENGTH).nullish();
export type EntryText = z.infer<typeof EntryText>;

/** The third. */
export const EntryDescription = z.string().max(MAX_DESCRIPTION_LENGTH).nullish();
export type EntryDescription = z.infer<typeof EntryDescription>;

/** Shown when `text` is absent, which for core is always. Optional the same two ways. */
export const PageReference = z.int().min(FIRST_PAGE).max(MAX_PAGE_NUMBER).nullish();
export type PageReference = z.infer<typeof PageReference>;

/**
 * The one operation that collides on purpose (DATA-MODEL.md §1). Its presence is what
 * makes the warning meaningful, so it is a field an author types rather than something
 * inferred from two entries sharing a name.
 */
export const Overrides = Ref.nullish();
export type Overrides = z.infer<typeof Overrides>;

// ---------------------------------------------------------------------------
// Content arrays
// ---------------------------------------------------------------------------

/**
 * An entry as the envelope sees it: counted and bounded, not yet described. The shape
 * of a spell, an item, a class, an ancestry and a table is #20, and each of those is a
 * strict object built from the leaves above. Until then an entry is `unknown` rather
 * than a permissive object, because "not validated yet" and "validated loosely" must
 * not look the same in this file.
 */
const PackEntry = z.unknown();

const contentArray = (): z.ZodOptional<z.ZodArray<typeof PackEntry>> =>
  z.array(PackEntry).max(MAX_ENTRIES_PER_ARRAY).optional();

// ---------------------------------------------------------------------------
// The envelope
// ---------------------------------------------------------------------------

/**
 * `format` and `formatVersion` are checked as literals so unrelated JSON — a character
 * file, somebody's `package.json`, a payload that is not a pack at all — fails on its
 * first field with a message that says what it should have been, rather than deep
 * inside an array with fifty problems.
 *
 * **Every content array is optional.** A pack of four spells has one array, and a pack
 * with none at all is still a valid pack (PRD.md principle 6 — everything is optional
 * except the sheet).
 */
export const Pack = z.strictObject({
  format: z.literal(PACK_FORMAT),
  formatVersion: z.literal(PACK_FORMAT_VERSION),

  id: PackId,
  name: z.string().min(NOT_EMPTY).max(PACK_NAME_MAX_LENGTH),
  version: z.string().max(PACK_VERSION_MAX_LENGTH).regex(PACK_VERSION_PATTERN),

  author: z.string().max(PACK_AUTHOR_MAX_LENGTH).nullish(),
  description: z.string().max(PACK_DESCRIPTION_MAX_LENGTH).nullish(),

  classes: contentArray(),
  ancestries: contentArray(),
  spells: contentArray(),
  items: contentArray(),
  talents: contentArray(),
  tables: contentArray(),

  /** Additions to something another pack defined. Never collides. DATA-MODEL.md §8. */
  extends: z.array(PackEntry).max(MAX_EXTENDS_PER_PACK).optional(),
});
export type Pack = z.infer<typeof Pack>;

// ---------------------------------------------------------------------------
// The boundary
// ---------------------------------------------------------------------------

/**
 * What is wrong with a pack, as `path — what was expected`. The same shape a character
 * file reports, because DATA-MODEL.md §9 makes that format a contract: these lines are
 * written to be pasted back into a model along with the file that produced them.
 */
export type PackProblem = Problem;

export { formatProblems };

/** Errors are values at every boundary. CLAUDE.md §2.5. */
export type PackParseResult =
  | { readonly ok: true; readonly pack: Pack }
  | { readonly ok: false; readonly problems: readonly PackProblem[] };

/**
 * Parse anything — a file a DM picked, a pack reassembled from a peer's chunks. Never
 * throws, and never returns a half-repaired pack: a pack that failed validation is
 * reported, not guessed at.
 */
export function parsePack(input: unknown): PackParseResult {
  const result = Pack.safeParse(input);
  if (result.success) return { ok: true, pack: result.data };

  return { ok: false, problems: problemsFrom(result.error) };
}
