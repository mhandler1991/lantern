/**
 * Where the character lives between visits, and how a stored one is brought forward
 * when the format moves under it. DATA-MODEL.md §12.
 *
 * The bytes under `lantern:character` are the same bytes an export writes — the whole
 * character document, `format` and `formatVersion` included, with no wrapper of its own.
 * That is deliberate: storage and import then share one migration path, so a sheet saved
 * by an old build and a file exported by one are brought forward by the same code and
 * cannot drift apart. Issue #16 imports files through `migrateCharacterDocument` too.
 *
 * Two rules govern everything here, and they are PRD.md principle 4 restated:
 *
 *   - **Never refuse to load a character.** A value that cannot be read is reported as
 *     a result, never thrown, and the app carries on with a new sheet.
 *   - **Never destroy player data.** A value this file cannot read is copied aside
 *     before anything is allowed to save over it, and a value written by a *newer*
 *     build is left exactly as it is rather than downgraded.
 */

import {
  CHARACTER_FORMAT,
  CHARACTER_FORMAT_VERSION,
  MAX_CHARACTER_BYTES,
  STORAGE_PREFIX,
} from '../constants';
import type { Character, CharacterProblem } from '../model/character';
import { parseCharacter } from '../model/character';
import type { StorageDriver, StorageFailure } from './storage';
import { defaultStorageDriver, describeError, readText, removeKey, writeText } from './storage';

/** The active sheet. One slot — DESIGN.md's diagram says "localStorage: full character". */
export const CHARACTER_KEY = `${STORAGE_PREFIX}character`;

/**
 * Where a value we could not read goes before a new sheet is allowed to overwrite it.
 * It is never read back by the app; it exists so that "corrupt" means "set aside for a
 * human" rather than "gone".
 */
export const REJECTED_CHARACTER_KEY = `${STORAGE_PREFIX}character.rejected`;

/** The first version, so `formatVersion: 0` is a broken file rather than an old one. */
const FIRST_FORMAT_VERSION = 1;

/** One step forward. Applied to a document already known to be at `from`. */
export type CharacterMigration = (document: StoredDocument) => StoredDocument;

/** A stored document before it has been validated — an object, and nothing more. */
export type StoredDocument = Readonly<Record<string, unknown>>;

/**
 * Keyed by the version being migrated **from**; each entry produces the next one up.
 * Empty at `formatVersion: 1` because nothing has been superseded yet — the chain that
 * walks it is what issue #15 owed, and it is tested against injected migrations rather
 * than left to be written for the first time on the day a format actually changes.
 */
export const CHARACTER_MIGRATIONS: ReadonlyMap<number, CharacterMigration> = new Map();

export type MigrationResult =
  | {
      readonly ok: true;
      readonly document: StoredDocument;
      /** The version found in storage. Equal to the target when nothing was applied. */
      readonly from: number;
    }
  | { readonly ok: false; readonly problems: readonly CharacterProblem[] };

function problem(path: string, message: string): { problems: readonly CharacterProblem[] } {
  return { problems: [{ path, message }] };
}

function isDocument(value: unknown): value is StoredDocument {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Walk a stored document up to the current format, one registered step at a time.
 *
 * `target` and `migrations` are parameters rather than constants so the chain can be
 * proven now, with versions that do not exist yet, instead of the first migration ever
 * written being the one that finds out whether this loop works. Production passes
 * neither.
 *
 * A document from the *future* is refused rather than guessed at: a newer build wrote
 * it, this one cannot know what it dropped, and mangling it would be exactly the data
 * loss PRD.md principle 4 forbids.
 */
export function migrateCharacterDocument(
  input: unknown,
  migrations: ReadonlyMap<number, CharacterMigration> = CHARACTER_MIGRATIONS,
  target: number = CHARACTER_FORMAT_VERSION,
): MigrationResult {
  if (!isDocument(input)) {
    return { ok: false, ...problem('(root)', `expected an object, found ${typeof input}`) };
  }

  if (input.format !== CHARACTER_FORMAT) {
    return {
      ok: false,
      ...problem('format', `expected "${CHARACTER_FORMAT}", found ${JSON.stringify(input.format)}`),
    };
  }

  const from = input.formatVersion;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < FIRST_FORMAT_VERSION) {
    return {
      ok: false,
      ...problem(
        'formatVersion',
        `expected an integer of at least ${FIRST_FORMAT_VERSION}, found ${JSON.stringify(from)}`,
      ),
    };
  }

  if (from > target) {
    return {
      ok: false,
      ...problem(
        'formatVersion',
        `saved by a newer version of Lantern (formatVersion ${from}); this build reads up to ${target}. The stored copy has been left unchanged`,
      ),
    };
  }

  let document: StoredDocument = input;
  for (let version = from; version < target; version += 1) {
    const migration = migrations.get(version);
    if (!migration) {
      return {
        ok: false,
        ...problem(
          'formatVersion',
          `no migration from formatVersion ${version} to ${version + 1}`,
        ),
      };
    }

    const next = migration(document);
    if (!isDocument(next) || next.formatVersion !== version + 1) {
      return {
        ok: false,
        ...problem(
          'formatVersion',
          `the migration from ${version} to ${version + 1} did not produce a document at formatVersion ${version + 1}`,
        ),
      };
    }
    document = next;
  }

  return { ok: true, document, from };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type CharacterLoad =
  /** `migratedFrom` is null unless the stored copy was behind and was brought forward. */
  | { readonly kind: 'loaded'; readonly character: Character; readonly migratedFrom: number | null }
  /** Nothing stored. A first visit, or a cleared browser. */
  | { readonly kind: 'empty' }
  /**
   * Something was stored and could not be read. `kept` says whether the raw text is now
   * safe under `REJECTED_CHARACTER_KEY`; when it is false an earlier rejected value is
   * already parked there and was not overwritten, because the first thing to break is
   * the likelier to be real player data.
   */
  | {
      readonly kind: 'rejected';
      readonly problems: readonly CharacterProblem[];
      readonly kept: boolean;
    }
  /** The browser would not let us look. Nothing is wrong with the sheet. */
  | { readonly kind: 'unavailable'; readonly failure: StorageFailure };

/**
 * Copy a value we could not read out of the way, so the autosave that follows cannot
 * destroy it. An existing quarantine is never overwritten.
 */
function quarantine(raw: string, driver: StorageDriver | null): boolean {
  const existing = readText(REJECTED_CHARACTER_KEY, driver);
  if (!existing.ok || existing.value !== null) return false;

  return writeText(REJECTED_CHARACTER_KEY, raw, driver).ok;
}

/**
 * Read the stored sheet. Never throws, and never returns a partially repaired
 * character — a rejected one is reported with the paths that failed, ready to paste
 * (DATA-MODEL.md §9).
 */
export function loadCharacter(driver = defaultStorageDriver()): CharacterLoad {
  const read = readText(CHARACTER_KEY, driver);
  if (!read.ok) return { kind: 'unavailable', failure: read.failure };
  if (read.value === null) return { kind: 'empty' };

  const raw = read.value;
  const reject = (problems: readonly CharacterProblem[]): CharacterLoad => ({
    kind: 'rejected',
    problems,
    kept: quarantine(raw, driver),
  });

  // A UTF-16 length is never larger than the byte count it encodes to, so this is the
  // conservative half of the same bound import uses on a file. It exists to stop a
  // hostile origin-mate parking megabytes under our key and having us parse it.
  if (raw.length > MAX_CHARACTER_BYTES) {
    return reject([
      {
        path: '(root)',
        message: `expected at most ${MAX_CHARACTER_BYTES} characters, found ${raw.length}`,
      },
    ]);
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (error) {
    return reject([{ path: '(root)', message: `expected JSON — ${describeError(error)}` }]);
  }

  const migrated = migrateCharacterDocument(decoded);
  if (!migrated.ok) return reject(migrated.problems);

  const parsed = parseCharacter(migrated.document);
  if (!parsed.ok) return reject(parsed.problems);

  return {
    kind: 'loaded',
    character: parsed.character,
    migratedFrom: migrated.from === CHARACTER_FORMAT_VERSION ? null : migrated.from,
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export type CharacterSave =
  | { readonly ok: true }
  /** Validated on the way out as well as in. CLAUDE.md §2.7 — even our own data. */
  | { readonly ok: false; readonly reason: 'invalid'; readonly problems: readonly CharacterProblem[] }
  | { readonly ok: false; readonly reason: 'storage'; readonly failure: StorageFailure };

export function saveCharacter(character: Character, driver = defaultStorageDriver()): CharacterSave {
  const validated = parseCharacter(character);
  if (!validated.ok) return { ok: false, reason: 'invalid', problems: validated.problems };

  const written = writeText(CHARACTER_KEY, JSON.stringify(validated.character), driver);
  if (!written.ok) return { ok: false, reason: 'storage', failure: written.failure };

  return { ok: true };
}

/** Used by export/import and by tests. The quarantined copy is deliberately left alone. */
export function clearStoredCharacter(driver = defaultStorageDriver()): void {
  removeKey(CHARACTER_KEY, driver);
}
