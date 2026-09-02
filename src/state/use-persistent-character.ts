/**
 * The sheet, wired to localStorage. One hook, and the only stateful thing in the app
 * that touches storage.
 *
 * Boot happens in the `useState` initialiser, not in an effect. CLAUDE.md §6 — deriving
 * state in an effect is a bug, and here it is a visible one: the first paint would show
 * a blank sheet and then replace it with the saved one, which reads as data loss for a
 * frame. The write is an effect, because a write *is* synchronisation with the outside
 * world.
 *
 * Writes are debounced, because a sheet is edited keystroke by keystroke. A debounce
 * that can be closed over loses the last keystroke, so the pending value is flushed on
 * `pagehide`, on the tab being hidden, and on unmount.
 */

import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PERSIST_DEBOUNCE_MS } from '../constants';
import type { Character } from '../model/character';
import type { CharacterLoad, CharacterSave } from './character-storage';
import { loadCharacter, saveCharacter } from './character-storage';
import { newCharacter } from './new-character';

export type PersistentCharacter = {
  readonly character: Character;
  readonly setCharacter: Dispatch<SetStateAction<Character>>;
  /** What boot found. `rejected` and `unavailable` are worth showing; nothing is fatal. */
  readonly load: CharacterLoad;
  /** The result of the most recent write, or null before one has happened. */
  readonly lastSave: CharacterSave | null;
  /** Write any pending edit now. Called for you on unmount and when the tab goes away. */
  readonly flush: () => void;
};

export function usePersistentCharacter(): PersistentCharacter {
  const [load] = useState<CharacterLoad>(() => loadCharacter());
  const [character, setCharacter] = useState<Character>(() =>
    load.kind === 'loaded' ? load.character : newCharacter(),
  );
  const [lastSave, setLastSave] = useState<CharacterSave | null>(null);

  /** The value the sheet booted with. Re-writing it would be a write nobody asked for. */
  const bootedWith = useRef(character);

  /** An edit that has not reached storage yet. Null means storage is up to date. */
  const pending = useRef<Character | null>(null);

  const isMounted = useRef(true);

  const flush = useCallback(() => {
    const unsaved = pending.current;
    if (unsaved === null) return;

    pending.current = null;
    const result = saveCharacter(unsaved);
    if (isMounted.current) setLastSave(result);
  }, []);

  useEffect(() => {
    if (character === bootedWith.current) return;

    pending.current = character;
    const timer = setTimeout(flush, PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [character, flush]);

  useEffect(() => {
    isMounted.current = true;

    const onHidden = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };

    // `pagehide` is the one that fires on iOS Safari, where `beforeunload` does not.
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);

    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
      // Cleared first, so the flush below writes storage without reaching for state on
      // a component that is on its way out.
      isMounted.current = false;
      flush();
    };
  }, [flush]);

  return { character, setCharacter, load, lastSave, flush };
}
