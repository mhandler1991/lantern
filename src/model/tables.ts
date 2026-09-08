/**
 * A table roll is a roll plus a lookup. Nothing else (DESIGN.md §4).
 *
 * ```
 * roll 2d6 → 8 → look up in a table → show that row's text
 * ```
 *
 * **The app never parses a result.** `"+2 to your spellcasting checks"` is a string an
 * author wrote, and the whole of what happens to it here is that it is found and handed
 * back. Nothing in this file reads a row's text, and nothing anywhere turns one into a
 * stat — a result lands on a sheet as words (PRD.md principle 1, DATA-MODEL.md §8). The
 * moment something in the app matches on `+2` is the moment it has become an effects
 * engine, which PRD.md §4 rules out permanently.
 *
 * Coverage lives here rather than in `pack.ts` for the reason DATA-MODEL.md §8 gives:
 * gaps and overlaps are **warnings, not refusals**. A table missing a row for 7 answers
 * for everything else, and losing the pack over it is the block PRD.md principle 4
 * forbids — so the schema checks that each row is well formed and this module, where the
 * lookup that would fall through the hole actually happens, says what is wrong with the
 * set of them.
 *
 * Pure, given its randomness, the same way `dice.ts` is: the source of random words is an
 * argument with a default, so a test drives a chosen face rather than hoping to roll one.
 */

import { MAX_TABLE_REROLLS } from '../constants';
import type { RandomWords, Roll, RollFailure } from './dice';
import { cryptoWords, describeRollFailure, dieSides, rollPool, rollTotal } from './dice';
import { dieNotationParts } from './enums';
import type { TableRoll, TableRow } from './pack';
import type { ResolvedTable } from './pack-resolver';
import type { Problem } from './problems';

/** An empty list, a count of nothing rolled away. A floor, not a rule of the game. */
const NONE = 0;

/** The first of something, and the step between two faces. */
const ONE = 1;

// ---------------------------------------------------------------------------
// What can be rolled on
// ---------------------------------------------------------------------------

/**
 * The three facts a lookup needs. Structural rather than `TableEntry`, because the rows
 * that get rolled on are **not** always the entry's own: an extension adds rows to a
 * table another pack defined (DATA-MODEL.md §9), and those live on the `ResolvedTable`
 * beside the entry rather than inside it. A function taking `TableEntry` would silently
 * roll on the un-extended table, which is a wrong answer that looks completely right.
 */
export type RollableTable = {
  readonly die: string;
  readonly rerollable: boolean;
  readonly rows: readonly TableRow[];
};

/** A resolved table as this module rolls on it — entry's rows *and* every extension's. */
export function rollableTable(table: ResolvedTable): RollableTable {
  return {
    die: table.entry.die,
    rerollable: table.entry.rerollable,
    rows: table.rows,
  };
}

// ---------------------------------------------------------------------------
// The span a notation covers
// ---------------------------------------------------------------------------

/** Every number a table's dice can produce, inclusive at both ends. */
export type TableSpan = {
  readonly low: number;
  readonly high: number;
};

/**
 * What `2d6` can roll: 2 through 12, not 1 through 12. A count of dice is a floor as
 * well as a multiplier, and a table written as though `2d6` could show a 1 has a row
 * nothing will ever land on.
 *
 * `null` when the string is not a notation at all. The notation is picked apart by
 * `enums.ts` — the same function `dice.ts` rolls through — so what a table may name and
 * what can be rolled cannot drift apart.
 */
export function tableSpan(die: string): TableSpan | null {
  const parts = dieNotationParts(die);
  if (parts === null) return null;

  return { low: parts.count, high: parts.count * dieSides(parts.die) };
}

/** A row's band, in the one shape the rest of the file compares. */
function rowSpan(roll: TableRoll): TableSpan {
  if (typeof roll === 'number') return { low: roll, high: roll };

  const [low, high] = roll;
  return { low, high };
}

/** Whether a number falls inside a band, both ends included. */
function covers(span: TableSpan, total: number): boolean {
  return total >= span.low && total <= span.high;
}

// ---------------------------------------------------------------------------
// The lookup
// ---------------------------------------------------------------------------

/**
 * The row a number lands on, or `null` when no row covers it.
 *
 * `null` is a real answer rather than a failure: a table with a gap still answers for
 * every other face, and the caller shows the number it rolled and says no row covers it
 * (PRD.md principle 4). 🚫 It never throws and never substitutes a neighbouring row —
 * a nearby answer presented as the answer is worse than no answer.
 *
 * **The first row that covers the number wins.** Overlaps are an authoring fault and are
 * reported by `coverageProblems`, but a lookup still has to be deterministic: reading in
 * order means the same roll gives the same row on every machine at the table, which is
 * the property that matters once a result is being read aloud.
 */
export function rowFor(table: RollableTable, total: number): TableRow | null {
  return table.rows.find((row) => covers(rowSpan(row.roll), total)) ?? null;
}

// ---------------------------------------------------------------------------
// Coverage — warnings, never refusals
// ---------------------------------------------------------------------------

/** `7`, or `7-9` for a run. A list of every missing face would be a wall, not a report. */
function renderRun(low: number, high: number): string {
  return low === high ? `${low}` : `${low}-${high}`;
}

/** Consecutive missing faces, collapsed into the runs an author would read. */
function renderMissing(missing: readonly number[]): string {
  const runs: string[] = [];
  let low = missing[NONE] as number;
  let previous = low;

  for (const face of missing.slice(ONE)) {
    if (face === previous + ONE) {
      previous = face;
      continue;
    }
    runs.push(renderRun(low, previous));
    low = face;
    previous = face;
  }
  runs.push(renderRun(low, previous));

  return runs.join(', ');
}

/**
 * What is wrong with a table's rows taken together: a row outside what its dice can
 * roll, two rows claiming the same face, and a face no row claims at all.
 *
 * Every one of them is a `Problem` in the format the whole app reports in
 * (`problems.ts`) — path, expectation, and what was actually there — because these lines
 * are written to be pasted back into an AI alongside the pack that produced them
 * (DATA-MODEL.md §10). Paths are relative to the table: `rows[3].roll`.
 *
 * 🚫 **Nothing here refuses anything.** The list is a report; the table it describes is
 * still rollable and every face that does have a row still answers.
 */
export function coverageProblems(table: RollableTable): readonly Problem[] {
  const problems: Problem[] = [];
  const span = tableSpan(table.die);

  if (span === null) {
    return [
      {
        path: 'die',
        message: `expected dice notation such as 2d6 or d20 — got ${JSON.stringify(table.die)}`,
      },
    ];
  }

  /** Which row claimed each face first, so an overlap can name the row it collides with. */
  const claimedBy = new Map<number, number>();

  table.rows.forEach((row, index) => {
    const band = rowSpan(row.roll);

    if (band.low < span.low || band.high > span.high) {
      problems.push({
        path: `rows[${index}].roll`,
        message:
          `expected a roll between ${span.low} and ${span.high}, the span of ${table.die} — ` +
          `got ${renderRun(band.low, band.high)}`,
      });
    }

    // One line per colliding row, not one per shared face: two rows overlapping across
    // four faces is one mistake, and four copies of it buries the rest of the report.
    // The row keeps claiming either way — an overlapping row still covers what it
    // covers, and stopping at the collision would report the rest of it as a gap.
    let reported = false;

    for (let face = band.low; face <= band.high; face += ONE) {
      const claimed = claimedBy.get(face);
      if (claimed === undefined) {
        claimedBy.set(face, index);
        continue;
      }
      if (reported) continue;

      problems.push({
        path: `rows[${index}].roll`,
        message: `expected a band no other row covers — ${face} is already covered by rows[${claimed}]`,
      });
      reported = true;
    }
  });

  const missing: number[] = [];
  for (let face = span.low; face <= span.high; face += ONE) {
    if (!claimedBy.has(face)) missing.push(face);
  }

  if (missing.length > NONE) {
    problems.push({
      path: 'rows',
      message:
        `expected a row for every roll ${table.die} can make — ` +
        `nothing covers ${renderMissing(missing)}`,
    });
  }

  return problems;
}

/**
 * Coverage over every table in a resolved stack, in the shape `resolvePacks` warns in.
 *
 * This is the call that makes coverage reach anybody. `coverageProblems` has told the
 * truth about one table since #141 and nothing asked it, so a pack with a hole at 7
 * loaded in silence and the author found out when somebody rolled a 7 (#142).
 *
 * Two things it does that a caller looping itself would get wrong:
 *
 *   - It reads `rollableTable`, so the rows an **extension** added count. A table left
 *     two faces short by its own pack and completed by a supplement — which is exactly
 *     what `packs/example-pack.json` does — is complete, and saying otherwise would
 *     teach authors to distrust the report.
 *   - It paths every problem to the table in the stack the warning is about and names
 *     that table's reference, because `rows[3].roll` on its own says nothing about
 *     *which* table, and the whole point of a problem line is that it can be acted on
 *     (DATA-MODEL.md §10).
 *
 * 🚫 Warnings, never refusals. The stack this describes is the stack that is returned.
 */
export function tableCoverageProblems(tables: readonly ResolvedTable[]): readonly Problem[] {
  return tables.flatMap((table, index) =>
    coverageProblems(rollableTable(table)).map((problem) => ({
      path: `tables[${index}].${problem.path}`,
      message: `${problem.message} (${table.ref})`,
    })),
  );
}

// ---------------------------------------------------------------------------
// Rolling on one
// ---------------------------------------------------------------------------

/** One throw and what it found. The unit a reroll discards. */
export type TableThrow = {
  readonly roll: Roll;
  /** The number that was looked up — the dice, summed. */
  readonly total: number;
  /** The row it landed on, or `null` for a face no row covers. */
  readonly row: TableRow | null;
};

/**
 * A throw, plus whatever was thrown away to reach it.
 *
 * `canReroll` is an *offer*, and only a `rerollable` table makes one (DATA-MODEL.md §8).
 * It is the model's whole part in "a reroll before the result is kept": keeping is the
 * caller's — nothing here stores a result, and a result that is never kept costs nothing.
 */
export type TableResult = TableThrow & {
  /** Thrown away by a reroll, oldest first. Kept so the overlay can show what was passed up. */
  readonly discarded: readonly TableThrow[];
  readonly canReroll: boolean;
};

/** A reroll nobody was offered, on top of every way a roll itself fails (`dice.ts`). */
export type TableRollFailure = RollFailure | { readonly reason: 'reroll-not-offered' };

export type TableRollResult =
  | { readonly ok: true; readonly result: TableResult }
  | { readonly ok: false; readonly failure: TableRollFailure };

/** One line a player can act on, in the same voice as `dice.ts` and `problems.ts`. */
export function describeTableRollFailure(failure: TableRollFailure): string {
  if (failure.reason === 'reroll-not-offered') {
    return 'this table offers no reroll — roll on it again to start over';
  }
  return describeRollFailure(failure);
}

/** The throw a result is, without the history it carries. */
function thrown(result: TableResult): TableThrow {
  return { roll: result.roll, total: result.total, row: result.row };
}

/** Whether another reroll is on offer, given how many have already been taken. */
function offersReroll(table: RollableTable, discarded: readonly TableThrow[]): boolean {
  return table.rerollable && discarded.length < MAX_TABLE_REROLLS;
}

/** Roll the table's dice, sum them, and find the row — the whole operation, once. */
function throwOnce(
  table: RollableTable,
  discarded: readonly TableThrow[],
  random: RandomWords,
): TableRollResult {
  const parts = dieNotationParts(table.die);
  if (parts === null) {
    return { ok: false, failure: { reason: 'notation', notation: table.die } };
  }

  // 🚫 No modifier. A table roll is the dice and nothing else (DESIGN.md §4) — a bonus
  // added here would move which row came up, which is adjudication wearing arithmetic.
  const rolled = rollPool({ die: parts.die, count: parts.count }, random);
  if (!rolled.ok) return { ok: false, failure: rolled.failure };

  const total = rollTotal(rolled.roll);

  return {
    ok: true,
    result: {
      roll: rolled.roll,
      total,
      row: rowFor(table, total),
      discarded,
      canReroll: offersReroll(table, discarded),
    },
  };
}

/**
 * Roll on a table. This is the operation DESIGN.md §4 describes and there is nothing
 * else to it: dice, a total, the row that total lands on.
 *
 * **A table roll is never chosen from the overlay.** It arrives from context — a level
 * up opens the class's talent table, the DM's loot button opens a loot table — so a
 * caller always has the table in hand and there is nothing to look up by name here.
 */
export function rollOnTable(
  table: RollableTable,
  random: RandomWords = cryptoWords,
): TableRollResult {
  return throwOnce(table, [], random);
}

/**
 * Take the reroll a table offered: throw again, keeping what was passed up.
 *
 * Refused when no offer stands — a table that is not `rerollable`, or one whose single
 * offer has been taken (`MAX_TABLE_REROLLS`). Refusing rather than quietly rolling again
 * is what keeps the offer meaningful; rolling on the table from the top is always
 * available and is a different act, which is why it is a different function.
 */
export function rerollTable(
  table: RollableTable,
  previous: TableResult,
  random: RandomWords = cryptoWords,
): TableRollResult {
  if (!previous.canReroll) return { ok: false, failure: { reason: 'reroll-not-offered' } };

  return throwOnce(table, [...previous.discarded, thrown(previous)], random);
}
