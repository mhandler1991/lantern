/**
 * Hit points, armour class and luck.
 *
 * HP is two numbers the player owns outright — `current` may sit above `max` after a
 * blessing and below zero when things have gone badly, and the sheet records both
 * rather than deciding they cannot be so (DATA-MODEL.md §11).
 *
 * AC is the opposite: it is read-only here because it is computed from equipped armour
 * (CLAUDE.md §4). Until a pack defines an item, nothing equipped supplies armour and the
 * number is the unarmoured one — which the panel says out loud rather than leaving a
 * player to wonder why their plate mail changed nothing.
 */

import type { ReactElement } from 'react';
import { MAX_HP, MAX_LUCK } from '../../constants';
import type { ArmorClass } from '../../model/derived';
import { setHitPoints } from '../../state/character-edits';
import { NumberField, Panel } from '../fields';
import { formatModifier } from '../format';
import type { PanelProps } from './sheet-props';

/** Nothing left. A floor, not a business rule. */
const NONE = 0;

export function VitalsPanel({
  character,
  setCharacter,
  armor,
}: PanelProps & { readonly armor: ArmorClass }): ReactElement {
  return (
    <Panel title="Vitals" aside={`AC ${armor.ac}`}>
      <div className="panel__grid">
        <NumberField
          label="HP now"
          value={character.hp.current}
          min={-MAX_HP}
          max={MAX_HP}
          onChange={(current) => setCharacter((previous) => setHitPoints(previous, { current }))}
        />
        <NumberField
          label="HP max"
          value={character.hp.max}
          min={NONE}
          max={MAX_HP}
          onChange={(max) => setCharacter((previous) => setHitPoints(previous, { max }))}
        />
        <NumberField
          label="Luck"
          value={character.luck}
          min={NONE}
          max={MAX_LUCK}
          onChange={(luck) => setCharacter((previous) => ({ ...previous, luck }))}
        />
      </div>

      <p className="readout">
        {armor.isUnarmored
          ? 'Unarmoured. Armour is read from equipped gear, which needs a content pack.'
          : `Armour worn${armor.shieldBonus > NONE ? `, shield ${formatModifier(armor.shieldBonus)}` : ''}.`}
      </p>
    </Panel>
  );
}
