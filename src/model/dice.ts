/**
 * Rolling dice, and the one thing that makes it honest: **rejection sampling**.
 *
 * A d20 from `crypto.getRandomValues` is not a d20 if it is reduced with `%`. A 32-bit
 * word has 2^32 values and 2^32 does not divide by 20, so the first sixteen faces are
 * reachable one more way than the last four. The skew is about one part in 200 million
 * — invisible at a table, and exactly the kind of thing somebody eventually runs a
 * million rolls through and posts the histogram of (DESIGN.md §4). So a word that falls
 * in the ragged tail past the last whole multiple of `sides` is **discarded and redrawn**
 * rather than folded in.
 *
 * Three properties hold for everything in this file:
 *
 *   - **Pure, given its randomness.** No React, no DOM, no clock. The source of random
 *     words is an argument with a default, the same way `light.ts` takes `now` rather
 *     than calling the clock — which is what lets a test drive the rejection branch
 *     instead of hoping to hit it.
 *   - **Errors are values.** A missing CSPRNG and an exhausted redraw loop are returned,
 *     never thrown and never papered over. 🚫 There is no `Math.random` fallback: a
 *     fallback that quietly produces numbers is worse than a roll that says it failed,
 *     because nobody at the table would ever find out.
 *   - **Nothing is adjudicated.** These are numbers. What a 17 means is the table's
 *     business (PRD.md principle 1), and no result here touches a stat.
 *
 * A `DieRoll` is deliberately the same shape as `net/protocol.ts`'s `DieResult`, so a
 * roll hands straight to the wire without a translation step. It is declared here rather
 * than imported because `model/` does not import `net/` — the protocol imports the model,
 * and the arrow only points one way.
 */

import * as z from 'zod';
import {
  MAX_DICE_PER_ROLL,
  MAX_DIE_SIDES,
  MAX_REJECTION_SAMPLING_ATTEMPTS,
  MAX_ROLL_MODIFIER,
  MIN_DIE_SIDES,
} from '../constants';
import { dieNotationParts } from './enums';
import type { Die } from './enums';

/** No dice, no modifier, nothing rolled. A floor, not a rule of the game. */
const NONE = 0;

/** The smallest pool anybody rolls, and the value a die's lowest face shows. */
const ONE = 1;

/**
 * How many values a `Uint32Array` element can hold. A fact about the platform's word
 * size, not a business rule — which is why it is here and not in `constants.ts`.
 */
const WORD_VALUES = 2 ** 32;

/** How many faces a die has, from the name a pack calls it by. `d20` is twenty. */
export function dieSides(die: Die): number {
  return Number(die.slice(ONE));
}

// ---------------------------------------------------------------------------
// Where the randomness comes from
// ---------------------------------------------------------------------------

/**
 * Fills the array it is handed with uniform 32-bit words, in place — the shape of
 * `crypto.getRandomValues`, so the real one satisfies it as it stands and a test can
 * hand over a scripted one.
 */
export type RandomWords = (words: Uint32Array) => void;

/**
 * The platform CSPRNG, looked up at call time rather than at import. A module that read
 * `crypto` once at load would be deciding, at import order, whether the app can roll.
 */
export const cryptoWords: RandomWords = (words) => {
  globalThis.crypto.getRandomValues(words);
};

/** Whether this environment has the CSPRNG at all. Checked, never assumed. */
function hasCrypto(): boolean {
  return typeof globalThis.crypto?.getRandomValues === 'function';
}

// ---------------------------------------------------------------------------
// What a roll is, and how one fails
// ---------------------------------------------------------------------------

/**
 * One die and what it showed. Structurally the protocol's `DieResult` (DESIGN.md §4),
 * and checked there again on the way in and on the way out — a roll leaving this machine
 * is validated like anything else (CLAUDE.md §2.7).
 */
export type DieRoll = {
  readonly sides: number;
  readonly value: number;
};

/**
 * A pool and the modifier applied to it. 🚫 No `total` field — a total is derived
 * (CLAUDE.md §4) and `rollTotal` computes it, so a stored copy cannot disagree with the
 * dice it was supposedly the sum of. The protocol makes the same choice for the same
 * reason.
 */
export type Roll = {
  readonly dice: readonly DieRoll[];
  readonly modifier: number;
};

/**
 * Who a roll is for, chosen when it is rolled and never afterwards (DESIGN.md §4).
 *
 * Per roll rather than per player: the same character rolls a public attack and a secret
 * stealth check a minute apart, so this belongs to the roll and not to a setting
 * somebody has to remember to put back.
 *
 * The three are not three degrees of the same thing. `everyone` and `dm-only` are both
 * *sent* and differ in who receives them; **`just-me` is never sent at all**, because
 * broadcasting numbers and hiding them client side is not secret — every peer runs its
 * own code and can print whatever it was given. `net/protocol.ts` derives its wire enum
 * from this one by excluding `just-me`, which is how that rule survives being written
 * down: the wire has no word for a secret roll, so no branch can accidentally find one.
 *
 * 🚫 Nothing here enforces anything about the DM. `dm-only` is a request the sender
 * addresses and the receiver honours — authority is modelled, never enforced (PRD.md
 * principle 3).
 */
export const RollVisibility = z.enum(['everyone', 'just-me', 'dm-only']);
export type RollVisibility = z.infer<typeof RollVisibility>;

/**
 * Something was off but the roll still happened (PRD.md principle 4). A warning never
 * costs a player their roll; it is reported alongside it and shown.
 */
export type RollWarning = {
  readonly reason: 'modifier-clamped';
  readonly requested: number;
  readonly applied: number;
};

/**
 * Why no dice were rolled at all. A pool larger than the cap is "a mistake or an attack,
 * never a roll somebody meant" (`constants.ts`), so unlike a wild modifier it is refused
 * rather than clamped.
 */
export type RollFailure =
  | { readonly reason: 'no-csprng' }
  | { readonly reason: 'source-threw'; readonly thrown: unknown }
  | { readonly reason: 'exhausted'; readonly attempts: number; readonly sides: number }
  | { readonly reason: 'count'; readonly requested: number }
  | { readonly reason: 'notation'; readonly notation: string }
  | { readonly reason: 'faces'; readonly requested: number };

export type RollResult =
  | { readonly ok: true; readonly roll: Roll; readonly warnings: readonly RollWarning[] }
  | { readonly ok: false; readonly failure: RollFailure };

/** One line a player can act on, in the same voice as `problems.ts`. */
export function describeRollFailure(failure: RollFailure): string {
  switch (failure.reason) {
    case 'no-csprng':
      return 'this browser has no crypto.getRandomValues — dice need it, and nothing here will guess in its place';
    case 'source-threw':
      return 'the random source failed — no dice were rolled';
    case 'exhausted':
      return `gave up drawing a fair d${failure.sides} after ${failure.attempts} attempts — the random source is not returning usable values`;
    case 'count':
      return `expected 1 to ${MAX_DICE_PER_ROLL} dice — got ${failure.requested}`;
    case 'notation':
      return `expected dice notation such as 2d6 or d20 — got "${failure.notation}"`;
    case 'faces':
      return `expected ${MIN_DIE_SIDES} to ${MAX_DIE_SIDES} things to choose between — got ${failure.requested}`;
  }
}

/** Dice plus modifier, computed on read. */
export function rollTotal(roll: Roll): number {
  return roll.dice.reduce((sum, die) => sum + die.value, NONE) + roll.modifier;
}

// ---------------------------------------------------------------------------
// One face, drawn fairly
// ---------------------------------------------------------------------------

type FaceResult =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly failure: RollFailure };

/**
 * One face of a `sides`-sided die, uniform.
 *
 * `limit` is the last whole multiple of `sides` that fits in a word: every word below it
 * maps to a face the same number of ways, and every word at or above it is thrown away.
 * That discard is the entire difference between a fair die and `% sides`.
 *
 * The loop is bounded because an unbounded one is a hung tab in the presence of a broken
 * source. Running out is reported (`constants.ts` — "a reportable error, not a silent
 * fallback to a biased result"); with a real CSPRNG the chance of a single redraw is
 * under one in forty million for the largest die there is.
 */
function rollFace(sides: number, random: RandomWords): FaceResult {
  const limit = WORD_VALUES - (WORD_VALUES % sides);
  const word = new Uint32Array(ONE);

  for (let attempt = NONE; attempt < MAX_REJECTION_SAMPLING_ATTEMPTS; attempt += ONE) {
    try {
      random(word);
    } catch (thrown) {
      return { ok: false, failure: { reason: 'source-threw', thrown } };
    }

    const drawn = word[NONE] as number;
    if (drawn < limit) return { ok: true, value: (drawn % sides) + ONE };
  }

  return {
    ok: false,
    failure: { reason: 'exhausted', attempts: MAX_REJECTION_SAMPLING_ATTEMPTS, sides },
  };
}

// ---------------------------------------------------------------------------
// A pool
// ---------------------------------------------------------------------------

/** What to roll: a die from the pack vocabulary, how many, and what to add. */
export type RollRequest = {
  readonly die: Die;
  readonly count?: number;
  readonly modifier?: number;
};

/**
 * A modifier outside the band is a typo, so it is clamped and said so rather than
 * refused (`constants.ts`) — a player who typed an extra digit still gets their roll.
 * A non-finite one is not a number anybody typed, and lands at zero.
 */
function clampModifier(modifier: number): number {
  if (!Number.isFinite(modifier)) return NONE;
  const whole = Math.trunc(modifier);
  return Math.min(Math.max(whole, -MAX_ROLL_MODIFIER), MAX_ROLL_MODIFIER);
}

/** `count` dice of one size, plus a modifier. The whole of what a free roll is. */
export function rollPool(request: RollRequest, random: RandomWords = cryptoWords): RollResult {
  const count = request.count ?? ONE;
  const requestedModifier = request.modifier ?? NONE;

  if (!Number.isInteger(count) || count < ONE || count > MAX_DICE_PER_ROLL) {
    return { ok: false, failure: { reason: 'count', requested: count } };
  }
  if (random === cryptoWords && !hasCrypto()) {
    return { ok: false, failure: { reason: 'no-csprng' } };
  }

  const modifier = clampModifier(requestedModifier);
  const warnings: RollWarning[] =
    modifier === requestedModifier
      ? []
      : [{ reason: 'modifier-clamped', requested: requestedModifier, applied: modifier }];

  const sides = dieSides(request.die);
  const dice: DieRoll[] = [];

  for (let rolled = NONE; rolled < count; rolled += ONE) {
    const face = rollFace(sides, random);
    if (!face.ok) return { ok: false, failure: face.failure };
    dice.push({ sides, value: face.value });
  }

  return { ok: true, roll: { dice, modifier }, warnings };
}

/**
 * The same roll, named the way a pack names it — `2d6`, `d20`, `1d8` (DATA-MODEL.md §8).
 * The notation is picked apart by `enums.ts` rather than by a second regex here, so the
 * dice a notation may name are the `Die` enum and cannot drift from it.
 */
export function rollNotation(
  notation: string,
  modifier = NONE,
  random: RandomWords = cryptoWords,
): RollResult {
  const parts = dieNotationParts(notation);
  if (parts === null) return { ok: false, failure: { reason: 'notation', notation } };

  return rollPool({ die: parts.die, count: parts.count, modifier }, random);
}

/**
 * A uniform draw among `count` things, as a roll of a die with that many faces.
 *
 * This is how "roll or choose" is rolled (#35). Picking one of six ancestries is a d6,
 * and picking one of thirty-three items is a d33 — a die nobody owns, which is exactly
 * why it belongs here rather than in a component: the fairness is the same rejection
 * sampling every other roll gets, and the result travels as a `Roll` so the corner shows
 * it, the feed keeps it and the wire could carry it. `DieRoll.sides` is a number rather
 * than a member of the `Die` enum, and always was — the enum bounds what a *pack* may
 * name, not what a roll may contain.
 *
 * The bounds are the protocol's own (`MIN_DIE_SIDES`, `MAX_DIE_SIDES`). One option is
 * refused deliberately: `constants.ts` calls a one-faced die "a constant wearing a die's
 * clothes", and a list with a single entry has nothing to decide. Callers offer no roll
 * rather than rolling a die that cannot come up any other way.
 *
 * 🚫 It draws an index and nothing else. **What the drawn face means is the caller's** —
 * this function has never seen the list, and no result here touches a stat (PRD.md
 * principle 1).
 */
export function rollAmong(count: number, random: RandomWords = cryptoWords): RollResult {
  if (!Number.isInteger(count) || count < MIN_DIE_SIDES || count > MAX_DIE_SIDES) {
    return { ok: false, failure: { reason: 'faces', requested: count } };
  }
  if (random === cryptoWords && !hasCrypto()) {
    return { ok: false, failure: { reason: 'no-csprng' } };
  }

  const face = rollFace(count, random);
  if (!face.ok) return { ok: false, failure: face.failure };

  return {
    ok: true,
    roll: { dice: [{ sides: count, value: face.value }], modifier: NONE },
    warnings: [],
  };
}
