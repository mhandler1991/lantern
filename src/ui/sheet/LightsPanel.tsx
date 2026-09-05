/**
 * Light sources, when each one was lit, and how much of it is left.
 *
 * Lighting a torch records the wall-clock moment and nothing else. There is no counter
 * decremented here, deliberately: what is left is computed from that timestamp every
 * render (`model/light.ts`), and the render is driven by a clock that re-reads
 * `Date.now()` rather than counting its own ticks (`state/use-light-clock.ts`). A page
 * reload and twenty minutes in a background tab are therefore the same case — both are
 * just a later `now` against the same stored `litAt` (DESIGN.md §6, DATA-MODEL.md §11).
 *
 * The bar is `aria-hidden`: it draws the same fact the countdown beside it already says
 * in words, and a per-second live region would announce a torch over the top of
 * everything else on the sheet.
 */

import type { ReactElement } from 'react';
import { MAX_LIGHT_MINUTES, MAX_LIGHTS, MAX_NAME_LENGTH } from '../../constants';
import { computeBurn } from '../../model/light';
import { appendRow, isAtLimit, newLight, removeRow, updateRow } from '../../state/character-edits';
import { useLightClock } from '../../state/use-light-clock';
import { AddRowButton, EmptyNote, NumberField, Panel, RemoveRowButton, TextField } from '../fields';
import { describeBurn } from '../format';
import type { PanelProps } from './sheet-props';

/** Nothing carried yet. A floor, not a business rule. */
const NONE = 0;

export function LightsPanel({ character, setCharacter }: PanelProps): ReactElement {
  const full = isAtLimit(character.lights, MAX_LIGHTS);
  const now = useLightClock(character.lights);

  return (
    <Panel title="Light">
      {character.lights.length === NONE ? (
        <EmptyNote>Nothing to burn.</EmptyNote>
      ) : (
        <ul className="rows">
          {character.lights.map((light) => {
            const burn = computeBurn(light, now);

            return (
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
                <div className={burn.isSpent ? 'light light--spent' : 'light'}>
                  <div className="light__bar" aria-hidden="true">
                    <div
                      className="light__bar-fill"
                      style={{ width: `${burn.percentRemaining}%` }}
                    />
                  </div>
                  <span className="light__remaining">{describeBurn(burn)}</span>
                </div>
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
            );
          })}
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
