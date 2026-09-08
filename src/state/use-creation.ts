/**
 * The walkthrough's place in the sequence, and nothing else.
 *
 * The character being built is the sheet — `usePersistentCharacter` owns it, the same
 * autosave writes it, and the same schema validates it on the way out. So there is no
 * draft here to commit at the end and no second copy to keep in step with the first:
 * what this hook holds is a bookmark, and a step that was filled in is already saved
 * whether the walkthrough is on screen or not.
 *
 * Boot happens in the `useState` initialiser rather than an effect, like every other
 * restore in the app: a walkthrough that appeared one frame after the sheet would read
 * as the app changing its mind (CLAUDE.md §6). The write *is* synchronisation with the
 * outside world, so that stays an effect.
 *
 * A bookmark that names a different character is ignored rather than deleted. Importing
 * a file replaces the sheet with a different `id`, and the position on screen has to
 * stop applying the moment it does — but that is a fact derived on read here, not state
 * corrected in an effect, and nothing overwrites the stored record on the way past.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreationProgress } from './creation-storage';
import { clearCreation, loadCreation, saveCreation } from './creation-storage';
import type { StorageFailure } from './storage';

/** Which character is being walked through, and where. Never a step this build lost. */
type Session<Id extends string> = {
  readonly characterId: string;
  readonly step: Id;
};

export type CreationSession<Id extends string> = {
  /** The step on screen, or null when the walkthrough is not running. */
  readonly step: Id | null;
  /** Begin at the first step, for the character on screen right now. */
  readonly start: () => void;
  readonly go: (step: Id) => void;
  /** Stop. The sheet keeps everything that was entered; only the position is dropped. */
  readonly leave: () => void;
  /** Storage would not answer, so this walkthrough will not survive the tab closing. */
  readonly failure: StorageFailure | null;
};

/** The stored id as one of ours, or null. A `find` rather than a cast: no `any` in sight. */
function knownStep<Id extends string>(steps: readonly Id[], step: string): Id | null {
  return steps.find((candidate) => candidate === step) ?? null;
}

function resume<Id extends string>(
  steps: readonly Id[],
): { readonly session: Session<Id> | null; readonly failure: StorageFailure | null } {
  const load = loadCreation((step) => knownStep(steps, step) !== null);
  if (load.progress === null) return { session: null, failure: load.failure };

  const step = knownStep(steps, load.progress.step);
  if (step === null) return { session: null, failure: load.failure };

  return { session: { characterId: load.progress.characterId, step }, failure: load.failure };
}

/**
 * `steps` is the sequence in order; the first is where `start` begins. It is expected to
 * be a module constant — a fresh array every render would re-run nothing here, but it is
 * the identity the effects below are compared against.
 */
export function useCreation<Id extends string>(
  characterId: string,
  steps: readonly Id[],
): CreationSession<Id> {
  const [booted] = useState(() => resume(steps));
  const [session, setSession] = useState<Session<Id> | null>(booted.session);

  /**
   * Whether the effect below has run yet. It guards exactly one thing: the first pass,
   * where the value in state is the value boot read out of storage and writing it back
   * would be a write nobody asked for. Comparing against the booted value instead would
   * be wrong in a way that is easy to miss — leaving a walkthrough that was never
   * resumed returns state to the `null` it started at, and a comparison would then skip
   * the clear and leave the bookmark behind.
   */
  const hasSynchronised = useRef(false);

  useEffect(() => {
    if (!hasSynchronised.current) {
      hasSynchronised.current = true;
      return;
    }

    if (session === null) {
      clearCreation();
      return;
    }

    const progress: CreationProgress = { characterId: session.characterId, step: session.step };
    saveCreation(progress);
  }, [session]);

  const start = useCallback(() => {
    const [first] = steps;
    if (first === undefined) return;

    setSession({ characterId, step: first });
  }, [characterId, steps]);

  const go = useCallback(
    (step: Id) => {
      setSession({ characterId, step });
    },
    [characterId],
  );

  const leave = useCallback(() => setSession(null), []);

  // Derived on read, never stored: a sheet replaced by an import is a different
  // character, and a bookmark into the last one stops applying the instant it arrives.
  const step = session !== null && session.characterId === characterId ? session.step : null;

  return { step, start, go, leave, failure: booted.failure };
}
