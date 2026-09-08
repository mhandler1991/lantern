/**
 * Where the walkthrough had got to, so closing the tab mid-creation costs nothing.
 * DATA-MODEL.md §13.
 *
 * This is the one stored value in the app that is **not** player data. The character
 * being built is the sheet, saved by `character-storage.ts` on every edit like any
 * other; what lives here is a bookmark into it — a character id and the step that was
 * on screen. That difference decides the whole module: a value that cannot be read is
 * dropped rather than quarantined, because losing a bookmark costs a player one press
 * of the Back button and parking it would offer them a file that says nothing about
 * their character.
 *
 * Two rules it does keep from the stores that hold real data:
 *
 *   - **Nothing throws.** Every failure is a result, and a browser that refuses storage
 *     leaves creation working and merely un-resumable (PRD.md principle 4).
 *   - **Stored is not trusted.** A value under our key is a value any other tab on this
 *     origin could have written, so it is bounded before it is decoded and parsed by a
 *     schema like anything else that arrives from outside (CLAUDE.md §2.7).
 *
 * The vocabulary of steps is not known here, deliberately. The sequence is a UI
 * decision (`ui/creation/creation.ts`) and `state/` does not import from `ui/`, so the
 * caller passes the guard that says which ids exist. That also means the resume path is
 * tested against step ids invented for the test, rather than against whatever the real
 * sequence happens to hold this month.
 */

import { z } from 'zod';
import {
  CHARACTER_ID_PATTERN,
  CREATION_FORMAT,
  CREATION_FORMAT_VERSION,
  MAX_CHARACTER_ID_LENGTH,
  MAX_CREATION_BYTES,
  STORAGE_PREFIX,
} from '../constants';
import type { StorageFailure } from './storage';
import { defaultStorageDriver, readText, removeKey, writeText } from './storage';

/** The bookmark. One key: there is one sheet, so there is one walkthrough. */
export const CREATION_KEY = `${STORAGE_PREFIX}creation`;

/**
 * A step id is checked against the caller's list rather than a pattern, so the bound
 * here only has to stop an absurd string reaching that check. It is the character id's
 * cap because the two are stored side by side and neither is prose.
 */
const MAX_STEP_ID_LENGTH = MAX_CHARACTER_ID_LENGTH;

/**
 * The stored document. Strict, so a key this build does not know is a value this build
 * did not write — and a bookmark is not worth guessing at.
 */
const StoredCreation = z.strictObject({
  format: z.literal(CREATION_FORMAT),
  formatVersion: z.literal(CREATION_FORMAT_VERSION),
  characterId: z.string().max(MAX_CHARACTER_ID_LENGTH).regex(CHARACTER_ID_PATTERN),
  step: z.string().max(MAX_STEP_ID_LENGTH),
});

/**
 * Which character the walkthrough was building, and where it had got to.
 *
 * The character id is half the record for a reason: a sheet replaced by an import is a
 * different character, and resuming someone else's third step on it would be the app
 * acting on a bookmark that no longer points anywhere.
 */
export type CreationProgress = {
  readonly characterId: string;
  readonly step: string;
};

/** Whether a step id read back is one this build still has. */
export type KnownStep = (step: string) => boolean;

export type CreationLoad = {
  /** Null when there is nothing stored, or nothing readable. Never an error to show. */
  readonly progress: CreationProgress | null;
  /** The browser would not let us look. Creation works; it just will not resume. */
  readonly failure: StorageFailure | null;
};

const NOTHING: CreationLoad = { progress: null, failure: null };

/**
 * The stored position, or nothing. A value that does not parse — or that names a step
 * this build no longer has — reads as nothing at all: the walkthrough starts from the
 * top, which is the same place a player who never started one begins.
 */
export function loadCreation(
  isKnownStep: KnownStep,
  driver = defaultStorageDriver(),
): CreationLoad {
  const read = readText(CREATION_KEY, driver);
  if (!read.ok) return { progress: null, failure: read.failure };
  if (read.value === null) return NOTHING;
  if (read.value.length > MAX_CREATION_BYTES) return NOTHING;

  let decoded: unknown;
  try {
    decoded = JSON.parse(read.value);
  } catch {
    return NOTHING;
  }

  const parsed = StoredCreation.safeParse(decoded);
  if (!parsed.success) return NOTHING;
  if (!isKnownStep(parsed.data.step)) return NOTHING;

  return {
    progress: { characterId: parsed.data.characterId, step: parsed.data.step },
    failure: null,
  };
}

export type CreationSave = { readonly ok: true } | { readonly ok: false; readonly failure: StorageFailure };

/** Validated on the way out as well as in (CLAUDE.md §2.7), even for a bookmark. */
export function saveCreation(
  progress: CreationProgress,
  driver = defaultStorageDriver(),
): CreationSave {
  const document = {
    format: CREATION_FORMAT,
    formatVersion: CREATION_FORMAT_VERSION,
    characterId: progress.characterId,
    step: progress.step,
  };

  const validated = StoredCreation.safeParse(document);
  if (!validated.success) {
    return { ok: false, failure: { kind: 'failed', detail: 'the walkthrough position did not validate' } };
  }

  const written = writeText(CREATION_KEY, JSON.stringify(validated.data), driver);
  return written.ok ? { ok: true } : { ok: false, failure: written.failure };
}

/** Leaving the walkthrough, or finishing it. The character it built is untouched. */
export function clearCreation(driver = defaultStorageDriver()): void {
  removeKey(CREATION_KEY, driver);
}
