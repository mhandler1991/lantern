/**
 * Where the character lives between visits, and how a stored one is brought forward
 * when the format moves under it. DATA-MODEL.md §13.
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
import { newRowId } from './new-character';
import type { StorageDriver, StorageFailure } from './storage';
import { defaultStorageDriver, describeError, readText, removeKey, writeText } from './storage';

/** The active sheet. One slot — DESIGN.md's diagram says "localStorage: full character". */
export const CHARACTER_KEY = `${STORAGE_PREFIX}character`;

/**
 * Where a value we could not read goes before a new sheet is allowed to overwrite it.
 *
 * Nothing in the app parses it, migrates it, or writes over it. It is read back in
 * exactly one direction: `readRejectedCharacter` hands the raw string to
 * `ui/RecoverCharacter.tsx`, which offers it to the player as a file. "Corrupt" means
 * "set aside for a human", and issue #89 is what gives the human a way to reach it that
 * is not devtools.
 */
export const REJECTED_CHARACTER_KEY = `${STORAGE_PREFIX}character.rejected`;

/** The first version, so `formatVersion: 0` is a broken file rather than an old one. */
const FIRST_FORMAT_VERSION = 1;

/** A migration's endpoints are fixed labels: 1 → 2 stays 1 → 2 after the format moves on. */
const FORMAT_VERSION_1 = 1;
const FORMAT_VERSION_2 = 2;

/** Nothing carried. A floor, not a business rule. */
const NONE = 0;

/** One step forward. Applied to a document already known to be at `from`. */
export type CharacterMigration = (document: StoredDocument) => StoredDocument;

/** A stored document before it has been validated — an object, and nothing more. */
export type StoredDocument = Readonly<Record<string, unknown>>;

/**
 * A v1 `ancestry` or `class` was a bare ref or null. A v2 one is a `ContentRef`, so that
 * a character built with no packs has somewhere to put the words the player typed.
 */
function toContentRef(value: unknown): unknown {
  if (value === null) return { ref: null, name: '' };
  if (typeof value === 'string') return { ref: value, name: '' };

  // Anything else was already wrong in v1. Left as it is, so the v2 parse reports it
  // against the shape it actually has rather than one this function invented.
  return value;
}

/**
 * Give every row in a list an id, and any defaults v2 added. `defaults` sit *under* the
 * row so a key the stored row already carries is never overwritten — a value this build
 * does not understand is the player's, and the parse that follows is what judges it.
 */
function withRowIds(value: unknown, defaults: Readonly<Record<string, unknown>> = {}): unknown {
  if (!Array.isArray(value)) return value;

  return value.map((row: unknown) => (isDocument(row) ? { ...defaults, ...row, id: newRowId() } : row));
}

/**
 * 1 → 2. Rows gain an `id` and a free-text `name`; items gain their own `slots`, left at
 * zero because every v1 row referenced a pack and the pack's answer is the one that wins
 * (`model/derived.ts`). Nothing is dropped, so the migration cannot lose player data.
 */
function migrateCharacter1To2(document: StoredDocument): StoredDocument {
  return {
    ...document,
    formatVersion: FORMAT_VERSION_2,
    ancestry: toContentRef(document.ancestry),
    class: toContentRef(document.class),
    items: withRowIds(document.items, { name: '', slots: NONE }),
    spells: withRowIds(document.spells, { name: '' }),
    lights: withRowIds(document.lights, { name: '' }),
    talents: withRowIds(document.talents),
    journal: withRowIds(document.journal),
    quests: withRowIds(document.quests),
  };
}

/**
 * Keyed by the version being migrated **from**; each entry produces the next one up.
 * The chain that walks this map is tested against injected migrations as well, so a
 * future step is proven before it is written rather than on the day it ships.
 */
export const CHARACTER_MIGRATIONS: ReadonlyMap<number, CharacterMigration> = new Map([
  [FORMAT_VERSION_1, migrateCharacter1To2],
]);

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
   * Something was stored and could not be read. `kept` says whether *this* raw text is
   * now safe under `REJECTED_CHARACTER_KEY`; when it is false an earlier rejected value
   * is already parked there and was not overwritten, because the first thing to break is
   * the likelier to be real player data.
   *
   * `quarantined` is the question the UI actually asks — is there anything under that
   * key to offer back? It is true in both of those cases and false only when storage
   * refused, so `kept` cannot stand in for it: a browser that would not take the write
   * leaves `kept` false with nothing parked at all.
   */
  | {
      readonly kind: 'rejected';
      readonly problems: readonly CharacterProblem[];
      readonly kept: boolean;
      readonly quarantined: boolean;
    }
  /** The browser would not let us look. Nothing is wrong with the sheet. */
  | { readonly kind: 'unavailable'; readonly failure: StorageFailure };

/** What the quarantine attempt left behind. Both halves are reported to the player. */
type Quarantine = { readonly kept: boolean; readonly quarantined: boolean };

/** Storage would not answer, so there is nothing to promise the player. */
const NO_QUARANTINE: Quarantine = { kept: false, quarantined: false };

/**
 * Copy a value we could not read out of the way, so the autosave that follows cannot
 * destroy it. An existing quarantine is never overwritten — but it still counts as
 * something to offer back, which is why `quarantined` is true where `kept` is false.
 */
function quarantine(raw: string, driver: StorageDriver | null): Quarantine {
  const existing = readText(REJECTED_CHARACTER_KEY, driver);
  if (!existing.ok) return NO_QUARANTINE;
  if (existing.value !== null) return { kept: false, quarantined: true };

  const written = writeText(REJECTED_CHARACTER_KEY, raw, driver);
  return { kept: written.ok, quarantined: written.ok };
}

export type RejectedCharacterRead =
  /** The raw string, byte for byte as it was found. Never parsed, never repaired. */
  | { readonly ok: true; readonly text: string }
  /** Nothing is parked. A player who has already recovered it, or never had one. */
  | { readonly ok: false; readonly reason: 'empty' }
  | { readonly ok: false; readonly reason: 'unavailable'; readonly failure: StorageFailure };

/**
 * The quarantined value, for handing back to the player and for nothing else.
 *
 * Read-only by construction: there is no driver write anywhere on this path, so no
 * amount of clicking the offer can overwrite or clear what is parked (issue #89). The
 * text is returned exactly as stored — not re-serialised, not migrated, not validated —
 * because the whole point of the copy is that this build could not read it, and a build
 * that could not read it has no business rewriting it.
 */
export function readRejectedCharacter(driver = defaultStorageDriver()): RejectedCharacterRead {
  const read = readText(REJECTED_CHARACTER_KEY, driver);
  if (!read.ok) return { ok: false, reason: 'unavailable', failure: read.failure };
  if (read.value === null) return { ok: false, reason: 'empty' };

  return { ok: true, text: read.value };
}

/**
 * Read the stored sheet. Never throws, and never returns a partially repaired
 * character — a rejected one is reported with the paths that failed, ready to paste
 * (DATA-MODEL.md §10).
 */
export function loadCharacter(driver = defaultStorageDriver()): CharacterLoad {
  const read = readText(CHARACTER_KEY, driver);
  if (!read.ok) return { kind: 'unavailable', failure: read.failure };
  if (read.value === null) return { kind: 'empty' };

  const raw = read.value;
  const reject = (problems: readonly CharacterProblem[]): CharacterLoad => ({
    kind: 'rejected',
    problems,
    ...quarantine(raw, driver),
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
