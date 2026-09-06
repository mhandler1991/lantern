/**
 * What every panel is handed: the character, and the one way to change it.
 *
 * There is no store and no context. A sheet is one level of prop drilling, which is
 * exactly the depth CLAUDE.md §6 says to stay at until it genuinely hurts. Panels that
 * also need a derived value take it as a prop — computed once in `CharacterSheet`, so
 * two panels showing the same number cannot show two different ones.
 */

import type { Dispatch, SetStateAction } from 'react';
import type { Character } from '../../model/character';
import type { OrphanReport } from '../../model/orphans';
import type { Stat } from '../../model/character';
import type { ResolvedStack } from '../../model/pack-resolver';
import type { SheetChoices } from '../choices';

export type SetCharacter = Dispatch<SetStateAction<Character>>;

export type PanelProps = {
  readonly character: Character;
  readonly setCharacter: SetCharacter;
};

/**
 * Which of this sheet's rows point at content no loaded pack answers for. Computed once,
 * above the sheet, for the same reason every derived value is: two panels disagreeing
 * about whether a row is orphaned would be two answers to one question.
 *
 * Taken by the four panels that hold references — identity, gear, spells and light.
 * 🚫 Not talents: a talent stores its words rather than a reference (DATA-MODEL.md §11)
 * and keeps working with every pack off, which is what it stored them for.
 */
export type OrphanProps = {
  readonly orphans: OrphanReport;
};

/**
 * The packs that are on, and what they offer a picker. Both come from above the sheet
 * for the same reason the orphan report does: which packs are loaded is not the sheet's
 * question, and two panels resolving it differently would be two answers to one.
 *
 * `stack` is what a row's name is read back out of, and `choices` is that stack turned
 * into option lists once (`ui/choices.ts`) rather than once per panel. Both are empty
 * and harmless with no packs loaded, which is the state PRD.md principle 6 requires the
 * sheet to work in: every picker falls back to a box the player types in.
 */
export type StackProps = {
  readonly stack: ResolvedStack;
};

export type ContentProps = StackProps & {
  readonly choices: SheetChoices;
};

/**
 * What the character's class casts on, while a loaded pack says it casts at all.
 *
 * `null` is one answer to three different questions — a class that does not cast, a
 * class no loaded pack defines, and a character who has not chosen one — because all
 * three mean the same thing to a sheet: there is no spellcasting to print. Computed
 * above the panel like every other derived value, and never stored (CLAUDE.md §4).
 */
export type Casting = {
  readonly stat: Stat;
  readonly modifier: number;
  /** The highest tier reached at this level, or `null` for a caster not there yet. */
  readonly highestTier: number | null;
};

export type CastingProps = {
  readonly casting: Casting | null;
};
