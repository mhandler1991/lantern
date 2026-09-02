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

export type SetCharacter = Dispatch<SetStateAction<Character>>;

export type PanelProps = {
  readonly character: Character;
  readonly setCharacter: SetCharacter;
};
