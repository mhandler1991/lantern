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
 * Scope: this file validates **the envelope and the entries inside it** — spells, items,
 * classes, ancestries and tables, DATA-MODEL.md §§3-7. Two arrays are still counted
 * rather than described: `talents`, which DATA-MODEL.md gives no shape, and `extends`,
 * whose shape only means anything alongside the resolution that applies it (#22).
 * Resolving define/extend/override across loaded packs is #22 as well; nothing here
 * looks at a second pack.
 */

import * as z from 'zod';
import {
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
} from './enums';
import { formatProblems, reportProblems, validate, type Problem } from './problems';
import {
  ENTRY_ID_MAX_LENGTH,
  ENTRY_REF_PATTERN,
  MAX_ARMOR_AC,
  MAX_CHARACTER_LEVEL,
  MAX_COIN,
  MAX_DESCRIPTION_LENGTH,
  MAX_ENTRIES_PER_ARRAY,
  MAX_EXTENDS_PER_PACK,
  MAX_NAME_LENGTH,
  MAX_PACK_ITEM_SLOTS,
  MAX_PAGE_NUMBER,
  MAX_REF_LENGTH,
  MAX_TABLE_ROLL,
  MAX_TABLE_ROWS,
  MAX_TAGS_PER_ENTRY,
  MAX_TEXT_LENGTH,
  MIN_PACK_ITEM_SLOTS,
  MIN_TABLE_ROLL,
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

/** Free, and weightless. A floor on a number, not a statement about gear. */
const NOTHING = 0;

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

/**
 * What one entry writes when it points at another. Three forms, all of which appear in
 * DATA-MODEL.md's own examples: `rimewalker-talents` in the same pack (§5),
 * `frostbound:rimewalker` in another with the kind implied by the field (§3), and
 * `core:item:dagger` written out in full (§5).
 *
 * All three are accepted, because a pack author should not have to know whether the
 * thing they are naming happens to live beside them, and because refusing one would
 * refuse a pack written straight from the document. **Which form it is stays visible** —
 * filling in the implied segments from the field a reference sat in is resolution's job
 * (#22), not this schema's.
 */
export const EntryRef = z
  .string()
  .max(MAX_REF_LENGTH)
  .regex(ENTRY_REF_PATTERN, 'expected a reference such as dagger, core:dagger or core:item:dagger');
export type EntryRef = z.infer<typeof EntryRef>;

/**
 * A short closed-vocabulary label an entry carries a list of — a weapon property, an
 * armour a class may wear. Same shape as an id and deliberately not free text: three
 * fields hold free text (`name`, `text`, `description`) and a tag is not one of them
 * (DATA-MODEL.md §2), which is what keeps a pack sortable and filterable.
 */
export const EntryTag = EntryId;
export type EntryTag = z.infer<typeof EntryTag>;

/** A list of them, bounded. `["versatile"]`, `["none", "light"]`. */
const tagList = <T extends z.ZodType>(tag: T): z.ZodArray<T> =>
  z.array(tag).max(MAX_TAGS_PER_ENTRY);

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
// Spells. DATA-MODEL.md §3.
// ---------------------------------------------------------------------------

/**
 * **The spell is the source of truth for which lists it is on.** A class names its
 * talent table; a spell names its classes. That direction is the whole reason adding
 * spells to an existing class needs no `extends` at all — a four-spell pack for the
 * wizard is four entries and no extension (DATA-MODEL.md §3).
 *
 * A spell on no list is allowed. It is a spell an author has not finished placing, and
 * refusing it would cost them the pack over a field they are still writing (PRD.md
 * principle 4); a picker simply never offers it.
 */
export const SpellEntry = z.strictObject({
  id: EntryId,
  name: EntryName,
  tier: Tier,
  classes: tagList(EntryRef),
  range: Range,
  duration: Duration,

  text: EntryText,
  page: PageReference,
  overrides: Overrides,
});
export type SpellEntry = z.infer<typeof SpellEntry>;

// ---------------------------------------------------------------------------
// Items. DATA-MODEL.md §4.
// ---------------------------------------------------------------------------

/** What a thing costs, in one of the three coins a sheet keeps. */
export const ItemCost = z.strictObject({
  amount: z.int().min(NOTHING).max(MAX_COIN),
  currency: Currency,
});
export type ItemCost = z.infer<typeof ItemCost>;

/**
 * 🚫 `damage` is a notation, never an expression, and nothing in this app evaluates it —
 * `model/dice.ts` reads the dice out of it. `properties` are tags rather than sentences,
 * so a sheet can group by them; a property that needs explaining goes in `text`.
 */
export const WeaponBlock = z.strictObject({
  type: WeaponType,
  damage: DamageNotation,
  properties: tagList(EntryTag),
});
export type WeaponBlock = z.infer<typeof WeaponBlock>;

/**
 * `ac` is the class this armour sets, or — for a shield — the bonus it adds, which is
 * how `model/derived.ts` already reads it. `addDex` is how heavy armour is expressed:
 * false, and dexterity does not apply. Both are numbers a pack supplies to arithmetic
 * that lives elsewhere; nothing here adjudicates (CLAUDE.md §4).
 */
export const ArmorBlock = z.strictObject({
  type: ArmorType,
  ac: z.int().min(NOTHING).max(MAX_ARMOR_AC),
  addDex: z.boolean(),
});
export type ArmorBlock = z.infer<typeof ArmorBlock>;

/**
 * `weapon` and `armor` are mutually exclusive in practice and **not enforced to be**. A
 * shield that also hits is somebody's homebrew, not a malformed file, and the pair of
 * blocks costs the reader nothing (PRD.md principle 4).
 *
 * `slots` is what **one** of it costs to carry. A sheet multiplies by quantity and a
 * pack's answer wins over the row's own — `model/derived.ts` §carry slots.
 */
export const ItemEntry = z.strictObject({
  id: EntryId,
  name: EntryName,
  slots: z.int().min(MIN_PACK_ITEM_SLOTS).max(MAX_PACK_ITEM_SLOTS),
  cost: ItemCost,

  weapon: WeaponBlock.nullish(),
  armor: ArmorBlock.nullish(),

  text: EntryText,
  page: PageReference,
  overrides: Overrides,
});
export type ItemEntry = z.infer<typeof ItemEntry>;

// ---------------------------------------------------------------------------
// Classes. DATA-MODEL.md §5.
// ---------------------------------------------------------------------------

/**
 * `null` for a non-caster, and that is a stated fact rather than an absent field —
 * absent and null both read as "does not cast" here, the same way they do for `text`.
 *
 * `highestTierByLevel` is indexed by level − 1, one entry per level, which is why it is
 * bounded by `MAX_CHARACTER_LEVEL` rather than by a cap of its own. A shorter list is
 * accepted: a class that only goes to level five is a class an author is still writing,
 * and the caller reads past the end as "no tier yet".
 */
export const SpellcastingBlock = z.strictObject({
  stat: Stat,
  highestTierByLevel: z.array(Tier).max(MAX_CHARACTER_LEVEL),
});
export type SpellcastingBlock = z.infer<typeof SpellcastingBlock>;

/**
 * XP thresholds are uniform across classes, so there is no per-class progression here —
 * `model/derived.ts` computes advancement from level alone (DATA-MODEL.md §5).
 *
 * **A class referencing an item no pack defines warns and renders as plain text.** That
 * is why `weapons` is a list of references and not a list of resolved items: resolution
 * happens later and against whatever is loaded, and a missing one never fails the pack.
 */
export const ClassEntry = z.strictObject({
  id: EntryId,
  name: EntryName,
  hitDie: Die,
  weapons: tagList(EntryRef),
  armor: tagList(ArmorType),
  spellcasting: SpellcastingBlock.nullish(),
  talentTable: EntryRef,

  text: EntryText,
  page: PageReference,
  overrides: Overrides,
});
export type ClassEntry = z.infer<typeof ClassEntry>;

// ---------------------------------------------------------------------------
// Ancestries. DATA-MODEL.md §6.
// ---------------------------------------------------------------------------

/**
 * The smallest entry there is: a name, the words describing its knack, and a page.
 *
 * `talent` is free text under a fourth name, which DATA-MODEL.md §2's three-field rule
 * does not list. It is the same field as `text` wearing the label §6 gives it, so it
 * carries the same bound — and, like `text`, core ships without it (DESIGN.md §5).
 *
 * 🚫 Nothing reads it. A talent is recorded, never applied (PRD.md principle 1).
 */
export const AncestryEntry = z.strictObject({
  id: EntryId,
  name: EntryName,
  talent: EntryText,

  text: EntryText,
  page: PageReference,
  overrides: Overrides,
});
export type AncestryEntry = z.infer<typeof AncestryEntry>;

// ---------------------------------------------------------------------------
// Tables. DATA-MODEL.md §7.
// ---------------------------------------------------------------------------

/**
 * A face, or an inclusive band of them: `2` and `[3, 6]` (DATA-MODEL.md §7). The pair is
 * a tuple rather than an array so a third element is a reported problem instead of a
 * silently ignored one, and `low` may equal `high` — a one-face band is a band an author
 * wrote out longhand, not an error.
 *
 * **Gaps and overlaps are not checked here.** They are real faults and they are
 * *warnings*: a table missing a row for 7 is a table that answers for everything else,
 * and refusing the pack over it is exactly what PRD.md principle 4 forbids. Coverage is
 * `model/tables.ts` (CLAUDE.md §7), where the lookup that would fall through it lives.
 */
export const TableRoll = z.union([
  z.int().min(MIN_TABLE_ROLL).max(MAX_TABLE_ROLL),
  z
    .tuple([
      z.int().min(MIN_TABLE_ROLL).max(MAX_TABLE_ROLL),
      z.int().min(MIN_TABLE_ROLL).max(MAX_TABLE_ROLL),
    ])
    .refine(([low, high]) => low <= high, {
      message: 'expected an inclusive range [low, high] with low no greater than high',
    }),
]);
export type TableRoll = z.infer<typeof TableRoll>;

/**
 * The row's `text` is required and is the only free text a table carries — a row with
 * nothing to say is not a row. 🚫 **There is no `grants` field, deliberately.** A result
 * lands on a sheet as words; applying it would need an effects engine, which PRD.md
 * principle 1 rules out and PRD.md §4 defers indefinitely.
 */
export const TableRow = z.strictObject({
  roll: TableRoll,
  text: z.string().min(NOT_EMPTY).max(MAX_TEXT_LENGTH),
});
export type TableRow = z.infer<typeof TableRow>;

/**
 * `die` is a notation, not one of the `Die` enum's members: `2d6` carries a count and a
 * talent table is usually rolled on more than one die.
 *
 * `rerollable` defaults to false when it is absent. An author who omits a flag means
 * "no", and losing a whole pack to a missing boolean is the refusal PRD.md principle 4
 * forbids — so the default is stated here rather than left to every caller to guess.
 */
export const TableEntry = z.strictObject({
  id: EntryId,
  name: EntryName,
  die: DieNotation,
  rerollable: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
  rows: z.array(TableRow).max(MAX_TABLE_ROWS),

  text: EntryText,
  page: PageReference,
  overrides: Overrides,
});
export type TableEntry = z.infer<typeof TableEntry>;

// ---------------------------------------------------------------------------
// Content arrays
// ---------------------------------------------------------------------------

/**
 * Two arrays the envelope still only counts.
 *
 * `talents` has no shape in DATA-MODEL.md to be executable against, and `extends` (§8)
 * is one half of a pair whose other half is resolution — an extension's `target` only
 * means something once there is a stack of loaded packs to look it up in (#22). Both
 * stay `unknown` rather than becoming a permissive object, because "not described yet"
 * and "described loosely" must not look the same in this file.
 */
const UndescribedEntry = z.unknown();

const contentArray = <T extends z.ZodType>(entry: T): z.ZodOptional<z.ZodArray<T>> =>
  z.array(entry).max(MAX_ENTRIES_PER_ARRAY).optional();

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

  classes: contentArray(ClassEntry),
  ancestries: contentArray(AncestryEntry),
  spells: contentArray(SpellEntry),
  items: contentArray(ItemEntry),
  talents: contentArray(UndescribedEntry),
  tables: contentArray(TableEntry),

  /** Additions to something another pack defined. Never collides. DATA-MODEL.md §8. */
  extends: z.array(UndescribedEntry).max(MAX_EXTENDS_PER_PACK).optional(),
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

export { formatProblems, reportProblems };

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
  const result = validate(Pack, input);
  if (result.ok) return { ok: true, pack: result.value };

  return { ok: false, problems: result.problems };
}
