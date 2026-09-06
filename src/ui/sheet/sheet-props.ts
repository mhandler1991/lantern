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
