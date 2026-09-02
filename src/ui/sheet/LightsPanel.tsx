/**
 * Light sources, and when each one was lit.
 *
 * Lighting a torch records the wall-clock moment and nothing else. There is no counter
 * to decrement here, deliberately: how much is left is computed from that timestamp, so
 * a backgrounded tab cannot drift it (DATA-MODEL.md §11). The countdown itself, and the
 * room dimming with it, is issue #14 — this panel is the record it reads from.
 */

import type { ReactElement } from 'react';
import { MAX_LIGHT_MINUTES, MAX_LIGHTS, MAX_NAME_LENGTH } from '../../constants';
import { appendRow, isAtLimit, newLight, removeRow, updateRow } from '../../state/character-edits';
import { AddRowButton, EmptyNote, NumberField, Panel, RemoveRowButton, TextField } from '../fields';
import { formatMoment } from '../format';
import type { PanelProps } from './sheet-props';

/** Nothing carried yet. A floor, not a business rule. */
const NONE = 0;

export function LightsPanel({ character, setCharacter }: PanelProps): ReactElement {
  const full = isAtLimit(character.lights, MAX_LIGHTS);

  return (
    <Panel title="Light">
      {character.lights.length === NONE ? (
        <EmptyNote>Nothing to burn.</EmptyNote>
      ) : (
        <ul className="rows">
          {character.lights.map((light) => (
            <li key={light.id} className="row row--light">
              <TextField
                label="Light source"
                hideLabel
                placeholder="Torch"
                value={light.name}
                maxLength={MAX_NAME_LENGTH}
                onChange={(name) =>
                  setCharacter((previous) => ({
                    ...previous,
                    lights: updateRow(previous.lights, light.id, { name }),
                  }))
                }
              />
              <NumberField
                label="Minutes"
                hideLabel
                value={light.minutes}
                min={1}
                max={MAX_LIGHT_MINUTES}
                onChange={(minutes) =>
                  setCharacter((previous) => ({
                    ...previous,
                    lights: updateRow(previous.lights, light.id, { minutes }),
                  }))
                }
              />
              <button
                type="button"
                className="button"
                onClick={() =>
                  setCharacter((previous) => ({
                    ...previous,
                    lights: updateRow(previous.lights, light.id, {
                      litAt: light.litAt === null ? Date.now() : null,
                    }),
                  }))
                }
              >
                {light.litAt === null ? 'Light it' : 'Put it out'}
              </button>
              <span className="provenance">
                {light.litAt === null ? 'unlit' : `lit ${formatMoment(light.litAt)}`}
              </span>
              <RemoveRowButton
                label={`Remove ${light.name === '' ? 'this light' : light.name}`}
                onClick={() =>
                  setCharacter((previous) => ({
                    ...previous,
                    lights: removeRow(previous.lights, light.id),
                  }))
                }
              />
            </li>
          ))}
        </ul>
      )}

      <div className="row-actions">
        <AddRowButton
          label="Add light source"
          disabled={full}
          onClick={() =>
            setCharacter((previous) => ({
              ...previous,
              lights: appendRow(previous.lights, newLight(), MAX_LIGHTS),
            }))
          }
        />
      </div>
    </Panel>
  );
}
