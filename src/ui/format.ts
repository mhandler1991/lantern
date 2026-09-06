/**
 * Turning numbers into the strings a sheet prints. No React, no state, and no clock of
 * its own — the moment to read a countdown against is passed in, so what is printed is
 * a function of what was handed over and nothing else.
 */

import type { Burn } from '../model/light';

/** A clock reads from zero. A floor, not a business rule. */
const NONE = 0;

/** Unit conversions, not limits: the clock counts ms and a countdown is read in both. */
const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3_600;

/** Two digits, so a countdown does not jitter its width as it falls. */
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** A modifier is signed even when it is positive: `+2`, `0`, `−1` reads as a modifier. */
export function formatModifier(modifier: number): string {
  return modifier > 0 ? `+${modifier}` : String(modifier);
}

/**
 * A journal entry's moment, in the reader's own locale. `at` is epoch milliseconds
 * (DATA-MODEL.md §11); nothing is stored formatted, so a character written in one place
 * reads correctly in another.
 */
export function formatMoment(at: number): string {
  return new Date(at).toLocaleString();
}

/**
 * A duration as a countdown: `4:07`, and `1:12:30` once there is an hour of it. Seconds
 * are rounded **up**, so a torch reads `0:01` for its last second and reaches `0:00` at
 * the moment it is actually spent rather than a second before.
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(Math.ceil(ms / MS_PER_SECOND), NONE);

  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;

  if (hours > NONE) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}

/**
 * What a light source's row says about itself: unlit, how long it has left, or that it
 * has gone out. Words rather than a bare number, because "0:00" alone reads as a bar
 * that failed to load rather than as a torch that burned down.
 */
export function describeBurn(burn: Burn): string {
  if (!burn.isLit) return 'unlit';
  if (burn.isSpent) return 'burnt out';
  return `${formatDuration(burn.remainingMs)} left`;
}

/**
 * What to print in a row whose pack is not loaded. The player's own words if there are
 * any, and otherwise the reference itself — a row that reads as an empty box has been
 * lost as far as anyone looking at the sheet can tell, and nothing here is lost
 * (DATA-MODEL.md §5). Text, always: a reference came out of a pack (CLAUDE.md §2.6).
 */
export function orphanLabel(name: string, reference: string | null): string {
  return name !== '' ? name : (reference ?? '');
}
