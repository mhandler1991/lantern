/**
 * A table lookup fails silently or not at all: every wrong answer here is a real row
 * with real text, printed for a roll it does not belong to (CLAUDE.md §7). Nothing
 * throws, nothing looks broken, and the only person who could catch it is an author
 * reading their own table back against what the app said.
 *
 * So the boundaries are the test. A `[3, 6]` row must answer for 3 and for 6 and not for
 * 2 or 7; `2d6` must know its span starts at 2 rather than 1; a gap must read as *no
 * row*, never as the nearest row. The coverage report is tested for what it says as well
 * as how many problems it finds, because a report is only worth having if an author can
 * act on the line.
 *
 * The shipped core tables are checked too, at the end: four real talent tables whose
 * rows have to cover 2d6 exactly.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CORE_PACK_PATH, MAX_TABLE_REROLLS } from '../constants';
import type { RandomWords } from './dice';
import { parsePack } from './pack';
import type { TableRow } from './pack';
import { resolvePacks } from './pack-resolver';
import type { Problem } from './problems';
import {
  coverageProblems,
  describeTableRollFailure,
  rerollTable,
  rollOnTable,
  rollableTable,
  rowFor,
  tableSpan,
  type RollableTable,
  type TableResult,
} from './tables';

/** The example from DATA-MODEL.md §8, minus the fields a lookup does not read. */
const TALENTS: RollableTable = {
  die: '2d6',
  rerollable: false,
  rows: [
    { roll: 2, text: 'Choose a talent or +2 to a stat' },
    { roll: [3, 6], text: '+1 to melee and ranged attacks' },
    { roll: [7, 9], text: '+2 to your spellcasting checks' },
    { roll: [10, 11], text: '+1 to a stat of your choice' },
    { roll: 12, text: 'Choose any talent' },
  ],
};

/** The same table, offering the reroll DATA-MODEL.md §8 lets a table offer. */
const REROLLABLE: RollableTable = { ...TALENTS, rerollable: true };

/**
 * A source that produces the faces it is given, in order.
 *
 * `dice.ts` turns a word below the rejection limit into `(word % sides) + 1`, so a face
 * `f` is the word `f - 1`. Small words are far below every limit, which is what makes a
 * chosen roll a chosen roll rather than one this test hopes for.
 */
function faces(wanted: readonly number[]): RandomWords {
  let next = 0;
  return (into) => {
    const face = wanted[Math.min(next, wanted.length - 1)] as number;
    into[0] = face - 1;
    next += 1;
  };
}

/** Unwraps a roll that must have succeeded, so a failure fails the test that expected one. */
function resultOf(rolled: ReturnType<typeof rollOnTable>): TableResult {
  if (!rolled.ok) throw new Error(`expected a result, got ${describeTableRollFailure(rolled.failure)}`);
  return rolled.result;
}

/** What a row says, or the fact that there was no row. */
function textOf(row: TableRow | null): string | null {
  return row === null ? null : row.text;
}

/** One line per problem, the way a report is read. */
function lines(problems: readonly Problem[]): readonly string[] {
  return problems.map((problem) => `${problem.path} — ${problem.message}`);
}

// ---------------------------------------------------------------------------
// The span a notation covers
// ---------------------------------------------------------------------------

describe('tableSpan', () => {
  it('starts a multi-die span at the count, not at one', () => {
    expect(tableSpan('2d6')).toEqual({ low: 2, high: 12 });
    expect(tableSpan('3d6')).toEqual({ low: 3, high: 18 });
  });

  it('reads the three notations DATA-MODEL.md §8 names', () => {
    expect(tableSpan('2d6')).toEqual({ low: 2, high: 12 });
    expect(tableSpan('1d20')).toEqual({ low: 1, high: 20 });
    expect(tableSpan('d100')).toEqual({ low: 1, high: 100 });
  });

  it('defaults an omitted count to one die', () => {
    expect(tableSpan('d6')).toEqual(tableSpan('1d6'));
    expect(tableSpan('d20')).toEqual(tableSpan('1d20'));
  });

  it('answers null for anything that is not a notation', () => {
    for (const die of ['', 'd7', '2d6+1', 'two d6', '0d6', 'd', '1d20 ']) {
      expect(tableSpan(die)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// The lookup — boundaries
// ---------------------------------------------------------------------------

describe('rowFor', () => {
  it('answers every face of 2d6 with the row that covers it', () => {
    const found = Array.from({ length: 11 }, (_, i) => textOf(rowFor(TALENTS, i + 2)));

    expect(found).toEqual([
      'Choose a talent or +2 to a stat',
      '+1 to melee and ranged attacks',
      '+1 to melee and ranged attacks',
      '+1 to melee and ranged attacks',
      '+1 to melee and ranged attacks',
      '+2 to your spellcasting checks',
      '+2 to your spellcasting checks',
      '+2 to your spellcasting checks',
      '+1 to a stat of your choice',
      '+1 to a stat of your choice',
      'Choose any talent',
    ]);
  });

  it('includes both ends of a range', () => {
    expect(textOf(rowFor(TALENTS, 3))).toBe('+1 to melee and ranged attacks');
    expect(textOf(rowFor(TALENTS, 6))).toBe('+1 to melee and ranged attacks');
    expect(textOf(rowFor(TALENTS, 7))).toBe('+2 to your spellcasting checks');
    expect(textOf(rowFor(TALENTS, 9))).toBe('+2 to your spellcasting checks');
  });

  it('treats a single number as a band of one', () => {
    const table: RollableTable = {
      die: '1d20',
      rerollable: false,
      rows: [{ roll: [1, 19], text: 'nothing' }, { roll: 20, text: 'something' }],
    };

    expect(textOf(rowFor(table, 19))).toBe('nothing');
    expect(textOf(rowFor(table, 20))).toBe('something');
  });

  it('accepts a one-face range written longhand', () => {
    const table: RollableTable = {
      die: '1d20',
      rerollable: false,
      rows: [{ roll: [7, 7], text: 'exactly seven' }],
    };

    expect(textOf(rowFor(table, 7))).toBe('exactly seven');
    expect(rowFor(table, 6)).toBeNull();
    expect(rowFor(table, 8)).toBeNull();
  });

  it('answers null for a face no row covers rather than the nearest row', () => {
    const gapped: RollableTable = {
      die: '2d6',
      rerollable: false,
      rows: [{ roll: [2, 6], text: 'low' }, { roll: [10, 12], text: 'high' }],
    };

    expect(rowFor(gapped, 7)).toBeNull();
    expect(rowFor(gapped, 9)).toBeNull();
    expect(textOf(rowFor(gapped, 6))).toBe('low');
    expect(textOf(rowFor(gapped, 10))).toBe('high');
  });

  it('answers null outside the table entirely, at both ends', () => {
    expect(rowFor(TALENTS, 1)).toBeNull();
    expect(rowFor(TALENTS, 13)).toBeNull();
  });

  it('gives the first row that covers a face when two do', () => {
    const overlapping: RollableTable = {
      die: '1d20',
      rerollable: false,
      rows: [{ roll: [1, 10], text: 'first' }, { roll: [5, 15], text: 'second' }],
    };

    expect(textOf(rowFor(overlapping, 5))).toBe('first');
    expect(textOf(rowFor(overlapping, 10))).toBe('first');
    expect(textOf(rowFor(overlapping, 11))).toBe('second');
  });

  it('answers null for a table with no rows at all', () => {
    expect(rowFor({ die: '2d6', rerollable: false, rows: [] }, 7)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Coverage — gaps, overlaps, and rows outside the span
// ---------------------------------------------------------------------------

describe('coverageProblems', () => {
  it('finds nothing wrong with a table that covers its span exactly', () => {
    expect(coverageProblems(TALENTS)).toEqual([]);
  });

  it('names the run a gap leaves', () => {
    const gapped: RollableTable = {
      die: '2d6',
      rerollable: false,
      rows: [{ roll: [2, 6], text: 'low' }, { roll: [10, 12], text: 'high' }],
    };

    expect(lines(coverageProblems(gapped))).toEqual([
      'rows — expected a row for every roll 2d6 can make — nothing covers 7-9',
    ]);
  });

  it('names a single missing face without pretending it is a range', () => {
    const gapped: RollableTable = {
      die: '2d6',
      rerollable: false,
      rows: [{ roll: [2, 6], text: 'low' }, { roll: [8, 12], text: 'high' }],
    };

    expect(lines(coverageProblems(gapped))).toEqual([
      'rows — expected a row for every roll 2d6 can make — nothing covers 7',
    ]);
  });

  it('collapses several gaps into runs in one problem', () => {
    const gapped: RollableTable = {
      die: '2d6',
      rerollable: false,
      rows: [{ roll: 2, text: 'a' }, { roll: [4, 6], text: 'b' }, { roll: [10, 11], text: 'c' }],
    };

    expect(lines(coverageProblems(gapped))).toEqual([
      'rows — expected a row for every roll 2d6 can make — nothing covers 3, 7-9, 12',
    ]);
  });

  it('reports a table with no rows as covering none of its span', () => {
    const empty: RollableTable = { die: '2d6', rerollable: false, rows: [] };

    expect(lines(coverageProblems(empty))).toEqual([
      'rows — expected a row for every roll 2d6 can make — nothing covers 2-12',
    ]);
  });

  it('names the row an overlap collides with', () => {
    const overlapping: RollableTable = {
      die: '1d20',
      rerollable: false,
      rows: [{ roll: [1, 10], text: 'first' }, { roll: [5, 20], text: 'second' }],
    };

    expect(lines(coverageProblems(overlapping))).toEqual([
      'rows[1].roll — expected a band no other row covers — 5 is already covered by rows[0]',
    ]);
  });

  it('reports one line per overlapping row, not one per shared face', () => {
    const overlapping: RollableTable = {
      die: '1d20',
      rerollable: false,
      rows: [{ roll: [1, 20], text: 'everything' }, { roll: [5, 9], text: 'again' }],
    };

    expect(coverageProblems(overlapping)).toHaveLength(1);
  });

  it('catches a duplicate single face', () => {
    const duplicated: RollableTable = {
      die: '1d20',
      rerollable: false,
      rows: [{ roll: [1, 19], text: 'most' }, { roll: 20, text: 'crit' }, { roll: 20, text: 'also crit' }],
    };

    expect(lines(coverageProblems(duplicated))).toEqual([
      'rows[2].roll — expected a band no other row covers — 20 is already covered by rows[1]',
    ]);
  });

  it('reports a row below the span of a multi-die table', () => {
    const below: RollableTable = {
      die: '2d6',
      rerollable: false,
      rows: [{ roll: 1, text: 'unreachable' }, { roll: [2, 12], text: 'everything' }],
    };

    expect(lines(coverageProblems(below))).toEqual([
      'rows[0].roll — expected a roll between 2 and 12, the span of 2d6 — got 1',
    ]);
  });

  it('reports a row above the span, printing the band it named', () => {
    const above: RollableTable = {
      die: '2d6',
      rerollable: false,
      rows: [{ roll: [2, 12], text: 'everything' }, { roll: [13, 18], text: 'off the end' }],
    };

    expect(lines(coverageProblems(above))).toEqual([
      'rows[1].roll — expected a roll between 2 and 12, the span of 2d6 — got 13-18',
    ]);
  });

  it('reports a band that runs off the end as one problem, and still counts its faces', () => {
    const spilling: RollableTable = {
      die: '2d6',
      rerollable: false,
      rows: [{ roll: [2, 6], text: 'low' }, { roll: [7, 14], text: 'high' }],
    };

    // Out of span, but 7 through 12 are covered — so no gap is reported alongside it.
    expect(lines(coverageProblems(spilling))).toEqual([
      'rows[1].roll — expected a roll between 2 and 12, the span of 2d6 — got 7-14',
    ]);
  });

  it('says only that the notation is unreadable when it is', () => {
    const unreadable: RollableTable = {
      die: '2d7',
      rerollable: false,
      rows: [{ roll: 1, text: 'anything' }],
    };

    expect(lines(coverageProblems(unreadable))).toEqual([
      'die — expected dice notation such as 2d6 or d20 — got "2d7"',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Rolling on a table
// ---------------------------------------------------------------------------

describe('rollOnTable', () => {
  it('rolls the notation and looks the total up', () => {
    const result = resultOf(rollOnTable(TALENTS, faces([3, 4])));

    expect(result.total).toBe(7);
    expect(result.roll.dice).toEqual([
      { sides: 6, value: 3 },
      { sides: 6, value: 4 },
    ]);
    expect(textOf(result.row)).toBe('+2 to your spellcasting checks');
  });

  it('rolls one die when the notation names no count', () => {
    const table: RollableTable = {
      die: 'd100',
      rerollable: false,
      rows: [{ roll: [1, 100], text: 'anything' }],
    };
    const result = resultOf(rollOnTable(table, faces([42])));

    expect(result.roll.dice).toEqual([{ sides: 100, value: 42 }]);
    expect(result.total).toBe(42);
  });

  it('adds no modifier — the total is the dice', () => {
    const result = resultOf(rollOnTable(TALENTS, faces([1, 1])));

    expect(result.roll.modifier).toBe(0);
    expect(result.total).toBe(2);
    expect(textOf(result.row)).toBe('Choose a talent or +2 to a stat');
  });

  it('hands back a null row for a gap rather than failing', () => {
    const gapped: RollableTable = {
      die: '2d6',
      rerollable: false,
      rows: [{ roll: [2, 6], text: 'low' }],
    };
    const result = resultOf(rollOnTable(gapped, faces([6, 6])));

    expect(result.total).toBe(12);
    expect(result.row).toBeNull();
  });

  it('refuses a table whose die is not a notation', () => {
    const unreadable: RollableTable = { die: 'd7', rerollable: false, rows: [] };
    const rolled = rollOnTable(unreadable, faces([1]));

    expect(rolled.ok).toBe(false);
    if (rolled.ok) return;
    expect(rolled.failure).toEqual({ reason: 'notation', notation: 'd7' });
    expect(describeTableRollFailure(rolled.failure)).toContain('2d6');
  });

  it('passes a dice failure through unchanged', () => {
    const throwing: RandomWords = () => {
      throw new Error('no entropy');
    };
    const rolled = rollOnTable(TALENTS, throwing);

    expect(rolled.ok).toBe(false);
    if (rolled.ok) return;
    expect(rolled.failure.reason).toBe('source-threw');
    expect(describeTableRollFailure(rolled.failure)).toBe(
      'the random source failed — no dice were rolled',
    );
  });

  it('offers no reroll on a table that is not rerollable', () => {
    expect(resultOf(rollOnTable(TALENTS, faces([3, 4]))).canReroll).toBe(false);
  });

  it('starts with nothing discarded', () => {
    expect(resultOf(rollOnTable(REROLLABLE, faces([3, 4]))).discarded).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The reroll a table offers
// ---------------------------------------------------------------------------

describe('rerollTable', () => {
  it('offers a reroll on a rerollable table', () => {
    expect(resultOf(rollOnTable(REROLLABLE, faces([1, 1]))).canReroll).toBe(true);
  });

  it('throws again and keeps what was passed up', () => {
    const random = faces([1, 1, 6, 6]);
    const first = resultOf(rollOnTable(REROLLABLE, random));
    const second = resultOf(rerollTable(REROLLABLE, first, random));

    expect(first.total).toBe(2);
    expect(second.total).toBe(12);
    expect(textOf(second.row)).toBe('Choose any talent');
    expect(second.discarded).toEqual([{ roll: first.roll, total: 2, row: first.row }]);
  });

  it('offers exactly the rerolls MAX_TABLE_REROLLS allows, then stops', () => {
    const random = faces([1, 1, 3, 3, 6, 6]);
    let result = resultOf(rollOnTable(REROLLABLE, random));

    for (let taken = 0; taken < MAX_TABLE_REROLLS; taken += 1) {
      expect(result.canReroll).toBe(true);
      result = resultOf(rerollTable(REROLLABLE, result, random));
    }

    expect(result.canReroll).toBe(false);
    expect(result.discarded).toHaveLength(MAX_TABLE_REROLLS);
  });

  it('refuses a reroll nobody was offered', () => {
    const first = resultOf(rollOnTable(TALENTS, faces([3, 4])));
    const rerolled = rerollTable(TALENTS, first, faces([1, 1]));

    expect(rerolled.ok).toBe(false);
    if (rerolled.ok) return;
    expect(rerolled.failure).toEqual({ reason: 'reroll-not-offered' });
    expect(describeTableRollFailure(rerolled.failure)).toContain('offers no reroll');
  });

  it('leaves the result it was given untouched', () => {
    const random = faces([1, 1, 6, 6]);
    const first = resultOf(rollOnTable(REROLLABLE, random));
    resultOf(rerollTable(REROLLABLE, first, random));

    expect(first.total).toBe(2);
    expect(first.discarded).toEqual([]);
    expect(first.canReroll).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A resolved table, extensions included
// ---------------------------------------------------------------------------

describe('rollableTable', () => {
  it('rolls on the rows an extension added, not only the ones the entry defines', () => {
    const defining = parsePack({
      format: 'lantern-pack',
      formatVersion: 1,
      id: 'base-pack',
      name: 'Base',
      version: '1.0.0',
      tables: [
        {
          id: 'quirks',
          name: 'Quirks',
          die: '1d20',
          rows: [{ roll: [1, 10], text: 'from the base pack' }],
        },
      ],
    });
    const extending = parsePack({
      format: 'lantern-pack',
      formatVersion: 1,
      id: 'more-pack',
      name: 'More',
      version: '1.0.0',
      extends: [
        {
          target: 'base-pack:table:quirks',
          rows: [{ roll: [11, 20], text: 'from the supplement' }],
        },
      ],
    });

    if (!defining.ok || !extending.ok) throw new Error('the fixture packs must parse');

    const stack = resolvePacks([defining.pack, extending.pack]);
    const resolved = stack.tables[0];
    if (resolved === undefined) throw new Error('the table must resolve');

    const table = rollableTable(resolved);

    expect(table.die).toBe('1d20');
    expect(table.rerollable).toBe(false);
    expect(coverageProblems(table)).toEqual([]);
    expect(textOf(rowFor(table, 15))).toBe('from the supplement');
  });
});

// ---------------------------------------------------------------------------
// The tables the app actually ships
// ---------------------------------------------------------------------------

describe('the shipped core tables', () => {
  const parsed = parsePack(
    JSON.parse(readFileSync(resolve(process.cwd(), 'public', CORE_PACK_PATH), 'utf8')),
  );
  if (!parsed.ok) throw new Error('core.json does not parse');

  const stack = resolvePacks([parsed.pack]);

  it('has tables to roll on', () => {
    expect(stack.tables.length).toBeGreaterThan(0);
  });

  it.each(stack.tables.map((table) => [table.entry.id, table] as const))(
    'covers every face of %s with exactly one row',
    (_id, table) => {
      expect(coverageProblems(rollableTable(table))).toEqual([]);
    },
  );

  it.each(stack.tables.map((table) => [table.entry.id, table] as const))(
    'answers every roll on %s with a row',
    (_id, table) => {
      const rollable = rollableTable(table);
      const span = tableSpan(rollable.die);
      if (span === null) throw new Error(`${rollable.die} is not a notation`);

      for (let total = span.low; total <= span.high; total += 1) {
        expect(rowFor(rollable, total)).not.toBeNull();
      }
    },
  );
});
