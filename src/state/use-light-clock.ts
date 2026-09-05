/**
 * The clock a burning light is read against.
 *
 * Burn-down is computed from `litAt` and the wall clock (`model/light.ts`), so nothing
 * here counts anything: this hook's whole job is to make the component render again so
 * that the arithmetic is redone against a newer `now`. The interval is a **repaint
 * trigger, never an accumulator** — every tick reads `Date.now()` fresh, so a tick that
 * arrives late, early, or not at all changes when the number is redrawn and never what
 * the number is.
 *
 * That is the bug this shape exists to make impossible. A backgrounded tab has its
 * timers throttled to once a minute or stopped outright, and a hook that subtracted a
 * second per tick would come back from twenty minutes in another tab with nineteen of
 * them unaccounted for. Here, coming back is just a later `Date.now()`.
 *
 * Two details earn their place:
 *
 * - **It only runs while something is burning.** Nothing lit, or everything lit already
 *   spent, and there is no interval at all — a sheet on a table for an hour with no
 *   torch does not wake the tab sixty times a minute. The moment the last light goes
 *   out the interval clears itself, because `isBurning` is derived on render rather
 *   than stored.
 * - **`visibilitychange` re-reads immediately.** The throttled tick may be up to a
 *   minute away when the player comes back to the tab, and the first thing they do is
 *   look at the torch. Waiting for the interval would show them a stale number for as
 *   long as the browser felt like.
 */

import { useEffect, useState } from 'react';
import { LIGHT_TICK_MS } from '../constants';
import type { Light } from '../model/character';
import { anyBurning } from '../model/light';

/**
 * The moment to read `lights` against. Advances while any of them is alight and holds
 * still otherwise — a frozen clock over a sheet with nothing burning is not stale, it
 * is a sheet with nothing burning.
 */
export function useLightClock(lights: readonly Light[]): number {
  const [now, setNow] = useState<number>(() => Date.now());
  const isBurning = anyBurning(lights, now);

  useEffect(() => {
    if (!isBurning) return;

    const read = (): void => setNow(Date.now());

    // The clock may have moved a long way since the last render — a torch lit before a
    // reload, or a tab that has been in the background.
    read();

    const timer = window.setInterval(read, LIGHT_TICK_MS);
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') read();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isBurning]);

  return now;
}
