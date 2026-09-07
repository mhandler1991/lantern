/**
 * How much of a light source is left, from when it was lit.
 *
 * Shadowdark burns light in **real time** (DESIGN.md §6), and the only honest way to
 * hold that in a browser tab is the way a sheet already holds it: `litAt` is the moment
 * the player struck it, `minutes` is how long the thing burns, and everything else is
 * arithmetic over the clock at the moment somebody looks. Nothing here writes, and
 * nothing anywhere decrements a stored remainder — a stored remainder is a derived value
 * (CLAUDE.md §4), and it is one that goes wrong in the most ordinary way there is: the
 * player switches tabs, the interval is throttled, and the torch that should be out has
 * twelve minutes left on it.
 *
 * So this module is pure, and `now` is an argument rather than a call to `Date.now()`.
 * Same inputs, same answer — which is what lets a reload, a backgrounded tab and a test
 * be the same case: they differ only in how far `now` has moved since `litAt`.
 *
 * **How long a thing burns is a fact about the thing**, so a row pointing at an item a
 * loaded pack says gives light burns for the pack's `minutes` (DATA-MODEL.md §4). The
 * lookup comes in as an argument for the same reason `derived.ts` takes one, and obeys
 * the same rule: a loaded pack's answer wins and the row's own number is the fallback.
 * Turn the pack off and the row goes back to what it stored, still lightable — a torch
 * a player could not light because a supplement was off would be the app blocking play
 * (PRD.md principle 4).
 *
 * 🚫 Nothing here adjudicates. A spent torch is a number reaching zero; what that means
 * at the table is the table's business (PRD.md principle 1).
 */

import type { Light } from './character';
import type { ItemLookup } from './derived';

/** No time elapsed, none remaining. A floor, not a rule of the game. */
const NONE = 0;

/** A bar is drawn as a percentage of itself. A scale, not a business rule. */
const FULL_BAR = 100;

/** Unit conversion, not a limit — the sheet stores minutes and the clock counts ms. */
const MS_PER_MINUTE = 60_000;

/** What a light has left, at one moment. Every field is derived; none is stored. */
export type Burn = {
  /** It was struck and not put out. Says nothing about whether it is still alight. */
  readonly isLit: boolean;
  /** Still alight: lit, and something left to burn. */
  readonly isBurning: boolean;
  /** Lit, and nothing left. */
  readonly isSpent: boolean;
  /** How long this source burns from new. */
  readonly totalMs: number;
  /** Since it was lit, never negative. Zero while unlit. */
  readonly elapsedMs: number;
  /** Never negative — a torch that ran out an hour ago is out, not owed an hour. */
  readonly remainingMs: number;
  /** 0 to 100, for the bar. Full while unlit: nothing has been spent yet. */
  readonly percentRemaining: number;
};

/**
 * How long this row's source burns from new: the loaded pack's answer for the item it
 * points at, and the row's own `minutes` when no pack answers for it.
 *
 * A row with no `ref` is a light the player wrote down with no pack loaded, and it is
 * answered from the row rather than being unresolved — the same reading `derived.ts`
 * gives a typed-in item. Nothing is written back either way: a pack's number is read
 * every render, never copied onto the sheet (DATA-MODEL.md §12).
 */
export function burnMinutes(light: Light, lookup: ItemLookup): number {
  return packBurnMinutes(light, lookup) ?? light.minutes;
}

/**
 * How long a loaded pack says this row's source burns, or `null` when none does — an
 * item with no `light` block, a reference no loaded pack answers for, and a row that
 * points at nothing all read the same way, because they mean the same thing here: the
 * number on the row is the number, and it is the player's to change.
 */
export function packBurnMinutes(light: Light, lookup: ItemLookup): number | null {
  const facts = light.ref === null ? null : lookup(light.ref);

  return facts?.light?.minutes ?? null;
}

/**
 * What is left of one light source, read against `now`.
 *
 * Two clocks can disagree and one of them can move backwards — a machine correcting
 * itself over NTP, a character exported on a laptop that is ten minutes fast and
 * imported here. `now` earlier than `litAt` therefore reads as *no time elapsed* rather
 * than as time owed back: a torch is never longer for having been lit in the future.
 * The same clamp at the other end keeps a torch left burning overnight at zero.
 */
export function computeBurn(light: Light, now: number, lookup: ItemLookup): Burn {
  const totalMs = burnMinutes(light, lookup) * MS_PER_MINUTE;

  if (light.litAt === null) {
    return {
      isLit: false,
      isBurning: false,
      isSpent: false,
      totalMs,
      elapsedMs: NONE,
      remainingMs: totalMs,
      percentRemaining: FULL_BAR,
    };
  }

  const elapsedMs = Math.max(now - light.litAt, NONE);
  const remainingMs = Math.max(totalMs - elapsedMs, NONE);

  // The schema will not admit a light of zero minutes, but the division is here and a
  // sheet is not the only thing that ever reaches a function. An empty bar is the
  // reading that cannot print NaN across the row.
  const percentRemaining =
    totalMs <= NONE ? NONE : Math.round((remainingMs / totalMs) * FULL_BAR);

  return {
    isLit: true,
    isBurning: remainingMs > NONE,
    isSpent: remainingMs <= NONE,
    totalMs,
    elapsedMs,
    remainingMs,
    percentRemaining: Math.min(Math.max(percentRemaining, NONE), FULL_BAR),
  };
}

/**
 * Whether anything the character carries is still alight at `now`.
 *
 * This is what decides that the clock needs reading at all (`state/use-light-clock.ts`).
 * A sheet with nothing lit, and a sheet whose last torch went out an hour ago, both say
 * no — the second one is why "is anything lit" is not the same question.
 */
export function anyBurning(lights: readonly Light[], now: number, lookup: ItemLookup): boolean {
  return lights.some((light) => computeBurn(light, now, lookup).isBurning);
}
