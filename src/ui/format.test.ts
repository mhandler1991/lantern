// A countdown is read at a glance in the middle of somebody's turn, so the two things
// that matter are that it never jitters its width and that it never rounds a torch out
// early. Both are boundary cases, and both are here.

import { describe, expect, it } from 'vitest';
import type { Burn } from '../model/light';
import { describeBurn, formatDuration, formatModifier } from './format';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

function burn(overrides: Partial<Burn> = {}): Burn {
  return {
    isLit: true,
    isBurning: true,
    isSpent: false,
    totalMs: HOUR,
    elapsedMs: 20 * MINUTE,
    remainingMs: 40 * MINUTE,
    percentRemaining: 67,
    ...overrides,
  };
}

describe('a modifier', () => {
  it('is signed when it helps and bare when it does not', () => {
    expect(formatModifier(2)).toBe('+2');
    expect(formatModifier(0)).toBe('0');
    expect(formatModifier(-1)).toBe('-1');
  });
});

describe('a duration', () => {
  it('pads the seconds so the number does not jitter as it falls', () => {
    expect(formatDuration(4 * MINUTE + 7 * SECOND)).toBe('4:07');
    expect(formatDuration(9 * SECOND)).toBe('0:09');
  });

  it('grows an hours place only once there is an hour of it', () => {
    expect(formatDuration(59 * MINUTE + 59 * SECOND)).toBe('59:59');
    expect(formatDuration(HOUR)).toBe('1:00:00');
    expect(formatDuration(HOUR + 12 * MINUTE + 30 * SECOND)).toBe('1:12:30');
  });

  // Rounding up is what makes 0:00 mean spent. Rounding down would show a torch out for
  // its whole last second, which is a second of play at a table that is watching it.
  it('shows a last second rather than a premature zero', () => {
    expect(formatDuration(1)).toBe('0:01');
    expect(formatDuration(SECOND)).toBe('0:01');
    expect(formatDuration(0)).toBe('0:00');
  });

  it('reads as nothing left rather than as a negative time', () => {
    expect(formatDuration(-5 * MINUTE)).toBe('0:00');
  });
});

describe('what a light says about itself', () => {
  it('says how much is left while it burns', () => {
    expect(describeBurn(burn())).toBe('40:00 left');
  });

  it('says it is unlit before it is struck', () => {
    expect(describeBurn(burn({ isLit: false, isBurning: false, remainingMs: HOUR }))).toBe(
      'unlit',
    );
  });

  it('says it has gone out rather than printing a bare zero', () => {
    expect(
      describeBurn(burn({ isBurning: false, isSpent: true, remainingMs: 0, percentRemaining: 0 })),
    ).toBe('burnt out');
  });
});
