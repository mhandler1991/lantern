/**
 * The corner. One component, for free rolls and table rolls alike (DESIGN.md §4).
 *
 * There is one of these in the app and there is deliberately not a second: a table roll
 * is a roll plus a lookup, so it differs from a free roll by one field on the entry and
 * by one line on the card. Two components would be two places for the same result to be
 * drawn differently, and the corner is meant to be *universally* where dice happen — a
 * player who learns to look there for their own d20 finds a peer's loot roll in the same
 * place.
 *
 * **Nothing here decides a number.** `state/use-rolls.ts` hands over a result that has
 * already been rolled, and this file draws a shape around it. The predecessor project's
 * expensive bugs all lived in the gap between a decided result and an animation trying
 * to reach it; with no physics there is no gap.
 *
 * **A roll that is not yours cannot be touched.** The card for a peer's roll carries no
 * control at all — no dismiss, nothing focusable — and the stylesheet takes it out of
 * the pointer's reach entirely. It leaves on the dwell timer and leaves an entry in the
 * feed behind it, which is DESIGN.md §4's "nobody's screen gets hijacked" written as
 * markup rather than as a promise.
 *
 * 🚫 Every string a pack or a peer supplies — a table row's text, a peer's name, a roll
 * label — reaches the page as a text node (CLAUDE.md §2.6). Nothing here renders markup
 * from a string, and the die shapes are polygons this file owns rather than anything
 * that arrived from outside.
 */

import type { ReactElement } from 'react';
import { useId, useState } from 'react';
import { MAX_DICE_PER_ROLL, MAX_NAME_LENGTH, MAX_ROLL_MODIFIER } from '../constants';
import type { DieRoll, RollVisibility } from '../model/dice';
import { RollVisibility as RollVisibilityEnum, rollTotal } from '../model/dice';
import type { Die } from '../model/enums';
import { Die as DieEnum } from '../model/enums';
import { describeTableRollFailure } from '../model/tables';
import type { RollEntry, RollOrigin, Rolls } from '../state/use-rolls';
import { NumberField, TextField, Warning } from './fields';
import {
  SILHOUETTE_VIEW_BOX,
  describeRollWarning,
  describeVisibility,
  dieLabel,
  dieSilhouette,
  rollNotation,
} from './rolls';

/** No modifier. A floor, not a rule of the game. */
const NONE = 0;

/** One die — the smallest pool anybody rolls. */
const ONE = 1;

/**
 * What the handle offers before anything is chosen. The d20 is the die a Shadowdark
 * session reaches for most, so it costs the fewest clicks to be wrong about.
 */
const DEFAULT_DIE: Die = 'd20';

/**
 * What the handle offers before an audience is chosen. Most rolls at a table are made in
 * front of everybody, and a default of anything narrower would quietly hide rolls the
 * player meant to share — the failure that is not noticed until somebody asks what they
 * got. The choice sticks between rolls, so a run of secret rolls costs one decision.
 */
const DEFAULT_VISIBILITY: RollVisibility = 'everyone';

// ---------------------------------------------------------------------------
// One die
// ---------------------------------------------------------------------------

/**
 * A silhouette with a number in it.
 *
 * The SVG is decoration and says so: the value beside it is the accessible text, and the
 * shape carries `aria-hidden` because "hexagon" is not what a screen reader should read
 * out of a d20 showing 17.
 */
function DieFace({ die }: { readonly die: DieRoll }): ReactElement {
  return (
    <li className="die">
      <svg
        className="die__shape"
        viewBox={SILHOUETTE_VIEW_BOX}
        aria-hidden="true"
        focusable="false"
      >
        <polygon points={dieSilhouette(die.sides)} />
      </svg>
      <span className="die__value" aria-hidden="true">
        {die.value}
      </span>
      <span className="visually-hidden">{`${die.value} on a ${dieLabel(die.sides)}`}</span>
    </li>
  );
}

/** Who rolled it, in the fewest words that make the answer unambiguous. */
function describeRoller(origin: RollOrigin): string {
  return origin.kind === 'mine' ? 'You rolled' : `${origin.who} rolled`;
}

/** A roll's own words, or what it was if nobody named it. */
function describeSubject(entry: RollEntry): string {
  return entry.label.trim() === '' ? rollNotation(entry.roll) : entry.label;
}

// ---------------------------------------------------------------------------
// The corner
// ---------------------------------------------------------------------------

export function DiceOverlay({ rolls }: { readonly rolls: Rolls }): ReactElement {
  const dieId = useId();
  const visibilityId = useId();
  const [isOpen, setOpen] = useState(false);
  const [die, setDie] = useState<Die>(DEFAULT_DIE);
  const [count, setCount] = useState(ONE);
  const [modifier, setModifier] = useState(NONE);
  const [label, setLabel] = useState('');
  const [visibility, setVisibility] = useState<RollVisibility>(DEFAULT_VISIBILITY);

  const { showing } = rolls;
  const isPeerRoll = showing !== null && showing.origin.kind === 'peer';

  return (
    <div className="dice">
      {showing !== null && (
        // Keyed on the entry so a roll landing while another is on screen replaces the
        // card outright rather than reconciling into it — a total from the last roll
        // must never be what is repainted under the new one's dice.
        <div
          key={showing.id}
          className={isPeerRoll ? 'dice__result dice__result--peer' : 'dice__result'}
          role="status"
          aria-live="polite"
        >
          <p className="dice__who">
            {describeRoller(showing.origin)} {describeSubject(showing)}
          </p>

          <ul className="dice__pool">
            {showing.roll.dice.map((rolled, index) => (
              // The roll's id plus the position. Dice within one roll never move — the
              // array is built once and replaced whole — so this is a stable identity
              // rather than an index standing in for one (CLAUDE.md §6).
              <DieFace key={`${showing.id}:${index}`} die={rolled} />
            ))}
          </ul>

          <p className="dice__total">
            <span className="visually-hidden">Total </span>
            {rollTotal(showing.roll)}
          </p>
          <p className="dice__notation">{rollNotation(showing.roll)}</p>
          <p className="dice__visibility">{describeVisibility(showing.visibility)}</p>

          {showing.lookup !== null && (
            <p className="dice__row">
              {showing.lookup.row ??
                'No row on that table covers this number — the roll stands, the table has a gap.'}
            </p>
          )}

          {showing.warnings.map((warning) => (
            <p className="dice__warning" key={warning.reason}>
              {describeRollWarning(warning)}
            </p>
          ))}

          {/* 🚫 Never rendered for a peer's roll. The card has to be untouchable, and a
              button is the one thing that would make it otherwise. */}
          {!isPeerRoll && (
            <button type="button" className="button" onClick={rolls.dismiss}>
              Dismiss
            </button>
          )}
        </div>
      )}

      <div className="dice__handle">
        <button
          type="button"
          className="button dice__grip"
          aria-expanded={isOpen}
          onClick={() => setOpen((open) => !open)}
        >
          Dice
        </button>

        {isOpen && (
          <div className="dice__panel">
            <div className="field">
              <label className="field__label" htmlFor={dieId}>
                Die
              </label>
              <select
                id={dieId}
                className="field__input"
                value={die}
                onChange={(event) => {
                  // Narrowed through the enum rather than cast: the schema is what says
                  // which dice exist (CLAUDE.md §5), and a `<select>`'s value is a string.
                  const chosen = DieEnum.safeParse(event.target.value);
                  if (chosen.success) setDie(chosen.data);
                }}
              >
                {DieEnum.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            <NumberField
              label="How many"
              value={count}
              min={ONE}
              max={MAX_DICE_PER_ROLL}
              onChange={setCount}
            />
            <NumberField
              label="Modifier"
              value={modifier}
              min={-MAX_ROLL_MODIFIER}
              max={MAX_ROLL_MODIFIER}
              onChange={setModifier}
            />
            <TextField
              label="What for"
              value={label}
              maxLength={MAX_NAME_LENGTH}
              placeholder="Longsword"
              onChange={setLabel}
            />

            {/* Who the roll is for, chosen before it is rolled rather than after
                (DESIGN.md §4). "Just me" is not a roll that is sent and then hidden —
                Phase 5 has no way to send one, because the wire enum excludes it. */}
            <div className="field">
              <label className="field__label" htmlFor={visibilityId}>
                Who sees it
              </label>
              <select
                id={visibilityId}
                className="field__input"
                value={visibility}
                onChange={(event) => {
                  // Narrowed through the schema, never cast: a `<select>`'s value is a
                  // string, and the enum is what says which audiences exist.
                  const chosen = RollVisibilityEnum.safeParse(event.target.value);
                  if (chosen.success) setVisibility(chosen.data);
                }}
              >
                {RollVisibilityEnum.options.map((option) => (
                  <option key={option} value={option}>
                    {describeVisibility(option)}
                  </option>
                ))}
              </select>
            </div>

            <div className="row-actions">
              <button
                type="button"
                className="button"
                onClick={() => rolls.roll({ die, count, modifier, label, visibility })}
              >
                Roll {count > ONE ? `${count}${die}` : die}
              </button>
            </div>

            {rolls.failure !== null && (
              <Warning>
                No dice were rolled: {describeTableRollFailure(rolls.failure)}.
              </Warning>
            )}

            <p className="subhead">Rolls</p>
            {rolls.feed.length === NONE ? (
              <p className="empty-note">Nothing rolled yet.</p>
            ) : (
              <ol className="dice__feed">
                {rolls.feed.map((entry) => (
                  <li className="dice__entry" key={entry.id}>
                    <span className="dice__entry-subject">
                      {describeRoller(entry.origin)} {describeSubject(entry)}
                    </span>
                    <span className="dice__entry-notation">{rollNotation(entry.roll)}</span>
                    <span className="dice__visibility">
                      {describeVisibility(entry.visibility)}
                    </span>
                    <span className="dice__entry-total">{rollTotal(entry.roll)}</span>
                    {entry.lookup !== null && (
                      <span className="dice__entry-row">
                        {entry.lookup.row ?? 'no row covers that number'}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
