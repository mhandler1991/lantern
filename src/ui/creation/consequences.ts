/**
 * What a later step chose under an earlier answer that has since changed.
 *
 * Going back is free in this walkthrough because there is no draft: a step writes to the
 * sheet, so a player who returns to step two keeps everything steps three to seven put
 * there (`ui/creation/creation.ts`). That is most of issue #36 already, and it is also
 * what leaves the one real problem: **a choice can survive and still stop making sense**.
 * A player who picks a wizard, learns three spells, then goes back and takes a fighter
 * has three spells on a sheet whose class nothing says casts. Nothing is wrong with the
 * sheet — it loads, it saves, it is a legal character — but the player needs telling.
 *
 * So this module answers one question and the UI does the rest: which rows were chosen
 * under an answer that has since moved. Four rules decide it.
 *
 * **It flags, it never removes.** 🚫 Nothing here returns a character, and nothing that
 * reads it writes one. Dropping a row a player might have meant to keep is exactly the
 * destruction PRD.md principle 4 forbids, and "the class changed" is not evidence that
 * they no longer want the spell — plenty of tables allow precisely that.
 *
 * **Only the class has dependents.** The sheet's later steps read one earlier answer:
 * a class narrows the spell picker (`model/pack-resolver.ts` — a spell names its
 * classes) and supplies the talent list and talent table, and it says what hit points
 * are rolled on. Ancestry, alignment and the ability scores narrow nothing, and nothing
 * derived from a score is stored, so changing one invalidates nothing to report.
 *
 * Hit points were once left out of this on the grounds that the sheet recorded the
 * number and not the die, which made any flag a guess. Issue 161 closed that by writing
 * the die down (`hpRolledOn`, DATA-MODEL.md §12), so the check here is now an equality
 * rather than an inference — and it is still only ever a flag: 🚫 nothing re-rolls hit
 * points and nothing rewrites the total because a class moved.
 *
 * **A row nothing answers for is not this module's business.** A row the player typed in
 * has no reference and can never be checked against a list; a row whose pack is merely
 * turned off is already reported by `model/orphans.ts`, and saying it twice in two
 * different words would read as two problems. Both are skipped, which also means turning
 * a pack off never makes this list longer.
 *
 * **No class, no findings.** With no class chosen, or one no loaded pack answers for,
 * there is nothing to check anything against — and a wall of flags the moment a DM turns
 * a pack off would be the app blaming a player for something they did not do.
 *
 * Pure, and no React. It lives beside the sequence rather than in `model/` because a
 * finding names the step to go back to, and the sequence is a UI decision — the same
 * reason `ui/choices.ts` is where it is.
 */

import { MAX_FLAG_EXCERPT } from '../../constants';
import type { Character } from '../../model/character';
import type { Ref } from '../../model/pack';
import type { ResolvedClass, ResolvedStack } from '../../model/pack-resolver';
import { hitDieFor, spellsForClass, talentTableFor } from '../../model/pack-resolver';
import { displayName } from '../choices';
import type { CreationStepId } from './creation';

/** An empty list. A floor, not a business rule. */
const NONE = 0;

/** Where the excerpt starts. */
const START = 0;

const NOTHING: readonly CreationFlag[] = [];

/** Hit points are one field rather than a list, so their flag's key is a constant. */
const HP_FLAG_ID = 'hp';

/**
 * One row that no longer follows from the answers above it.
 *
 * `what` and `why` are separate because they are read at different moments: a player
 * scanning the review needs the row named, and a player deciding what to do about it
 * needs the reason. Both are our own words about the player's own sheet — 🚫 no pack
 * text is copied into either (CLAUDE.md §2.9).
 */
export type CreationFlag = {
  /** The row's own id, so the list keys on something stable across renders. */
  readonly id: string;
  /** Where to go to deal with it. */
  readonly step: CreationStepId;
  /** The row, named the way the sheet names it. */
  readonly what: string;
  /** What changed underneath it, in one clause. */
  readonly why: string;
};

/**
 * A talent named in the space a line has. A talent is a paragraph the player may have
 * edited, so the row is quoted rather than described — but only far enough to recognise.
 */
function excerpt(text: string): string {
  const flat = text.trim().replace(/\s+/gu, ' ');
  if (flat === '') return 'a talent with nothing written in it';

  return flat.length <= MAX_FLAG_EXCERPT
    ? flat
    : `${flat.slice(START, MAX_FLAG_EXCERPT).trimEnd()}…`;
}

/**
 * A hit point total rolled on a die the chosen class does not roll.
 *
 * Three things have to be true before there is anything to say, and each missing one is
 * silence rather than a flag: the number has to have been **rolled** (`hpRolledOn` is
 * null for one typed in, and typing over the box clears it — `state/character-edits.ts`),
 * a loaded pack has to answer for what this class rolls, and the two dice have to
 * actually differ. Two classes that both roll a `d8` leave nothing worth saying, and a
 * class whose pack is off leaves nothing to compare against — the same reading as
 * "a row nothing answers for is not this module's business".
 *
 * The id is a constant because there is only ever one of these: `hp` is a field, not a
 * row, and no row id can collide with it (`ROW_ID_PATTERN` requires the `r_` prefix).
 */
function hitPointFlags(
  character: Character,
  stack: ResolvedStack,
  chosen: ResolvedClass,
): readonly CreationFlag[] {
  const rolledOn = character.hpRolledOn;
  if (rolledOn === null) return NOTHING;

  const die = hitDieFor(stack, chosen.ref);
  if (die === null || die === rolledOn) return NOTHING;

  return [
    {
      id: HP_FLAG_ID,
      step: 'vitals',
      what: `hit points, rolled on ${rolledOn}`,
      why: `${chosen.entry.name} rolls ${die} for them`,
    },
  ];
}

/**
 * Spells recorded against a class that does not offer them.
 *
 * Two findings, and which one applies is the class's business rather than the row's: a
 * class nothing says casts makes every spell on the sheet a leftover, and a class that
 * does cast makes only the ones off its list one. Said separately because they are
 * different things to have happened, and a player who took a fighter wants to hear the
 * first rather than the same sentence seven times about a list that does not exist.
 */
function spellFlags(
  character: Character,
  stack: ResolvedStack,
  chosen: ResolvedClass,
): readonly CreationFlag[] {
  const casts = (chosen.entry.spellcasting ?? null) !== null;
  const onList = new Set<Ref>(spellsForClass(stack, chosen.ref).map((spell) => spell.ref));
  const flags: CreationFlag[] = [];

  for (const spell of character.spells) {
    const reference = spell.ref;
    if (reference === null || !stack.byRef.has(reference)) continue;
    if (casts && onList.has(reference)) continue;

    flags.push({
      id: spell.id,
      step: 'spells',
      what: displayName(stack, reference, spell.name),
      why: casts
        ? `it is not on ${chosen.entry.name}’s spell list`
        : `nothing loaded says ${chosen.entry.name} casts spells`,
    });
  }

  return flags;
}

/**
 * Talents whose source this class was never offered.
 *
 * A talent stores its **words** rather than a reference (DATA-MODEL.md §12), so the row
 * itself is never degraded by any of this and the text stays the player's. What is
 * checked is `source` — the talent entry it was picked from, or the table it was rolled
 * on — against the two things a class offers: the talents an extension gave it
 * (DATA-MODEL.md §9) and its own talent table.
 */
function talentFlags(
  character: Character,
  stack: ResolvedStack,
  chosen: ResolvedClass,
): readonly CreationFlag[] {
  const table = talentTableFor(stack, chosen.ref);
  const offered = new Set<Ref>(chosen.talents);
  if (table !== null) offered.add(table.ref);

  const flags: CreationFlag[] = [];

  for (const talent of character.talents) {
    const source = talent.source;
    if (source === null || !stack.byRef.has(source)) continue;
    if (offered.has(source)) continue;

    flags.push({
      id: talent.id,
      step: 'talents',
      what: excerpt(talent.text),
      why: `it came from a list ${chosen.entry.name} is not offered`,
    });
  }

  return flags;
}

/**
 * Every row on this sheet that was chosen under an answer that has since changed, in the
 * sequence's own order so the list reads as a route back.
 *
 * 🚫 Never throws, never blocks, and never returns a character. The caller shows this
 * beside the rows and beside the Finish button, which stays a button that works.
 */
export function flagged(character: Character, stack: ResolvedStack): readonly CreationFlag[] {
  const classRef = character.class.ref;
  if (classRef === null) return NOTHING;

  const chosen = stack.byRef.get(classRef);
  if (chosen === undefined || chosen.kind !== 'class') return NOTHING;

  return [
    ...hitPointFlags(character, stack, chosen),
    ...talentFlags(character, stack, chosen),
    ...spellFlags(character, stack, chosen),
  ];
}

/** The flags belonging to one step, for the strip that sits above its panel. */
export function flagsFor(
  flags: readonly CreationFlag[],
  step: CreationStepId,
): readonly CreationFlag[] {
  return flags.filter((flag) => flag.step === step);
}

/**
 * Which steps have something to look at, for the progress list. This is the half of the
 * criterion that matters most: a player who changed their class on step two has to be
 * able to see that step seven now wants them without walking to step seven first.
 */
export function stepsFlagged(flags: readonly CreationFlag[]): ReadonlySet<CreationStepId> {
  return new Set(flags.map((flag) => flag.step));
}

/** Whether anything is flagged at all, for the one place that only asks that. */
export function hasFlags(flags: readonly CreationFlag[]): boolean {
  return flags.length > NONE;
}
