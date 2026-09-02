/**
 * What the party said it would do, and whether it has been done.
 *
 * A finished quest stays on the sheet, struck through rather than removed — a session
 * record is worth more than a tidy list, and nothing here throws away a player's text
 * on their behalf.
 */

import type { ReactElement } from 'react';
import { MAX_QUEST_LENGTH, MAX_QUESTS } from '../../constants';
import { appendRow, isAtLimit, newQuest, removeRow, updateRow } from '../../state/character-edits';
import {
  AddRowButton,
  CheckField,
  EmptyNote,
  Panel,
  RemoveRowButton,
  TextField,
} from '../fields';
import type { PanelProps } from './sheet-props';

/** Nothing promised yet. A floor, not a business rule. */
const NONE = 0;

export function QuestsPanel({ character, setCharacter }: PanelProps): ReactElement {
  const full = isAtLimit(character.quests, MAX_QUESTS);

  return (
    <Panel title="Quests">
      {character.quests.length === NONE ? (
        <EmptyNote>Nothing promised yet.</EmptyNote>
      ) : (
        <ul className="rows">
          {character.quests.map((quest) => (
            <li key={quest.id} className={quest.done ? 'row row--quest is-done' : 'row row--quest'}>
              <CheckField
                label="Done"
                hideLabel
                checked={quest.done}
                onChange={(done) =>
                  setCharacter((previous) => ({
                    ...previous,
                    quests: updateRow(previous.quests, quest.id, { done }),
                  }))
                }
              />
              <TextField
                label="Quest"
                hideLabel
                placeholder="What was promised"
                value={quest.text}
                maxLength={MAX_QUEST_LENGTH}
                onChange={(text) =>
                  setCharacter((previous) => ({
                    ...previous,
                    quests: updateRow(previous.quests, quest.id, { text }),
                  }))
                }
              />
              <RemoveRowButton
                label="Remove this quest"
                onClick={() =>
                  setCharacter((previous) => ({
                    ...previous,
                    quests: removeRow(previous.quests, quest.id),
                  }))
                }
              />
            </li>
          ))}
        </ul>
      )}

      <div className="row-actions">
        <AddRowButton
          label="Add quest"
          disabled={full}
          onClick={() =>
            setCharacter((previous) => ({
              ...previous,
              quests: appendRow(previous.quests, newQuest(), MAX_QUESTS),
            }))
          }
        />
      </div>
    </Panel>
  );
}
