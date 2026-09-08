/**
 * What a roll picked out, and whether there was anything fair to roll. Pure — no React,
 * no dice; the dice are `model/dice.ts` and this reads their answer.
 *
 * The split matters. `rollAmong` draws one face of a die with as many faces as there are
 * options and has never seen the list; this turns that face into the option it landed
 * on. Keeping the two apart is what stops the fairness and the meaning being tangled
 * together — the model can be tested for uniformity with no list in sight, and the rule
 * below can be tested with no randomness in sight.
 *
 * 🚫 Nothing here adjudicates. Picking a class at random is the player asking the dice
 * to choose *for* them, which is what "roll or choose" means (#35); it is not a table
 * result, and no stat moves because of one (PRD.md principle 1).
 */

import { MAX_DIE_SIDES, MIN_DIE_SIDES } from '../../constants';
import type { RollEntry } from '../../state/use-rolls';

/** The first face, and the offset from a 1-based face to a 0-based index. */
const FIRST = 1;

/** A draw among things is one die. Anything else did not come from `rollAmong`. */
const ONE_DIE = 1;

/**
 * Whether a list of this length can be rolled among at all.
 *
 * A list of one is refused, and that is the interesting end: `constants.ts` calls a
 * one-faced die "a constant wearing a die's clothes", and a choice with one option is
 * not a choice. The caller offers no roll rather than a button whose answer is known —
 * the picker is still there, and picking the only thing on it is what a player does.
 */
export function canRollAmong(count: number): boolean {
  return count >= MIN_DIE_SIDES && count <= MAX_DIE_SIDES;
}

/**
 * The option a draw landed on, or `null` if this entry cannot be read as one.
 *
 * The die's own `sides` is checked against the list it is being read against, and a
 * mismatch answers `null` rather than indexing anyway. That is the guard that matters
 * here: a pack turned on between the throw and the read would otherwise silently shift
 * which entry a 4 meant, and picking the wrong content off a right-looking number is
 * exactly the kind of wrong answer nobody notices.
 */
export function pickedBy<T>(options: readonly T[], entry: RollEntry): T | null {
  const { dice } = entry.roll;
  if (dice.length !== ONE_DIE) return null;

  const [die] = dice;
  if (die === undefined || die.sides !== options.length) return null;

  return options[die.value - FIRST] ?? null;
}
