/**
 * The report itself. DATA-MODEL.md §10 — these lines are pasted back into an AI along
 * with the file that produced them, so what is asserted here is the sentence, not just
 * that something failed.
 *
 * Three things every test below is really checking: the **path** can be searched for in
 * the file, the **expectation** says what would have been accepted, and the **actual**
 * says what was there instead. 🚫 A message that carries only the first two is the
 * "Invalid pack" this module exists to refuse.
 */

import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { MAX_PROBLEM_VALUE_LENGTH } from '../constants';
import { formatPath, formatProblems, reportProblems, validate, type Problem } from './problems';

const Spell = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/u),
  name: z.string().min(1).max(20),
  tier: z.int().min(1).max(5),
  range: z.enum(['self', 'close', 'near', 'far']),
  roll: z.union([z.int(), z.array(z.int())]).optional(),
});

const HOARFROST = { id: 'hoarfrost', name: 'Hoarfrost', tier: 2, range: 'near' };

function problemsIn(input: unknown): readonly Problem[] {
  const result = validate(Spell, input);
  if (result.ok) throw new Error('expected the parse to fail, and it succeeded');
  return result.problems;
}

/** One problem, as the line it would be pasted as. */
function lineIn(input: unknown): string {
  const problems = problemsIn(input);
  expect(problems).toHaveLength(1);
  return `${problems[0]?.path} — ${problems[0]?.message}`;
}

describe('validate', () => {
  it('returns the parsed value rather than the input', () => {
    const result = validate(Spell, { ...HOARFROST, tier: 2 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.name).toBe('Hoarfrost');
  });
});

describe('path, expectation and actual', () => {
  it('writes the line DATA-MODEL.md §10 says it writes', () => {
    expect(lineIn({ ...HOARFROST, range: 'medium' })).toBe(
      'range — expected one of: self, close, near, far — got "medium"',
    );
  });

  it('says what was there when the type is wrong, not only what was wanted', () => {
    expect(lineIn({ ...HOARFROST, tier: 'two' })).toBe('tier — expected a number — got "two"');
  });

  it('tells a string apart from the number it looks like', () => {
    expect(lineIn({ ...HOARFROST, tier: '2' })).toContain('got "2"');
  });

  it('names the field a bound belongs to and the value that broke it', () => {
    expect(lineIn({ ...HOARFROST, tier: 9 })).toBe('tier — expected at most 5 — got 9');
  });

  it('reports how long a too-long string was, not the string itself', () => {
    const line = lineIn({ ...HOARFROST, name: 'n'.repeat(40) });
    expect(line).toBe('name — expected at most 20 characters — got 40 characters');
    expect(line).not.toContain('nnn');
  });

  it('shortens a value too long to sit at the end of a line', () => {
    const line = lineIn({ ...HOARFROST, id: 'X'.repeat(MAX_PROBLEM_VALUE_LENGTH * 2) });
    expect(line).toContain('…');
    expect(line.length).toBeLessThan(MAX_PROBLEM_VALUE_LENGTH * 2);
  });

  it('quotes a pattern an author can compare their value against', () => {
    expect(lineIn({ ...HOARFROST, id: 'Hoarfrost' })).toBe(
      'id — expected text matching /^[a-z0-9-]+$/u — got "Hoarfrost"',
    );
  });
});

describe('a field that is not there', () => {
  it('is reported against the object that should have held it, and named', () => {
    const withoutTier: Record<string, unknown> = { ...HOARFROST };
    delete withoutTier.tier;

    expect(lineIn(withoutTier)).toBe('(root) — missing required field: tier');
  });

  it('is named inside the array entry it is missing from', () => {
    const Pack = z.strictObject({ spells: z.array(Spell) });
    const spells = [HOARFROST, HOARFROST, HOARFROST, { ...HOARFROST, tier: undefined }];

    const result = validate(Pack, { spells });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems).toEqual([
        { path: 'spells[3]', message: 'missing required field: tier' },
      ]);
    }
  });

  it('says nothing about a value, because there is no value to say anything about', () => {
    const withoutRange: Record<string, unknown> = { ...HOARFROST };
    delete withoutRange.range;

    expect(lineIn(withoutRange)).not.toContain('got');
  });
});

describe('a field that should not be there', () => {
  it('is reported at its own path, so an author can search for it', () => {
    expect(lineIn({ ...HOARFROST, onLoad: 'alert(1)' })).toBe(
      'onLoad — unknown field — remove it, or check the spelling',
    );
  });

  it('gets a line each, because each is a separate thing to delete', () => {
    const problems = problemsIn({ ...HOARFROST, onLoad: 1, ac: 2 });
    expect(problems.map((problem) => problem.path)).toEqual(['onLoad', 'ac']);
  });
});

describe('every problem, not just the first', () => {
  it('reports all of them in one pass', () => {
    const problems = problemsIn({ id: 'Bad Id', name: '', tier: 9, range: 'medium' });

    expect(problems.map((problem) => problem.path)).toEqual(['id', 'name', 'tier', 'range']);
  });

  it('reports a problem in every entry of a list, not the first entry only', () => {
    const Pack = z.strictObject({ spells: z.array(Spell) });
    const result = validate(Pack, {
      spells: [
        { ...HOARFROST, range: 'medium' },
        { ...HOARFROST, tier: 9 },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.map((problem) => problem.path)).toEqual([
        'spells[0].range',
        'spells[1].tier',
      ]);
    }
  });
});

describe('a value that could have been several things', () => {
  it('says all of them on one line rather than "invalid input"', () => {
    expect(lineIn({ ...HOARFROST, roll: 'x' })).toBe(
      'roll — expected a number or a list — got "x"',
    );
  });

  it('keeps the problems inside the branch that got furthest', () => {
    const problems = problemsIn({ ...HOARFROST, roll: [1, 'two'] });
    expect(formatProblems(problems)).toContain('roll[1]');
  });
});

describe('a schema that writes its own expectation', () => {
  it('is used verbatim, so a field can explain itself', () => {
    const Ref = z.strictObject({
      target: z.string().regex(/^[a-z:]+$/u, 'expected a reference such as core:item:dagger'),
    });

    const result = validate(Ref, { target: 'Dagger!' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems[0]?.message).toBe(
        'expected a reference such as core:item:dagger — got "Dagger!"',
      );
    }
  });
});

describe('"invalid" is never the whole message', () => {
  const wrong: readonly unknown[] = [
    null,
    [],
    'a string',
    42,
    { ...HOARFROST, range: 'medium' },
    { ...HOARFROST, tier: null },
    { ...HOARFROST, id: {} },
    { ...HOARFROST, name: undefined },
    { ...HOARFROST, roll: { of: 1 } },
    { ...HOARFROST, sneaky: '<script>' },
  ];

  it.each(wrong.map((input, index) => [index, input]))(
    'says what was expected in every problem of case %i',
    (_index, input) => {
      for (const problem of problemsIn(input)) {
        expect(problem.message).not.toBe('Invalid input');
        expect(problem.message).toMatch(/^(expected|missing|unknown|a payload)/u);
      }
    },
  );
});

describe('formatPath', () => {
  it('names the value as a whole when there is no path to it', () => {
    expect(formatPath([])).toBe('(root)');
  });

  it('writes an index as an index and a field as a field', () => {
    expect(formatPath(['items', 3, 'qty'])).toBe('items[3].qty');
    expect(formatPath([0, 'roll'])).toBe('[0].roll');
  });
});

describe('the block, ready to paste', () => {
  const problems: readonly Problem[] = [
    { path: 'spells[4].range', message: 'expected one of: self, close, near, far — got "medium"' },
    { path: 'spells[7]', message: 'missing required field: tier' },
  ];

  it('heads the lines with what failed and how much of it did', () => {
    expect(reportProblems(problems, 'Frostbound')).toBe(
      [
        '2 problems in "Frostbound":',
        '  spells[4].range — expected one of: self, close, near, far — got "medium"',
        '  spells[7] — missing required field: tier',
      ].join('\n'),
    );
  });

  it('counts one problem as one problem', () => {
    expect(reportProblems(problems.slice(0, 1), 'Frostbound')).toContain(
      '1 problem in "Frostbound":',
    );
  });

  it('formats one problem per line, path first', () => {
    expect(formatProblems(problems).split('\n')).toHaveLength(2);
    expect(formatProblems(problems)).toContain('  spells[7] — missing required field: tier');
  });
});
