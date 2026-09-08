/**
 * The walkthrough: the sheet's own panels, one at a time, with a prompt above each and
 * a way forward and back.
 *
 * It renders the panels rather than reimplementing them, and that is the whole design
 * (`ui/creation/creation.ts`). A step is not a form that produces a character at the
 * end — it is the sheet with everything but one panel put away. So the ability scores a
 * player types on step one are on the sheet the instant they are typed, saved by the
 * same debounced autosave and validated by the same schema, and closing the tab
 * halfway costs a player the *place they were at* and nothing else. That is what
 * `state/use-creation.ts` stores, and it is all it stores.
 *
 * The consequences are worth stating, because they are what make this cheap:
 *
 *   - **Nothing is committed at the end.** Finishing puts the sheet back and clears the
 *     bookmark. There is no draft to reconcile and no half-written character anywhere.
 *   - **Every panel keeps its rules.** Slots are counted, AC is derived, a pack that is
 *     off marks its rows — because these are the same components, handed the same
 *     derived values by the same hook the sheet uses (`ui/sheet/derivations.ts`).
 *   - **There is always a way out.** Leaving is offered at every step and never asks
 *     twice: the sheet is right there, complete, with everything already on it
 *     (PRD.md principle 4). A walkthrough a player cannot leave is a walkthrough that
 *     has taken their sheet hostage.
 *
 * **Roll or choose** (#35) is the strip above each panel: `ui/creation/StepRoll.tsx`
 * offers the dice, the panel below is where the same thing is picked by hand, and every
 * option in it says which pack supplied it. The rolls belong to creation rather than to
 * the panels, which is why they are a strip here and not a button inside `AbilitiesPanel`
 * — the sheet is unchanged by any of it.
 *
 * The review step is the only one that is not a panel of the sheet's, and it does two
 * things: it lists what is still blank — a report, never a gate — and it says out loud
 * whether the character validates, which is the acceptance criterion for this step of
 * the build made visible rather than merely tested.
 */

import type { ReactElement } from 'react';
import { useMemo } from 'react';
import type { Character } from '../../model/character';
import { parseCharacter } from '../../model/character';
import { Panel } from '../fields';
import { ProblemReport } from '../ProblemReport';
import { AbilitiesPanel } from '../sheet/AbilitiesPanel';
import type { SheetDerivations } from '../sheet/derivations';
import { useSheetDerivations } from '../sheet/derivations';
import { GearPanel } from '../sheet/GearPanel';
import { IdentityPanel } from '../sheet/IdentityPanel';
import { LightsPanel } from '../sheet/LightsPanel';
import type { OrphanProps, PanelProps, RollsProps, StackProps } from '../sheet/sheet-props';
import { SpellsPanel } from '../sheet/SpellsPanel';
import { TalentsPanel } from '../sheet/TalentsPanel';
import { VitalsPanel } from '../sheet/VitalsPanel';
import type { CreationStepId } from './creation';
import { StepRoll } from './StepRoll';
import {
  CREATION_STEPS,
  nextOf,
  outstanding,
  positionOf,
  previousOf,
  stepAt,
  stepCount,
} from './creation';

/** An empty list. A floor, not a business rule. */
const NONE = 0;

export type WalkthroughProps = PanelProps &
  OrphanProps &
  StackProps &
  RollsProps & {
    readonly step: CreationStepId;
    readonly onGo: (step: CreationStepId) => void;
    /** Finishing and giving up are the same call; only the label differs. */
    readonly onLeave: () => void;
    /** False when the browser refused storage, and the position will not survive. */
    readonly canResume: boolean;
  };

/**
 * The last step: what is still blank, and whether the sheet validates.
 *
 * The parse is the sheet's own — the same call `saveCharacter` makes on every write —
 * so a green line here means the character on screen is one that loads back. It is
 * shown rather than merely asserted because a player who has just built something is
 * owed the answer to "is this actually saved", and this is the moment they ask it.
 */
function ReviewStep({ character }: { readonly character: Character }): ReactElement {
  const missing = useMemo(() => outstanding(character), [character]);
  const parsed = useMemo(() => parseCharacter(character), [character]);

  return (
    <Panel title="Review">
      {missing.length === NONE ? (
        <p className="readout">Nothing is left blank. Every step has something in it.</p>
      ) : (
        <>
          <p className="readout">
            Still blank. None of it stops you finishing — a character can be filled in at
            the table, and every one of these is a legal thing for a sheet to hold:
          </p>
          <ul className="walkthrough__missing">
            {missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      )}

      {parsed.ok ? (
        <p className="readout" role="status">
          This sheet validates and is saved in this browser. Closing the tab will not
          lose it — and the character file panel writes it out to a file you keep.
        </p>
      ) : (
        <>
          <p className="warning" role="alert">
            The sheet does not validate, which is a bug in Lantern rather than something
            you did. Nothing has been lost — the paths below say where, and the button
            copies them for an issue:
          </p>
          <ProblemReport subject="the sheet" problems={parsed.problems} />
        </>
      )}
    </Panel>
  );
}

/**
 * One step: what it offers to roll, and the panel it is choosing in.
 *
 * Both halves read the same `choices`, built once here. The pack label is `always`, which
 * is the one thing creation asks of them that the sheet does not — issue #35's third
 * criterion, argued in `ui/choices.ts`: during creation an option's pack is the point,
 * and on the sheet it is noise.
 */
function StepBody({
  step,
  character,
  setCharacter,
  orphans,
  stack,
  rolls,
}: Omit<WalkthroughProps, 'onGo' | 'onLeave' | 'canResume'>): ReactElement {
  const { items, modifiers, armor, carry, progress, choices, casting } = useSheetDerivations(
    character,
    stack,
    'always',
  );

  return (
    <>
      <StepRoll
        step={step}
        character={character}
        setCharacter={setCharacter}
        stack={stack}
        choices={choices}
        rolls={rolls}
      />
      <StepPanel
        step={step}
        character={character}
        setCharacter={setCharacter}
        orphans={orphans}
        stack={stack}
        rolls={rolls}
        derived={{ items, modifiers, armor, carry, progress, choices, casting }}
      />
    </>
  );
}

/** The choose half: a panel of the sheet's, unchanged, or the review. */
function StepPanel({
  step,
  character,
  setCharacter,
  orphans,
  stack,
  rolls,
  derived,
}: Omit<WalkthroughProps, 'onGo' | 'onLeave' | 'canResume'> & {
  readonly derived: SheetDerivations;
}): ReactElement {
  const { items, modifiers, armor, carry, progress, choices, casting } = derived;

  switch (step) {
    case 'abilities':
      return (
        <AbilitiesPanel character={character} setCharacter={setCharacter} modifiers={modifiers} />
      );
    case 'identity':
      return (
        <IdentityPanel
          character={character}
          setCharacter={setCharacter}
          orphans={orphans}
          stack={stack}
          choices={choices}
          progress={progress}
        />
      );
    case 'vitals':
      return <VitalsPanel character={character} setCharacter={setCharacter} armor={armor} />;
    case 'talents':
      return (
        <TalentsPanel
          character={character}
          setCharacter={setCharacter}
          stack={stack}
          choices={choices}
          rolls={rolls}
        />
      );
    case 'gear':
      return (
        <GearPanel
          character={character}
          setCharacter={setCharacter}
          orphans={orphans}
          stack={stack}
          choices={choices}
          rolls={rolls}
          carry={carry}
        />
      );
    case 'light':
      return (
        <LightsPanel
          character={character}
          setCharacter={setCharacter}
          orphans={orphans}
          stack={stack}
          choices={choices}
          items={items}
        />
      );
    case 'spells':
      return (
        <SpellsPanel
          character={character}
          setCharacter={setCharacter}
          orphans={orphans}
          stack={stack}
          choices={choices}
          casting={casting}
        />
      );
    case 'review':
      return <ReviewStep character={character} />;
  }
}

export function Walkthrough({
  step,
  onGo,
  onLeave,
  canResume,
  ...panel
}: WalkthroughProps): ReactElement {
  const current = stepAt(step);
  const previous = previousOf(step);
  const next = nextOf(step);

  return (
    <section className="walkthrough" aria-label="Making a character">
      <div className="walkthrough__head">
        <h2 className="walkthrough__title">Making a character</h2>
        <p className="walkthrough__position">
          Step {positionOf(step)} of {stepCount()} — {current.title}
        </p>
        <ol className="walkthrough__steps">
          {CREATION_STEPS.map((entry) => (
            <li
              key={entry.id}
              className={
                entry.id === step ? 'walkthrough__step walkthrough__step--here' : 'walkthrough__step'
              }
              aria-current={entry.id === step ? 'step' : undefined}
            >
              {entry.title}
            </li>
          ))}
        </ol>
      </div>

      <p className="prompt">{current.prompt}</p>

      {!canResume && (
        <p className="warning">
          This browser is not letting Lantern remember where you got to, so closing the
          tab will start the walkthrough over. Everything you enter still reaches the
          sheet.
        </p>
      )}

      <StepBody step={step} {...panel} />

      <div className="row-actions walkthrough__actions">
        <button
          type="button"
          className="button"
          disabled={previous === null}
          onClick={() => {
            if (previous !== null) onGo(previous);
          }}
        >
          Back
        </button>

        {next === null ? (
          <button type="button" className="button" onClick={onLeave}>
            Finish
          </button>
        ) : (
          <>
            <button type="button" className="button" onClick={() => onGo(next)}>
              Next: {stepAt(next).title}
            </button>
            <button type="button" className="button" onClick={onLeave}>
              Leave the walkthrough
            </button>
          </>
        )}
      </div>
    </section>
  );
}
