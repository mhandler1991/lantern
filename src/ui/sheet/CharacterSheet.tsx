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
 * The stack of loaded packs arrives the same way and for the same reason. It is what
 * `derived.ts` reads an item's slots and armour through, what a row's name is read back
 * out of, and what the pickers offer — so a pack turned on changes AC, slot counts, the
 * words on referenced rows and every list on the sheet, with nothing stored and nothing
 * copied. `derived.ts` taking its lookup as an argument is what made that one line here
 * rather than a change in every calculation.
 *
 * With no packs loaded the stack is empty, every lookup answers `null`, and the sheet is
 * exactly the Phase 1 sheet: rows priced at what the player wrote on them, and a box to
 * type in wherever a picker would otherwise be (PRD.md principle 6).
 */

import type { ReactElement } from 'react';
import { useMemo } from 'react';
import {
  abilityModifiers,
  computeArmorClass,
  computeCarry,
  computeLevelProgress,
  highestSpellTier,
  spellcastingModifier,
} from '../../model/derived';
import { itemLookup, spellcastingFor } from '../../model/pack-resolver';
import { sheetChoices } from '../choices';
import { AbilitiesPanel } from './AbilitiesPanel';
import { ConditionsPanel } from './ConditionsPanel';
import { GearPanel } from './GearPanel';
import { IdentityPanel } from './IdentityPanel';
import { JournalPanel } from './JournalPanel';
import { LightsPanel } from './LightsPanel';
import { QuestsPanel } from './QuestsPanel';
import type { Casting, OrphanProps, PanelProps, StackProps } from './sheet-props';
import { SpellsPanel } from './SpellsPanel';
import { TalentsPanel } from './TalentsPanel';
import { VitalsPanel } from './VitalsPanel';

export function CharacterSheet({
  character,
  setCharacter,
  orphans,
  stack,
}: PanelProps & OrphanProps & StackProps): ReactElement {
  const items = useMemo(() => itemLookup(stack), [stack]);

  const modifiers = useMemo(() => abilityModifiers(character.stats), [character.stats]);
  const armor = useMemo(() => computeArmorClass(character, items), [character, items]);
  const carry = useMemo(() => computeCarry(character, items), [character, items]);
  const progress = useMemo(() => computeLevelProgress(character), [character]);

  /** Every picker on the sheet, built once so two panels cannot offer two lists. */
  const choices = useMemo(
    () => sheetChoices(stack, character.class.ref),
    [stack, character.class.ref],
  );

  const casting = useMemo<Casting | null>(() => {
    const facts = spellcastingFor(stack, character.class.ref);
    const modifier = spellcastingModifier(character.stats, facts);
    if (facts === null || modifier === null) return null;

    return { stat: facts.stat, modifier, highestTier: highestSpellTier(facts, character.level) };
  }, [stack, character.class.ref, character.stats, character.level]);

  return (
    <div className="sheet">
      <div className="sheet__column">
        <IdentityPanel
          character={character}
          setCharacter={setCharacter}
          orphans={orphans}
          stack={stack}
          choices={choices}
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
          stack={stack}
          choices={choices}
          carry={carry}
        />
        <LightsPanel
          character={character}
          setCharacter={setCharacter}
          orphans={orphans}
          stack={stack}
          choices={choices}
        />
        <SpellsPanel
          character={character}
          setCharacter={setCharacter}
          orphans={orphans}
          stack={stack}
          choices={choices}
          casting={casting}
        />
      </div>

      <div className="sheet__column">
        <TalentsPanel character={character} setCharacter={setCharacter} />
        <QuestsPanel character={character} setCharacter={setCharacter} />
        <JournalPanel character={character} setCharacter={setCharacter} />
      </div>
    </div>
  );
}
