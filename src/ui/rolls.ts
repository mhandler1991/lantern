/**
 * The pure half of the corner: what a pool is called, and what a die looks like.
 *
 * `DiceOverlay.tsx` renders; this file decides. Nothing here touches React or the DOM,
 * which is what lets the notation and the silhouettes be tested as values rather than
 * scraped back out of a rendered tree.
 *
 * **The silhouettes are outlines, not simulations** (DESIGN.md §4). There is no physics
 * and therefore no orientation, no face and nothing to force a result onto: a shape is
 * drawn and the number is printed inside it. The predecessor project's entire class of
 * expensive bugs — a swapped d4 face, a duplicated label, a verification layer to catch
 * the animation disagreeing with the result — cannot exist here, because the drawing
 * knows nothing about the number it surrounds.
 */

import type { DieRoll, Roll, RollVisibility, RollWarning } from '../model/dice';
import type { DiscardedThrow } from '../state/use-rolls';

/** No dice, no modifier. A floor, not a rule of the game. */
const NONE = 0;

/** One die, and the count a notation leaves off. */
const ONE = 1;

// ---------------------------------------------------------------------------
// What a pool is called
// ---------------------------------------------------------------------------

/**
 * `d20`, `2d6`, and `2d6 + 1d8` for a pool that mixes sizes.
 *
 * A pool this app rolls is always one size — `rollPool` takes a single `die` — but a
 * pool it *shows* need not be: a roll from a peer is an array of `DieResult` and the
 * schema does not require them to match (`net/protocol.ts`). Grouping rather than
 * assuming means a mixed pool reads as what it is instead of as its first die.
 *
 * Sizes keep the order they first appear in, so the notation reads back in the order the
 * dice were rolled rather than in an order sorting invented.
 */
export function poolNotation(dice: readonly DieRoll[]): string {
  const counts = new Map<number, number>();
  for (const die of dice) {
    counts.set(die.sides, (counts.get(die.sides) ?? NONE) + ONE);
  }

  return Array.from(counts, ([sides, count]) =>
    count === ONE ? `d${sides}` : `${count}d${sides}`,
  ).join(' + ');
}

/** `+2`, `-1`, and nothing at all for zero — an unmodified roll says so by silence. */
export function signedModifier(modifier: number): string {
  if (modifier === NONE) return '';
  return modifier > NONE ? `+${modifier}` : `${modifier}`;
}

/** `2d6 + 2`. What was rolled, before what it showed. */
export function rollNotation(roll: Roll): string {
  const modifier = signedModifier(roll.modifier);
  const pool = poolNotation(roll.dice);

  return modifier === '' ? pool : `${pool} ${modifier}`;
}

// ---------------------------------------------------------------------------
// Who a roll was for
// ---------------------------------------------------------------------------

/**
 * What each visibility is called, in the picker and on the record alike.
 *
 * One wording for both, rather than one for choosing and another for reading back.
 * "Just me" is only ever printed on a roll that is in fact this player's — the wire has
 * no word for it (`net/protocol.ts`), so a peer's roll can never arrive claiming to be
 * one — and a single label is one fewer place for the two to describe the same roll
 * differently.
 *
 * The record is unconditional: `everyone` prints "Everyone" rather than printing nothing.
 * A secret roll and a public one must not be told apart by the *absence* of a mark,
 * because absence is also what a bug looks like.
 */
const VISIBILITY_LABELS: Readonly<Record<RollVisibility, string>> = {
  everyone: 'Everyone',
  'just-me': 'Just me',
  'dm-only': 'DM only',
};

/** Who a roll was for, in the words the picker offered when it was rolled. */
export function describeVisibility(visibility: RollVisibility): string {
  return VISIBILITY_LABELS[visibility];
}

// ---------------------------------------------------------------------------
// What a reroll passed up
// ---------------------------------------------------------------------------

/**
 * A throw a reroll threw away: the number, and the row it found.
 *
 * Printed rather than hidden, because a table that says *take it or roll again*
 * (DATA-MODEL.md §8) has to show what was passed up — a reroll that quietly replaced the
 * record would let a result disappear, and a result nobody can point at afterwards is
 * exactly what a shared roll is not for.
 *
 * A face no row covered is said in the same words the card uses for one: a gap is
 * reported, never filled in with a neighbour (`model/tables.ts`).
 */
export function describePassedUp(passed: DiscardedThrow): string {
  return `${passed.total} — ${passed.row ?? 'no row covered that number'}`;
}

/** Every one of them on one line, for the feed's one row per roll. */
export function describePassedUpLine(discarded: readonly DiscardedThrow[]): string {
  return discarded.map(describePassedUp).join('; ');
}

// ---------------------------------------------------------------------------
// Silhouettes
// ---------------------------------------------------------------------------

/**
 * The box every silhouette is drawn in. Unitless, so the shape scales with whatever
 * length the stylesheet gives it and no pixel is written into a component (CLAUDE.md §6).
 */
export const SILHOUETTE_VIEW_BOX = '0 0 100 100';

/**
 * The outline of each die, as the polygon a player recognises across a table: a triangle
 * for the d4, a square for the d6, and so on up to the near-round d100.
 *
 * These are silhouettes of the solid, not nets of it — there are no pips and no face
 * layout, because a 2D drawing of a 3D die's faces is exactly the detail that has to
 * agree with the number and therefore exactly the detail that eventually does not.
 */
/**
 * A near-circle: the d100, and the shape anything unfamiliar is drawn as.
 *
 * The second job is reachable. A roll from a peer may name any face count the protocol
 * admits — 2 through 100 — and a pack may one day name a die this file has not been
 * taught. Drawing a generic solid is PRD.md principle 4 in one shape: the roll still
 * shows its number, rather than the corner rendering nothing over an unfamiliar size.
 */
const ROUNDED = '50,2 78,10 94,32 94,68 78,90 50,98 22,90 6,68 6,32 22,10';

const SILHOUETTES = new Map<number, string>([
  [4, '50,5 95,88 5,88'],
  [6, '12,12 88,12 88,88 12,88'],
  [8, '50,4 92,50 50,96 8,50'],
  [10, '50,2 90,34 50,98 10,34'],
  [12, '50,4 95,37 78,92 22,92 5,37'],
  [20, '50,3 91,27 91,73 50,97 9,73 9,27'],
  [100, ROUNDED],
]);

/** The polygon for a die of this many sides. Never null — see `ROUNDED`. */
export function dieSilhouette(sides: number): string {
  return SILHOUETTES.get(sides) ?? ROUNDED;
}

/** What a die is called: `d20`. The size as written, never a name looked up. */
export function dieLabel(sides: number): string {
  return `d${sides}`;
}

// ---------------------------------------------------------------------------
// What went not-quite-wrong
// ---------------------------------------------------------------------------

/**
 * A warning said the way `model/problems.ts` says things: what was expected, and what
 * was actually there. The roll still happened — that is the whole point of a warning
 * rather than a failure (PRD.md principle 4) — so the line reports rather than apologises.
 */
export function describeRollWarning(warning: RollWarning): string {
  return `a modifier of ${warning.requested} is past anything a roll takes — ${warning.applied} was used instead`;
}
