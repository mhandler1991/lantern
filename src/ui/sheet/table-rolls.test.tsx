// PRD.md §5, Phase 3: "you can roll a weapon from your sheet and roll on a talent table,
// and the result records without modifying anything". Issue #32's acceptance run.
//
// The sheet and the corner are mounted together, over one `useRolls`, because that is
// the arrangement the app has and the claim is about the join between them: a roll
// starts where the thing being rolled lives (DESIGN.md §4) and lands in the one corner.
// 🚫 No table is chosen from the overlay, and there is nothing in the overlay to choose
// one with — that is asserted here rather than left as an intention.
//
// The random source is scripted, so the number on screen is *the* number that was drawn
// rather than a plausible one, and the row it lands on is the row it must land on.
//
// The core pack is the real file off disk. The talent table with words in it is a
// homebrew fixture instead, for the reason CLAUDE.md §9 gives: an assertion that quotes
// a row is a copy of that row, and the only rows this file quotes are its own.
//
// No @testing-library: React 18.3 exports `act`, and CLAUDE.md §12 forbids installing a
// package without asking.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { act, useState } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Character } from '../../model/character';
import { parseCharacter } from '../../model/character';
import type { RandomWords } from '../../model/dice';
import { orphanReport } from '../../model/orphans';
import type { Pack } from '../../model/pack';
import { parsePack, reportProblems } from '../../model/pack';
import { resolvePacks } from '../../model/pack-resolver';
import { newCharacter, newRowId } from '../../state/new-character';
import { useRolls } from '../../state/use-rolls';
import { DiceOverlay } from '../DiceOverlay';
import { CharacterSheet } from './CharacterSheet';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** The repository root. `import.meta.url` is an `http:` URL under jsdom, not a file one. */
const repository = resolve(import.meta.dirname, '..', '..', '..');

function packFromDisk(...path: readonly string[]): Pack {
  const result = parsePack(JSON.parse(readFileSync(resolve(repository, ...path), 'utf8')));
  if (!result.ok) throw new Error(reportProblems(result.problems, path.join('/')));

  return result.pack;
}

function fixturePack(fields: Record<string, unknown>): Pack {
  const result = parsePack({ format: 'lantern-pack', formatVersion: 1, version: '1.0.0', ...fields });
  if (!result.ok) throw new Error(reportProblems(result.problems, String(fields['id'])));

  return result.pack;
}

const CORE = packFromDisk('public', 'packs', 'core.json');

/**
 * A class and a table of this file's own words. Homebrew in the same shape a DM's file
 * is, so what a row says can be asserted literally without copying anybody's book.
 */
const HOMEBREW = fixturePack({
  id: 'homebrew',
  name: 'Homebrew',
  classes: [
    {
      id: 'wanderer',
      name: 'Wanderer',
      hitDie: 'd6',
      weapons: [],
      armor: ['none'],
      talentTable: 'wanderer-talents',
    },
    {
      // A class whose table says *take it or roll again* (DATA-MODEL.md §8). The offer
      // is the only thing that separates it from the Wanderer.
      id: 'oracle',
      name: 'Oracle',
      hitDie: 'd6',
      weapons: [],
      armor: ['none'],
      talentTable: 'oracle-omens',
    },
    {
      // Names a table nothing defines: a class with nothing to roll on, which is a
      // warning at resolution and simply no button here (PRD.md principle 4).
      id: 'drifter',
      name: 'Drifter',
      hitDie: 'd6',
      weapons: [],
      armor: ['none'],
      talentTable: 'drifter-talents',
    },
  ],
  tables: [
    {
      id: 'wanderer-talents',
      name: 'Wanderer talents',
      die: '2d6',
      rows: [
        { roll: [2, 6], text: 'A knack for knots' },
        { roll: [7, 9], text: 'The name of a river' },
        // 10 through 12 are deliberately uncovered: a gap is a warning, never a refusal,
        // and a roll that finds nothing must write nothing.
      ],
    },
    {
      id: 'oracle-omens',
      name: 'Oracle omens',
      die: '2d6',
      // The flag's whole purpose, and the one this file's own words are here to prove
      // reaches a player: a result that can be passed up before it is kept.
      rerollable: true,
      rows: [
        { roll: [2, 6], text: 'A shape in the smoke' },
        { roll: [7, 12], text: 'A cold wind from the east' },
      ],
    },
  ],
});

const STACK = resolvePacks([CORE, HOMEBREW]);

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

/**
 * A source that draws the faces it is told to, in order, wrapping. `rollFace` turns a
 * word into `(word % sides) + 1`, so the word for a face is one less than the face.
 */
function scripted(...faces: readonly number[]): RandomWords {
  let index = 0;
  return (words) => {
    words[0] = (faces[index % faces.length] as number) - 1;
    index += 1;
  };
}

let container: HTMLDivElement;
let root: Root;
let latest: Character | null = null;

/** The sheet and the corner over one hook, which is exactly how `App` wires them. */
function Harness({
  start,
  random,
}: {
  readonly start: Character;
  readonly random: RandomWords;
}): ReactElement {
  const [character, setCharacter] = useState(start);
  const rolls = useRolls(random);
  latest = character;

  return (
    <>
      <CharacterSheet
        character={character}
        setCharacter={setCharacter}
        orphans={orphanReport(character, STACK)}
        stack={STACK}
        rolls={rolls}
      />
      <DiceOverlay rolls={rolls} />
    </>
  );
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  document.body.replaceChildren();
  latest = null;
});

async function mount(start: Character, random: RandomWords): Promise<void> {
  await act(async () => {
    root.render(<Harness start={start} random={random} />);
  });
}

/** The character as it stands right now. Non-null because the harness is mounted. */
function character(): Character {
  if (latest === null) throw new Error('nothing mounted');
  return latest;
}

function press(title: string): Promise<void> {
  const found = [...container.querySelectorAll('button')].find(
    (element) => element.title === title || element.textContent === title,
  );
  if (!found) throw new Error(`no button titled ${title}`);

  return act(async () => {
    found.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function buttonTitles(): readonly string[] {
  return [...container.querySelectorAll('button')].map((element) => element.title);
}

function text(selector: string): string {
  const found = container.querySelector(selector);
  if (!found) throw new Error(`nothing matching ${selector}`);
  return found.textContent ?? '';
}

/**
 * React installs its own value setter on the element, so assigning `.value` directly is
 * invisible to it. Going through the prototype descriptor is how a real keystroke looks.
 */
async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  await act(async () => {
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function fieldLabelled(label: string): HTMLInputElement {
  const found = [...container.querySelectorAll('label')].find(
    (element) => element.textContent === label,
  );
  const input = found === undefined ? null : document.getElementById(found.htmlFor);
  if (!(input instanceof HTMLInputElement)) throw new Error(`no field labelled ${label}`);

  return input;
}

/** A sheet carrying the rows a case is about, and nothing else. */
function sheet(fields: Partial<Character> = {}): Character {
  return { ...newCharacter(), ...fields };
}

const carrying = (ref: string): Character['items'][number] => ({
  id: newRowId(),
  ref,
  name: '',
  slots: 0,
  qty: 1,
  equipped: true,
});

// ---------------------------------------------------------------------------
// A weapon rolls its own damage
// ---------------------------------------------------------------------------

describe('a weapon rolled from the sheet', () => {
  it('rolls the dice the pack says it deals', async () => {
    await mount(sheet({ items: [carrying('core:item:dagger')] }), scripted(3));

    await press('Roll 1d4 damage for Dagger');

    // The number on screen is the number that was drawn — there is nothing between the
    // two to disagree (DESIGN.md §4).
    expect(text('.dice__result .dice__total')).toContain('3');
    expect(text('.dice__notation')).toBe('d4');
    expect(text('.dice__who')).toBe('You rolled Dagger damage');
  });

  it('offers a roll for each hand a versatile weapon can be used in', async () => {
    await mount(sheet({ items: [carrying('core:item:bastard-sword')] }), scripted(7));

    // `1d8/1d10` is two offers, not one guess: which hand it was in is the player's to
    // say, and choosing for them would be adjudication (PRD.md principle 1).
    expect(buttonTitles()).toContain('Roll 1d8 damage for Bastard sword');
    expect(buttonTitles()).toContain('Roll 1d10 damage for Bastard sword');

    await press('Roll 1d10 damage for Bastard sword');
    expect(text('.dice__notation')).toBe('d10');
  });

  it('leaves the sheet exactly as it found it', async () => {
    const start = sheet({ items: [carrying('core:item:dagger')] });
    // Compared against a copy taken before the roll, so a sheet edited in place would
    // fail here rather than quietly agreeing with itself.
    const before = structuredClone(start);
    await mount(start, scripted(4));

    await press('Roll 1d4 damage for Dagger');

    // 🚫 Damage is a number in the corner. Nothing is subtracted from anything, here or
    // anywhere — the app records and does not adjudicate (PRD.md principle 1).
    expect(character()).toEqual(before);
  });

  it('offers nothing to roll on a row the player wrote themselves', async () => {
    const own = { ...carrying('core:item:dagger'), ref: null, name: 'A sharpened spoon' };
    await mount(sheet({ items: [own] }), scripted(4));

    // No pack answers for it, so nothing knows what it hits for — and the sheet does not
    // invent one (DATA-MODEL.md §12: `name` is a fallback, never a cache).
    expect(buttonTitles().some((title) => title.startsWith('Roll'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A talent table, opened by taking a level
// ---------------------------------------------------------------------------

describe('the class’s talent table', () => {
  const wanderer = (level: number): Character =>
    sheet({ class: { ref: 'homebrew:class:wanderer', name: '' }, level });

  it('is offered by levelling up, and never chosen from the corner', async () => {
    await mount(wanderer(1), scripted(2, 2));

    expect(container.querySelector('.prompt')).toBeNull();
    await typeInto(fieldLabelled('Level'), '2');

    expect(text('.prompt')).toContain('Level 2');
    expect(text('.prompt')).toContain('Wanderer talents');

    // 🚫 The corner has a die, a count, a modifier, a label and an audience — and no
    // table (DESIGN.md §4). A table arrives from the context that already has it.
    await press('Dice');
    expect([...container.querySelectorAll('.dice__panel label')].map((one) => one.textContent))
      .toEqual(['Die', 'How many', 'Modifier', 'What for', 'Who sees it']);
  });

  it('records the row it landed on as text on the sheet', async () => {
    await mount(wanderer(2), scripted(4, 4));

    await press('Roll on Wanderer talents');

    const [talent] = character().talents;
    expect(talent?.text).toBe('The name of a river');
    expect(talent?.source).toBe('homebrew:table:wanderer-talents');
    // The total that produced it, not a die face: `2d6` showing two fours is eight.
    expect(talent?.rolled).toBe(8);
    expect(parseCharacter(character()).ok).toBe(true);
  });

  it('adjudicates nothing — every number on the sheet is where it was', async () => {
    const start = wanderer(3);
    const before = structuredClone(start);
    await mount(start, scripted(2, 2));

    await press('Roll on Wanderer talents');

    // The row this lands on is a talent, and a talent is words. 🚫 No stat moves, no HP,
    // no level, no luck (PRD.md principle 1, DATA-MODEL.md §8).
    expect(character()).toEqual({ ...before, talents: character().talents });
    expect(character().talents[0]?.text).toBe('A knack for knots');
  });

  it('writes nothing when the roll lands on a face no row covers', async () => {
    await mount(wanderer(2), scripted(6, 6));

    await press('Roll on Wanderer talents');

    // A gap is reported, never filled in with a neighbouring row — and a blank talent
    // would be worse than none (`model/tables.ts`).
    expect(character().talents).toEqual([]);
    expect(text('.dice__row')).toContain('gap');
  });

  it('settles the offer once it has been rolled', async () => {
    await mount(wanderer(1), scripted(4, 4));

    await typeInto(fieldLabelled('Level'), '2');
    await press('Roll on Wanderer talents');

    expect(container.querySelector('.prompt')).toBeNull();
  });

  it('does not read a level typed back down as an advance', async () => {
    await mount(wanderer(3), scripted(4, 4));

    await typeInto(fieldLabelled('Level'), '2');

    expect(container.querySelector('.prompt')).toBeNull();
  });

  it('offers nothing to roll when no loaded pack answers for a table', async () => {
    await mount(sheet({ class: { ref: 'homebrew:class:drifter', name: '' } }), scripted(4));

    // The class names a table nothing defines. The free-text row is how a talent from
    // anywhere else is recorded, which is what it was already for.
    expect(buttonTitles().some((title) => title.startsWith('Roll on'))).toBe(false);
  });

  it('rolls a core class’s table and records where the words came from', async () => {
    await mount(sheet({ class: { ref: 'core:class:fighter', name: '' }, level: 2 }), scripted(4, 4));

    await press('Roll on Fighter talents');

    const [talent] = character().talents;
    expect(talent?.source).toBe('core:table:fighter-talents');
    expect(talent?.rolled).toBe(8);
    expect(talent?.text).not.toBe('');
    expect(parseCharacter(character()).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A table that offers a reroll
// ---------------------------------------------------------------------------

describe('a rerollable table’s offer', () => {
  const oracle = (level: number): Character =>
    sheet({ class: { ref: 'homebrew:class:oracle', name: '' }, level });

  /** 4 on the first throw, 8 on the second — different rows, so the change is visible. */
  const twoThrows = () => scripted(2, 2, 4, 4);

  it('offers the reroll on the card, and writes nothing while it stands', async () => {
    await mount(oracle(2), twoThrows());

    await press('Roll on Oracle omens');

    expect(text('.dice__row')).toBe('A shape in the smoke');
    expect([...container.querySelectorAll('.dice__result button')].map((b) => b.textContent))
      .toEqual(['Reroll', 'Keep it']);
    // 🚫 Not yet the result. DATA-MODEL.md §8 offers the reroll *before the result is
    // kept*, so a row the player is about to pass up has not reached the sheet.
    expect(character().talents).toEqual([]);
  });

  it('records the throw that was kept, and never the one passed up', async () => {
    await mount(oracle(2), twoThrows());

    await press('Roll on Oracle omens');
    await press('Reroll');

    expect(text('.dice__row')).toBe('A cold wind from the east');
    expect(text('.dice__passed')).toContain('A shape in the smoke');

    const talents = character().talents;
    expect(talents).toHaveLength(1);
    expect(talents[0]?.text).toBe('A cold wind from the east');
    expect(talents[0]?.rolled).toBe(8);
    expect(parseCharacter(character()).ok).toBe(true);
  });

  it('spends the offer: the card has nothing left to reroll', async () => {
    await mount(oracle(2), twoThrows());

    await press('Roll on Oracle omens');
    await press('Reroll');

    // `MAX_TABLE_REROLLS` is one. A second offer would be rolling until the row is liked,
    // which is a different thing and not one any table asks for.
    expect([...container.querySelectorAll('.dice__result button')].map((b) => b.textContent))
      .toEqual(['Dismiss']);
  });

  it('records what is on screen when the player keeps it instead', async () => {
    await mount(oracle(2), twoThrows());

    await press('Roll on Oracle omens');
    await press('Keep it');

    expect(character().talents[0]?.text).toBe('A shape in the smoke');
    expect(character().talents).toHaveLength(1);
  });

  it('leaves rolling from the top available, and it is not the same act', async () => {
    await mount(oracle(2), twoThrows());

    await press('Roll on Oracle omens');
    await press('Roll on Oracle omens');

    // Starting over settles the first throw — the player kept it by rolling on past it —
    // and opens a *fresh* offer with nothing passed up. Two acts, not one reroll
    // (DATA-MODEL.md §8): the second throw is on offer in its own right.
    expect(container.querySelector('.dice__passed')).toBeNull();
    expect(text('.dice__row')).toBe('A cold wind from the east');
    expect(character().talents.map((talent) => talent.text)).toEqual([
      'A shape in the smoke',
    ]);

    await press('Keep it');
    expect(character().talents.map((talent) => talent.text)).toEqual([
      'A shape in the smoke',
      'A cold wind from the east',
    ]);
  });

  it('adjudicates nothing — a reroll changes which words are copied and no number', async () => {
    const start = oracle(3);
    const before = structuredClone(start);
    await mount(start, twoThrows());

    await press('Roll on Oracle omens');
    await press('Reroll');

    // 🚫 A talent is words. No stat moves for a roll, and none moves for a reroll either
    // (PRD.md principle 1, DATA-MODEL.md §8).
    expect(character()).toEqual({ ...before, talents: character().talents });
  });
});
