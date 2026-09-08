// A biased die is the quietest wrong answer in the app (CLAUDE.md §7): nothing throws,
// every number is in range, every roll looks like a roll, and the only symptom is a
// histogram somebody plots a year later. So two things are tested here that a range
// check would never catch — that a word in the ragged tail past the last whole multiple
// of the die is actually *discarded*, and that a large real sample comes out flat.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_DICE_PER_ROLL,
  MAX_DIE_SIDES,
  MAX_REJECTION_SAMPLING_ATTEMPTS,
  MAX_ROLL_MODIFIER,
  MIN_DIE_SIDES,
} from '../constants';
import type { Die } from './enums';
import type { RandomWords } from './dice';
import {
  cryptoWords,
  describeRollFailure,
  dieSides,
  rollAmong,
  rollNotation,
  rollPool,
  rollTotal,
} from './dice';

const EVERY_DIE: readonly Die[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];

/** 2^32 — the size of the word the CSPRNG hands back, not a rule of anything. */
const WORD_VALUES = 2 ** 32;

/** The last whole multiple of `sides` that fits in a word. At or above it is discarded. */
function rejectionLimit(sides: number): number {
  return WORD_VALUES - (WORD_VALUES % sides);
}

/** A source that hands back the words it was given, in order, then repeats the last. */
function scripted(words: readonly number[]): RandomWords {
  let next = 0;
  return (into) => {
    into[0] = words[Math.min(next, words.length - 1)] as number;
    next += 1;
  };
}

/** Unwraps a roll that must have succeeded, so a failure fails the test that expected one. */
function facesOf(result: ReturnType<typeof rollPool>): readonly number[] {
  if (!result.ok) throw new Error(`expected a roll, got ${describeRollFailure(result.failure)}`);
  return result.roll.dice.map((die) => die.value);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Rejection sampling — the point of the module
// ---------------------------------------------------------------------------

describe('rejection sampling', () => {
  it('discards every word in the biased tail and redraws', () => {
    const sides = 20;
    const limit = rejectionLimit(sides);
    const tail = Array.from({ length: WORD_VALUES - limit }, (_, i) => limit + i);
    const source = vi.fn(scripted([...tail, 41]));

    expect(facesOf(rollPool({ die: 'd20' }, source))).toEqual([2]);
    // Sixteen discards, then the word that was actually used.
    expect(source).toHaveBeenCalledTimes(tail.length + 1);
  });

  it('does not discard the last word below the limit', () => {
    const source = scripted([rejectionLimit(20) - 1]);

    // 4294967279 % 20 is 19, so the face is the twentieth.
    expect(facesOf(rollPool({ die: 'd20' }, source))).toEqual([20]);
  });

  it('reports exhaustion rather than folding a biased word in', () => {
    const source = vi.fn(scripted([WORD_VALUES - 1]));
    const result = rollPool({ die: 'd20' }, source);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual({
      reason: 'exhausted',
      attempts: MAX_REJECTION_SAMPLING_ATTEMPTS,
      sides: 20,
    });
    expect(source).toHaveBeenCalledTimes(MAX_REJECTION_SAMPLING_ATTEMPTS);
  });

  it('never rejects for a die whose faces divide the word space', () => {
    const source = vi.fn(scripted([WORD_VALUES - 1]));

    // 2^32 divides by 4, so there is no tail and the highest word there is still rolls.
    expect(facesOf(rollPool({ die: 'd4' }, source))).toEqual([4]);
    expect(source).toHaveBeenCalledTimes(1);
  });

  it('maps the lowest word to the lowest face on every die', () => {
    for (const die of EVERY_DIE) {
      expect(facesOf(rollPool({ die }, scripted([0])))).toEqual([1]);
    }
  });
});

// ---------------------------------------------------------------------------
// Range, per die
// ---------------------------------------------------------------------------

describe('the range of a die', () => {
  it('names the faces the pack vocabulary does', () => {
    expect(EVERY_DIE.map(dieSides)).toEqual([4, 6, 8, 10, 12, 20, 100]);
  });

  it('rolls only faces that die has, over many rolls', () => {
    for (const die of EVERY_DIE) {
      const sides = dieSides(die);
      const result = rollPool({ die, count: MAX_DICE_PER_ROLL });
      if (!result.ok) throw new Error(describeRollFailure(result.failure));

      for (const rolled of result.roll.dice) {
        expect(rolled.sides).toBe(sides);
        expect(Number.isInteger(rolled.value)).toBe(true);
        expect(rolled.value).toBeGreaterThanOrEqual(1);
        expect(rolled.value).toBeLessThanOrEqual(sides);
      }
    }
  });

  it('reaches both ends of a d100 over a large sample', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i += 1) {
      for (const face of facesOf(rollPool({ die: 'd100', count: MAX_DICE_PER_ROLL }))) {
        seen.add(face);
      }
    }
    expect(seen.size).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Uniformity, over a real sample from the real CSPRNG
// ---------------------------------------------------------------------------

describe('uniformity', () => {
  /**
   * Chi-square against a flat expectation, with the threshold far past the p=0.001
   * critical value (43.8 for 19 degrees of freedom) so a fair die never flakes it.
   *
   * 📌 This does **not** catch the modulo bias. A `%` reduction over a 32-bit word skews
   * a d20 by about one part in 200 million, which needs something like 10^19 rolls to
   * separate from chance — no sample a test suite can take will ever see it. What pins
   * the bias is the discard test above, which proves the tail words are thrown away.
   * This one catches the other failure: a source that is grossly non-uniform, or an
   * arithmetic slip that makes a face unreachable or twice as likely.
   */
  function chiSquare(counts: readonly number[], total: number): number {
    const expected = total / counts.length;
    return counts.reduce((sum, seen) => sum + (seen - expected) ** 2 / expected, 0);
  }

  it('spreads a d20 evenly across 200,000 rolls', () => {
    const counts = new Array<number>(20).fill(0);
    let total = 0;

    for (let batch = 0; batch < 2_000; batch += 1) {
      for (const face of facesOf(rollPool({ die: 'd20', count: MAX_DICE_PER_ROLL }))) {
        counts[face - 1] = (counts[face - 1] ?? 0) + 1;
        total += 1;
      }
    }

    expect(total).toBe(200_000);
    expect(counts.every((seen) => seen > 0)).toBe(true);
    expect(chiSquare(counts, total)).toBeLessThan(60);
  });

  it('spreads a d6 evenly across 60,000 rolls', () => {
    const counts = new Array<number>(6).fill(0);
    let total = 0;

    for (let batch = 0; batch < 600; batch += 1) {
      for (const face of facesOf(rollPool({ die: 'd6', count: MAX_DICE_PER_ROLL }))) {
        counts[face - 1] = (counts[face - 1] ?? 0) + 1;
        total += 1;
      }
    }

    // Five degrees of freedom: 20.5 is p=0.001, so 40 is unreachable by chance.
    expect(chiSquare(counts, total)).toBeLessThan(40);
  });
});

// ---------------------------------------------------------------------------
// Counts and modifiers
// ---------------------------------------------------------------------------

describe('a pool', () => {
  it('rolls one die when no count is given', () => {
    expect(facesOf(rollPool({ die: 'd20' }))).toHaveLength(1);
  });

  it('rolls as many dice as it was asked for', () => {
    expect(facesOf(rollPool({ die: 'd6', count: 7 }))).toHaveLength(7);
  });

  it('rolls the largest pool the app allows', () => {
    expect(facesOf(rollPool({ die: 'd6', count: MAX_DICE_PER_ROLL }))).toHaveLength(
      MAX_DICE_PER_ROLL,
    );
  });

  it('refuses a pool larger than the cap rather than truncating it', () => {
    const result = rollPool({ die: 'd6', count: MAX_DICE_PER_ROLL + 1 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual({ reason: 'count', requested: MAX_DICE_PER_ROLL + 1 });
    expect(describeRollFailure(result.failure)).toContain(String(MAX_DICE_PER_ROLL));
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses a count of %p',
    (count) => {
      expect(rollPool({ die: 'd6', count }).ok).toBe(false);
    },
  );

  it('carries the modifier without folding it into a die', () => {
    const result = rollPool({ die: 'd20', modifier: 3 }, scripted([0]));
    if (!result.ok) throw new Error('expected a roll');

    expect(result.roll.dice).toEqual([{ sides: 20, value: 1 }]);
    expect(result.roll.modifier).toBe(3);
    expect(rollTotal(result.roll)).toBe(4);
  });

  it('adds no modifier when none was asked for', () => {
    const result = rollPool({ die: 'd6', count: 2 }, scripted([0]));
    if (!result.ok) throw new Error('expected a roll');

    expect(result.roll.modifier).toBe(0);
    expect(result.warnings).toEqual([]);
    expect(rollTotal(result.roll)).toBe(2);
  });

  it('takes a negative modifier', () => {
    const result = rollPool({ die: 'd20', modifier: -2 }, scripted([0]));
    if (!result.ok) throw new Error('expected a roll');

    expect(rollTotal(result.roll)).toBe(-1);
  });

  it('clamps a modifier past the band and says so, rather than losing the roll', () => {
    const result = rollPool({ die: 'd20', modifier: MAX_ROLL_MODIFIER + 1 }, scripted([0]));
    if (!result.ok) throw new Error('expected a roll');

    expect(result.roll.modifier).toBe(MAX_ROLL_MODIFIER);
    expect(result.warnings).toEqual([
      { reason: 'modifier-clamped', requested: MAX_ROLL_MODIFIER + 1, applied: MAX_ROLL_MODIFIER },
    ]);
  });

  it('clamps at the other end too', () => {
    const result = rollPool({ die: 'd20', modifier: -MAX_ROLL_MODIFIER - 1 }, scripted([0]));
    if (!result.ok) throw new Error('expected a roll');

    expect(result.roll.modifier).toBe(-MAX_ROLL_MODIFIER);
  });

  it('treats a modifier that is not a number as none at all', () => {
    const result = rollPool({ die: 'd20', modifier: Number.NaN }, scripted([0]));
    if (!result.ok) throw new Error('expected a roll');

    expect(result.roll.modifier).toBe(0);
    expect(result.warnings).toHaveLength(1);
  });

  it('sums the dice it actually rolled', () => {
    const result = rollPool({ die: 'd6', count: 3, modifier: 1 }, scripted([1, 2, 3]));
    if (!result.ok) throw new Error('expected a roll');

    expect(result.roll.dice.map((die) => die.value)).toEqual([2, 3, 4]);
    expect(rollTotal(result.roll)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Notation — the form a pack writes
// ---------------------------------------------------------------------------

describe('rolling a notation', () => {
  it('reads the count off the notation', () => {
    expect(facesOf(rollNotation('2d6'))).toHaveLength(2);
  });

  it('means one die when the notation has no count', () => {
    expect(facesOf(rollNotation('d100'))).toHaveLength(1);
  });

  it('carries a modifier the same way a pool does', () => {
    const result = rollNotation('2d6', 2, scripted([0]));
    if (!result.ok) throw new Error('expected a roll');

    expect(rollTotal(result.roll)).toBe(4);
  });

  it.each(['', 'd7', '2d', 'd20+1', '1d8/1d10', 'twenty', '0d6', '11d6'])(
    'refuses %p rather than guessing at it',
    (notation) => {
      const result = rollNotation(notation);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure).toEqual({ reason: 'notation', notation });
    },
  );
});

// ---------------------------------------------------------------------------
// When the randomness is not there
// ---------------------------------------------------------------------------

describe('a missing or broken source', () => {
  it('says so rather than falling back to Math.random', () => {
    vi.stubGlobal('crypto', undefined);
    const result = rollPool({ die: 'd20' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual({ reason: 'no-csprng' });
    expect(describeRollFailure(result.failure)).toContain('crypto.getRandomValues');
  });

  it('says so when the object is there but the function is not', () => {
    vi.stubGlobal('crypto', {});

    expect(rollPool({ die: 'd20' }).ok).toBe(false);
  });

  it('reports a source that throws, and rolls nothing', () => {
    const thrown = new Error('quota');
    const result = rollPool({ die: 'd20', count: 5 }, () => {
      throw thrown;
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual({ reason: 'source-threw', thrown });
  });

  it('uses the real CSPRNG by default', () => {
    const getRandomValues = vi.fn((words: Uint32Array) => {
      words[0] = 0;
      return words;
    });
    vi.stubGlobal('crypto', { getRandomValues });

    expect(facesOf(rollPool({ die: 'd20' }))).toEqual([1]);
    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(cryptoWords).toBeTypeOf('function');
  });
});

// ---------------------------------------------------------------------------
// Rolling among things — how "roll or choose" rolls (#35)
// ---------------------------------------------------------------------------

describe('rolling among things', () => {
  it('is one die with as many faces as there are things', () => {
    const result = rollAmong(6, scripted([3]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.roll.dice).toEqual([{ sides: 6, value: 4 }]);
    expect(result.roll.modifier).toBe(0);
  });

  // A die nobody owns is the point: the `Die` enum bounds what a *pack* may name, and a
  // list of thirty-three items still has to be chosen between fairly.
  it('rolls a count that is not a die anybody sells', () => {
    const result = rollAmong(33, scripted([0]));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.roll.dice[0]?.sides).toBe(33);
  });

  it('discards the biased tail, exactly as a die does', () => {
    const faces = 7;
    const limit = rejectionLimit(faces);
    const result = rollAmong(faces, scripted([limit, limit + 1, 3]));

    // The first two words are in the ragged tail. Folding either in would have skewed
    // the first face; both are thrown away and the third is what answers.
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.roll.dice[0]?.value).toBe(4);
  });

  it('refuses a list with nothing to decide, and one too long to be fair about', () => {
    for (const count of [0, 1, MIN_DIE_SIDES - 1, MAX_DIE_SIDES + 1, 2.5, Number.NaN]) {
      const result = rollAmong(count, scripted([0]));

      expect(result.ok, `${count}`).toBe(false);
      if (!result.ok) expect(result.failure.reason).toBe('faces');
    }
  });

  it('says what it refused, in a line a player could act on', () => {
    const result = rollAmong(1, scripted([0]));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(describeRollFailure(result.failure)).toContain('1');
  });

  it('reports a missing CSPRNG rather than choosing anything', () => {
    vi.stubGlobal('crypto', {});

    const result = rollAmong(6, cryptoWords);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.reason).toBe('no-csprng');
  });

  it('comes out flat over a large sample', () => {
    const faces = 7;
    const rolls = 70_000;
    const seen = new Map<number, number>();

    for (let rolled = 0; rolled < rolls; rolled += 1) {
      const result = rollAmong(faces);
      if (!result.ok) throw new Error(describeRollFailure(result.failure));

      const value = result.roll.dice[0]?.value ?? 0;
      seen.set(value, (seen.get(value) ?? 0) + 1);
    }

    expect(seen.size).toBe(faces);
    const expected = rolls / faces;
    for (const [face, count] of seen) {
      // A wide band: this is a smoke test for a `%` reduction sneaking back in, not a
      // statistics exam. A biased seventh face would sit about 14% off, not 10%.
      expect(Math.abs(count - expected) / expected, `face ${face}`).toBeLessThan(0.1);
    }
  });
});
