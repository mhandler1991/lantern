// A file is the only copy of a character that survives this browser (DESIGN.md §8), so
// there are exactly two things to prove: what goes out comes back identical, and what
// comes in cannot be anything else. Every test below is one of those two.
//
// The oversize and unreadable cases are the reason `PickedFile` is a structural type
// rather than the DOM `File`: a 600 KB file and a disk that disappeared mid-read are
// both one object literal here, and both would otherwise be untested assumptions.

import { describe, expect, it, vi } from 'vitest';
import {
  CHARACTER_FORMAT,
  CHARACTER_FORMAT_VERSION,
  MAX_CHARACTER_BYTES,
  MAX_CHARACTER_FILE_SLUG_LENGTH,
} from '../constants';
import type { Character } from '../model/character';
import { formatProblems } from '../model/character';
import type { PickedFile } from './character-file';
import {
  CHARACTER_FILE_TYPE,
  characterFileName,
  fromCharacterFileText,
  readCharacterFile,
  toCharacterFile,
} from './character-file';
import { CHARACTER_KEY, saveCharacter } from './character-storage';
import { createCharacter } from './new-character';

const vess: Character = {
  ...createCharacter('c_9f3a2b', 'Vess of the Low Road'),
  level: 3,
  xp: 6,
  hp: { current: 11, max: 17 },
  conditions: ['blessed'],
  packsUsed: ['core'],
};

/** A `File`, as far as anything in `character-file.ts` is concerned. */
function picked(text: string, size = text.length): PickedFile {
  return { size, text: () => Promise.resolve(text) };
}

function fileText(character: Character): string {
  const written = toCharacterFile(character);
  if (!written.ok) throw new Error(`expected an export, got ${JSON.stringify(written.problems)}`);
  return written.file.text;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

describe('exporting', () => {
  it('writes the same bytes storage holds — DATA-MODEL.md §13, no wrapper of its own', () => {
    localStorage.clear();
    expect(saveCharacter(vess)).toEqual({ ok: true });

    expect(fileText(vess)).toBe(localStorage.getItem(CHARACTER_KEY));
    localStorage.clear();
  });

  it('writes a document that reads straight back as the same character', () => {
    const read = fromCharacterFileText(fileText(vess));

    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.character).toEqual(vess);
      expect(read.migratedFrom).toBeNull();
    }
  });

  it('carries the format and version, so the file says what it is', () => {
    const decoded: unknown = JSON.parse(fileText(vess));

    expect(decoded).toMatchObject({
      format: CHARACTER_FORMAT,
      formatVersion: CHARACTER_FORMAT_VERSION,
    });
  });

  it('offers JSON, so a browser and a text editor both know what they have', () => {
    const written = toCharacterFile(vess);
    expect(written.ok && written.file.type).toBe(CHARACTER_FILE_TYPE);
  });

  it('refuses to write a sheet that would not load back, naming the field', () => {
    // Cast because the type system already forbids this; a hostile or buggy caller is
    // what the outbound validation exists for (CLAUDE.md §2.7).
    const broken = { ...vess, level: 99 } as unknown as Character;

    const written = toCharacterFile(broken);
    expect(written.ok).toBe(false);
    if (!written.ok) expect(written.problems.map((problem) => problem.path)).toContain('level');
  });
});

describe('the file name', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['Vess of the Low Road', 'lantern-character-vess-of-the-low-road.json'],
    ["Grix, the Rat-King's Own", 'lantern-character-grix-the-rat-king-s-own.json'],
    ['  ', 'lantern-character.json'],
    ['', 'lantern-character.json'],
    // Nothing survives the slug, so the name is dropped rather than left as hyphens.
    ['ヴェス', 'lantern-character.json'],
  ];

  it.each(cases)('turns %j into %s', (name, expected) => {
    expect(characterFileName({ ...vess, name })).toBe(expected);
  });

  it('caps the slug and never ends on the hyphen the cut left behind', () => {
    // One-letter words, so the slug alternates letter and hyphen and the cut at the cap
    // lands on a hyphen — the case the second trim exists for.
    const name = Array.from({ length: 60 }, () => 'a').join(' ');

    const written = characterFileName({ ...vess, name });
    expect(written.startsWith(`${CHARACTER_FORMAT}-a-a-`)).toBe(true);
    expect(written).not.toMatch(/-\.json$/u);
    expect(written.length).toBeLessThanOrEqual(
      `${CHARACTER_FORMAT}-`.length + MAX_CHARACTER_FILE_SLUG_LENGTH + '.json'.length,
    );
  });
});

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

describe('importing', () => {
  it('brings a whole character back off a file', async () => {
    const read = await readCharacterFile(picked(fileText(vess)));

    expect(read.ok).toBe(true);
    if (read.ok) expect(read.character).toEqual(vess);
  });

  const rejections: readonly (readonly [string, string, string])[] = [
    ['is not JSON at all', '{ not json', '(root)'],
    ['is empty', '', '(root)'],
    ['is a JSON array rather than a document', '[]', '(root)'],
    ['belongs to another app', JSON.stringify({ format: 'something-else', formatVersion: 2 }), 'format'],
    [
      'carries a derived value the schema forbids',
      JSON.stringify({ ...vess, ac: 14 }),
      'ac',
    ],
    ['is missing a required field', JSON.stringify({ ...vess, stats: undefined }), 'stats'],
    ['claims a level no character reaches', JSON.stringify({ ...vess, level: 99 }), 'level'],
    [
      'was written by a newer build',
      JSON.stringify({ ...vess, formatVersion: CHARACTER_FORMAT_VERSION + 1 }),
      'formatVersion',
    ],
  ];

  // What is named may be the path or the message — a field that is missing is reported
  // against the object that should have held it (DATA-MODEL.md §10). Either way it is in
  // the block the player is asked to paste.
  it.each(rejections)('refuses a file that %s, naming %s', async (_label, text, named) => {
    const read = await readCharacterFile(picked(text));

    expect(read.ok).toBe(false);
    if (!read.ok) expect(formatProblems(read.problems)).toContain(named);
  });

  it('refuses a file larger than the cap without reading a byte of it', async () => {
    const text = vi.fn(() => Promise.resolve('{}'));

    const read = await readCharacterFile({ size: MAX_CHARACTER_BYTES + 1, text });

    expect(read.ok).toBe(false);
    expect(text).not.toHaveBeenCalled();
    if (!read.ok) {
      expect(read.problems[0]?.message).toMatch(
        new RegExp(`at most ${MAX_CHARACTER_BYTES} bytes`, 'u'),
      );
    }
  });

  it('refuses text longer than the cap even when the file claimed to be small', async () => {
    // A file's reported size and its text are two different claims. The second one is
    // checked too, so a lying `size` buys nothing.
    const oversize = 'x'.repeat(MAX_CHARACTER_BYTES + 1);

    const read = await readCharacterFile({ size: 1, text: () => Promise.resolve(oversize) });

    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.problems[0]?.message).toMatch(
        new RegExp(`at most ${MAX_CHARACTER_BYTES} characters`, 'u'),
      );
    }
  });

  it('reports a file that could not be read rather than throwing', async () => {
    const read = await readCharacterFile({
      size: 10,
      text: () => Promise.reject(new DOMException('NotReadableError', 'NotReadableError')),
    });

    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.problems[0]?.message).toMatch(/could not be read/u);
  });

  it('brings a file written by an older build forward, and says which', async () => {
    const v1 = {
      format: CHARACTER_FORMAT,
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
      talents: [{ text: 'A talent', source: null, rolled: null }],
      lights: [{ ref: 'core:item:torch', litAt: null, minutes: 60 }],
      conditions: ['blessed'],
      journal: [{ at: 1735689600000, text: 'The innkeeper lied about the well.' }],
      quests: [{ text: 'Find out what is down the well', done: false }],
      packsUsed: ['core', 'frostbound'],
    };

    const read = await readCharacterFile(picked(JSON.stringify(v1)));

    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.migratedFrom).toBe(1);
      expect(read.character.formatVersion).toBe(CHARACTER_FORMAT_VERSION);
      expect(read.character.ancestry).toEqual({ ref: 'core:ancestry:human', name: '' });
      expect(read.character.items[0]?.qty).toBe(1);
    }
  });

  it('keeps the id, so a round trip is the same character and not a copy of one', async () => {
    const read = await readCharacterFile(picked(fileText(vess)));

    expect(read.ok && read.character.id).toBe(vess.id);
  });
});
