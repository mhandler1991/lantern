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
import type {
  RandomWords,
  Roll,
  RollResult,
  RollVisibility,
  RollWarning,
} from '../model/dice';
import { cryptoWords, rollNotation, rollPool } from '../model/dice';
import type { Die } from '../model/enums';
import type { RollableTable, TableRollFailure } from '../model/tables';
import { rollOnTable } from '../model/tables';
import { newRowId } from './new-character';

/** The start of a list, and a count of nothing. */
const NONE = 0;

/** No modifier. A table roll never takes one, and a damage roll is the weapon's dice. */
const UNMODIFIED = 0;

/**
 * Who a roll is for before anybody says otherwise. Most rolls at a table are made in
 * front of everybody, and a default of anything narrower would quietly hide rolls the
 * player meant to share (DESIGN.md §4).
 */
const DEFAULT_VISIBILITY: RollVisibility = 'everyone';

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

/**
 * A pool from the handle: a die, how many, what to add, and what it was for.
 *
 * 🚫 No audience. Who a roll is for is the hook's, not the caller's — see `visibility`
 * on `Rolls` — so a roll from the sheet and a roll from the handle are for the same
 * people without either of them having to ask the other.
 */
export type FreeRoll = {
  readonly die: Die;
  readonly count: number;
  readonly modifier: number;
  readonly label: string;
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
  /**
   * Who the next roll is for, whatever starts it (DESIGN.md §4).
   *
   * It lives here rather than in the handle that renders the picker, because a roll no
   * longer only starts there: a weapon's damage and a talent table are rolled from the
   * sheet, and an audience the handle kept to itself would mean a DM's secret loot roll
   * going out in front of the table the moment it came off a button instead of a
   * `<select>`. One sticky choice, one place, whoever asks for the dice.
   */
  readonly visibility: RollVisibility;
  readonly setVisibility: (visibility: RollVisibility) => void;
  readonly roll: (request: FreeRoll) => void;
  /**
   * A pool named the way a pack names it — a weapon's `1d8` (DATA-MODEL.md §4). The
   * notation is read by `model/dice.ts`; nothing here evaluates a string.
   */
  readonly rollNotation: (notation: string, label: string) => void;
  /**
   * Roll on a table, and hand back the entry so the caller can record what it found.
   *
   * `null` when no dice were rolled at all — the reason is on `failure`. The entry is
   * returned rather than pushed at the sheet because **what is done with a result is the
   * caller's**: a talent table's row is written down as words (PRD.md principle 1), and
   * a loot table's is not written anywhere. Nothing in this hook knows the difference.
   */
  readonly rollTable: (table: RollableTable, label: string) => RollEntry | null;
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
  const [visibility, setVisibility] = useState<RollVisibility>(DEFAULT_VISIBILITY);

  /**
   * The one way an entry reaches the feed, whoever rolled it. Prepending and capping in
   * the same step is what keeps the cap a bound on memory rather than a suggestion.
   */
  const record = useCallback((entry: RollEntry): void => {
    setFeed((previous) => [entry, ...previous].slice(NONE, MAX_ROLL_FEED_ENTRIES));
    setShowing(entry);
    setFailure(null);
  }, []);

  /**
   * A pool that has already been rolled, put in the feed. The one place an entry of our
   * own is built, so a free roll, a weapon and a table cannot describe themselves
   * differently.
   *
   * A roll that produced no dice is said out loud and shows nothing. 🚫 There is no
   * substitute number: `model/dice.ts` refuses rather than guessing, and a corner that
   * invented one would undo that in the last inch (DESIGN.md §4).
   */
  const keep = useCallback(
    (
      rolled: RollResult,
      label: string,
      lookup: RollLookup | null,
    ): RollEntry | null => {
      if (!rolled.ok) {
        setFailure(rolled.failure);
        setShowing(null);
        return null;
      }

      const entry: RollEntry = {
        id: newRowId(),
        at: Date.now(),
        origin: MINE,
        label,
        visibility,
        roll: rolled.roll,
        lookup,
        warnings: rolled.warnings,
      };
      record(entry);

      return entry;
    },
    [record, visibility],
  );

  const roll = useCallback(
    (request: FreeRoll): void => {
      keep(
        rollPool(
          { die: request.die, count: request.count, modifier: request.modifier },
          random,
        ),
        request.label,
        null,
      );
    },
    [keep, random],
  );

  /**
   * A weapon's own dice, rolled as the pack wrote them. 🚫 No modifier is added: what a
   * strength bonus does to damage is the table's business, not the app's (PRD.md
   * principle 1), and the handle is where a player adds one on purpose.
   */
  const rollNotated = useCallback(
    (notation: string, label: string): void => {
      keep(rollNotation(notation, UNMODIFIED, random), label, null);
    },
    [keep, random],
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
    (table: RollableTable, label: string): RollEntry | null => {
      const rolled = rollOnTable(table, random);
      if (!rolled.ok) {
        setFailure(rolled.failure);
        setShowing(null);
        return null;
      }

      return keep(
        { ok: true, roll: rolled.result.roll, warnings: [] },
        label,
        { row: rolled.result.row?.text ?? null },
      );
    },
    [keep, random],
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
    () => ({
      feed,
      showing,
      failure,
      visibility,
      setVisibility,
      roll,
      rollNotation: rollNotated,
      rollTable,
      record,
      dismiss,
    }),
    [feed, showing, failure, visibility, roll, rollNotated, rollTable, record, dismiss],
  );
}
