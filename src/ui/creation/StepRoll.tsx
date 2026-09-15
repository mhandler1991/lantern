/**
 * The roll half of "roll or choose" (#35). One strip above each step, and the step's own
 * panel below it is the choose half.
 *
 * **Why a strip and not a button inside each panel.** The walkthrough renders the sheet's
 * panels unchanged (`ui/creation/Walkthrough.tsx`), and a roll button added to
 * `AbilitiesPanel` would appear on the sheet too — where rolling your strength again in
 * the middle of a session is not an offer anybody wants. Creation is the moment these
 * rolls belong to, so they live in creation and the panels stay exactly as Phase 1 left
 * them.
 *
 * **Every roll goes through the corner.** Nothing here draws its own number: each button
 * asks `state/use-rolls.ts` for dice, gets the entry back, and writes down the number
 * that is already on screen in the overlay (DESIGN.md §4). There is no second source of
 * randomness in the app and this does not become one.
 *
 * **What is rolled, and where it comes from:**
 *
 *   - **Abilities** roll `ABILITY_ROLL_NOTATION`. The app carries that default because
 *     the pack format describes content and has nowhere to put a creation rule.
 *   - **Ancestry, class, alignment, gear, light, spells** roll *among the options the
 *     loaded packs offer* — a die with as many faces as there are choices
 *     (`model/dice.ts`). So a supplement being on changes what can come up, with nothing
 *     here knowing anything about which packs are loaded.
 *   - **Hit points** roll the class's own `hitDie`, which is a pack's answer
 *     (DATA-MODEL.md §5) and absent when no loaded pack gives one. The die is written
 *     down beside the number so a class changed afterwards can be reported (issue 161).
 *   - **Talents** get no strip: `TalentsPanel` already rolls the class's talent table
 *     from inside the step, and a table roll arrives from context rather than from a
 *     second button beside it (DESIGN.md §4).
 *
 * 🚫 A rolled ability score is written into the box the player was going to type in, and
 * that is the whole of it. Nothing is derived from it, nothing else moves, and every one
 * of these boxes is still editable afterwards — the dice are an offer, not an authority
 * (PRD.md principle 1).
 */

import type { ReactElement, ReactNode } from 'react';
import {
  ABILITY_ROLL_NOTATION,
  MAX_ITEMS,
  MAX_LIGHTS,
  MAX_SPELLS_KNOWN,
  MAX_STAT,
  MIN_STAT,
} from '../../constants';
import type { Stat } from '../../model/character';
import { rollTotal } from '../../model/dice';
import { Alignment } from '../../model/enums';
import { hitDieFor } from '../../model/pack-resolver';
import {
  appendRow,
  clampInt,
  isAtLimit,
  newItem,
  newLight,
  newSpell,
  setHitPoints,
  setStat,
} from '../../state/character-edits';
import type { Choice } from '../choices';
import { displayName } from '../choices';
import { RollButton } from '../fields';
import type { ContentProps, PanelProps, RollsProps, StackProps } from '../sheet/sheet-props';
import type { CreationStepId } from './creation';
import { canRollAmong, pickedBy } from './rolling';

/** DATA-MODEL.md §2 — the six, in the order every sheet prints them, and their words. */
const ABILITIES: readonly (readonly [Stat, string])[] = [
  ['str', 'Strength'],
  ['dex', 'Dexterity'],
  ['con', 'Constitution'],
  ['int', 'Intelligence'],
  ['wis', 'Wisdom'],
  ['cha', 'Charisma'],
];

export type StepRollProps = PanelProps &
  ContentProps &
  StackProps &
  RollsProps & {
    readonly step: CreationStepId;
  };

/** What a strip offers, or nothing at all when this step has nothing to throw. */
export function StepRoll({
  step,
  character,
  setCharacter,
  stack,
  choices,
  rolls,
}: StepRollProps): ReactElement | null {
  /**
   * Roll among a list and hand the option back. The entry is read rather than the list
   * being sampled here, so what lands on the sheet is what the corner is showing.
   */
  function rollAmong(options: readonly Choice[], label: string): Choice | null {
    const entry = rolls.rollAmong(options.length, label);
    return entry === null ? null : pickedBy(options, entry);
  }

  function rollAbility(stat: Stat, label: string): void {
    const entry = rolls.rollNotation(ABILITY_ROLL_NOTATION, label);
    if (entry === null) return;

    // Clamped to what the schema will hold, so a roll can never make a sheet unsaveable.
    // No notation this app offers can reach either bound; the clamp is the guarantee.
    const score = clampInt(rollTotal(entry.roll), MIN_STAT, MAX_STAT);
    setCharacter((previous) => setStat(previous, stat, score));
  }

  function rollEveryAbility(): void {
    for (const [stat, label] of ABILITIES) rollAbility(stat, label);
  }

  if (step === 'abilities') {
    return (
      <Strip say={`Roll ${ABILITY_ROLL_NOTATION} for a score, or type in what you rolled elsewhere.`}>
        <RollButton
          text="Roll all six"
          label={`Roll ${ABILITY_ROLL_NOTATION} for every ability`}
          onClick={rollEveryAbility}
        />
        {ABILITIES.map(([stat, label]) => (
          <RollButton
            key={stat}
            text={label}
            label={`Roll ${ABILITY_ROLL_NOTATION} for ${label}`}
            onClick={() => rollAbility(stat, label)}
          />
        ))}
      </Strip>
    );
  }

  if (step === 'identity') {
    // The three are a closed enum, so this list is the model's rather than this file's.
    const alignments: readonly Choice[] = Alignment.options.map((alignment) => ({
      ref: alignment,
      label: alignment,
    }));

    return (
      <Strip say="Let the dice decide, or pick below. Either way it stays editable.">
        {canRollAmong(choices.ancestries.length) && (
          <RollButton
            text="Roll ancestry"
            label={`Roll among the ${choices.ancestries.length} ancestries the loaded packs offer`}
            onClick={() => {
              const picked = rollAmong(choices.ancestries, 'Ancestry');
              if (picked === null) return;

              setCharacter((previous) => ({
                ...previous,
                ancestry: { ref: picked.ref, name: '' },
              }));
            }}
          />
        )}
        {canRollAmong(choices.classes.length) && (
          <RollButton
            text="Roll class"
            label={`Roll among the ${choices.classes.length} classes the loaded packs offer`}
            onClick={() => {
              const picked = rollAmong(choices.classes, 'Class');
              if (picked === null) return;

              setCharacter((previous) => ({ ...previous, class: { ref: picked.ref, name: '' } }));
            }}
          />
        )}
        <RollButton
          text="Roll alignment"
          label="Roll among the three alignments"
          onClick={() => {
            const picked = rollAmong(alignments, 'Alignment');
            if (picked === null) return;

            const alignment = Alignment.safeParse(picked.ref);
            if (!alignment.success) return;

            setCharacter((previous) => ({ ...previous, alignment: alignment.data }));
          }}
        />
      </Strip>
    );
  }

  if (step === 'vitals') {
    const hitDie = hitDieFor(stack, character.class.ref);
    if (hitDie === null) {
      return (
        <Strip say="No loaded pack says what this character's class rolls for hit points, so this one is typed in." />
      );
    }

    const className = displayName(stack, character.class.ref, character.class.name);

    return (
      <Strip say={`${className} rolls ${hitDie} for hit points, or type in what you have.`}>
        <RollButton
          text={`Roll ${hitDie}`}
          label={`Roll ${hitDie} for hit points`}
          onClick={() => {
            const entry = rolls.rollNotation(hitDie, 'Hit points');
            if (entry === null) return;

            // Both halves, because a character who has not been hit yet is at full. The
            // two are separate fields and stay separately editable (DATA-MODEL.md §12).
            //
            // The die goes down with the number. It is a record and nothing else: it
            // never re-rolls anything and never rewrites the total, and it is what lets
            // a class changed afterwards be reported rather than guessed at
            // (`ui/creation/consequences.ts`). Typing over the box clears it.
            const rolled = rollTotal(entry.roll);
            setCharacter((previous) =>
              setHitPoints(previous, { max: rolled, current: rolled }, hitDie),
            );
          }}
        />
      </Strip>
    );
  }

  if (step === 'gear') {
    if (!canRollAmong(choices.items.length)) return null;

    return (
      <Strip say="Roll for something to carry, or add what you want below.">
        <RollButton
          text="Roll for an item"
          label={`Roll among the ${choices.items.length} items the loaded packs offer`}
          disabled={isAtLimit(character.items, MAX_ITEMS)}
          onClick={() => {
            const picked = rollAmong(choices.items, 'An item');
            if (picked === null) return;

            setCharacter((previous) => ({
              ...previous,
              items: appendRow(previous.items, newItem(picked.ref), MAX_ITEMS),
            }));
          }}
        />
      </Strip>
    );
  }

  if (step === 'light') {
    if (!canRollAmong(choices.lights.length)) return null;

    return (
      <Strip say="Roll for what you carry to see by, or pick it below.">
        <RollButton
          text="Roll for a light"
          label={`Roll among the ${choices.lights.length} lights the loaded packs offer`}
          disabled={isAtLimit(character.lights, MAX_LIGHTS)}
          onClick={() => {
            const picked = rollAmong(choices.lights, 'A light');
            if (picked === null) return;

            setCharacter((previous) => ({
              ...previous,
              lights: appendRow(previous.lights, newLight(picked.ref), MAX_LIGHTS),
            }));
          }}
        />
      </Strip>
    );
  }

  if (step === 'spells') {
    if (!canRollAmong(choices.spells.length)) return null;

    return (
      <Strip say="Roll for a spell from what this class can learn, or choose one below.">
        <RollButton
          text="Roll for a spell"
          label={`Roll among the ${choices.spells.length} spells the loaded packs offer`}
          disabled={isAtLimit(character.spells, MAX_SPELLS_KNOWN)}
          onClick={() => {
            const picked = rollAmong(choices.spells, 'A spell');
            if (picked === null) return;

            setCharacter((previous) => ({
              ...previous,
              spells: appendRow(previous.spells, newSpell(picked.ref), MAX_SPELLS_KNOWN),
            }));
          }}
        />
      </Strip>
    );
  }

  // Talents roll their class's table from inside the panel, and the review rolls
  // nothing at all.
  return null;
}

/** The strip itself: one line saying what the dice are for, and the dice. */
function Strip({
  say,
  children,
}: {
  readonly say: string;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <div className="step-roll">
      <p className="step-roll__say">{say}</p>
      {children !== undefined && <div className="step-roll__dice">{children}</div>}
    </div>
  );
}
