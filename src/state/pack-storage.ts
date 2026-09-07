/**
 * The packs a DM chose to keep, and how they come back. DATA-MODEL.md §9, §13.
 *
 * DESIGN.md §7 sets the position this file implements: packs are **room-scoped by
 * default, with an explicit opt-in to keep one**. So nothing arrives here unless it was
 * asked for, and what is stored is not merely the pack — it is the two decisions
 * somebody made about it, its place in the load order and whether it was on.
 *
 * It is `character-storage.ts` with a list in front of it, and it holds the same two
 * rules, which are PRD.md principle 4 restated:
 *
 *   - **Never refuse to load.** Every failure is a result with paths, never a throw. A
 *     stored pack that no longer parses costs its own restore and nothing else — the
 *     others come back and the app runs with no packs at all if it has to.
 *   - **Never destroy player data.** A stored value this build could not read is copied
 *     aside under `lantern:packs.rejected` *before* the next write is allowed over the
 *     live key, and an existing copy is never replaced by a later one.
 *
 * **Stored is not trusted.** A value under our key is a value some other tab on this
 * origin could have written, so it is bounded before it is decoded and every pack in it
 * goes through `parsePack` exactly as a picked file does (CLAUDE.md §2.7). The write is
 * validated too: a pack that would not load back is reported rather than stored.
 *
 * localStorage rather than IndexedDB, which is a real choice and not an omission. The
 * asynchrony IndexedDB buys is asynchrony this does not want — the restore happens in a
 * reducer initialiser so the first paint already has the packs (`use-packs.ts`) — and
 * the quota problem it would solve is solved instead by bounding the opt-in, which a DM
 * can see and an unbounded store cannot.
 */

import {
  KEPT_PACKS_FORMAT,
  KEPT_PACKS_FORMAT_VERSION,
  MAX_KEPT_PACKS,
  MAX_KEPT_PACKS_BYTES,
  MAX_PACK_SOURCE_NAME_LENGTH,
  STORAGE_PREFIX,
} from '../constants';
import type { Pack, PackProblem } from '../model/pack';
import { parsePack } from '../model/pack';
import type { StorageDriver, StorageFailure } from './storage';
import { defaultStorageDriver, describeError, readText, removeKey, writeText } from './storage';

/** The kept packs, in load order. One key: the list is one decision, saved together. */
export const KEPT_PACKS_KEY = `${STORAGE_PREFIX}packs`;

/**
 * Where a stored value we could not read goes before the next write is allowed over it.
 * Nothing parses it, migrates it or writes over it; `readRejectedPacks` hands the raw
 * string to the content screen, which offers it back as a file. Exactly the treatment
 * `REJECTED_CHARACTER_KEY` gives a character (DATA-MODEL.md §13).
 */
export const REJECTED_PACKS_KEY = `${STORAGE_PREFIX}packs.rejected`;

/** Nothing carried, and the first position in a list. Neither is a rule of the game. */
const NONE = 0;

/** The path a problem takes when the fault is the stored value rather than a pack in it. */
const WHOLE_STORE = '(root)';

/** One kept pack: the pack, the file it was picked from, and whether it was on. */
export type KeptPack = {
  /** The file's name, not the pack's — it is provenance in the load order. */
  readonly name: string;
  readonly isEnabled: boolean;
  readonly pack: Pack;
};

/**
 * The stored value, as text. Exported because the bound is checked before a pack is
 * ever marked kept, not only at the write: refusing the opt-in with a reason is a
 * decision a DM can act on, while a write that silently failed later is not.
 */
export function keptPacksText(entries: readonly KeptPack[]): string {
  return JSON.stringify({
    format: KEPT_PACKS_FORMAT,
    formatVersion: KEPT_PACKS_FORMAT_VERSION,
    packs: entries.map((entry) => ({
      name: entry.name.slice(NONE, MAX_PACK_SOURCE_NAME_LENGTH),
      isEnabled: entry.isEnabled,
      pack: entry.pack,
    })),
  });
}

/** Whether this many packs, at this size, are inside both bounds. */
export function fitsKeptPacks(entries: readonly KeptPack[]): boolean {
  return entries.length <= MAX_KEPT_PACKS && keptPacksText(entries).length <= MAX_KEPT_PACKS_BYTES;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * What boot found. Flat rather than a union because the interesting cases overlap: two
 * of three packs restoring while the third is set aside is one outcome, not two.
 *
 * `kept` and `quarantined` are different facts, exactly as they are for a character.
 * `kept` is true when *this* value is the one now parked; `quarantined` is true whenever
 * there is something under the rejected key to offer back, including when an earlier
 * broken value was already there and this one was not allowed over it. Both are false
 * only when storage refused the copy, and then there is nothing to offer.
 */
export type KeptPacksLoad = {
  readonly entries: readonly KeptPack[];
  /** Why anything did not come back. Empty when everything stored was read. */
  readonly problems: readonly PackProblem[];
  readonly kept: boolean;
  readonly quarantined: boolean;
  /** The browser would not let us look. Nothing is wrong with what is stored. */
  readonly failure: StorageFailure | null;
};

const NOTHING_STORED: KeptPacksLoad = {
  entries: [],
  problems: [],
  kept: false,
  quarantined: false,
  failure: null,
};

/** What the quarantine attempt left behind. Both halves are reported to the player. */
type Quarantine = { readonly kept: boolean; readonly quarantined: boolean };

const NO_QUARANTINE: Quarantine = { kept: false, quarantined: false };

/**
 * Copy a value we could not read out of the way, so the next write cannot destroy it.
 * An existing quarantine is never overwritten — the first thing to break is the likelier
 * to be real player data — but it still counts as something to offer back.
 */
function quarantine(raw: string, driver: StorageDriver | null): Quarantine {
  const existing = readText(REJECTED_PACKS_KEY, driver);
  if (!existing.ok) return NO_QUARANTINE;
  if (existing.value !== null) return { kept: false, quarantined: true };

  const written = writeText(REJECTED_PACKS_KEY, raw, driver);
  return { kept: written.ok, quarantined: written.ok };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A pack's own problem, re-pathed to where it sat in the store — `packs[1].spells[0].tier`
 * — so a report names the entry as well as the field (DATA-MODEL.md §10).
 */
function inEntry(index: number, problem: PackProblem): PackProblem {
  const at = `packs[${index}]`;
  return {
    path: problem.path === WHOLE_STORE ? at : `${at}.${problem.path}`,
    message: problem.message,
  };
}

/**
 * Read the kept packs. Never throws, never returns a pack that did not parse, and never
 * drops one in silence: what could not be read comes back as problems with paths, and
 * the raw value it came from is parked under the rejected key first.
 */
export function loadKeptPacks(driver = defaultStorageDriver()): KeptPacksLoad {
  const read = readText(KEPT_PACKS_KEY, driver);
  if (!read.ok) return { ...NOTHING_STORED, failure: read.failure };
  if (read.value === null) return NOTHING_STORED;

  const raw = read.value;
  const reject = (
    problems: readonly PackProblem[],
    entries: readonly KeptPack[] = [],
  ): KeptPacksLoad => ({ entries, problems, ...quarantine(raw, driver), failure: null });

  // A UTF-16 length is never larger than the byte count it encodes to, so this is the
  // conservative half of the same bound the opt-in is refused above. It stops another
  // tab on this origin parking megabytes under our key and having us parse them.
  if (raw.length > MAX_KEPT_PACKS_BYTES) {
    return reject([
      {
        path: WHOLE_STORE,
        message: `expected at most ${MAX_KEPT_PACKS_BYTES} characters, found ${raw.length}`,
      },
    ]);
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (error: unknown) {
    return reject([{ path: WHOLE_STORE, message: `expected JSON — ${describeError(error)}` }]);
  }

  if (!isRecord(decoded)) {
    return reject([{ path: WHOLE_STORE, message: `expected an object, found ${typeof decoded}` }]);
  }

  if (decoded.format !== KEPT_PACKS_FORMAT) {
    return reject([
      {
        path: 'format',
        message: `expected "${KEPT_PACKS_FORMAT}", found ${JSON.stringify(decoded.format)}`,
      },
    ]);
  }

  if (decoded.formatVersion !== KEPT_PACKS_FORMAT_VERSION) {
    return reject([
      {
        path: 'formatVersion',
        message: `expected ${KEPT_PACKS_FORMAT_VERSION}, found ${JSON.stringify(decoded.formatVersion)}`,
      },
    ]);
  }

  if (!Array.isArray(decoded.packs)) {
    return reject([{ path: 'packs', message: `expected an array, found ${typeof decoded.packs}` }]);
  }

  const stored: readonly unknown[] = decoded.packs;
  const problems: PackProblem[] = [];
  const entries: KeptPack[] = [];

  if (stored.length > MAX_KEPT_PACKS) {
    problems.push({
      path: 'packs',
      message: `expected at most ${MAX_KEPT_PACKS} packs, found ${stored.length} — the rest were not restored`,
    });
  }

  stored.slice(NONE, MAX_KEPT_PACKS).forEach((entry: unknown, index: number) => {
    if (!isRecord(entry)) {
      problems.push(inEntry(index, { path: WHOLE_STORE, message: `expected an object, found ${typeof entry}` }));
      return;
    }

    const { name, isEnabled } = entry;

    if (typeof name !== 'string' || name.length > MAX_PACK_SOURCE_NAME_LENGTH) {
      problems.push(
        inEntry(index, {
          path: 'name',
          message: `expected a string of at most ${MAX_PACK_SOURCE_NAME_LENGTH} characters, found ${JSON.stringify(name)}`,
        }),
      );
      return;
    }

    if (typeof isEnabled !== 'boolean') {
      problems.push(
        inEntry(index, {
          path: 'isEnabled',
          message: `expected a boolean, found ${JSON.stringify(isEnabled)}`,
        }),
      );
      return;
    }

    const parsed = parsePack(entry.pack);
    if (!parsed.ok) {
      parsed.problems.forEach((problem) => problems.push(inEntry(index, problem)));
      return;
    }

    entries.push({ name, isEnabled, pack: parsed.pack });
  });

  // The good ones still come back. A store with one bad pack in it is quarantined whole,
  // because the value that gets written next holds only what parsed — and the copy aside
  // is the only place the rest still exists.
  return problems.length === NONE
    ? { entries, problems, kept: false, quarantined: false, failure: null }
    : reject(problems, entries);
}

export type RejectedPacksRead =
  /** The raw string, byte for byte as it was found. Never parsed, never repaired. */
  | { readonly ok: true; readonly text: string }
  /** Nothing is parked. A DM who has already recovered it, or never had one. */
  | { readonly ok: false; readonly reason: 'empty' }
  | { readonly ok: false; readonly reason: 'unavailable'; readonly failure: StorageFailure };

/**
 * The quarantined value, for handing back and for nothing else. Read-only by
 * construction: there is no driver write on this path, so no amount of pressing the
 * offer can clear what is parked. The bytes are returned exactly as stored — this build
 * is the build that could not read them, and it has no business rewriting them.
 */
export function readRejectedPacks(driver = defaultStorageDriver()): RejectedPacksRead {
  const read = readText(REJECTED_PACKS_KEY, driver);
  if (!read.ok) return { ok: false, reason: 'unavailable', failure: read.failure };
  if (read.value === null) return { ok: false, reason: 'empty' };

  return { ok: true, text: read.value };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export type KeptPacksSave =
  | { readonly ok: true; readonly count: number }
  /** Validated on the way out as well as in (CLAUDE.md §2.7) — even our own data. */
  | { readonly ok: false; readonly reason: 'invalid'; readonly problems: readonly PackProblem[] }
  /** Past `MAX_KEPT_PACKS` or `MAX_KEPT_PACKS_BYTES`. Nothing was written. */
  | { readonly ok: false; readonly reason: 'too-large' }
  /** The browser would not take it — private mode, blocked site data, a full origin. */
  | { readonly ok: false; readonly reason: 'storage'; readonly failure: StorageFailure };

/**
 * Store the kept packs, replacing whatever was there. An empty list clears the key
 * rather than writing an empty store: a DM who un-kept their last pack has asked for
 * nothing to be left behind.
 */
export function saveKeptPacks(
  entries: readonly KeptPack[],
  driver = defaultStorageDriver(),
): KeptPacksSave {
  if (entries.length === NONE) {
    const cleared = removeKey(KEPT_PACKS_KEY, driver);
    return cleared.ok ? { ok: true, count: NONE } : { ok: false, reason: 'storage', failure: cleared.failure };
  }

  if (!fitsKeptPacks(entries)) return { ok: false, reason: 'too-large' };

  // Every pack goes back through the schema on the way out, so what is stored is what
  // will load — a pack that would come back rejected is reported now, while the DM is
  // looking at the content screen, rather than on their next visit.
  for (const [index, entry] of entries.entries()) {
    const validated = parsePack(entry.pack);
    if (!validated.ok) {
      return {
        ok: false,
        reason: 'invalid',
        problems: validated.problems.map((problem) => inEntry(index, problem)),
      };
    }
  }

  const written = writeText(KEPT_PACKS_KEY, keptPacksText(entries), driver);
  if (!written.ok) return { ok: false, reason: 'storage', failure: written.failure };

  return { ok: true, count: entries.length };
}
