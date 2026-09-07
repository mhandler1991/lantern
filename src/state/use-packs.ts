/**
 * Which packs are loaded, in what order, and what that resolves to.
 *
 * `model/pack-resolver.ts` answers "what does the table have, given these packs in this
 * order". This hook owns the list that question is asked of: the core pack fetched on
 * mount, whatever a DM picked afterwards, each one on or off and movable up and down.
 * Reordering is nothing more than calling `resolvePacks` again with the list rearranged
 * (DATA-MODEL.md §9), so the whole of load order lives in one array here.
 *
 * Four decisions carry the module.
 *
 * **Core goes in front, always.** Not because core is privileged — it is a pack like any
 * other and `state/core-pack.ts` says so — but because everything else is written against
 * it. A homebrew pack overriding `core:spell:fireball` while core sat *after* it in the
 * list would override a target nothing had defined yet, and core would then define
 * fireball back over the top. Inserting core first makes the arriving fetch independent
 * of what the player did while it was in flight.
 *
 * **A pack replaces the pack with its id, in place.** `version` exists to answer "is this
 * the pack I already have" (DATA-MODEL.md §1), so picking Frostbound 1.2.0 over
 * Frostbound 1.1.0 is an update, not a second Frostbound — it keeps its position in the
 * load order and its on/off state, because both were decisions somebody made. This is
 * also what makes React 18's StrictMode double-mount harmless: core arriving twice
 * replaces itself rather than appearing twice.
 *
 * **The state is a reducer, not four `useState`s.** Reading the list, deciding whether a
 * pick replaces something, and reporting what happened have to be one atomic step: a
 * player who picks a second file while the first is still being read would otherwise
 * have one write clobber the other through a stale closure. The reducer is pure and
 * exported, so those transitions are tested without a component at all.
 *
 * **A pack is kept only if it was asked for.** DESIGN.md §7 — packs are room-scoped by
 * default, with an explicit opt-in to keep one. So a loaded pack lasts as long as the
 * tab unless a DM presses Keep, and then `state/pack-storage.ts` holds it with its place
 * in the load order and its on/off state. The restore happens in the reducer's
 * initialiser rather than in an effect: a list that fills in one frame after an empty
 * one reads as data loss, and CLAUDE.md §6 keeps effects for synchronising with the
 * outside world — which the *write* genuinely is.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { MAX_KEPT_PACKS, MAX_PACKS_LOADED } from '../constants';
import type { Pack, PackId, PackProblem } from '../model/pack';
import type { ResolvedStack } from '../model/pack-resolver';
import { resolvePacks } from '../model/pack-resolver';
import type { CorePackResult } from './core-pack';
import { loadCorePack } from './core-pack';
import type { PickedPackFile } from './pack-file';
import { readPackFile } from './pack-file';
import type { KeptPack, KeptPacksLoad, KeptPacksSave } from './pack-storage';
import { fitsKeptPacks, loadKeptPacks, saveKeptPacks } from './pack-storage';
import type { StorageDriver } from './storage';
import { defaultStorageDriver } from './storage';

/** An empty list, and the first position in one. Neither is a rule of the game. */
const NONE = 0;

/** How far one press of a move button carries a pack. A direction, not a limit. */
const ONE_PLACE = 1;

/** Not found, as `findIndex` reports it. */
const MISSING = -1;

/** Where a pack came from, which is what the content screen labels it with. */
export type PackSource =
  /** Shipped with Lantern and fetched on boot. There is no file to pick again. */
  | { readonly kind: 'core' }
  /** Picked off a disk. The name is the file's, not the pack's. */
  | { readonly kind: 'file'; readonly name: string };

/** One pack in the load order. */
export type LoadedPack = {
  readonly pack: Pack;
  readonly source: PackSource;
  /** A pack turned off keeps its place in the order, so turning it back on is one press. */
  readonly isEnabled: boolean;
  /**
   * Stored, so it comes back on the next visit. Off by default and never true of core,
   * which is fetched on boot and has no file to remember (DESIGN.md §7).
   */
  readonly isKept: boolean;
};

/** How the pack the app ships with is getting on. */
export type CoreState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  /** Warned and never blocking: the sheet works with no packs at all (PRD.md principle 6). */
  | { readonly kind: 'failed'; readonly problems: readonly PackProblem[] };

/** What the last picked file did. Cleared by the next pick, never on a timer. */
export type PackPick =
  | { readonly kind: 'idle' }
  | { readonly kind: 'reading'; readonly name: string }
  | {
      readonly kind: 'loaded';
      readonly name: string;
      readonly packName: string;
      readonly version: string;
      /** The version this one replaced, when it replaced one. */
      readonly replaced: string | null;
    }
  | {
      readonly kind: 'failed';
      /** The file, so the report says which one the paths below belong to. */
      readonly name: string;
      readonly problems: readonly PackProblem[];
    }
  /** At `MAX_PACKS_LOADED`. Nothing was replaced and nothing was dropped. */
  | { readonly kind: 'full'; readonly name: string };

/**
 * What the last press of Keep did. A refusal is the bound being reached, and it names
 * which one: the pack is still loaded either way (PRD.md principle 4).
 */
export type KeepReport =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'refused';
      readonly name: string;
      readonly reason: 'count' | 'size';
    };

export type PacksState = {
  readonly loaded: readonly LoadedPack[];
  readonly core: CoreState;
  readonly pick: PackPick;
  /** What boot found in storage. Shown when it found something it could not read. */
  readonly restore: KeptPacksLoad;
  /** The result of the last write, or null before one has happened. */
  readonly store: KeptPacksSave | null;
  readonly keep: KeepReport;
};

export type PacksAction =
  | { readonly type: 'core-loaded'; readonly pack: Pack }
  | { readonly type: 'core-failed'; readonly problems: readonly PackProblem[] }
  | { readonly type: 'reading'; readonly name: string }
  | { readonly type: 'read-failed'; readonly name: string; readonly problems: readonly PackProblem[] }
  | { readonly type: 'read-loaded'; readonly name: string; readonly pack: Pack }
  | { readonly type: 'toggle'; readonly id: PackId }
  | { readonly type: 'move'; readonly id: PackId; readonly by: number }
  | { readonly type: 'remove'; readonly id: PackId }
  | { readonly type: 'keep'; readonly id: PackId }
  | { readonly type: 'stored'; readonly result: KeptPacksSave };

/** Nothing loaded and nothing stored — a first visit, and what a test starts from. */
export const INITIAL_PACKS: PacksState = {
  loaded: [],
  core: { kind: 'loading' },
  pick: { kind: 'idle' },
  restore: { entries: [], problems: [], kept: false, quarantined: false, failure: null },
  store: null,
  keep: { kind: 'idle' },
};

/**
 * Boot, storage included. A kept pack comes back in the position it was stored in and
 * with the on/off state it had, because both were decisions somebody made — and core is
 * placed in front of all of them when its fetch lands (`place`, below).
 */
export function initialPacks(driver: StorageDriver | null): PacksState {
  const restore = loadKeptPacks(driver);

  return {
    ...INITIAL_PACKS,
    loaded: restore.entries.map((entry) => ({
      pack: entry.pack,
      source: { kind: 'file', name: entry.name },
      isEnabled: entry.isEnabled,
      isKept: true,
    })),
    restore,
  };
}

/** The kept packs of a load order, in order, as they are stored. */
export function keptPacks(loaded: readonly LoadedPack[]): readonly KeptPack[] {
  return loaded
    .filter((held) => held.isKept)
    .map((held) => ({
      name: held.source.kind === 'file' ? held.source.name : '',
      isEnabled: held.isEnabled,
      pack: held.pack,
    }));
}

/**
 * Put a pack in the list: over the one with its id if there is one, otherwise at the end
 * — or at the front, which is core's case and only core's.
 *
 * A replacement keeps the existing entry's `isEnabled` **and its `isKept`**. Both are
 * decisions about the pack rather than about the version: a DM who loads a fix for a
 * supplement they had turned off has not asked for it back on, and one who had asked for
 * it to be kept has not asked for that to be forgotten.
 */
function place(
  list: readonly LoadedPack[],
  entry: LoadedPack,
  at: 'front' | 'end',
): readonly LoadedPack[] {
  const index = list.findIndex((held) => held.pack.id === entry.pack.id);

  if (index !== MISSING) {
    return list.map((held, position) =>
      position === index ? { ...entry, isEnabled: held.isEnabled, isKept: held.isKept } : held,
    );
  }

  return at === 'front' ? [entry, ...list] : [...list, entry];
}

/** Mark one pack kept or not. Its place in the order and its on/off state are untouched. */
function setKept(list: readonly LoadedPack[], id: PackId, isKept: boolean): readonly LoadedPack[] {
  return list.map((held) => (held.pack.id === id ? { ...held, isKept } : held));
}

/** Swap a pack with its neighbour. At either end there is no neighbour and nothing moves. */
function move(list: readonly LoadedPack[], id: PackId, by: number): readonly LoadedPack[] {
  const from = list.findIndex((held) => held.pack.id === id);
  const to = from + by;

  if (from === MISSING || to < NONE || to >= list.length) return list;

  const moved = [...list];
  const [lifted] = moved.splice(from, ONE_PLACE);
  if (lifted !== undefined) moved.splice(to, NONE, lifted);

  return moved;
}

/**
 * Every transition, pure. 🚫 Nothing here throws and nothing refuses a pack that parsed:
 * a list at its cap reports that it is full and keeps what it has (PRD.md principle 4).
 */
export function packsReducer(state: PacksState, action: PacksAction): PacksState {
  switch (action.type) {
    case 'core-loaded':
      return {
        ...state,
        core: { kind: 'ready' },
        loaded: place(
          state.loaded,
          { pack: action.pack, source: { kind: 'core' }, isEnabled: true, isKept: false },
          'front',
        ),
      };

    case 'core-failed':
      return { ...state, core: { kind: 'failed', problems: action.problems } };

    case 'reading':
      return { ...state, pick: { kind: 'reading', name: action.name } };

    case 'read-failed':
      return { ...state, pick: { kind: 'failed', name: action.name, problems: action.problems } };

    case 'read-loaded': {
      const existing = state.loaded.find((held) => held.pack.id === action.pack.id) ?? null;

      if (existing === null && state.loaded.length >= MAX_PACKS_LOADED) {
        return { ...state, pick: { kind: 'full', name: action.name } };
      }

      return {
        loaded: place(
          state.loaded,
          { pack: action.pack, source: { kind: 'file', name: action.name }, isEnabled: true, isKept: false },
          'end',
        ),
        core: state.core,
        restore: state.restore,
        store: state.store,
        keep: state.keep,
        pick: {
          kind: 'loaded',
          name: action.name,
          packName: action.pack.name,
          version: action.pack.version,
          replaced: existing?.pack.version ?? null,
        },
      };
    }

    case 'toggle':
      return {
        ...state,
        loaded: state.loaded.map((held) =>
          held.pack.id === action.id ? { ...held, isEnabled: !held.isEnabled } : held,
        ),
      };

    case 'move':
      return { ...state, loaded: move(state.loaded, action.id, action.by) };

    case 'remove':
      return { ...state, loaded: state.loaded.filter((held) => held.pack.id !== action.id) };

    case 'keep': {
      const held = state.loaded.find((entry) => entry.pack.id === action.id) ?? null;

      // Core is fetched on boot and there is no file to remember, so it is not offered
      // the opt-in and cannot be given it by an action either.
      if (held === null || held.source.kind === 'core') return state;

      if (held.isKept) return { ...state, loaded: setKept(state.loaded, action.id, false), keep: { kind: 'idle' } };

      // Both bounds are checked here rather than at the write, so a refusal is a
      // sentence a DM can act on instead of a store that quietly stopped growing.
      const wanted = keptPacks(setKept(state.loaded, action.id, true));
      if (wanted.length > MAX_KEPT_PACKS) {
        return { ...state, keep: { kind: 'refused', name: held.pack.name, reason: 'count' } };
      }
      if (!fitsKeptPacks(wanted)) {
        return { ...state, keep: { kind: 'refused', name: held.pack.name, reason: 'size' } };
      }

      return { ...state, loaded: setKept(state.loaded, action.id, true), keep: { kind: 'idle' } };
    }

    case 'stored':
      return { ...state, store: action.result };
  }
}

/** How the core pack arrives. Injected so a test never touches the network. */
export type CorePackLoader = () => Promise<CorePackResult>;

/** Module-level, so the mount effect's dependency is stable across renders. */
const fetchCorePack: CorePackLoader = () => loadCorePack();

export type Packs = {
  readonly loaded: readonly LoadedPack[];
  /** Every enabled pack, resolved. Recomputed when the list changes and not before. */
  readonly stack: ResolvedStack;
  readonly core: CoreState;
  readonly pick: PackPick;
  readonly restore: KeptPacksLoad;
  readonly store: KeptPacksSave | null;
  readonly keep: KeepReport;
  readonly addFile: (file: PickedPackFile) => Promise<void>;
  readonly toggle: (id: PackId) => void;
  readonly moveUp: (id: PackId) => void;
  readonly moveDown: (id: PackId) => void;
  readonly remove: (id: PackId) => void;
  /** The opt-in, both ways. Off by default and never offered for core. */
  readonly toggleKept: (id: PackId) => void;
};

export function usePacks(
  load: CorePackLoader = fetchCorePack,
  driver: StorageDriver | null = defaultStorageDriver(),
): Packs {
  const [state, dispatch] = useReducer(packsReducer, driver, initialPacks);

  // An effect, because fetching the core pack is synchronising with the outside world —
  // which is the one job CLAUDE.md §6 says an effect is for. The cancel flag is not
  // about a warning React 18 no longer prints; it is so a fetch that resolves after the
  // tab moved on cannot write to a reducer nobody is reading.
  useEffect(() => {
    let isCancelled = false;

    void (async () => {
      const result = await load();
      if (isCancelled) return;

      dispatch(
        result.ok
          ? { type: 'core-loaded', pack: result.pack }
          : { type: 'core-failed', problems: result.problems },
      );
    })();

    return () => {
      isCancelled = true;
    };
  }, [load]);

  const addFile = useCallback(async (file: PickedPackFile): Promise<void> => {
    dispatch({ type: 'reading', name: file.name });

    const read = await readPackFile(file);
    dispatch(
      read.ok
        ? { type: 'read-loaded', name: file.name, pack: read.pack }
        : { type: 'read-failed', name: file.name, problems: read.problems },
    );
  }, []);

  const toggle = useCallback((id: PackId) => dispatch({ type: 'toggle', id }), []);
  const moveUp = useCallback((id: PackId) => dispatch({ type: 'move', id, by: -ONE_PLACE }), []);
  const moveDown = useCallback((id: PackId) => dispatch({ type: 'move', id, by: ONE_PLACE }), []);
  const remove = useCallback((id: PackId) => dispatch({ type: 'remove', id }), []);
  const toggleKept = useCallback((id: PackId) => dispatch({ type: 'keep', id }), []);

  /** What ought to be in storage right now. Rebuilt only when the load order changes. */
  const kept = useMemo(() => keptPacks(state.loaded), [state.loaded]);

  /**
   * Whether storage is this app's business at all yet. A browser where nothing has ever
   * been kept is never written to and never asked to clear a key it does not have, so a
   * DM who never pressed Keep is not told about a private-mode failure that has no
   * bearing on anything they did.
   */
  const isStoring = useRef(kept.length > NONE);

  // An effect, because a write *is* synchronisation with the outside world (CLAUDE.md
  // §6). Dispatching the result cannot loop: `store` is not what `kept` is derived from.
  useEffect(() => {
    if (kept.length === NONE && !isStoring.current) return;

    isStoring.current = kept.length > NONE;
    dispatch({ type: 'stored', result: saveKeptPacks(kept, driver) });
  }, [kept, driver]);

  /**
   * Derived on read and memoised, never stored (CLAUDE.md §4). A pack that is turned off
   * is not in the stack at all — that is what turning it off means — and it keeps its
   * place in `loaded` so turning it back on restores the order it had.
   */
  const stack = useMemo(
    () => resolvePacks(state.loaded.filter((held) => held.isEnabled).map((held) => held.pack)),
    [state.loaded],
  );

  return {
    loaded: state.loaded,
    stack,
    core: state.core,
    pick: state.pick,
    restore: state.restore,
    store: state.store,
    keep: state.keep,
    addFile,
    toggle,
    moveUp,
    moveDown,
    remove,
    toggleKept,
  };
}
