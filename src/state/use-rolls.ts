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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DICE_OVERLAY_DWELL_MS, MAX_ROLL_FEED_ENTRIES } from '../constants';
import type {
  RandomWords,
  Roll,
  RollResult,
  RollVisibility,
  RollWarning,
} from '../model/dice';
import { cryptoWords, rollAmong, rollNotation, rollPool } from '../model/dice';
import type { Die } from '../model/enums';
import type { RollableTable, TableResult, TableRollFailure } from '../model/tables';
import { rerollTable, rollOnTable } from '../model/tables';
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
  /**
   * Throws a reroll passed up, oldest first. Empty on all but a rerolled result.
   *
   * The record is the point of keeping them. A table that says *take it or roll again*
   * (DATA-MODEL.md §8) has to show what was rolled away, or the offer is something that
   * happened invisibly and the feed reads as though the second throw were the only one.
   */
  readonly discarded: readonly DiscardedThrow[];
  /**
   * Whether a reroll is still on offer. Only a `rerollable` table ever offers one, and
   * only `MAX_TABLE_REROLLS` of them — `model/tables.ts` decides both, and this is that
   * answer carried up. 🚫 Never a permission the corner grants itself.
   */
  readonly canReroll: boolean;
};

/**
 * A throw a reroll threw away: the number it made and the row it found, which is all of
 * one that is worth showing. 🚫 Its dice are not kept — a passed-up throw is a line in
 * the record, not a second result to draw silhouettes for.
 */
export type DiscardedThrow = {
  readonly total: number;
  readonly row: string | null;
};

/**
 * A model result, as the feed keeps it. The only place a `TableResult` is turned into a
 * lookup, so the card, the feed and a caller recording a talent cannot disagree about
 * what was rolled or what was passed up.
 *
 * 🚫 The text is copied, never read. `row.text` goes across as the author's own string.
 */
function lookupOf(result: TableResult): RollLookup {
  return {
    row: result.row?.text ?? null,
    discarded: result.discarded.map((passed) => ({
      total: passed.total,
      row: passed.row?.text ?? null,
    })),
    canReroll: result.canReroll,
  };
}

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
/**
 * What a caller does with a table result, once it *is* the result.
 *
 * Called exactly once per `rollTable`, and — on a `rerollable` table — not until the
 * offer has been settled. That ordering is DATA-MODEL.md §8's "a reroll before the
 * result is kept" made mechanical: a talent the player rolled away must never have
 * reached the sheet, and the only way to guarantee that is for the sheet to be told
 * later rather than told twice.
 */
export type KeepResult = (entry: RollEntry) => void;

/**
 * The offer standing right now: what was thrown, what it was thrown on, and who asked
 * to be told once it is settled.
 *
 * The `TableResult` is kept because `rerollTable` takes the previous *result*, not the
 * entry — `discarded` and `canReroll` are the model's to carry forward, and rebuilding
 * them from an entry would be this file second-guessing `MAX_TABLE_REROLLS`.
 */
type StandingOffer = {
  readonly entry: RollEntry;
  readonly table: RollableTable;
  readonly result: TableResult;
  readonly keep: KeepResult | null;
};

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
  /**
   * The entry is handed back for the same reason `rollTable`'s is: a caller that has to
   * write the number down — an ability score in the walkthrough (#35) — must write the
   * one that was rolled rather than roll a second time to find out. `null` when no dice
   * were thrown at all; the reason is on `failure`.
   */
  readonly roll: (request: FreeRoll) => RollEntry | null;
  /**
   * A pool named the way a pack names it — a weapon's `1d8`, a class's `hitDie`
   * (DATA-MODEL.md §4, §5). The notation is read by `model/dice.ts`; nothing here
   * evaluates a string.
   */
  readonly rollNotation: (notation: string, label: string) => RollEntry | null;
  /**
   * One face of a die with as many faces as there are things to choose between — how
   * "roll or choose" rolls (#35). `null` when there was nothing fair to throw, which
   * includes a list of one (`model/dice.ts`).
   *
   * 🚫 It is handed a count, never the list. What the face picked out is the caller's
   * to decide and to record; nothing here knows what was being chosen between.
   */
  readonly rollAmong: (count: number, label: string) => RollEntry | null;
  /**
   * Roll on a table, and hand back the entry so the caller can record what it found.
   *
   * `null` when no dice were rolled at all — the reason is on `failure`. The entry is
   * returned rather than pushed at the sheet because **what is done with a result is the
   * caller's**: a talent table's row is written down as words (PRD.md principle 1), and
   * a loot table's is not written anywhere. Nothing in this hook knows the difference.
   *
   * 🚫 **The returned entry is not necessarily the result.** On a `rerollable` table it
   * is a throw with an offer still standing, and the player may yet pass it up. A caller
   * that records anything passes `keep`, which fires once, on the throw that was kept.
   */
  readonly rollTable: (
    table: RollableTable,
    label: string,
    keep?: KeepResult,
  ) => RollEntry | null;
  /**
   * Take the reroll the standing result offered: throw again on the same table, keeping
   * what was passed up on the new entry.
   *
   * The offer is the model's — `rerollTable` refuses a table that never made one and a
   * table whose one offer is spent — so this is the corner asking rather than deciding.
   * Rolling on the table from the top is `rollTable` and is a different act entirely:
   * it starts a fresh entry with nothing passed up (DATA-MODEL.md §8).
   */
  readonly reroll: () => RollEntry | null;
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
   * The offer on the table, if one is.
   *
   * A ref rather than state, deliberately: nothing rendered reads it — `canReroll` and
   * `discarded` travel on the entry, which *is* state — and it is only ever touched from
   * an event handler or an effect, which is the whole of what a ref is for. Holding it as
   * state instead would re-render the corner to record a fact the corner cannot see.
   */
  const offer = useRef<StandingOffer | null>(null);

  /**
   * Take the standing offer off the table and tell whoever was waiting what was kept.
   *
   * `kept` is the throw that survived, or `null` when the offer simply lapsed and the
   * throw already on screen is what the player has. Settling twice is a no-op, which is
   * what lets every path that ends an offer — dismiss, another roll, a reroll — call it
   * without checking first.
   */
  const settle = useCallback((kept: RollEntry | null): void => {
    const standing = offer.current;
    if (standing === null) return;

    offer.current = null;
    standing.keep?.(kept ?? standing.entry);
  }, []);

  /**
   * The one way an entry reaches the feed, whoever rolled it. Prepending and capping in
   * the same step is what keeps the cap a bound on memory rather than a suggestion.
   *
   * `replacing` is a reroll and nothing else: the throw that was passed up is *replaced*
   * in the feed by the one that replaced it, rather than both being prepended. Two lines
   * for one act would put a rejected row in the permanent record looking exactly like a
   * kept one, which is a wrong answer that reads as right. Nothing is hidden by it — the
   * passed-up throw is on the entry that replaced it, in `lookup.discarded`, and the
   * corner prints it.
   */
  const land = useCallback((entry: RollEntry, replacing: string | null): void => {
    setFeed((previous) =>
      replacing === null
        ? [entry, ...previous].slice(NONE, MAX_ROLL_FEED_ENTRIES)
        : previous.map((existing) => (existing.id === replacing ? entry : existing)),
    );
    setShowing(entry);
    setFailure(null);
  }, []);

  /** A roll from anywhere else. Any roll landing ends whatever offer was standing. */
  const record = useCallback(
    (entry: RollEntry): void => {
      settle(null);
      land(entry, null);
    },
    [land, settle],
  );

  /**
   * A pool that has already been rolled, put in the feed. The one place a free roll of
   * our own is built, so the handle and a weapon cannot describe themselves differently.
   *
   * A roll that produced no dice is said out loud and shows nothing. 🚫 There is no
   * substitute number: `model/dice.ts` refuses rather than guessing, and a corner that
   * invented one would undo that in the last inch (DESIGN.md §4).
   */
  const enter = useCallback(
    (rolled: RollResult, label: string): RollEntry | null => {
      settle(null);

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
        lookup: null,
        warnings: rolled.warnings,
      };
      record(entry);

      return entry;
    },
    [record, settle, visibility],
  );

  /**
   * A table result, into the feed — and onto the table as an offer when the model says
   * one stands. The single path a first throw and a reroll both take, so the two cannot
   * come to describe the same result differently.
   */
  const takeTable = useCallback(
    (
      table: RollableTable,
      result: TableResult,
      label: string,
      keep: KeepResult | null,
      replacing: string | null,
    ): RollEntry => {
      const entry: RollEntry = {
        id: newRowId(),
        at: Date.now(),
        origin: MINE,
        label,
        visibility,
        roll: result.roll,
        lookup: lookupOf(result),
        warnings: [],
      };
      land(entry, replacing);

      if (result.canReroll) {
        offer.current = { entry, table, result, keep };
      } else {
        // Nothing further is on offer, so this throw *is* the result and the caller can
        // record it (DATA-MODEL.md §8 — the offer comes before the result is kept).
        offer.current = null;
        keep?.(entry);
      }

      return entry;
    },
    [land, visibility],
  );

  const roll = useCallback(
    (request: FreeRoll): RollEntry | null =>
      enter(
        rollPool(
          { die: request.die, count: request.count, modifier: request.modifier },
          random,
        ),
        request.label,
      ),
    [enter, random],
  );

  /**
   * A weapon's own dice, rolled as the pack wrote them. 🚫 No modifier is added: what a
   * strength bonus does to damage is the table's business, not the app's (PRD.md
   * principle 1), and the handle is where a player adds one on purpose.
   */
  const rollNotated = useCallback(
    (notation: string, label: string): RollEntry | null =>
      enter(rollNotation(notation, UNMODIFIED, random), label),
    [enter, random],
  );

  /**
   * A draw among things, through the same feed as everything else. The count is the
   * caller's list length; `model/dice.ts` refuses one it cannot throw fairly, and the
   * failure lands on `failure` like any other.
   */
  const rollAmongThings = useCallback(
    (count: number, label: string): RollEntry | null => enter(rollAmong(count, random), label),
    [enter, random],
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
    (table: RollableTable, label: string, keep?: KeepResult): RollEntry | null => {
      // Rolling from the top is a new act, so anything still on offer lapses: the throw
      // the player left on screen is the one they kept (DATA-MODEL.md §8).
      settle(null);

      const rolled = rollOnTable(table, random);
      if (!rolled.ok) {
        setFailure(rolled.failure);
        setShowing(null);
        return null;
      }

      return takeTable(table, rolled.result, label, keep ?? null, null);
    },
    [random, settle, takeTable],
  );

  const reroll = useCallback((): RollEntry | null => {
    const standing = offer.current;
    if (standing === null) {
      setFailure({ reason: 'reroll-not-offered' });
      return null;
    }

    const rolled = rerollTable(standing.table, standing.result, random);
    if (!rolled.ok) {
      // 🚫 The offer stands. No dice were thrown, so nothing was passed up and the one
      // reroll the table offered has not been spent on a roll that never happened.
      setFailure(rolled.failure);
      return null;
    }

    // The label is the table's, unchanged: a reroll is the same act on the same table,
    // and it takes over the entry rather than adding a second one beside it.
    return takeTable(
      standing.table,
      rolled.result,
      standing.entry.label,
      standing.keep,
      standing.entry.id,
    );
  }, [random, takeTable]);

  /** Taking the card off the screen is taking the offer: what is showing is what is kept. */
  const dismiss = useCallback((): void => {
    settle(null);
    setShowing(null);
  }, [settle]);

  /**
   * The dwell. Keyed on the entry itself, so a roll that lands while another is on
   * screen restarts the clock instead of inheriting what was left of the old one.
   *
   * It clears `showing` and never touches `feed` — which is the mechanical difference
   * between the two lifetimes this hook keeps, written where it happens.
   *
   * 🚫 **A card with a reroll on offer does not dwell out.** The dwell exists so nobody
   * else's roll sits on your screen (DESIGN.md §4); this one is your own, and it is
   * asking you a question. A question that answers itself in six seconds is not one, and
   * a timer that settled the offer would be the app deciding a talent for the player.
   */
  useEffect(() => {
    if (showing === null || showing.lookup?.canReroll === true) return;

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
      rollAmong: rollAmongThings,
      rollTable,
      reroll,
      record,
      dismiss,
    }),
    [
      feed,
      showing,
      failure,
      visibility,
      roll,
      rollNotated,
      rollAmongThings,
      rollTable,
      reroll,
      record,
      dismiss,
    ],
  );
}
