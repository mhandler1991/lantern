/**
 * Talents, as text.
 *
 * This panel is PRD.md principle 1 made visible: a talent that reads "+1 to melee
 * attacks" is a paragraph on a sheet and nothing more. Nothing here touches a stat, and
 * there is no field that could. When a roll produces one in Phase 3 it will arrive with
 * its `source` and the face that rolled it, and those are shown beside it — a record of
 * where the words came from, so a pack can be re-offered after it is turned off.
 */

import type { ReactElement } from 'react';
import { MAX_TALENTS, MAX_TEXT_LENGTH } from '../../constants';
import { appendRow, isAtLimit, newTalent, removeRow, updateRow } from '../../state/character-edits';
import { AddRowButton, EmptyNote, Panel, RemoveRowButton, TextAreaField } from '../fields';
import type { PanelProps } from './sheet-props';

/** Nothing written down yet. A floor, not a business rule. */
const NONE = 0;

/** Enough to read a talent without scrolling it, small enough to list several. */
const TALENT_ROWS = 2;

export function TalentsPanel({ character, setCharacter }: PanelProps): ReactElement {
  const full = isAtLimit(character.talents, MAX_TALENTS);

  return (
    <Panel title="Talents">
      {character.talents.length === NONE ? (
        <EmptyNote>No talents yet.</EmptyNote>
      ) : (
        <ul className="rows">
          {character.talents.map((talent) => (
            <li key={talent.id} className="row row--talent">
              <TextAreaField
                label="Talent"
                hideLabel
                placeholder="What the talent says"
                value={talent.text}
                maxLength={MAX_TEXT_LENGTH}
                rows={TALENT_ROWS}
                onChange={(text) =>
                  setCharacter((previous) => ({
                    ...previous,
                    talents: updateRow(previous.talents, talent.id, { text }),
                  }))
                }
              />
              {talent.rolled !== null && (
                <span className="provenance">rolled {talent.rolled}</span>
              )}
              <RemoveRowButton
                label="Remove this talent"
                onClick={() =>
                  setCharacter((previous) => ({
                    ...previous,
                    talents: removeRow(previous.talents, talent.id),
                  }))
                }
              />
            </li>
          ))}
        </ul>
      )}

      <div className="row-actions">
        <AddRowButton
          label="Add talent"
          disabled={full}
          onClick={() =>
            setCharacter((previous) => ({
              ...previous,
              talents: appendRow(previous.talents, newTalent(), MAX_TALENTS),
            }))
          }
        />
      </div>
    </Panel>
  );
}
