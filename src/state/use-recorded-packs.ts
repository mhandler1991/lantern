/**
 * The sheet's record of what it was built against, written the moment a pack arrives.
 *
 * `updatePacksUsed` (`model/orphans.ts`) is stamped rather than derived, because the app
 * can only see what a pack contributes while that pack is loaded. Until now the only
 * thing that ran it was an edit, and that leaves one case unrecorded: a pack that
 * *overrides* `core:item:torch` changes nothing about the reference, so a sheet that
 * resolves through the supplement and is never touched afterwards carries no trace of
 * it. That was harmless while nothing survived a reload; a kept pack (DESIGN.md §7) is
 * what makes it observable — load an overriding supplement, change nothing, reload, and
 * the sheet resolves back through core with nothing saying what it lost.
 *
 * So the stamp happens when the load order changes as well: loading a pack, enabling
 * one, reordering, removing one. All four produce a new resolved stack and none of them
 * is an edit.
 *
 * **Not an effect, and not a derived value either.** CLAUDE.md §6 keeps effects for
 * synchronising with the outside world, and an effect here would be the anti-pattern
 * exactly — state adjusted in response to other state, one render late, with a visible
 * frame in between where the sheet's record disagrees with the packs it is resolving
 * through. This is React's documented alternative: compare against what was stamped
 * last, and adjust during the render itself. React throws away the returned output and
 * re-renders immediately, so nothing downstream ever sees the stale record, and the
 * `stack !== stamped` guard is what makes it terminate. `updatePacksUsed` returns the
 * character unchanged when nothing moved, so the common case is a bail-out and not a
 * write.
 *
 * The one rule this pattern carries is that only the rendering component's own state may
 * be adjusted, which is why this takes the setter rather than reaching for one: it is
 * called by the component that owns the character.
 */

import type { Dispatch, SetStateAction } from 'react';
import { useState } from 'react';
import type { Character } from '../model/character';
import { updatePacksUsed } from '../model/orphans';
import type { ResolvedStack } from '../model/pack-resolver';

/**
 * Keep `packsUsed` honest against the packs that are loaded right now, without waiting
 * for an edit. Pass the *unwrapped* setter — the stamp is this hook's whole job, and
 * running it through a wrapper that also stamps would just do it twice.
 */
export function useRecordedPacks(
  setCharacter: Dispatch<SetStateAction<Character>>,
  stack: ResolvedStack,
): void {
  const [stamped, setStamped] = useState<ResolvedStack | null>(null);

  if (stamped !== stack) {
    setStamped(stack);
    setCharacter((previous) => updatePacksUsed(previous, stack));
  }
}
