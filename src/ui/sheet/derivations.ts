/**
 * Every value the sheet's panels are handed rather than compute: modifiers, AC, carry,
 * level progress, the pickers, and what the class casts on.
 *
 * It was inside `CharacterSheet` until the walkthrough needed the same panels
 * (`ui/creation/Walkthrough.tsx`). Two components computing this separately would be two
 * answers to one question the first time either of them drifted, which is the same
 * reason the sheet computed it in one place to begin with. So it is a hook rather than a
 * prop bundle: it is `useMemo` and nothing else, and it belongs to whoever renders the
 * panels.
 *
 * Derived on read, never stored (CLAUDE.md §4). Every value here changes when a pack is
 * turned on or off, because `model/derived.ts` reads item and class facts through the
 * stack it is given — which is what makes "the pack is off" a different number rather
 * than a stale one.
 */

import { useMemo } from 'react';
import {
  abilityModifiers,
  computeArmorClass,
  computeCarry,
  computeLevelProgress,
  highestSpellTier,
  spellcastingModifier,
} from '../../model/derived';
import type { ArmorClass, Carry, ItemLookup, LevelProgress } from '../../model/derived';
import type { Character, Stat } from '../../model/character';
import type { ResolvedStack } from '../../model/pack-resolver';
import { itemLookup, spellcastingFor } from '../../model/pack-resolver';
import type { SheetChoices } from '../choices';
import { sheetChoices } from '../choices';
import type { Casting } from './sheet-props';

export type SheetDerivations = {
  readonly items: ItemLookup;
  readonly modifiers: Record<Stat, number>;
  readonly armor: ArmorClass;
  readonly carry: Carry;
  readonly progress: LevelProgress;
  readonly choices: SheetChoices;
  readonly casting: Casting | null;
};

export function useSheetDerivations(
  character: Character,
  stack: ResolvedStack,
): SheetDerivations {
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

  return { items, modifiers, armor, carry, progress, choices, casting };
}
