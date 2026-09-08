// The two lifetimes this hook keeps, written as tests: an entry that stays in the feed
// forever, and a card that leaves on its own.
//
// The random source is scripted rather than real, which is what makes the first
// assertion in this file possible at all: the number that reaches the feed is *the*
// number that was drawn, not a plausible one. That is DESIGN.md §4's "roll a number,
// show a number" turned into something a machine can check.
//
// No @testing-library: CLAUDE.md §12 forbids installing a package without asking, and
// createRoot plus React's own act() is the harness every other hook test here uses.

import type { ReactElement } from 'react';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DICE_OVERLAY_DWELL_MS, MAX_ROLL_FEED_ENTRIES, MAX_TABLE_REROLLS } from '../constants';
import type { RandomWords } from '../model/dice';
import { rollTotal } from '../model/dice';
import type { RollableTable } from '../model/tables';
import type { FreeRoll, RollEntry, Rolls } from './use-rolls';
import { useRolls } from './use-rolls';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A random source that draws the faces it is told to, in order, wrapping.
 *
 * `rollFace` turns a word into `(word % sides) + 1`, so the word for a face is one less
 * than the face. Every value here is far below the rejection limit, so nothing is
 * redrawn and the sequence lands exactly as written.
 */
function scripted(...faces: readonly number[]): RandomWords {
  let index = 0;
  return (words) => {
    words[0] = (faces[index % faces.length] as number) - 1;
    index += 1;
  };
}

/** A source that throws — the failure path, without needing a browser without crypto. */
const BROKEN: RandomWords = () => {
  throw new Error('no entropy');
};

const TALENTS: RollableTable = {
  die: '2d6',
  rerollable: false,
  rows: [
    { roll: [2, 6], text: 'A knack for knots' },
    { roll: [7, 9], text: 'The name of a river' },
    // 10 through 12 are deliberately uncovered: a gap is a warning, never a refusal.
  ],
};

/** The same rows, on a table that says *take it or roll again* (DATA-MODEL.md §8). */
const REROLLABLE: RollableTable = { ...TALENTS, rerollable: true };

/**
 * A pool from the handle.
 *
 * Every field a roll needs has a default here so each test states only the ones it is
 * actually about. 🚫 No audience: who a roll is for is the hook's, sticky across rolls
 * and set through `setVisibility`, so a caller has none to pass.
 */
function pool(request: Partial<FreeRoll> = {}): FreeRoll {
  return { die: 'd20', count: 1, modifier: 0, label: '', ...request };
}

let container: HTMLDivElement;
let root: Root;
let latest: Rolls | null = null;

function Probe({ random }: { readonly random: RandomWords }): ReactElement {
  latest = useRolls(random);
  return <span>{latest.feed.length}</span>;
}

/** The hook as it stands right now. Non-null because the probe is always mounted. */
function rolls(): Rolls {
  if (latest === null) throw new Error('the probe is not mounted');
  return latest;
}

async function mount(random: RandomWords): Promise<void> {
  await act(async () => {
    root.render(<Probe random={random} />);
  });
}

/** Anything that changes the hook's state, run inside act so React flushes it. */
async function run(change: () => void): Promise<void> {
  await act(async () => {
    change();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  latest = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('rolling', () => {
  it('shows the number that was rolled, not one decided beforehand', async () => {
    await mount(scripted(17));
    await run(() => rolls().roll(pool({ label: 'Longsword' })));

    const entry = rolls().showing as RollEntry;
    expect(entry.roll.dice).toEqual([{ sides: 20, value: 17 }]);
    expect(rollTotal(entry.roll)).toBe(17);
    expect(entry.label).toBe('Longsword');
    expect(entry.origin).toEqual({ kind: 'mine' });
    expect(entry.lookup).toBeNull();
  });

  it('records who each roll was for, chosen at the roll and not after it', async () => {
    await mount(scripted(1, 2, 3));
    await run(() => rolls().roll(pool({ label: 'open' })));
    await run(() => rolls().setVisibility('just-me'));
    await run(() => rolls().roll(pool({ label: 'secret' })));
    await run(() => rolls().setVisibility('dm-only'));
    await run(() => rolls().roll(pool({ label: 'for the DM' })));

    // Per roll, not per player: three in a row, three different audiences, and each
    // entry keeps its own (DESIGN.md §4).
    expect(rolls().feed.map((entry) => entry.visibility)).toEqual([
      'dm-only',
      'just-me',
      'everyone',
    ]);
  });

  it('rolls a whole pool and adds the modifier on read', async () => {
    await mount(scripted(3, 5));
    await run(() => rolls().roll(pool({ die: 'd6', count: 2, modifier: 2 })));

    const entry = rolls().showing as RollEntry;
    expect(entry.roll.dice.map((die) => die.value)).toEqual([3, 5]);
    expect(rollTotal(entry.roll)).toBe(10);
  });

  it('carries a clamped modifier as a warning rather than losing the roll', async () => {
    await mount(scripted(4));
    await run(() => rolls().roll(pool({ die: 'd6', modifier: 100_000 })));

    const entry = rolls().showing as RollEntry;
    expect(entry.warnings).toHaveLength(1);
    expect(rolls().failure).toBeNull();
  });

  it('shows nothing and says why when no dice could be rolled', async () => {
    await mount(BROKEN);
    await run(() => rolls().roll(pool()));

    // 🚫 No substitute number. The corner is empty and the reason is available.
    expect(rolls().showing).toBeNull();
    expect(rolls().feed).toHaveLength(0);
    expect(rolls().failure?.reason).toBe('source-threw');
  });

  it('clears the last failure once a roll works', async () => {
    let broken = true;
    const source: RandomWords = (words) => {
      if (broken) throw new Error('no entropy');
      words[0] = 10;
    };

    await mount(source);
    await run(() => rolls().roll(pool()));
    expect(rolls().failure).not.toBeNull();

    broken = false;
    await run(() => rolls().roll(pool()));
    expect(rolls().failure).toBeNull();
  });
});

describe('table rolls', () => {
  it('is a roll plus a lookup, and nothing else', async () => {
    await mount(scripted(4, 4));
    await run(() => rolls().rollTable(TALENTS, 'Human talents'));

    const entry = rolls().showing as RollEntry;
    expect(rollTotal(entry.roll)).toBe(8);
    expect(entry.lookup).toEqual({ row: 'The name of a river', discarded: [], canReroll: false });
    expect(entry.label).toBe('Human talents');
    // 🚫 No modifier on a table roll — a bonus would move which row came up.
    expect(entry.roll.modifier).toBe(0);
  });

  it('records the visibility it was rolled with, the same as a free roll', async () => {
    await mount(scripted(4, 4));
    await run(() => rolls().setVisibility('dm-only'));
    await run(() => rolls().rollTable(TALENTS, 'Human talents'));

    // The audience is the hook's, so a table rolled from the sheet is for whoever the
    // last roll was for — not for the whole table because it did not come off the
    // handle (DESIGN.md §4).
    expect((rolls().showing as RollEntry).visibility).toBe('dm-only');
  });

  it('hands the entry back so the caller can record what it found', async () => {
    await mount(scripted(4, 4));

    let entry: RollEntry | null = null;
    await run(() => {
      entry = rolls().rollTable(TALENTS, 'Human talents');
    });

    // What is done with a result is the caller's: a talent is written down as words,
    // a loot row is not written anywhere (PRD.md principle 1).
    expect(entry).not.toBeNull();
    expect((entry as unknown as RollEntry).lookup?.row).toBe('The name of a river');
  });

  it('hands back nothing when no dice were rolled at all', async () => {
    await mount(BROKEN);

    let entry: RollEntry | null = null;
    await run(() => {
      entry = rolls().rollTable(TALENTS, 'Human talents');
    });

    expect(entry).toBeNull();
    expect(rolls().failure?.reason).toBe('source-threw');
  });

  it('reports a number no row covers rather than substituting a neighbour', async () => {
    await mount(scripted(6, 5));
    await run(() => rolls().rollTable(TALENTS, 'Human talents'));

    const entry = rolls().showing as RollEntry;
    expect(rollTotal(entry.roll)).toBe(11);
    // A table roll that found nothing, which is not the same fact as a free roll.
    expect(entry.lookup).toEqual({ row: null, discarded: [], canReroll: false });
  });
});

describe('the feed and the dwell', () => {
  it('keeps the entry after the card has dismissed itself', async () => {
    await mount(scripted(12));
    await run(() => rolls().roll(pool({ label: 'Sneak' })));
    expect(rolls().showing).not.toBeNull();

    await run(() => vi.advanceTimersByTime(DICE_OVERLAY_DWELL_MS));

    expect(rolls().showing, 'the card outstayed its dwell').toBeNull();
    expect(rolls().feed, 'the feed lost an entry to a timer').toHaveLength(1);
    expect(rolls().feed[0]?.label).toBe('Sneak');
  });

  it('gives a roll that lands mid-dwell the whole dwell, not what was left of it', async () => {
    await mount(scripted(2));
    await run(() => rolls().roll(pool({ label: 'first' })));
    await run(() => vi.advanceTimersByTime(DICE_OVERLAY_DWELL_MS - 1));

    await run(() => rolls().roll(pool({ label: 'second' })));
    await run(() => vi.advanceTimersByTime(DICE_OVERLAY_DWELL_MS - 1));

    expect(rolls().showing?.label, 'the second roll inherited the first one’s clock').toBe(
      'second',
    );

    await run(() => vi.advanceTimersByTime(1));
    expect(rolls().showing).toBeNull();
  });

  it('dismisses on request without touching the feed', async () => {
    await mount(scripted(9));
    await run(() => rolls().roll(pool()));
    await run(() => rolls().dismiss());

    expect(rolls().showing).toBeNull();
    expect(rolls().feed).toHaveLength(1);
  });

  it('is newest first', async () => {
    await mount(scripted(1, 2, 3));
    await run(() => rolls().roll(pool({ label: 'one' })));
    await run(() => rolls().roll(pool({ label: 'two' })));

    expect(rolls().feed.map((entry) => entry.label)).toEqual(['two', 'one']);
  });

  it('drops the oldest at the cap rather than growing without bound', async () => {
    await mount(scripted(1));

    for (let rolled = 0; rolled < MAX_ROLL_FEED_ENTRIES + 5; rolled += 1) {
      await run(() => rolls().roll(pool({ label: `${rolled}` })));
    }

    expect(rolls().feed).toHaveLength(MAX_ROLL_FEED_ENTRIES);
    expect(rolls().feed[0]?.label).toBe(`${MAX_ROLL_FEED_ENTRIES + 4}`);
  });

  it('gives every entry an id of its own, so the feed can be keyed', async () => {
    await mount(scripted(1));
    await run(() => rolls().roll(pool()));
    await run(() => rolls().roll(pool()));

    const ids = new Set(rolls().feed.map((entry) => entry.id));
    expect(ids.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The offer a rerollable table makes
// ---------------------------------------------------------------------------

describe('a rerollable table’s offer', () => {
  it('offers a reroll, and no other table does', async () => {
    await mount(scripted(1, 1));
    await run(() => rolls().rollTable(REROLLABLE, 'Omens'));

    expect(rolls().showing?.lookup?.canReroll).toBe(true);
    expect(rolls().showing?.lookup?.discarded).toEqual([]);

    await run(() => rolls().rollTable(TALENTS, 'Human talents'));
    expect(rolls().showing?.lookup?.canReroll).toBe(false);
  });

  it('throws again when the offer is taken, and the offer is then gone', async () => {
    // 2 on the first throw, 8 on the second: different rows, so what changed is visible.
    await mount(scripted(1, 1, 4, 4));
    await run(() => rolls().rollTable(REROLLABLE, 'Omens'));
    await run(() => rolls().reroll());

    const entry = rolls().showing as RollEntry;
    expect(rollTotal(entry.roll)).toBe(8);
    expect(entry.lookup?.row).toBe('The name of a river');
    expect(entry.lookup?.canReroll, 'a second offer is not one the table made').toBe(false);
    expect(entry.lookup?.discarded).toHaveLength(MAX_TABLE_REROLLS);
  });

  it('keeps what was passed up, so a rerolled result says what it replaced', async () => {
    await mount(scripted(1, 1, 4, 4));
    await run(() => rolls().rollTable(REROLLABLE, 'Omens'));
    await run(() => rolls().reroll());

    expect(rolls().showing?.lookup?.discarded).toEqual([
      { total: 2, row: 'A knack for knots' },
    ]);
  });

  it('replaces the throw it passed up rather than leaving both in the feed', async () => {
    await mount(scripted(1, 1, 4, 4));
    await run(() => rolls().rollTable(REROLLABLE, 'Omens'));
    await run(() => rolls().reroll());

    // One act, one line. A rejected row left standing in the permanent record would read
    // exactly like a kept one, and nothing is lost — it is on the entry that replaced it.
    expect(rolls().feed).toHaveLength(1);
    expect(rolls().feed[0]?.lookup?.row).toBe('The name of a river');
    expect(rolls().feed[0]?.lookup?.discarded).toHaveLength(1);
  });

  it('leaves rolling on the table from the top a different act entirely', async () => {
    await mount(scripted(1, 1, 4, 4));
    await run(() => rolls().rollTable(REROLLABLE, 'Omens'));
    await run(() => rolls().rollTable(REROLLABLE, 'Omens'));

    // Two entries, and the second passed nothing up: starting over is not a reroll, and
    // the offer it makes is a fresh one (DATA-MODEL.md §8).
    expect(rolls().feed).toHaveLength(2);
    expect(rolls().feed[0]?.lookup?.discarded).toEqual([]);
    expect(rolls().feed[0]?.lookup?.canReroll).toBe(true);
  });

  it('refuses a reroll nobody was offered, and rolls no dice doing it', async () => {
    await mount(scripted(4, 4));
    await run(() => rolls().rollTable(TALENTS, 'Human talents'));
    const before = rolls().showing;

    await run(() => rolls().reroll());

    expect(rolls().failure?.reason).toBe('reroll-not-offered');
    expect(rolls().showing, 'a refused reroll changed what was on screen').toBe(before);
    expect(rolls().feed).toHaveLength(1);
  });

  it('holds the card while the offer stands, and lets it dwell once it is spent', async () => {
    await mount(scripted(1, 1, 4, 4));
    await run(() => rolls().rollTable(REROLLABLE, 'Omens'));

    // A question that answers itself in six seconds is not one (DESIGN.md §4's dwell is
    // about a *peer's* roll not sitting on your screen; this one is asking you something).
    await run(() => vi.advanceTimersByTime(DICE_OVERLAY_DWELL_MS * 2));
    expect(rolls().showing, 'the offer dwelled out from under the player').not.toBeNull();

    await run(() => rolls().reroll());
    await run(() => vi.advanceTimersByTime(DICE_OVERLAY_DWELL_MS));
    expect(rolls().showing).toBeNull();
  });
});

describe('when a table result is kept', () => {
  /** What a caller was told to keep, in the order it was told. Issue #144's whole point. */
  function keeper(): { readonly kept: RollEntry[]; readonly keep: (entry: RollEntry) => void } {
    const kept: RollEntry[] = [];
    return { kept, keep: (entry) => kept.push(entry) };
  }

  it('tells a caller straight away when no offer stands', async () => {
    await mount(scripted(4, 4));
    const { kept, keep } = keeper();

    await run(() => rolls().rollTable(TALENTS, 'Human talents', keep));

    expect(kept).toHaveLength(1);
    expect(kept[0]?.lookup?.row).toBe('The name of a river');
  });

  it('makes a caller wait while a reroll is still on offer', async () => {
    await mount(scripted(1, 1, 4, 4));
    const { kept, keep } = keeper();

    await run(() => rolls().rollTable(REROLLABLE, 'Omens', keep));

    // DATA-MODEL.md §8: the reroll comes *before the result is kept*. A row the player
    // is about to pass up must never have reached the sheet.
    expect(kept, 'a throw still on offer was recorded as the result').toEqual([]);

    await run(() => rolls().reroll());

    expect(kept).toHaveLength(1);
    expect(kept[0]?.lookup?.row).toBe('The name of a river');
  });

  it('keeps what is on screen when the player takes it rather than rerolling', async () => {
    await mount(scripted(1, 1));
    const { kept, keep } = keeper();

    await run(() => rolls().rollTable(REROLLABLE, 'Omens', keep));
    await run(() => rolls().dismiss());

    // Taking the card away is taking the result. *Take it or roll again* — and this is
    // taking it.
    expect(kept).toHaveLength(1);
    expect(kept[0]?.lookup?.row).toBe('A knack for knots');
  });

  it('settles a standing offer when anything else is rolled', async () => {
    await mount(scripted(1, 1, 3));
    const { kept, keep } = keeper();

    await run(() => rolls().rollTable(REROLLABLE, 'Omens', keep));
    await run(() => rolls().roll(pool({ label: 'Sneak' })));

    expect(kept).toHaveLength(1);
    expect(kept[0]?.lookup?.row).toBe('A knack for knots');
  });

  it('tells a caller once and once only', async () => {
    await mount(scripted(1, 1, 4, 4));
    const { kept, keep } = keeper();

    await run(() => rolls().rollTable(REROLLABLE, 'Omens', keep));
    await run(() => rolls().reroll());
    await run(() => rolls().dismiss());
    await run(() => rolls().roll(pool()));

    expect(kept, 'the sheet was told twice about one roll').toHaveLength(1);
  });
});

describe('a roll that is not yours', () => {
  const THEIRS: RollEntry = {
    id: 'r_0123456789abcdef',
    at: 0,
    origin: { kind: 'peer', who: 'Thorin' },
    label: 'Loot',
    visibility: 'dm-only',
    roll: { dice: [{ sides: 6, value: 5 }], modifier: 0 },
    lookup: { row: 'A pouch of buttons', discarded: [], canReroll: false },
    warnings: [],
  };

  it('shows and feeds like any other, and leaves on the same clock', async () => {
    await mount(scripted(1));
    await run(() => rolls().record(THEIRS));

    expect(rolls().showing?.origin).toEqual({ kind: 'peer', who: 'Thorin' });
    expect(rolls().feed).toHaveLength(1);

    await run(() => vi.advanceTimersByTime(DICE_OVERLAY_DWELL_MS));
    expect(rolls().showing).toBeNull();
    expect(rolls().feed, 'a peer roll must leave a permanent entry behind').toHaveLength(1);
  });
});
