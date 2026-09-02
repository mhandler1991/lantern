/**
 * Conditions — the one private field the public projection carries (DESIGN.md §2).
 *
 * They are bare strings rather than rows, so the string has to stay unique to be a key:
 * `addCondition` trims, caps and refuses a repeat, and a condition is added and removed
 * rather than retyped. That is also how it reads at a table — a condition arrives and
 * later it lifts; nobody edits one into another.
 */

import type { ReactElement } from 'react';
import { useState } from 'react';
import { MAX_CONDITION_LENGTH, MAX_CONDITIONS } from '../../constants';
import { addCondition, isAtLimit, removeCondition } from '../../state/character-edits';
import { AddRowButton, EmptyNote, Panel, RemoveRowButton, TextField } from '../fields';
import type { PanelProps } from './sheet-props';

/** None on. A floor, not a business rule. */
const NONE = 0;

export function ConditionsPanel({ character, setCharacter }: PanelProps): ReactElement {
  /** What is half-typed in the box. It is not a condition until it is added. */
  const [typed, setTyped] = useState('');

  const full = isAtLimit(character.conditions, MAX_CONDITIONS);

  const add = (): void => {
    setCharacter((previous) => ({
      ...previous,
      conditions: addCondition(previous.conditions, typed),
    }));
    setTyped('');
  };

  return (
    <Panel title="Conditions">
      {character.conditions.length === NONE ? (
        <EmptyNote>None.</EmptyNote>
      ) : (
        <ul className="chips">
          {character.conditions.map((condition) => (
            <li key={condition} className="chip">
              <span>{condition}</span>
              <RemoveRowButton
                label={`Remove ${condition}`}
                onClick={() =>
                  setCharacter((previous) => ({
                    ...previous,
                    conditions: removeCondition(previous.conditions, condition),
                  }))
                }
              />
            </li>
          ))}
        </ul>
      )}

      <div className="row-actions">
        <TextField
          label="New condition"
          hideLabel
          placeholder="Condition"
          value={typed}
          maxLength={MAX_CONDITION_LENGTH}
          onChange={setTyped}
        />
        <AddRowButton label="Add" disabled={full || typed.trim() === ''} onClick={add} />
      </div>
    </Panel>
  );
}
