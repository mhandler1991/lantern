/**
 * Which packs are loaded, in what order, and what that resolves to.
 *
 * `model/pack-resolver.ts` answers "what does the table have, given these packs in this
 * order". This hook owns the list that question is asked of: the core pack fetched on
 * mount, whatever a DM picked afterwards, each one on or off and movable up and down.
 * Reordering is nothing more than calling `resolvePacks` again with the list rearranged
 * (DATA-MODEL.md §8), so the whole of load order lives in one array here.
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
 * **Nothing is persisted.** DESIGN.md §7 — packs are room-scoped by default, with an
 * explicit opt-in to keep one, and that opt-in is not built yet. So a loaded pack lasts
 * as long as the tab, and the content screen says so out loud rather than letting a DM
 * discover it after a reload.
 */

import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { MAX_PACKS_LOADED } from '../constants';
import type { Pack, PackId, PackProblem } from '../model/pack';
import type { ResolvedStack } from '../model/pack-resolver';
import { resolvePacks } from '../model/pack-resolver';
import type { CorePackResult } from './core-pack';
import { loadCorePack } from './core-pack';
import type { PickedPackFile } from './pack-file';
import { readPackFile } from './pack-file';

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

export type PacksState = {
  readonly loaded: readonly LoadedPack[];
  readonly core: CoreState;
  readonly pick: PackPick;
};

export type PacksAction =
  | { readonly type: 'core-loaded'; readonly pack: Pack }
  | { readonly type: 'core-failed'; readonly problems: readonly PackProblem[] }
  | { readonly type: 'reading'; readonly name: string }
  | { readonly type: 'read-failed'; readonly name: string; readonly problems: readonly PackProblem[] }
  | { readonly type: 'read-loaded'; readonly name: string; readonly pack: Pack }
  | { readonly type: 'toggle'; readonly id: PackId }
  | { readonly type: 'move'; readonly id: PackId; readonly by: number }
  | { readonly type: 'remove'; readonly id: PackId };

export const INITIAL_PACKS: PacksState = {
  loaded: [],
  core: { kind: 'loading' },
  pick: { kind: 'idle' },
};

/**
 * Put a pack in the list: over the one with its id if there is one, otherwise at the end
 * — or at the front, which is core's case and only core's.
 *
 * A replacement keeps the existing entry's `isEnabled`. Turning a pack off is a decision
 * about the pack, not about the version, and a DM who loads a fix for a supplement they
 * had turned off has not asked for it back on.
 */
function place(
  list: readonly LoadedPack[],
  entry: LoadedPack,
  at: 'front' | 'end',
): readonly LoadedPack[] {
  const index = list.findIndex((held) => held.pack.id === entry.pack.id);

  if (index !== MISSING) {
    return list.map((held, position) =>
      position === index ? { ...entry, isEnabled: held.isEnabled } : held,
    );
  }

  return at === 'front' ? [entry, ...list] : [...list, entry];
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
        loaded: place(state.loaded, { pack: action.pack, source: { kind: 'core' }, isEnabled: true }, 'front'),
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
          { pack: action.pack, source: { kind: 'file', name: action.name }, isEnabled: true },
          'end',
        ),
        core: state.core,
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
  readonly addFile: (file: PickedPackFile) => Promise<void>;
  readonly toggle: (id: PackId) => void;
  readonly moveUp: (id: PackId) => void;
  readonly moveDown: (id: PackId) => void;
  readonly remove: (id: PackId) => void;
};

export function usePacks(load: CorePackLoader = fetchCorePack): Packs {
  const [state, dispatch] = useReducer(packsReducer, INITIAL_PACKS);

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
    addFile,
    toggle,
    moveUp,
    moveDown,
    remove,
  };
}
