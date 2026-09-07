/**
 * The roll feed, and the one entry the corner is showing right now.
 *
 * **Roll, then show the number.** Every entry in here is built *from* a result that
 * `model/dice.ts` or `model/tables.ts` has already produced — there is no target, no
 * intended value and nothing to animate toward (DESIGN.md §4). That ordering is the
 * whole reason the predecessor project's dice bugs cannot be written here: a component
 * downstream of this hook has no number to disagree with, because it is handed the only
 * one there is.
 *
 * Two lifetimes, deliberately different:
 *
 *   - **The feed is permanent.** An entry is prepended and never removed by the passage
 *     of time. That is the difference between a feed and a toast, and it is what makes a
 *     roll something the table can refer back to two minutes later.
 *   - **What is *showing* is not.** It clears itself after `DICE_OVERLAY_DWELL_MS`,
 *     which is what stops somebody else's roll sitting on your screen (DESIGN.md §4 —
 *     "self-dismissing, plus a permanent entry in the feed. Nobody's screen gets
 *     hijacked").
 *
 * The feed is memory in this tab and nothing else. It is not stored, because a roll is a
 * thing that happened at the table rather than a thing about the character — the sheet
 * is what persists (DESIGN.md §8), and a reload starting the evening's dice log over
 * costs nothing anybody was relying on.
 *
 * 🚫 Nothing here adjudicates. A result is a number and, for a table, the row's own
 * words; no stat is touched by either (PRD.md principle 1).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DICE_OVERLAY_DWELL_MS, MAX_ROLL_FEED_ENTRIES } from '../constants';
import type { RandomWords, Roll, RollVisibility, RollWarning } from '../model/dice';
import { cryptoWords, rollPool } from '../model/dice';
import type { Die } from '../model/enums';
import type { RollableTable, TableRollFailure } from '../model/tables';
import { rollOnTable } from '../model/tables';
import { newRowId } from './new-character';

/** The start of a list, and a count of nothing. */
const NONE = 0;

// ---------------------------------------------------------------------------
// What an entry is
// ---------------------------------------------------------------------------

/**
 * Whose roll this is.
 *
 * `who` is a peer's display name, and it exists so the corner can say the roll is not
 * yours before it shows you the number. 🚫 It is never an identity claim out of a
 * payload — a roll that arrives over the wire is stamped with the peer id the transport
 * reports (CLAUDE.md §2.8), and this field is only ever what is *printed*.
 */
export type RollOrigin =
  | { readonly kind: 'mine' }
  | { readonly kind: 'peer'; readonly who: string };

/** Every roll a player makes here is theirs. Frozen once, rather than built per roll. */
const MINE: RollOrigin = { kind: 'mine' };

/**
 * What a table roll found.
 *
 * A one-field type rather than a bare string, because the absence has to be sayable:
 * `lookup === null` is a free roll from the handle, and `lookup.row === null` is a table
 * roll that landed on a number no row covers. Those are different facts and the corner
 * prints different things for them — a gap in a table is reported, never filled in with
 * a neighbouring row (`model/tables.ts`).
 *
 * 🚫 The text is the author's own, printed as a text node and never parsed. The moment
 * anything here reads a `+2` out of it, this has become an effects engine (PRD.md §4).
 */
export type RollLookup = {
  readonly row: string | null;
};

/**
 * One roll, as the feed keeps it and the overlay shows it.
 *
 * There is no `total` — it is `dice` plus `modifier`, and `rollTotal` computes it on
 * read (CLAUDE.md §4). A stored total is a total that can eventually disagree with the
 * dice it was supposedly the sum of.
 */
export type RollEntry = {
  /** A local id, in the shape the protocol's `EventId` already admits. A React key. */
  readonly id: string;
  readonly at: number;
  readonly origin: RollOrigin;
  /** What was rolled, in the roller's words: `Longsword`, `Human talents`. */
  readonly label: string;
  /**
   * Who this roll was for, decided when it was rolled (DESIGN.md §4). Recorded on every
   * entry, whoever rolled it: a peer's roll arrives already narrowed to what the wire
   * can say, and one of ours may be `just-me`, which is the case Phase 5 must never
   * send. Kept beside the dice rather than off to the side, because a roll and its
   * audience are one decision and separating them is how they come apart.
   */
  readonly visibility: RollVisibility;
  readonly roll: Roll;
  /** Null for a free roll from the handle; what was found for a table roll. */
  readonly lookup: RollLookup | null;
  /** Something odd that did not cost the roll — a clamped modifier (PRD.md principle 4). */
  readonly warnings: readonly RollWarning[];
};

/** A pool from the handle: a die, how many, what to add, what it was for, and who for. */
export type FreeRoll = {
  readonly die: Die;
  readonly count: number;
  readonly modifier: number;
  readonly label: string;
  readonly visibility: RollVisibility;
};

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

export type Rolls = {
  /** Newest first, capped at `MAX_ROLL_FEED_ENTRIES`. */
  readonly feed: readonly RollEntry[];
  /** What the corner is showing, or null once it has dismissed itself. */
  readonly showing: RollEntry | null;
  /** Why the last attempt produced no dice at all. Cleared by the next roll that works. */
  readonly failure: TableRollFailure | null;
  readonly roll: (request: FreeRoll) => void;
  readonly rollTable: (
    table: RollableTable,
    label: string,
    visibility: RollVisibility,
  ) => void;
  /** A roll that happened somewhere else. The seam Phase 5 broadcasts into. */
  readonly record: (entry: RollEntry) => void;
  readonly dismiss: () => void;
};

/**
 * `random` is an argument with a default, the same way it is in `model/dice.ts`: the
 * corner is where a scripted source lets a test assert that the number on screen is the
 * number that was rolled, rather than hoping the right face came up.
 */
export function useRolls(random: RandomWords = cryptoWords): Rolls {
  const [feed, setFeed] = useState<readonly RollEntry[]>([]);
  const [showing, setShowing] = useState<RollEntry | null>(null);
  const [failure, setFailure] = useState<TableRollFailure | null>(null);

  /**
   * The one way an entry reaches the feed, whoever rolled it. Prepending and capping in
   * the same step is what keeps the cap a bound on memory rather than a suggestion.
   */
  const record = useCallback((entry: RollEntry): void => {
    setFeed((previous) => [entry, ...previous].slice(NONE, MAX_ROLL_FEED_ENTRIES));
    setShowing(entry);
    setFailure(null);
  }, []);

  const roll = useCallback(
    (request: FreeRoll): void => {
      const rolled = rollPool(
        { die: request.die, count: request.count, modifier: request.modifier },
        random,
      );

      // A roll that produced no dice is said out loud and shows nothing. 🚫 There is no
      // substitute number: `model/dice.ts` refuses rather than guessing, and a corner
      // that invented one would undo that in the last inch (DESIGN.md §4).
      if (!rolled.ok) {
        setFailure(rolled.failure);
        setShowing(null);
        return;
      }

      record({
        id: newRowId(),
        at: Date.now(),
        origin: MINE,
        label: request.label,
        visibility: request.visibility,
        roll: rolled.roll,
        lookup: null,
        warnings: rolled.warnings,
      });
    },
    [random, record],
  );

  /**
   * A table roll is a roll plus a lookup and nothing else (DESIGN.md §4). It is here
   * rather than in a second hook because the corner is **one component for free rolls
   * and table rolls alike** — the two differ by one field on the entry.
   *
   * 🚫 A table is never chosen here. It arrives from the caller that already has it in
   * hand, and `label` is what that caller calls it.
   */
  const rollTable = useCallback(
    (table: RollableTable, label: string, visibility: RollVisibility): void => {
      const rolled = rollOnTable(table, random);
      if (!rolled.ok) {
        setFailure(rolled.failure);
        setShowing(null);
        return;
      }

      record({
        id: newRowId(),
        at: Date.now(),
        origin: MINE,
        label,
        visibility,
        roll: rolled.result.roll,
        lookup: { row: rolled.result.row?.text ?? null },
        warnings: [],
      });
    },
    [random, record],
  );

  const dismiss = useCallback((): void => setShowing(null), []);

  /**
   * The dwell. Keyed on the entry itself, so a roll that lands while another is on
   * screen restarts the clock instead of inheriting what was left of the old one.
   *
   * It clears `showing` and never touches `feed` — which is the mechanical difference
   * between the two lifetimes this hook keeps, written where it happens.
   */
  useEffect(() => {
    if (showing === null) return;

    const timer = window.setTimeout(() => setShowing(null), DICE_OVERLAY_DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [showing]);

  return useMemo(
    () => ({ feed, showing, failure, roll, rollTable, record, dismiss }),
    [feed, showing, failure, roll, rollTable, record, dismiss],
  );
}
