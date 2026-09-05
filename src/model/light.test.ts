// A torch's remaining time is a silent wrong answer waiting to happen: nothing throws
// when it drifts, the bar still moves, and the number is simply not the one the table is
// playing against (CLAUDE.md §7). Every test here fixes `litAt` and moves `now`, because
// that is the only variable there is — a reload, a backgrounded tab and a clock that
// jumped are the same case at three different distances.

import { describe, expect, it } from 'vitest';
import { DEFAULT_LIGHT_MINUTES, MAX_LIGHT_MINUTES } from '../constants';
import type { Light } from './character';
import { anyBurning, computeBurn } from './light';

const MINUTE = 60_000;

/** A moment with no significance beyond being a long way from zero. */
const LIT_AT = 1_735_689_600_000;

function torch(overrides: Partial<Light> = {}): Light {
  return {
    id: 'r_torch',
    ref: null,
    name: 'Torch',
    litAt: LIT_AT,
    minutes: DEFAULT_LIGHT_MINUTES,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The arithmetic
// ---------------------------------------------------------------------------

describe('an unlit light', () => {
  it('has burned nothing and has all of itself left', () => {
    const burn = computeBurn(torch({ litAt: null }), LIT_AT + 10 * MINUTE);

    expect(burn.isLit).toBe(false);
    expect(burn.isBurning).toBe(false);
    expect(burn.isSpent).toBe(false);
    expect(burn.elapsedMs).toBe(0);
    expect(burn.remainingMs).toBe(DEFAULT_LIGHT_MINUTES * MINUTE);
    expect(burn.percentRemaining).toBe(100);
  });
});

describe('a burning light', () => {
  it('has spent exactly the time that has passed', () => {
    const burn = computeBurn(torch(), LIT_AT + 20 * MINUTE);

    expect(burn.elapsedMs).toBe(20 * MINUTE);
    expect(burn.remainingMs).toBe(40 * MINUTE);
    expect(burn.isBurning).toBe(true);
    expect(burn.isSpent).toBe(false);
  });

  it('reads full at the moment it is struck', () => {
    const burn = computeBurn(torch(), LIT_AT);

    expect(burn.remainingMs).toBe(DEFAULT_LIGHT_MINUTES * MINUTE);
    expect(burn.percentRemaining).toBe(100);
    expect(burn.isBurning).toBe(true);
  });

  it('is still burning with a millisecond left, and out one millisecond later', () => {
    const lastMoment = LIT_AT + DEFAULT_LIGHT_MINUTES * MINUTE - 1;

    expect(computeBurn(torch(), lastMoment).isBurning).toBe(true);
    expect(computeBurn(torch(), lastMoment + 1).isBurning).toBe(false);
    expect(computeBurn(torch(), lastMoment + 1).isSpent).toBe(true);
  });

  it('counts the same time whether it is read once or a thousand times', () => {
    const at = LIT_AT + 37 * MINUTE;
    const once = computeBurn(torch(), at);

    for (let i = 0; i < 1_000; i += 1) computeBurn(torch(), LIT_AT + i);

    expect(computeBurn(torch(), at)).toEqual(once);
  });

  it('does not write to the light it was handed', () => {
    const light = torch();
    const before = { ...light };

    computeBurn(light, LIT_AT + 30 * MINUTE);

    expect(light).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// The clock misbehaving
// ---------------------------------------------------------------------------

describe('a light read against an odd clock', () => {
  // Twenty minutes in a background tab is not twenty ticks that never fired — it is one
  // later reading of the clock, and this is the case that proves it.
  it('spends the whole gap a backgrounded tab skipped', () => {
    const burn = computeBurn(torch({ minutes: MAX_LIGHT_MINUTES }), LIT_AT + 20 * MINUTE);

    expect(burn.elapsedMs).toBe(20 * MINUTE);
  });

  it('runs out rather than owing time, however long the tab was away', () => {
    const burn = computeBurn(torch(), LIT_AT + 100 * 24 * 60 * MINUTE);

    expect(burn.remainingMs).toBe(0);
    expect(burn.percentRemaining).toBe(0);
    expect(burn.isSpent).toBe(true);
  });

  // A machine correcting itself over NTP, or a character exported on a laptop that is
  // ten minutes fast. A torch is never longer for having been lit in the future.
  it('treats a clock that moved backwards as no time passed', () => {
    const burn = computeBurn(torch(), LIT_AT - 10 * MINUTE);

    expect(burn.elapsedMs).toBe(0);
    expect(burn.remainingMs).toBe(DEFAULT_LIGHT_MINUTES * MINUTE);
    expect(burn.isBurning).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The bar
// ---------------------------------------------------------------------------

describe('the proportion left', () => {
  it('is the fraction of the burn that remains', () => {
    expect(computeBurn(torch(), LIT_AT + 15 * MINUTE).percentRemaining).toBe(75);
    expect(computeBurn(torch(), LIT_AT + 30 * MINUTE).percentRemaining).toBe(50);
  });

  it('never leaves the track in either direction', () => {
    expect(computeBurn(torch(), LIT_AT + 600 * MINUTE).percentRemaining).toBe(0);
    expect(computeBurn(torch(), LIT_AT - 600 * MINUTE).percentRemaining).toBe(100);
  });

  // The schema will not admit it, but the division is there and a number that prints as
  // NaN across a row is worse than an empty bar.
  it('reads empty rather than NaN for a light of no duration', () => {
    expect(computeBurn(torch({ minutes: 0 }), LIT_AT + MINUTE).percentRemaining).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Anything alight
// ---------------------------------------------------------------------------

describe('whether anything is still alight', () => {
  it('is false for no lights at all', () => {
    expect(anyBurning([], LIT_AT)).toBe(false);
  });

  it('is false when every light is unlit', () => {
    expect(anyBurning([torch({ litAt: null })], LIT_AT)).toBe(false);
  });

  // The distinction the clock depends on: lit is not the same question as burning.
  it('is false when the only lit source has already burned out', () => {
    const spent = [torch()];

    expect(anyBurning(spent, LIT_AT + 30 * MINUTE)).toBe(true);
    expect(anyBurning(spent, LIT_AT + 90 * MINUTE)).toBe(false);
  });

  it('is true while any one of several is still going', () => {
    const lights = [
      torch({ id: 'r_a' }),
      torch({ id: 'r_b', minutes: MAX_LIGHT_MINUTES }),
    ];

    expect(anyBurning(lights, LIT_AT + 90 * MINUTE)).toBe(true);
  });
});
