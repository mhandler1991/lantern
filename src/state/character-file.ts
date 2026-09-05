/**
 * The character as a file on disk: what export writes, and what import is allowed to
 * believe. DESIGN.md §8 — characters live in one browser, so this file is the only
 * mitigation there is against losing one, and DATA-MODEL.md §12 is its contract.
 *
 * Two decisions carry the whole module.
 *
 * **An export is the stored document, byte for byte.** Not a wrapper, not a prettied
 * copy: `JSON.stringify` of the same validated character `saveCharacter` writes. That is
 * what lets one migration path serve both — a file exported by an old build and a sheet
 * saved by one are the same bytes and are brought forward by the same code, so the two
 * cannot drift apart. `character-file.test.ts` asserts the two strings are equal, which
 * turns that sentence of DATA-MODEL.md §12 into something that fails when it stops
 * being true.
 *
 * **An imported file is hostile until it parses.** It was picked off a disk, it may have
 * been edited by hand or by an AI, and it may not be ours at all. It is bounded, decoded,
 * migrated and validated in that order, and nothing here throws: every way a file can be
 * wrong comes back as problems with paths, ready to paste (DATA-MODEL.md §9). Nothing
 * partially repaired is ever returned, so the caller cannot half-import anything.
 *
 * There is no DOM here. Picking a file and starting a download are `ui/download.ts`.
 */

import {
  CHARACTER_FORMAT,
  CHARACTER_FORMAT_VERSION,
  MAX_CHARACTER_BYTES,
  MAX_CHARACTER_FILE_SLUG_LENGTH,
} from '../constants';
import type { Character, CharacterProblem } from '../model/character';
import { parseCharacter } from '../model/character';
import { migrateCharacterDocument } from './character-storage';
import { describeError } from './storage';

/** JSON, because the file is meant to be readable and pasteable. DATA-MODEL.md §11. */
export const CHARACTER_FILE_TYPE = 'application/json';

/** What the file picker offers by default. Both spellings: browsers disagree on which. */
export const CHARACTER_FILE_ACCEPT = 'application/json,.json';

/** A file with nothing in it. A floor, not a business rule. */
const EMPTY = 0;

/**
 * What this module needs of a picked file: how big it is, and its text. Structural
 * rather than the DOM `File` type, for the same reason `StorageDriver` is — a test can
 * hand in an object, including one that fails on read, and the failure path is exercised
 * rather than assumed. A real `File` satisfies it.
 */
export type PickedFile = {
  readonly size: number;
  text(): Promise<string>;
};

/** What a download needs: a name, a type, and the bytes. */
export type CharacterFile = {
  readonly name: string;
  readonly type: string;
  readonly text: string;
};

export type CharacterFileWrite =
  | { readonly ok: true; readonly file: CharacterFile }
  /** Validated on the way out as well as in. CLAUDE.md §2.7 — even our own data. */
  | { readonly ok: false; readonly problems: readonly CharacterProblem[] };

export type CharacterFileRead =
  | {
      readonly ok: true;
      readonly character: Character;
      /** Null unless the file was behind and was brought forward. */
      readonly migratedFrom: number | null;
    }
  | { readonly ok: false; readonly problems: readonly CharacterProblem[] };

function problems(path: string, message: string): { readonly problems: readonly CharacterProblem[] } {
  return { problems: [{ path, message }] };
}

/**
 * `lantern-character-vess-of-the-low-road.json`.
 *
 * The format name leads, so a folder of these sorts together and so the file says what
 * it is before anything opens it. The character's own name follows, reduced to what
 * every filesystem agrees on: a name written in a script this slug cannot carry — or no
 * name at all, which is every character before creation names one — leaves just
 * `lantern-character.json` rather than a row of hyphens.
 */
export function characterFileName(character: Character): string {
  const slug = character.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .slice(EMPTY, MAX_CHARACTER_FILE_SLUG_LENGTH)
    // After the slice as well as before it: a cut that lands mid-word leaves a hyphen.
    .replace(/^-+|-+$/gu, '');

  return slug === '' ? `${CHARACTER_FORMAT}.json` : `${CHARACTER_FORMAT}-${slug}.json`;
}

/**
 * A character, ready to hand to the browser. The character is parsed rather than
 * stringified as it arrived: a sheet that would not load back is reported here instead
 * of leaving the machine as a file nobody can open.
 */
export function toCharacterFile(character: Character): CharacterFileWrite {
  const validated = parseCharacter(character);
  if (!validated.ok) return { ok: false, problems: validated.problems };

  return {
    ok: true,
    file: {
      name: characterFileName(validated.character),
      type: CHARACTER_FILE_TYPE,
      text: JSON.stringify(validated.character),
    },
  };
}

/**
 * Read a character out of text. Bounded first, because the cap exists to stop a large
 * file being decoded at all; then decoded, migrated and validated, each step reporting
 * what it found rather than throwing it.
 */
export function fromCharacterFileText(text: string): CharacterFileRead {
  // A UTF-16 length never exceeds the byte count it encodes to, so this is the
  // conservative half of the bound `readCharacterFile` puts on the file itself. Storage
  // guards its own key the same way.
  if (text.length > MAX_CHARACTER_BYTES) {
    return {
      ok: false,
      ...problems(
        '(root)',
        `expected at most ${MAX_CHARACTER_BYTES} characters, found ${text.length}`,
      ),
    };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch (error) {
    return { ok: false, ...problems('(root)', `expected JSON — ${describeError(error)}`) };
  }

  const migrated = migrateCharacterDocument(decoded);
  if (!migrated.ok) return { ok: false, problems: migrated.problems };

  const parsed = parseCharacter(migrated.document);
  if (!parsed.ok) return { ok: false, problems: parsed.problems };

  return {
    ok: true,
    character: parsed.character,
    migratedFrom: migrated.from === CHARACTER_FORMAT_VERSION ? null : migrated.from,
  };
}

/**
 * Read a picked file. The size is checked before a byte is read, so an enormous file is
 * refused rather than pulled into memory to be refused, and a read that fails — a file
 * moved or unplugged between the picker and here — is a problem like any other.
 */
export async function readCharacterFile(file: PickedFile): Promise<CharacterFileRead> {
  if (file.size > MAX_CHARACTER_BYTES) {
    return {
      ok: false,
      ...problems('(root)', `expected at most ${MAX_CHARACTER_BYTES} bytes, found ${file.size}`),
    };
  }

  let text: string;
  try {
    text = await file.text();
  } catch (error) {
    return { ok: false, ...problems('(root)', `the file could not be read — ${describeError(error)}`) };
  }

  return fromCharacterFileText(text);
}
