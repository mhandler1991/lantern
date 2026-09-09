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
 * **Going back** (#36) is the progress list: every step in it is a button, so any step is
 * one press away rather than four presses of Back. It costs nothing precisely because
 * there is no draft — the character is the sheet, and a step is only ever a place to
 * stand while looking at one panel of it. So nothing is discarded on the way back and
 * nothing is re-entered on the way forward; the sequence is a route, not a transaction.
 *
 * What going back *can* do is leave a later choice standing under an answer that has
 * moved, and `ui/creation/consequences.ts` is the module that notices. Its findings
 * appear in three places, all of them saying the same thing at different distances: a
 * mark in the progress list so a step that wants attention says so from anywhere, a
 * strip above the panel where the rows themselves are, and the review, which lists every
 * one with a button back to it. 🚫 None of the three removes anything, and the Finish
 * button beside them stays a button that works (PRD.md principle 4).
 *
 * The review step is the only one that is not a panel of the sheet's, and it does three
 * things: it lists what is still blank — a report, never a gate — it lists what no longer
 * follows from the answers above it, and it says out loud whether the character
 * validates, which is the acceptance criterion for this step of the build made visible
 * rather than merely tested.
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
import type { CreationFlag } from './consequences';
import { flagged, flagsFor, hasFlags, stepsFlagged } from './consequences';
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
    /** Any step, from the Back button and from the progress list alike. */
    readonly onGo: (step: CreationStepId) => void;
    /** Finishing and giving up are the same call; only the label differs. */
    readonly onLeave: () => void;
    /** False when the browser refused storage, and the position will not survive. */
    readonly canResume: boolean;
  };

/**
 * What the two halves of a step are handed: everything the panels take, plus the flags
 * computed once above them. Computed once for the same reason every derived value on the
 * sheet is — two components answering "what no longer follows" separately would be two
 * answers to one question the first time either of them drifted.
 */
type StepProps = Omit<WalkthroughProps, 'onLeave' | 'canResume'> & {
  readonly flags: readonly CreationFlag[];
};

/**
 * Rows that were chosen under an answer that has since changed.
 *
 * The wording is doing real work, so it is worth being explicit about: this is a list of
 * things to *look at*, never a list of things to fix. A player who changed class and
 * kept the spells has made a decision the app has no standing to second-guess (PRD.md
 * principle 1), and one who did it by accident needs only to be told. Neither is served
 * by a control that removes a row.
 *
 * `onGo` is passed on the review, where the rows are elsewhere, and left off on the step
 * that owns them, where the panel below is already the place to go.
 */
function Flags({
  flags,
  onGo,
}: {
  readonly flags: readonly CreationFlag[];
  readonly onGo?: (step: CreationStepId) => void;
}): ReactElement | null {
  if (!hasFlags(flags)) return null;

  return (
    <div className="flags" role="status">
      <p className="flags__say">
        Chosen earlier, under answers that have moved since. Everything is still on the
        sheet and nothing here stops you finishing — this is a list to look at:
      </p>
      <ul className="flags__list">
        {flags.map((flag) => (
          <li key={flag.id}>
            <span className="flags__what">{flag.what}</span> — {flag.why}
          </li>
        ))}
      </ul>
      {onGo !== undefined && (
        <div className="row-actions">
          {[...stepsFlagged(flags)].map((flagStep) => (
            <button
              key={flagStep}
              type="button"
              className="button"
              onClick={() => onGo(flagStep)}
            >
              Go to {stepAt(flagStep).title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The last step: what is still blank, what no longer follows, and whether the sheet
 * validates.
 *
 * The parse is the sheet's own — the same call `saveCharacter` makes on every write —
 * so a green line here means the character on screen is one that loads back. It is
 * shown rather than merely asserted because a player who has just built something is
 * owed the answer to "is this actually saved", and this is the moment they ask it.
 */
function ReviewStep({
  character,
  flags,
  onGo,
}: {
  readonly character: Character;
  readonly flags: readonly CreationFlag[];
  readonly onGo: (step: CreationStepId) => void;
}): ReactElement {
  const missing = useMemo(() => outstanding(character), [character]);
  const parsed = useMemo(() => parseCharacter(character), [character]);

  return (
    <Panel title="Review">
      <Flags flags={flags} onGo={onGo} />

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
  flags,
  onGo,
}: StepProps): ReactElement {
  const { items, modifiers, armor, carry, progress, choices, casting } = useSheetDerivations(
    character,
    stack,
    'always',
  );

  // The review lists every flag with a way back to it, so the strip stays off there: the
  // same list twice on one screen would read as two problems.
  const here = flagsFor(flags, step);

  return (
    <>
      {step !== 'review' && <Flags flags={here} />}
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
        flags={flags}
        onGo={onGo}
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
  flags,
  onGo,
  derived,
}: StepProps & {
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
      return <ReviewStep character={character} flags={flags} onGo={onGo} />;
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

  const flags = useMemo(() => flagged(panel.character, panel.stack), [panel.character, panel.stack]);
  const wanting = useMemo(() => stepsFlagged(flags), [flags]);

  return (
    <section className="walkthrough" aria-label="Making a character">
      <div className="walkthrough__head">
        <h2 className="walkthrough__title">Making a character</h2>
        <p className="walkthrough__position">
          Step {positionOf(step)} of {stepCount()} — {current.title}
        </p>
        {/* Every step is a button, which is the whole of "go back to any earlier step":
            there is no draft to discard on the way and nothing to re-enter on the way
            forward, so a step four back is one press rather than four. Forward is open
            for the same reason — nothing in the sequence is a gate, and a player who
            knows what they want to fill in first is not wrong. */}
        <ol className="walkthrough__steps">
          {CREATION_STEPS.map((entry) => (
            <li
              key={entry.id}
              className={
                entry.id === step ? 'walkthrough__step walkthrough__step--here' : 'walkthrough__step'
              }
              aria-current={entry.id === step ? 'step' : undefined}
            >
              <button
                type="button"
                className="walkthrough__jump"
                onClick={() => onGo(entry.id)}
              >
                {entry.title}
                {wanting.has(entry.id) && (
                  <span className="walkthrough__wants"> — look again</span>
                )}
              </button>
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

      <StepBody step={step} flags={flags} onGo={onGo} {...panel} />

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
