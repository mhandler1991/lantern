/**
 * Light sources, when each one was lit, and how much of it is left.
 *
 * Lighting a torch records the wall-clock moment and nothing else. There is no counter
 * decremented here, deliberately: what is left is computed from that timestamp every
 * render (`model/light.ts`), and the render is driven by a clock that re-reads
 * `Date.now()` rather than counting its own ticks (`state/use-light-clock.ts`). A page
 * reload and twenty minutes in a background tab are therefore the same case — both are
 * just a later `now` against the same stored `litAt` (DESIGN.md §6, DATA-MODEL.md §12).
 *
 * A light source is an item, so the picker offers the items a loaded pack says give
 * light (DATA-MODEL.md §4) and a picked row is a reference and nothing else. Both of the
 * numbers on such a row then come from the pack: the name, and how long it burns — so
 * both boxes are read only while a pack answers, and both go back to the row's own words
 * and the row's own `minutes` the moment it is turned off. What never changes is that it
 * can be lit: a torch a player cannot light because a supplement was turned off would be
 * the app blocking play rather than warning about it (PRD.md principle 4).
 *
 * The bar is `aria-hidden`: it draws the same fact the countdown beside it already says
 * in words, and a per-second live region would announce a torch over the top of
 * everything else on the sheet.
 */

import type { ReactElement } from 'react';
import { MAX_LIGHT_MINUTES, MAX_LIGHTS, MAX_NAME_LENGTH, MIN_LIGHT_MINUTES } from '../../constants';
import { computeBurn, packBurnMinutes } from '../../model/light';
import { packOfRef } from '../../model/orphans';
import { appendRow, isAtLimit, newLight, removeRow, updateRow } from '../../state/character-edits';
import { useLightClock } from '../../state/use-light-clock';
import { displayName } from '../choices';
import {
  AddFromPack,
  AddRowButton,
  EmptyNote,
  NumberField,
  OrphanMark,
  Panel,
  RemoveRowButton,
  TextField,
} from '../fields';
import { describeBurn } from '../format';
import type { ContentProps, ItemsProps, OrphanProps, PanelProps } from './sheet-props';

/** Nothing carried yet. A floor, not a business rule. */
const NONE = 0;

export function LightsPanel({
  character,
  setCharacter,
  orphans,
  stack,
  choices,
  items,
}: PanelProps & OrphanProps & ContentProps & ItemsProps): ReactElement {
  const full = isAtLimit(character.lights, MAX_LIGHTS);
  const now = useLightClock(character.lights, items);

  return (
    <Panel title="Light">
      {character.lights.length === NONE ? (
        <EmptyNote>Nothing to burn.</EmptyNote>
      ) : (
        <ul className="rows">
          {character.lights.map((light) => {
            const burn = computeBurn(light, now, items);
            const isOrphaned = orphans.rows.has(light.id);
            const label = displayName(stack, light.ref, light.name);
            const packMinutes = packBurnMinutes(light, items);

            return (
              <li
                key={light.id}
                className={isOrphaned ? 'row row--light row--orphaned' : 'row row--light'}
              >
                <TextField
                  label="Light source"
                  hideLabel
                  placeholder="Torch"
                  value={label}
                  maxLength={MAX_NAME_LENGTH}
                  readOnly={light.ref !== null}
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
                  value={packMinutes ?? light.minutes}
                  min={MIN_LIGHT_MINUTES}
                  max={MAX_LIGHT_MINUTES}
                  readOnly={packMinutes !== null}
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
                  label={`Remove ${label === '' ? 'this light' : label}`}
                  onClick={() =>
                    setCharacter((previous) => ({
                      ...previous,
                      lights: removeRow(previous.lights, light.id),
                    }))
                  }
                />
                {isOrphaned && light.ref !== null && <OrphanMark pack={packOfRef(light.ref)} />}
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
        {choices.lights.length > NONE && (
          <AddFromPack
            label="Add a light from a pack"
            choices={choices.lights}
            disabled={full}
            onAdd={(ref) =>
              setCharacter((previous) => ({
                ...previous,
                lights: appendRow(previous.lights, newLight(ref), MAX_LIGHTS),
              }))
            }
          />
        )}
      </div>
    </Panel>
  );
}
