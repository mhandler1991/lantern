// Two things must hold no matter what is in storage: the app still starts, and whatever
// was there is still there afterwards. Every test below is one of those two.

import { afterEach, describe, expect, it } from 'vitest';
import { CHARACTER_FORMAT, CHARACTER_FORMAT_VERSION, MAX_CHARACTER_BYTES } from '../constants';
import { formatProblems, parseCharacter } from '../model/character';
import type { CharacterMigration, MigrationResult, StoredDocument } from './character-storage';
import {
  CHARACTER_KEY,
  REJECTED_CHARACTER_KEY,
  clearStoredCharacter,
  loadCharacter,
  migrateCharacterDocument,
  readRejectedCharacter,
  saveCharacter,
} from './character-storage';
import { createCharacter } from './new-character';
import type { StorageDriver } from './storage';

const vess = { ...createCharacter('c_vess', 'Vess of the Low Road'), level: 3, xp: 6 };

afterEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// The round trip
// ---------------------------------------------------------------------------

describe('saving and loading', () => {
  it('brings a character back exactly as it went in', () => {
    expect(saveCharacter(vess)).toEqual({ ok: true });

    const load = loadCharacter();
    expect(load.kind).toBe('loaded');
    if (load.kind === 'loaded') {
      expect(load.character).toEqual(vess);
      expect(load.migratedFrom).toBeNull();
    }
  });

  it('stores the same document an export writes — no wrapper of its own', () => {
    saveCharacter(vess);

    const raw: unknown = JSON.parse(localStorage.getItem(CHARACTER_KEY) ?? '');
    expect(raw).toEqual(vess);
  });

  it('reports empty storage as empty rather than as a fault', () => {
    expect(loadCharacter()).toEqual({ kind: 'empty' });
  });

  it('clears the live key without touching a quarantined copy', () => {
    saveCharacter(vess);
    localStorage.setItem(REJECTED_CHARACTER_KEY, 'something older');

    clearStoredCharacter();

    expect(localStorage.getItem(CHARACTER_KEY)).toBeNull();
    expect(localStorage.getItem(REJECTED_CHARACTER_KEY)).toBe('something older');
  });

  it('refuses to write a character that would not load back', () => {
    const broken = { ...vess, level: 99 };
    const result = saveCharacter(broken);

    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'invalid') {
      expect(result.problems.map((problem) => problem.path)).toContain('level');
    }
    expect(localStorage.getItem(CHARACTER_KEY)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Values that cannot be read
// ---------------------------------------------------------------------------

describe('a stored value that cannot be read', () => {
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    ['is not JSON', '{ this is not json', '(root)'],
    ['is not an object', '"a string"', '(root)'],
    ['belongs to another app', JSON.stringify({ format: 'something-else', formatVersion: 1 }), 'format'],
    [
      'carries a derived value the schema forbids',
      JSON.stringify({ ...vess, ac: 14 }),
      'ac',
    ],
    [
      'is missing a required field',
      JSON.stringify({ ...vess, stats: undefined }),
      'stats',
    ],
  ];

  // Named by the path, or by the message where a field is missing entirely and there is
  // no path to it — DATA-MODEL.md §9. Both are in the block the player pastes.
  it.each(cases)('rejects a value that %s, naming %s', (_label, raw, named) => {
    localStorage.setItem(CHARACTER_KEY, raw);

    const load = loadCharacter();
    expect(load.kind).toBe('rejected');
    if (load.kind === 'rejected') {
      expect(formatProblems(load.problems)).toContain(named);
      expect(load.kept).toBe(true);
    }
  });

  it('never destroys it — the raw value is copied aside and left where it was', () => {
    const raw = '{ not json at all';
    localStorage.setItem(CHARACTER_KEY, raw);

    loadCharacter();

    expect(localStorage.getItem(REJECTED_CHARACTER_KEY)).toBe(raw);
    expect(localStorage.getItem(CHARACTER_KEY)).toBe(raw);
  });

  it('does not overwrite an earlier quarantined value with a later one', () => {
    localStorage.setItem(REJECTED_CHARACTER_KEY, 'the first thing that broke');
    localStorage.setItem(CHARACTER_KEY, 'the second thing that broke');

    const load = loadCharacter();

    expect(load.kind === 'rejected' && load.kept).toBe(false);
    expect(localStorage.getItem(REJECTED_CHARACTER_KEY)).toBe('the first thing that broke');
  });

  it('rejects an implausibly large value before parsing it', () => {
    localStorage.setItem(CHARACTER_KEY, `"${'x'.repeat(MAX_CHARACTER_BYTES)}"`);

    const load = loadCharacter();
    expect(load.kind).toBe('rejected');
    if (load.kind === 'rejected') {
      expect(load.problems[0]?.message).toMatch(/at most/);
    }
  });
});

describe('a browser that will not let us look', () => {
  const blocked: StorageDriver = {
    getItem() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
    setItem() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
    removeItem: () => undefined,
  };

  it('reports unavailable rather than empty, so nothing claims data was lost', () => {
    const load = loadCharacter(blocked);
    expect(load.kind).toBe('unavailable');
  });

  it('reports a failed write as a storage failure, not as an invalid character', () => {
    const result = saveCharacter(vess, blocked);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('storage');
  });

  it('offers nothing back, because nothing could be read to offer', () => {
    const read = readRejectedCharacter(blocked);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toBe('unavailable');
  });
});

// ---------------------------------------------------------------------------
// Offering it back — issue #89
// ---------------------------------------------------------------------------

describe('the quarantined value', () => {
  it('is flagged as quarantined when this value is the one that was set aside', () => {
    localStorage.setItem(CHARACTER_KEY, '{ not json at all');

    const load = loadCharacter();

    expect(load.kind === 'rejected' && load.kept).toBe(true);
    expect(load.kind === 'rejected' && load.quarantined).toBe(true);
  });

  // `kept` cannot stand in for `quarantined`: an earlier copy is parked and untouched,
  // and it is still a value the player is owed a way back to.
  it('is flagged as quarantined when an earlier value is already parked', () => {
    localStorage.setItem(REJECTED_CHARACTER_KEY, 'the first thing that broke');
    localStorage.setItem(CHARACTER_KEY, 'the second thing that broke');

    const load = loadCharacter();

    expect(load.kind === 'rejected' && load.kept).toBe(false);
    expect(load.kind === 'rejected' && load.quarantined).toBe(true);
  });

  it('is not claimed as quarantined when the browser refused the copy', () => {
    const readable: StorageDriver = {
      getItem: (key) => (key === CHARACTER_KEY ? '{ not json at all' : null),
      setItem() {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      removeItem: () => undefined,
    };

    const load = loadCharacter(readable);

    expect(load.kind === 'rejected' && load.kept).toBe(false);
    expect(load.kind === 'rejected' && load.quarantined).toBe(false);
  });

  // The acceptance criterion in one test: what is handed back is what was stored, and a
  // value that never was JSON is handed back the same way as one that was.
  it.each([
    ['is not JSON at all', '{ not json at all'],
    ['is JSON but not ours', '{"format":"something-else","name":"Vess"}'],
    ['is not even text-shaped', '\u0000\ufeff  ragged\r\n\ttext '],
  ])('is handed back byte for byte when it %s', (_label, raw) => {
    localStorage.setItem(CHARACTER_KEY, raw);
    loadCharacter();

    const read = readRejectedCharacter();

    expect(read.ok).toBe(true);
    if (read.ok) expect(read.text).toBe(raw);
  });

  it('reports an empty key as empty rather than as an empty character', () => {
    const read = readRejectedCharacter();
    expect(read).toEqual({ ok: false, reason: 'empty' });
  });

  it('is never written to by reading it — the copy survives every look', () => {
    const raw = '{ not json at all';
    localStorage.setItem(CHARACTER_KEY, raw);
    loadCharacter();

    const writes: string[] = [];
    const watched: StorageDriver = {
      getItem: (key) => localStorage.getItem(key),
      setItem: (key) => writes.push(key),
      removeItem: (key) => writes.push(key),
    };

    readRejectedCharacter(watched);
    readRejectedCharacter(watched);

    expect(writes).toEqual([]);
    expect(localStorage.getItem(REJECTED_CHARACTER_KEY)).toBe(raw);
  });
});

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/** A document at `version`, valid enough for the migration chain to work on. */
function documentAt(version: number): StoredDocument {
  return { ...vess, formatVersion: version };
}

/** Bumps the version and leaves a mark, so an applied step is visible in the result. */
function bumpTo(version: number): CharacterMigration {
  return (document) => ({ ...document, formatVersion: version, [`migrated${version}`]: true });
}

describe('formatVersion', () => {
  it('passes a document already at the current version through untouched', () => {
    const result = migrateCharacterDocument(documentAt(CHARACTER_FORMAT_VERSION));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.from).toBe(CHARACTER_FORMAT_VERSION);
      expect(result.document).toEqual(documentAt(CHARACTER_FORMAT_VERSION));
    }
  });

  it('walks every registered step from the stored version to the target', () => {
    const migrations = new Map([
      [1, bumpTo(2)],
      [2, bumpTo(3)],
    ]);

    const result = migrateCharacterDocument(documentAt(1), migrations, 3);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.from).toBe(1);
      expect(result.document.formatVersion).toBe(3);
      expect(result.document.migrated2).toBe(true);
      expect(result.document.migrated3).toBe(true);
      // Everything the old document carried survives the walk.
      expect(result.document.name).toBe(vess.name);
    }
  });

  it('starts from the stored version, not from the first one', () => {
    const migrations = new Map([
      [1, bumpTo(2)],
      [2, bumpTo(3)],
    ]);

    const result = migrateCharacterDocument(documentAt(2), migrations, 3);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.migrated2).toBeUndefined();
      expect(result.document.migrated3).toBe(true);
    }
  });

  it('refuses when a step in the chain is missing rather than skipping it', () => {
    const migrations = new Map([[1, bumpTo(2)]]);

    const result = migrateCharacterDocument(documentAt(1), migrations, 3);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]?.message).toMatch(/no migration from formatVersion 2/);
  });

  it('refuses when a migration does not leave the document at the version it claims', () => {
    const migrations = new Map<number, CharacterMigration>([[1, (document) => document]]);

    const result = migrateCharacterDocument(documentAt(1), migrations, 2);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]?.path).toBe('formatVersion');
  });

  it('refuses a document from the future instead of downgrading it', () => {
    const future = CHARACTER_FORMAT_VERSION + 1;
    const result = migrateCharacterDocument(documentAt(future));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]?.message).toMatch(/newer version of Lantern/);
  });

  it('leaves a future document in storage exactly as it found it', () => {
    const raw = JSON.stringify(documentAt(CHARACTER_FORMAT_VERSION + 1));
    localStorage.setItem(CHARACTER_KEY, raw);

    const load = loadCharacter();

    expect(load.kind).toBe('rejected');
    expect(localStorage.getItem(CHARACTER_KEY)).toBe(raw);
    expect(localStorage.getItem(REJECTED_CHARACTER_KEY)).toBe(raw);
  });

  it.each([0, -1, 1.5, '1', null, undefined])('refuses %s as a version', (version) => {
    const result = migrateCharacterDocument({ format: CHARACTER_FORMAT, formatVersion: version });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]?.path).toBe('formatVersion');
  });

  // Tuples, not bare values: it.each spreads an array element into the arguments, so a
  // bare `[]` would arrive as no argument at all and quietly test `undefined` twice.
  it.each([[null], [undefined], [42], ['a string'], [[]]])(
    'refuses %s as a document',
    (input: unknown) => {
      const result = migrateCharacterDocument(input);
      expect(result.ok).toBe(false);
    },
  );
});

// ---------------------------------------------------------------------------
// The one real migration
// ---------------------------------------------------------------------------

/** A character as version 1 stored it: bare refs, no row ids, no free-text names. */
const VESS_V1: StoredDocument = {
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

/** The registered chain, not an injected one — this is the step that actually ships. */
function migrateVessV1(): MigrationResult {
  return migrateCharacterDocument(VESS_V1);
}

describe('formatVersion 1 to 2', () => {
  it('brings a version 1 character all the way to one that parses', () => {
    const result = migrateVessV1();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.from).toBe(1);
    const parsed = parseCharacter(result.document);
    expect(parsed.ok).toBe(true);
  });

  it('wraps the refs that became a name-and-reference pair', () => {
    const result = migrateVessV1();
    if (!result.ok) throw new Error('expected the migration to succeed');

    expect(result.document.ancestry).toEqual({ ref: 'core:ancestry:human', name: '' });
    expect(result.document.class).toEqual({ ref: 'core:class:thief', name: '' });
  });

  it('gives every row an id that would serve as a key', () => {
    const result = migrateVessV1();
    if (!result.ok) throw new Error('expected the migration to succeed');

    const parsed = parseCharacter(result.document);
    if (!parsed.ok) throw new Error('expected the migrated character to parse');

    const ids = [
      ...parsed.character.items,
      ...parsed.character.spells,
      ...parsed.character.talents,
      ...parsed.character.lights,
      ...parsed.character.journal,
      ...parsed.character.quests,
    ].map((row) => row.id);

    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('costs a migrated item nothing of its own — the pack still answers for it', () => {
    const result = migrateVessV1();
    if (!result.ok) throw new Error('expected the migration to succeed');

    const parsed = parseCharacter(result.document);
    if (!parsed.ok) throw new Error('expected the migrated character to parse');

    expect(parsed.character.items[0]?.slots).toBe(0);
    expect(parsed.character.items[0]?.ref).toBe('core:item:shortsword');
    expect(parsed.character.items[0]?.name).toBe('');
  });

  it('loses nothing a version 1 sheet was carrying', () => {
    const result = migrateVessV1();
    if (!result.ok) throw new Error('expected the migration to succeed');

    expect(result.document.name).toBe(VESS_V1.name);
    expect(result.document.conditions).toEqual(['blessed']);
    expect(result.document.packsUsed).toEqual(['core', 'frostbound']);
  });

  it('never overwrites a key a stored row already carried', () => {
    // A row from a build that added something this one does not know about. The
    // migration leaves it, and the strict parse is what reports it.
    const withExtra = { ...VESS_V1, items: [{ ref: 'core:item:torch', qty: 1, equipped: false, name: 'Mine' }] };
    const result = migrateCharacterDocument(withExtra);
    if (!result.ok) throw new Error('expected the migration to succeed');

    const items = result.document.items as ReadonlyArray<Record<string, unknown>>;
    expect(items[0]?.name).toBe('Mine');
  });

  it('reads back through storage as a loaded character, not a rejected one', () => {
    localStorage.setItem(CHARACTER_KEY, JSON.stringify(VESS_V1));

    const load = loadCharacter();

    expect(load.kind).toBe('loaded');
    if (load.kind !== 'loaded') return;
    expect(load.migratedFrom).toBe(1);
    expect(load.character.name).toBe('Vess of the Low Road');
  });
});
