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
 * A light source is an item, so the picker offers what the loaded packs hold and a
 * picked row is a reference and nothing else. Only the name is read only on such a row:
 * `minutes` is the row's own number — nothing in a pack says how long a light burns
 * (DATA-MODEL.md §4) — so it stays editable whether the pack is on or off, and so does
 * lighting it. A torch a player cannot light because a supplement was turned off would
 * be the app blocking play rather than warning about it (PRD.md principle 4).
 *
 * The bar is `aria-hidden`: it draws the same fact the countdown beside it already says
 * in words, and a per-second live region would announce a torch over the top of
 * everything else on the sheet.
 */

import type { ReactElement } from 'react';
import { MAX_LIGHT_MINUTES, MAX_LIGHTS, MAX_NAME_LENGTH } from '../../constants';
import { computeBurn } from '../../model/light';
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
import type { ContentProps, OrphanProps, PanelProps } from './sheet-props';

/** Nothing carried yet. A floor, not a business rule. */
const NONE = 0;

export function LightsPanel({
  character,
  setCharacter,
  orphans,
  stack,
  choices,
}: PanelProps & OrphanProps & ContentProps): ReactElement {
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
            const isOrphaned = orphans.rows.has(light.id);
            const label = displayName(stack, light.ref, light.name);

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
        {choices.items.length > NONE && (
          <AddFromPack
            label="Add a light from a pack"
            choices={choices.items}
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
