/**
 * The journal — what happened, and when it was written down.
 *
 * `at` is stamped once, when the entry is added, and never touched again: it is the
 * moment the player wrote, not the moment they last edited. Entries stay in the order
 * they were written, because that is what makes a log readable back.
 */

import type { ReactElement } from 'react';
import { MAX_JOURNAL_ENTRIES, MAX_JOURNAL_ENTRY_LENGTH } from '../../constants';
import {
  appendRow,
  isAtLimit,
  newJournalEntry,
  removeRow,
  updateRow,
} from '../../state/character-edits';
import { AddRowButton, EmptyNote, Panel, RemoveRowButton, TextAreaField } from '../fields';
import { formatMoment } from '../format';
import type { PanelProps } from './sheet-props';

/** Nothing written yet. A floor, not a business rule. */
const NONE = 0;

/** A few lines: long enough for a note, short enough that ten of them still scan. */
const ENTRY_ROWS = 3;

export function JournalPanel({ character, setCharacter }: PanelProps): ReactElement {
  const full = isAtLimit(character.journal, MAX_JOURNAL_ENTRIES);

  return (
    <Panel title="Journal">
      {character.journal.length === NONE ? (
        <EmptyNote>Nothing written down yet.</EmptyNote>
      ) : (
        <ul className="rows">
          {character.journal.map((entry) => (
            <li key={entry.id} className="row row--entry">
              <div className="row__head">
                <span className="provenance">{formatMoment(entry.at)}</span>
                <RemoveRowButton
                  label="Remove this entry"
                  onClick={() =>
                    setCharacter((previous) => ({
                      ...previous,
                      journal: removeRow(previous.journal, entry.id),
                    }))
                  }
                />
              </div>
              <TextAreaField
                label="Entry"
                hideLabel
                placeholder="What happened"
                value={entry.text}
                maxLength={MAX_JOURNAL_ENTRY_LENGTH}
                rows={ENTRY_ROWS}
                onChange={(text) =>
                  setCharacter((previous) => ({
                    ...previous,
                    journal: updateRow(previous.journal, entry.id, { text }),
                  }))
                }
              />
            </li>
          ))}
        </ul>
      )}

      <div className="row-actions">
        <AddRowButton
          label="Add entry"
          disabled={full}
          onClick={() =>
            setCharacter((previous) => ({
              ...previous,
              journal: appendRow(
                previous.journal,
                newJournalEntry(Date.now()),
                MAX_JOURNAL_ENTRIES,
              ),
            }))
          }
        />
      </div>
    </Panel>
  );
}
