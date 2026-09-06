/**
 * The sheet: every panel, and the one place derived values are computed.
 *
 * Modifiers, AC, carry and level progress are computed here with `useMemo` and passed
 * down (CLAUDE.md §6 — deriving state in an effect is a bug, and storing a derived value
 * guarantees drift). Computing them once also means two panels showing the same number
 * cannot disagree: the slot count in the gear banner and the coin line below it are the
 * same object.
 *
 * The orphan report comes in from above rather than being computed here, because it is
 * a question about the packs that are loaded and the sheet is not where that list lives.
 * Panels that hold a reference take it; `TalentsPanel` does not, and that omission is
 * the point — a talent stored its words so that turning a pack off costs it nothing.
 *
 * `NO_PACKS` is the honest state of Phase 1: nothing is loaded, so nothing resolves, and
 * every calculation falls back to what the player wrote on the row. Phase 2 replaces it
 * with the pack resolver and nothing else here changes — which is why `derived.ts` takes
 * the lookup as an argument rather than importing one.
 */

import type { ReactElement } from 'react';
import { useMemo } from 'react';
import type { ItemLookup } from '../../model/derived';
import {
  abilityModifiers,
  computeArmorClass,
  computeCarry,
  computeLevelProgress,
} from '../../model/derived';
import { AbilitiesPanel } from './AbilitiesPanel';
import { ConditionsPanel } from './ConditionsPanel';
import { GearPanel } from './GearPanel';
import { IdentityPanel } from './IdentityPanel';
import { JournalPanel } from './JournalPanel';
import { LightsPanel } from './LightsPanel';
import { QuestsPanel } from './QuestsPanel';
import type { OrphanProps, PanelProps } from './sheet-props';
import { SpellsPanel } from './SpellsPanel';
import { TalentsPanel } from './TalentsPanel';
import { VitalsPanel } from './VitalsPanel';

/** No pack is loaded until Phase 2, so no reference resolves to anything. */
const NO_PACKS: ItemLookup = () => null;

export function CharacterSheet({
  character,
  setCharacter,
  orphans,
}: PanelProps & OrphanProps): ReactElement {
  const modifiers = useMemo(() => abilityModifiers(character.stats), [character.stats]);
  const armor = useMemo(() => computeArmorClass(character, NO_PACKS), [character]);
  const carry = useMemo(() => computeCarry(character, NO_PACKS), [character]);
  const progress = useMemo(() => computeLevelProgress(character), [character]);

  return (
    <div className="sheet">
      <div className="sheet__column">
        <IdentityPanel
          character={character}
          setCharacter={setCharacter}
          orphans={orphans}
          progress={progress}
        />
        <AbilitiesPanel
          character={character}
          setCharacter={setCharacter}
          modifiers={modifiers}
        />
        <VitalsPanel character={character} setCharacter={setCharacter} armor={armor} />
        <ConditionsPanel character={character} setCharacter={setCharacter} />
      </div>

      <div className="sheet__column">
        <GearPanel
          character={character}
          setCharacter={setCharacter}
          orphans={orphans}
          carry={carry}
        />
        <LightsPanel character={character} setCharacter={setCharacter} orphans={orphans} />
        <SpellsPanel character={character} setCharacter={setCharacter} orphans={orphans} />
      </div>

      <div className="sheet__column">
        <TalentsPanel character={character} setCharacter={setCharacter} />
        <QuestsPanel character={character} setCharacter={setCharacter} />
        <JournalPanel character={character} setCharacter={setCharacter} />
      </div>
    </div>
  );
}
