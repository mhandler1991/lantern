/**
 * Turning numbers into the strings a sheet prints. No React, no state — just the two
 * places a raw number would read wrong on paper.
 */

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
