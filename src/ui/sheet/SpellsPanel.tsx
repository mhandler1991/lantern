/**
 * Spells known, by name.
 *
 * A spell is a reference and a name, and nothing else — tier, range, duration and the
 * words of the spell live in a pack, and never on the sheet (CLAUDE.md §2.9). Which is
 * also why there is no DC on this panel yet: a spell has no tier until a pack gives it
 * one, and `spellDC` has nothing to be a DC of.
 *
 * A spell whose pack is off keeps its row and shows what it points at. The name is the
 * pack's word for it, so it is read only until the pack is back — the row is a record of
 * a spell known, and a pack being off is not the character forgetting it.
 */

import type { ReactElement } from 'react';
import { MAX_NAME_LENGTH, MAX_SPELLS_KNOWN } from '../../constants';
import { packOfRef } from '../../model/orphans';
import { appendRow, isAtLimit, newSpell, removeRow, updateRow } from '../../state/character-edits';
import { AddRowButton, EmptyNote, OrphanMark, Panel, RemoveRowButton, TextField } from '../fields';
import { orphanLabel } from '../format';
import type { OrphanProps, PanelProps } from './sheet-props';

/** Nothing known yet. A floor, not a business rule. */
const NONE = 0;

export function SpellsPanel({
  character,
  setCharacter,
  orphans,
}: PanelProps & OrphanProps): ReactElement {
  const full = isAtLimit(character.spells, MAX_SPELLS_KNOWN);

  return (
    <Panel title="Spells">
      {character.spells.length === NONE ? (
        <EmptyNote>No spells known.</EmptyNote>
      ) : (
        <ul className="rows">
          {character.spells.map((spell) => {
            const isOrphaned = orphans.rows.has(spell.id);
            const label = orphanLabel(spell.name, spell.ref);

            return (
              <li
                key={spell.id}
                className={isOrphaned ? 'row row--spell row--orphaned' : 'row row--spell'}
              >
                <TextField
                  label="Spell"
                  hideLabel
                  placeholder="Spell"
                  value={isOrphaned ? label : spell.name}
                  maxLength={MAX_NAME_LENGTH}
                  readOnly={isOrphaned}
                  onChange={(name) =>
                    setCharacter((previous) => ({
                      ...previous,
                      spells: updateRow(previous.spells, spell.id, { name }),
                    }))
                  }
                />
                <RemoveRowButton
                  label={`Remove ${label === '' ? 'this spell' : label}`}
                  onClick={() =>
                    setCharacter((previous) => ({
                      ...previous,
                      spells: removeRow(previous.spells, spell.id),
                    }))
                  }
                />
                {isOrphaned && spell.ref !== null && <OrphanMark pack={packOfRef(spell.ref)} />}
              </li>
            );
          })}
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
