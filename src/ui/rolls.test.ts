// The pure half of the corner. Notation, and the shape a die is drawn as.
//
// The silhouettes are tested as *data* rather than as rendered pixels: what matters is
// that every die the vocabulary names has an outline of its own, that no two of them are
// the same shape, and that an unfamiliar face count still gets one — because a corner
// that rendered nothing over a size it had not been taught would be a blank where a
// number should be (PRD.md principle 4).

import { describe, expect, it } from 'vitest';
import { MAX_DIE_SIDES, MIN_DIE_SIDES } from '../constants';
import type { DieRoll } from '../model/dice';
import { Die } from '../model/enums';
import { dieSides } from '../model/dice';
import {
  SILHOUETTE_VIEW_BOX,
  describeRollWarning,
  dieLabel,
  dieSilhouette,
  poolNotation,
  rollNotation,
  signedModifier,
} from './rolls';

function pool(...dice: readonly (readonly [number, number])[]): DieRoll[] {
  return dice.map(([sides, value]) => ({ sides, value }));
}

describe('pool notation', () => {
  it('leaves the count off a single die', () => {
    expect(poolNotation(pool([20, 17]))).toBe('d20');
  });

  it('counts dice of the same size', () => {
    expect(poolNotation(pool([6, 1], [6, 4]))).toBe('2d6');
  });

  it('groups a mixed pool rather than reading it as its first die', () => {
    // Not reachable from the handle, which rolls one size. Reachable from a peer:
    // `net/protocol.ts` bounds each `DieResult` on its own and never requires a match.
    expect(poolNotation(pool([6, 3], [6, 5], [8, 2]))).toBe('2d6 + d8');
  });

  it('keeps the order the sizes were rolled in', () => {
    expect(poolNotation(pool([8, 2], [6, 3], [6, 5]))).toBe('d8 + 2d6');
  });

  it('is empty for no dice at all', () => {
    expect(poolNotation([])).toBe('');
  });
});

describe('signed modifier', () => {
  it('says nothing for zero — an unmodified roll says so by silence', () => {
    expect(signedModifier(0)).toBe('');
  });

  it('signs both directions', () => {
    expect(signedModifier(2)).toBe('+2');
    expect(signedModifier(-1)).toBe('-1');
  });
});

describe('roll notation', () => {
  it('is the pool alone when nothing was added', () => {
    expect(rollNotation({ dice: pool([20, 3]), modifier: 0 })).toBe('d20');
  });

  it('is the pool and the modifier when something was', () => {
    expect(rollNotation({ dice: pool([6, 3], [6, 6]), modifier: 2 })).toBe('2d6 +2');
    expect(rollNotation({ dice: pool([20, 11]), modifier: -1 })).toBe('d20 -1');
  });
});

describe('silhouettes', () => {
  const sizes = Die.options.map(dieSides);

  it('draws every die the vocabulary names', () => {
    for (const sides of sizes) {
      expect(dieSilhouette(sides), `d${sides} has no outline`).not.toBe('');
    }
  });

  it('gives each die an outline of its own — a d8 must not read as a d20', () => {
    expect(new Set(sizes.map(dieSilhouette)).size).toBe(sizes.length);
  });

  it('draws an unfamiliar face count rather than nothing', () => {
    // Every size the protocol admits, including the ones no real die has. A peer may
    // send any of them and the roll still has to show its number.
    for (let sides = MIN_DIE_SIDES; sides <= MAX_DIE_SIDES; sides += 1) {
      expect(dieSilhouette(sides), `${sides} sides drew nothing`).toMatch(/\d/);
    }
  });

  it('draws every point inside the box the component gives the svg', () => {
    const [, , width, height] = SILHOUETTE_VIEW_BOX.split(' ').map(Number);

    for (const sides of sizes) {
      for (const point of dieSilhouette(sides).split(' ')) {
        const [x, y] = point.split(',').map(Number);
        expect(x, `d${sides} draws outside the box at ${point}`).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(width as number);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(height as number);
      }
    }
  });

  it('names a die by its size rather than by a looked-up word', () => {
    expect(dieLabel(20)).toBe('d20');
    expect(dieLabel(7)).toBe('d7');
  });
});

describe('warnings', () => {
  it('says what was asked for and what was used', () => {
    const line = describeRollWarning({ reason: 'modifier-clamped', requested: 5000, applied: 999 });
    expect(line).toContain('5000');
    expect(line).toContain('999');
  });
});
