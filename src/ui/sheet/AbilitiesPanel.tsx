/**
 * The six scores, and the modifier each one produces.
 *
 * The modifier is printed beside the score and stored nowhere — it arrives as a prop
 * computed once for the whole sheet (CLAUDE.md §4). Editing a score moves the number
 * beside it in the same render, which is the visible half of "derived, never stored".
 */

import type { ReactElement } from 'react';
import { MAX_STAT, MIN_STAT } from '../../constants';
import type { Stat } from '../../model/character';
import { setStat } from '../../state/character-edits';
import { NumberField, Panel } from '../fields';
import { formatModifier } from '../format';
import type { PanelProps } from './sheet-props';

/** DATA-MODEL.md §2 — the order every sheet prints them in, and what each is called. */
const ABILITIES: readonly (readonly [Stat, string])[] = [
  ['str', 'Strength'],
  ['dex', 'Dexterity'],
  ['con', 'Constitution'],
  ['int', 'Intelligence'],
  ['wis', 'Wisdom'],
  ['cha', 'Charisma'],
];

export function AbilitiesPanel({
  character,
  setCharacter,
  modifiers,
}: PanelProps & { readonly modifiers: Record<Stat, number> }): ReactElement {
  return (
    <Panel title="Abilities">
      <ul className="rows rows--abilities">
        {ABILITIES.map(([stat, label]) => (
          <li key={stat} className="row row--ability">
            <NumberField
              label={label}
              value={character.stats[stat]}
              min={MIN_STAT}
              max={MAX_STAT}
              onChange={(score) => setCharacter((previous) => setStat(previous, stat, score))}
            />
            <span className="ability__modifier">{formatModifier(modifiers[stat])}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
