/**
 * Room codes and the invite link. PRD.md §4 — six characters, short enough to read
 * aloud over a call, and an invite that is a query string because GitHub Pages has no
 * rewrite rules and a path-based route would 404 (DEPLOY.md §1).
 *
 * 🚫 Nothing here touches the DOM or React. `inviteUrl` and `readInvite` take the URL
 * as a string and hand one back, so the whole file tests without a browser and the one
 * place that reads `window.location` is the hook that calls it.
 *
 * The alphabet is the interesting decision. `ROOM_CODE_ALPHABET` excludes **both** sides
 * of every ambiguous pair — no `0`/`O`, no `1`/`I`/`L`, no `5`/`S`, no `2`/`Z` — so a
 * mis-heard character has no valid reading rather than a wrong one. That is why
 * `normalizeRoomCode` can discard anything outside the alphabet instead of guessing what
 * a typed `O` was meant to be: there is no answer to guess.
 */

import {
  MAX_REJECTION_SAMPLING_ATTEMPTS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_CODE_QUERY_PARAM,
} from '../constants';

/** Zero is the floor of a count and the first index, not a rule of anything. */
const NONE = 0;

/** How many distinct values one byte holds. Arithmetic, not a business rule. */
const BYTE_VALUES = 256;

const SYMBOLS = ROOM_CODE_ALPHABET.length;

/**
 * The largest multiple of the alphabet that fits in a byte — 243 for 27 symbols. A byte
 * at or above it is discarded rather than reduced, because `% 27` over all 256 values
 * would hand the first 13 symbols an extra chance each. The skew is invisible in a room
 * code and the correction costs nothing, which is the same argument DESIGN.md §4 makes
 * about dice; a generator that is uniform only where somebody checked is not uniform.
 */
const UNBIASED_LIMIT = BYTE_VALUES - (BYTE_VALUES % SYMBOLS);

/** Where randomness comes from. Injectable so the rejection path can actually be tested. */
export type RandomBytes = (into: Uint8Array) => void;

const cryptoBytes: RandomBytes = (into) => {
  crypto.getRandomValues(into);
};

/**
 * Errors are values (CLAUDE.md §2.5). Exhausting the sampling budget is astronomically
 * unlikely — `(13/256)^n` — but the alternative to reporting it is silently returning a
 * biased code, and `MAX_REJECTION_SAMPLING_ATTEMPTS` exists precisely so that a
 * pathological RNG cannot hang the tab instead.
 */
export type RoomCodeResult =
  | { readonly ok: true; readonly code: string }
  | { readonly ok: false; readonly message: string };

export function generateRoomCode(random: RandomBytes = cryptoBytes): RoomCodeResult {
  const symbols: string[] = [];
  const draw = new Uint8Array(ROOM_CODE_LENGTH);

  for (let attempt = NONE; attempt < MAX_REJECTION_SAMPLING_ATTEMPTS; attempt += 1) {
    random(draw);

    for (const byte of draw) {
      if (byte >= UNBIASED_LIMIT) continue;

      symbols.push(ROOM_CODE_ALPHABET[byte % SYMBOLS] ?? '');
      if (symbols.length === ROOM_CODE_LENGTH) return { ok: true, code: symbols.join('') };
    }
  }

  return {
    ok: false,
    message: `could not draw ${ROOM_CODE_LENGTH} unbiased characters in ${MAX_REJECTION_SAMPLING_ATTEMPTS} attempts`,
  };
}

/**
 * What someone typed, heard down a call or pasted, as the code it can only have been:
 * upper-cased, with anything outside the alphabet dropped.
 *
 * Dropping rather than rejecting is deliberate: a code arrives spoken and gets typed
 * with a space or a hyphen in it, and refusing the whole thing over a space is the
 * "block" half of PRD.md principle 4. A character that is genuinely not in the alphabet
 * disappears, which shortens the code visibly and reads as the mistake it is.
 *
 * 📌 It does **not** truncate. A value that is still too long after this is not a code
 * with extra on the end, it is the wrong value — which is how `readInvite` can tell a
 * mistyped link from a real one instead of silently landing someone in the room named
 * by the first six characters of whatever they pasted.
 */
export function normalizeRoomCode(input: string): string {
  const kept: string[] = [];

  for (const character of input.toUpperCase()) {
    if (ROOM_CODE_ALPHABET.includes(character)) kept.push(character);
  }

  return kept.join('');
}

/**
 * The same, capped — what belongs in the box while somebody is typing in it. Separate
 * from `normalizeRoomCode` because truncating is right at a keystroke and wrong on a
 * link, and one function doing both is one of them done silently.
 */
export function typedRoomCode(input: string): string {
  return normalizeRoomCode(input).slice(NONE, ROOM_CODE_LENGTH);
}

/** A code that is ready to join with. Normalising guarantees the symbols; this is length. */
export function isCompleteRoomCode(code: string): boolean {
  return code.length === ROOM_CODE_LENGTH && normalizeRoomCode(code) === code;
}

/**
 * What the `?r=` on the current URL said.
 *
 * `unreadable` carries nothing from the URL with it. The lobby has to say something
 * about a broken invite, and the one thing it must not do is print an arbitrary string
 * from someone else's link back into the page — the escaping is React's job and it does
 * it, but an unbounded value in the layout is a separate problem and there is nothing
 * useful to learn from seeing it.
 */
export type InviteRead =
  | { readonly kind: 'none' }
  | { readonly kind: 'code'; readonly code: string }
  | { readonly kind: 'unreadable' };

export function readInvite(search: string): InviteRead {
  const raw = new URLSearchParams(search).get(ROOM_CODE_QUERY_PARAM);
  if (raw === null) return { kind: 'none' };

  const code = normalizeRoomCode(raw);
  if (!isCompleteRoomCode(code)) return { kind: 'unreadable' };

  return { kind: 'code', code };
}

/**
 * The link to send. Built from the page's own URL, so it carries whatever base the app
 * is served from — `/lantern/`, `/lantern/preview/`, or a domain root — without this
 * file knowing which (DEPLOY.md §2). 🚫 The code is a query parameter and never a path
 * segment: Pages cannot rewrite, so a path would 404.
 *
 * Null rather than a throw if the href is not a URL, which is not something
 * `window.location.href` produces but is something a caller could pass.
 */
export function inviteUrl(href: string, code: string): string | null {
  try {
    const url = new URL(href);
    url.searchParams.set(ROOM_CODE_QUERY_PARAM, code);
    return url.toString();
  } catch {
    return null;
  }
}
