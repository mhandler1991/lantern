// Two things must hold no matter what is in storage: the app still starts, and whatever
// was there is still there afterwards. Every test below is one of those two.

import { afterEach, describe, expect, it } from 'vitest';
import { CHARACTER_FORMAT, CHARACTER_FORMAT_VERSION, MAX_CHARACTER_BYTES } from '../constants';
import type { CharacterMigration, StoredDocument } from './character-storage';
import {
  CHARACTER_KEY,
  REJECTED_CHARACTER_KEY,
  clearStoredCharacter,
  loadCharacter,
  migrateCharacterDocument,
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
      '(root)',
    ],
    [
      'is missing a required field',
      JSON.stringify({ ...vess, stats: undefined }),
      'stats',
    ],
  ];

  it.each(cases)('rejects a value that %s, naming %s', (_label, raw, path) => {
    localStorage.setItem(CHARACTER_KEY, raw);

    const load = loadCharacter();
    expect(load.kind).toBe('rejected');
    if (load.kind === 'rejected') {
      expect(load.problems.map((problem) => problem.path)).toContain(path);
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
