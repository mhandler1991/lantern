// The character schema is a security boundary and a data-loss boundary at once: it
// meets files off disk and payloads off the wire, and what it rejects, a player loses.
// So the tests come in two halves — what must be accepted, and what must not be.
//
// `VESS` is the example from DATA-MODEL.md §11, copied exactly. If the doc and the
// schema ever disagree, this file fails, which is the only way to keep a written
// contract honest.

import { describe, expect, it } from 'vitest';
import {
  Character,
  formatProblems,
  parseCharacter,
  type CharacterProblem,
} from './character';
import {
  MAX_CHARACTER_ID_LENGTH,
  MAX_CHARACTER_LEVEL,
  MAX_CHARACTER_NAME_LENGTH,
  MAX_COIN,
  MAX_CONDITION_LENGTH,
  MAX_HP,
  MAX_ITEMS,
  MAX_STAT,
  MIN_CHARACTER_LEVEL,
  MIN_STAT,
} from '../constants';

const VESS = {
  format: 'lantern-character',
  formatVersion: 1,
  id: 'c_9f3a2b',
  name: 'Vess of the Low Road',
  ancestry: 'core:ancestry:human',
  class: 'core:class:thief',
  alignment: 'neutral',
  level: 3,
  xp: 6,
  stats: { str: 13, dex: 16, con: 11, int: 9, wis: 12, cha: 6 },
  hp: { current: 11, max: 17 },
  luck: 1,
  gold: { gp: 22, sp: 0, cp: 0 },
  items: [{ ref: 'core:item:shortsword', qty: 1, equipped: true }],
  spells: [{ ref: 'core:spell:magic-missile' }],
  talents: [
    {
      text: "Your torch burns a quarter longer than anyone else's",
      source: 'core:table:thief-talents',
      rolled: 5,
    },
  ],
  lights: [{ ref: 'core:item:torch', litAt: null, minutes: 60 }],
  conditions: ['blessed'],
  journal: [{ at: 1735689600000, text: 'The innkeeper lied about the well.' }],
  quests: [{ text: 'Find out what is down the well', done: false }],
  packsUsed: ['core', 'frostbound'],
} as const;

/** A copy of Vess with one field replaced. Structured so a test reads as one claim. */
function withField(field: string, value: unknown): unknown {
  return { ...VESS, [field]: value };
}

/** The paths a failed parse complained about, for asserting the message is usable. */
function pathsOf(input: unknown): string[] {
  const result = parseCharacter(input);
  if (result.ok) throw new Error('expected the parse to fail, and it succeeded');
  return result.problems.map((problem) => problem.path);
}

describe('the documented shape', () => {
  it('accepts DATA-MODEL.md §11 exactly as written', () => {
    const result = parseCharacter(VESS);
    expect(result.ok).toBe(true);
  });

  it('accepts a character that has not been built yet', () => {
    const blank = {
      ...VESS,
      name: '',
      ancestry: null,
      class: null,
      alignment: null,
      level: MIN_CHARACTER_LEVEL,
      xp: 0,
      items: [],
      spells: [],
      talents: [],
      lights: [],
      packsUsed: [],
    };
    expect(parseCharacter(blank).ok).toBe(true);
  });

  it('holds a dying character rather than refusing to load one', () => {
    expect(parseCharacter(withField('hp', { current: -3, max: 17 })).ok).toBe(true);
  });

  it('keeps a talent whose pack is gone — text and source, chosen or rolled', () => {
    const chosen = withField('talents', [
      { text: 'Written in by hand, not rolled for', source: null, rolled: null },
    ]);
    expect(parseCharacter(chosen).ok).toBe(true);
  });

  it('infers the type from the schema rather than declaring it twice', () => {
    const result = Character.safeParse(VESS);
    if (!result.success) throw new Error('fixture must parse');
    // A type error here is the assertion; the runtime check just keeps vitest honest.
    const level: number = result.data.level;
    const first = result.data.talents[0];
    expect(level).toBe(3);
    expect(first?.text).toBe("Your torch burns a quarter longer than anyone else's");
  });
});

describe('no derived value can be stored', () => {
  // CLAUDE.md §4. These are not merely absent from the schema — they are rejected, so
  // a file that carries one is reported rather than silently stripped and re-saved.
  it.each(['ac', 'slots', 'slotsUsed', 'xpToNext', 'spellDC', 'modifiers', 'initiative'])(
    'rejects a stored %s',
    (field) => {
      expect(pathsOf(withField(field, 14))).toContain('(root)');
    },
  );

  it('rejects any unknown key, so the whitelist has no gaps', () => {
    expect(parseCharacter(withField('notes', 'hello')).ok).toBe(false);
  });
});

describe('the envelope', () => {
  it('rejects unrelated JSON early', () => {
    expect(parseCharacter(withField('format', 'lantern-pack')).ok).toBe(false);
    expect(parseCharacter(withField('formatVersion', 2)).ok).toBe(false);
  });

  it.each([null, undefined, 'a string', 42, [], true])('rejects %p', (input) => {
    expect(parseCharacter(input).ok).toBe(false);
  });

  it('rejects a character id that could not be used as a key', () => {
    expect(parseCharacter(withField('id', '')).ok).toBe(false);
    expect(parseCharacter(withField('id', 'c 9f3a2b')).ok).toBe(false);
    expect(parseCharacter(withField('id', 'c'.repeat(MAX_CHARACTER_ID_LENGTH + 1))).ok).toBe(false);
  });
});

describe('stats', () => {
  it('requires all six', () => {
    expect(pathsOf(withField('stats', { str: 10, dex: 10, con: 10 }))).toEqual([
      'stats.int',
      'stats.wis',
      'stats.cha',
    ]);
  });

  it('rejects a seventh', () => {
    expect(parseCharacter(withField('stats', { ...VESS.stats, lck: 10 })).ok).toBe(false);
  });

  it('bounds each one and requires a whole number', () => {
    expect(parseCharacter(withField('stats', { ...VESS.stats, str: MIN_STAT - 1 })).ok).toBe(false);
    expect(parseCharacter(withField('stats', { ...VESS.stats, str: MAX_STAT + 1 })).ok).toBe(false);
    expect(parseCharacter(withField('stats', { ...VESS.stats, str: 13.5 })).ok).toBe(false);
    expect(parseCharacter(withField('stats', { ...VESS.stats, str: '13' })).ok).toBe(false);
  });
});

describe('numbers a hostile file would inflate', () => {
  it('bounds hp, level, luck and coin', () => {
    expect(parseCharacter(withField('hp', { current: 0, max: MAX_HP + 1 })).ok).toBe(false);
    expect(parseCharacter(withField('hp', { current: -MAX_HP - 1, max: 10 })).ok).toBe(false);
    expect(parseCharacter(withField('level', MAX_CHARACTER_LEVEL + 1)).ok).toBe(false);
    expect(parseCharacter(withField('level', MIN_CHARACTER_LEVEL - 1)).ok).toBe(false);
    expect(parseCharacter(withField('luck', -1)).ok).toBe(false);
    expect(parseCharacter(withField('gold', { gp: MAX_COIN + 1, sp: 0, cp: 0 })).ok).toBe(false);
    expect(parseCharacter(withField('xp', Number.MAX_SAFE_INTEGER)).ok).toBe(false);
  });

  it('bounds the lists, so an import cannot exhaust the tab', () => {
    const many = Array.from({ length: MAX_ITEMS + 1 }, () => ({
      ref: 'core:item:torch',
      qty: 1,
      equipped: false,
    }));
    expect(parseCharacter(withField('items', many)).ok).toBe(false);
  });

  it('bounds free text', () => {
    expect(parseCharacter(withField('name', 'n'.repeat(MAX_CHARACTER_NAME_LENGTH + 1))).ok).toBe(
      false,
    );
    expect(parseCharacter(withField('conditions', ['c'.repeat(MAX_CONDITION_LENGTH + 1)])).ok).toBe(
      false,
    );
    expect(parseCharacter(withField('conditions', [''])).ok).toBe(false);
  });
});

describe('references into pack content', () => {
  it.each([
    ['bare, not namespaced', 'shortsword'],
    ['two parts', 'core:shortsword'],
    ['four parts', 'core:item:short:sword'],
    ['uppercase', 'Core:Item:Shortsword'],
    ['a space', 'core:item:short sword'],
    ['empty', ''],
    ['a path', '../../etc/passwd'],
    ['markup', '<script>alert(1)</script>'],
  ])('rejects a ref that is %s', (_why, ref) => {
    expect(parseCharacter(withField('items', [{ ref, qty: 1, equipped: false }])).ok).toBe(false);
  });

  it('rejects a pack id in packsUsed that is not a bare id', () => {
    expect(parseCharacter(withField('packsUsed', ['core:class:thief'])).ok).toBe(false);
    expect(parseCharacter(withField('packsUsed', ['Core'])).ok).toBe(false);
  });
});

describe('rows', () => {
  it('requires a whole, positive quantity', () => {
    const qty = (value: unknown): unknown =>
      withField('items', [{ ref: 'core:item:torch', qty: value, equipped: false }]);
    expect(parseCharacter(qty(0)).ok).toBe(false);
    expect(parseCharacter(qty(-1)).ok).toBe(false);
    expect(parseCharacter(qty(1.5)).ok).toBe(false);
    expect(parseCharacter(qty(2)).ok).toBe(true);
  });

  it('rejects a light that stores a countdown instead of when it was lit', () => {
    const light = { ref: 'core:item:torch', litAt: null, minutes: 60, remaining: 12 };
    expect(parseCharacter(withField('lights', [light])).ok).toBe(false);
  });

  it('rejects a talent that tries to modify a stat', () => {
    // PRD.md principle 1 — a talent is text on a sheet, never an effect.
    const talent = { text: 'A talent', source: null, rolled: null, grants: { str: 2 } };
    expect(parseCharacter(withField('talents', [talent])).ok).toBe(false);
  });
});

describe('problems are written to be pasted back', () => {
  it('gives an exact path into a nested row', () => {
    const items = [
      { ref: 'core:item:torch', qty: 1, equipped: false },
      { ref: 'core:item:rope', qty: 'two', equipped: false },
    ];
    expect(pathsOf(withField('items', items))).toEqual(['items[1].qty']);
  });

  it('says what was expected, not just that it was invalid', () => {
    const result = parseCharacter(withField('level', 99));
    if (result.ok) throw new Error('expected the parse to fail');
    expect(result.problems[0]?.message).toContain(String(MAX_CHARACTER_LEVEL));
  });

  it('reports every problem at once rather than the first', () => {
    const broken = { ...VESS, level: 99, luck: -1, name: 'n'.repeat(MAX_CHARACTER_NAME_LENGTH + 1) };
    expect(pathsOf(broken).length).toBeGreaterThan(2);
  });

  it('formats one problem per line, path first', () => {
    const problems: CharacterProblem[] = [
      { path: 'items[1].qty', message: 'expected number' },
      { path: '(root)', message: 'Unrecognized key: "ac"' },
    ];
    expect(formatProblems(problems)).toBe(
      '  items[1].qty — expected number\n  (root) — Unrecognized key: "ac"',
    );
  });
});
