/**
 * Spells known, by name.
 *
 * A spell is a reference and a name, and nothing else — tier, range, duration and the
 * words of the spell live in a pack, and never on the sheet (CLAUDE.md §2.9). Which is
 * also why there is no DC on this panel yet: a spell has no tier until a pack gives it
 * one, and `spellDC` has nothing to be a DC of.
 */

import type { ReactElement } from 'react';
import { MAX_NAME_LENGTH, MAX_SPELLS_KNOWN } from '../../constants';
import { appendRow, isAtLimit, newSpell, removeRow, updateRow } from '../../state/character-edits';
import { AddRowButton, EmptyNote, Panel, RemoveRowButton, TextField } from '../fields';
import type { PanelProps } from './sheet-props';

/** Nothing known yet. A floor, not a business rule. */
const NONE = 0;

export function SpellsPanel({ character, setCharacter }: PanelProps): ReactElement {
  const full = isAtLimit(character.spells, MAX_SPELLS_KNOWN);

  return (
    <Panel title="Spells">
      {character.spells.length === NONE ? (
        <EmptyNote>No spells known.</EmptyNote>
      ) : (
        <ul className="rows">
          {character.spells.map((spell) => (
            <li key={spell.id} className="row row--spell">
              <TextField
                label="Spell"
                hideLabel
                placeholder="Spell"
                value={spell.name}
                maxLength={MAX_NAME_LENGTH}
                onChange={(name) =>
                  setCharacter((previous) => ({
                    ...previous,
                    spells: updateRow(previous.spells, spell.id, { name }),
                  }))
                }
              />
              <RemoveRowButton
                label={`Remove ${spell.name === '' ? 'this spell' : spell.name}`}
                onClick={() =>
                  setCharacter((previous) => ({
                    ...previous,
                    spells: removeRow(previous.spells, spell.id),
                  }))
                }
              />
            </li>
          ))}
        </ul>
      )}

      <div className="row-actions">
        <AddRowButton
          label="Add spell"
          disabled={full}
          onClick={() =>
            setCharacter((previous) => ({
              ...previous,
              spells: appendRow(previous.spells, newSpell(), MAX_SPELLS_KNOWN),
            }))
          }
        />
      </div>
    </Panel>
  );
}
