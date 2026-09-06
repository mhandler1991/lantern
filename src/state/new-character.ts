/**
 * The sheet you get when there is nothing to load.
 *
 * It lives in `state/` rather than `model/` for one reason: an id has to come from
 * somewhere, and `model/` is pure — same inputs, same answer. `createCharacter` below is
 * pure and takes the id; only `newCharacterId` reaches for the platform's randomness.
 *
 * A blank character is a **real** character, not an empty placeholder: level 0, no class,
 * no ancestry, and it validates. DATA-MODEL.md §12 — "zero is a real state, not an empty
 * one" — which is what lets the app open, save and reload before creation has run at all.
 */

import {
  CHARACTER_FORMAT,
  CHARACTER_FORMAT_VERSION,
  DEFAULT_STAT_SCORE,
  MIN_CHARACTER_LEVEL,
} from '../constants';
import type { Character } from '../model/character';

/** Nothing rolled, nothing carried, nothing owed. */
const NONE = 0;

/** Eight bytes of entropy as hex, behind a prefix: 18 characters, inside every id cap. */
const ID_BYTES = 8;
const HEX = 16;
const BYTE_HEX_DIGITS = 2;
const BYTE_VALUES = 256;

function randomBytes(count: number): Uint8Array {
  const bytes = new Uint8Array(count);

  // `crypto` is present in every browser this app supports and in jsdom. The fallback
  // is not a security decision — an id only has to be unique on one machine — it is
  // PRD.md principle 4: a missing global degrades, it never stops a sheet being made.
  const source = globalThis.crypto;
  if (source && typeof source.getRandomValues === 'function') {
    source.getRandomValues(bytes);
    return bytes;
  }

  for (let index = NONE; index < count; index += 1) {
    bytes[index] = Math.floor(Math.random() * BYTE_VALUES);
  }
  return bytes;
}

/** `c_1f3a…` or `r_1f3a…`. The two patterns admit the same shape; the prefix is for eyes. */
function localId(prefix: string): string {
  const hex = Array.from(randomBytes(ID_BYTES), (byte) =>
    byte.toString(HEX).padStart(BYTE_HEX_DIGITS, '0'),
  ).join('');

  return `${prefix}_${hex}`;
}

/** Matches `CHARACTER_ID_PATTERN`. Generated locally and never negotiated. */
export function newCharacterId(): string {
  return localId('c');
}

/**
 * One row on a sheet — an item, a spell, a talent. Matches `ROW_ID_PATTERN`. It is a
 * React key that has to survive the row being edited, so it is generated once when the
 * row is added and never derived from the row's contents.
 */
export function newRowId(): string {
  return localId('r');
}

/** Pure: the same id gives the same character. */
export function createCharacter(id: string, name = ''): Character {
  return {
    format: CHARACTER_FORMAT,
    formatVersion: CHARACTER_FORMAT_VERSION,

    id,
    name,

    // `{ ref: null, name: '' }` is unchosen — a real state, not a missing one.
    ancestry: { ref: null, name: '' },
    class: { ref: null, name: '' },
    alignment: null,

    level: MIN_CHARACTER_LEVEL,
    xp: NONE,

    stats: {
      str: DEFAULT_STAT_SCORE,
      dex: DEFAULT_STAT_SCORE,
      con: DEFAULT_STAT_SCORE,
      int: DEFAULT_STAT_SCORE,
      wis: DEFAULT_STAT_SCORE,
      cha: DEFAULT_STAT_SCORE,
    },
    hp: { current: NONE, max: NONE },
    luck: NONE,
    gold: { gp: NONE, sp: NONE, cp: NONE },

    items: [],
    spells: [],
    talents: [],
    lights: [],
    conditions: [],
    journal: [],
    quests: [],

    packsUsed: [],
  };
}

/** What boot falls back to when storage is empty, unreadable, or unavailable. */
export function newCharacter(): Character {
  return createCharacter(newCharacterId());
}
