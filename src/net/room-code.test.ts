// Room codes are spoken down a call and typed by someone not looking at the screen, so
// the tests are mostly about what a human does to a code between one browser and another
// — lower case, a space in the middle, a stray character that is not in the alphabet.
//
// The rejection sampling is tested with an injected generator rather than by mocking
// `crypto`, because the whole point of the bound is what happens when the draws go badly
// and a real CSPRNG will not do that on request.

import { describe, expect, it } from 'vitest';
import {
  MAX_REJECTION_SAMPLING_ATTEMPTS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_CODE_QUERY_PARAM,
} from '../constants';
import {
  generateRoomCode,
  inviteUrl,
  isCompleteRoomCode,
  normalizeRoomCode,
  readInvite,
  typedRoomCode,
  type RandomBytes,
} from './room-code';

/** Hands out the given bytes in order, then zeroes. */
function bytes(...values: number[]): RandomBytes {
  let next = 0;
  return (into) => {
    for (let i = 0; i < into.length; i += 1) {
      into[i] = values[next] ?? 0;
      next += 1;
    }
  };
}

describe('generateRoomCode', () => {
  it('draws a code of the documented length from the documented alphabet', () => {
    const result = generateRoomCode();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.code).toHaveLength(ROOM_CODE_LENGTH);
    for (const character of result.code) expect(ROOM_CODE_ALPHABET).toContain(character);
  });

  it('reaches every symbol in the alphabet over enough draws', () => {
    // Not a uniformity proof — a symbol that can never come out is the failure that
    // matters, and an off-by-one in the reduction is exactly how that happens.
    const seen = new Set<string>();
    for (let i = 0; i < 2_000; i += 1) {
      const result = generateRoomCode();
      if (result.ok) for (const character of result.code) seen.add(character);
    }

    expect(seen.size).toBe(ROOM_CODE_ALPHABET.length);
  });

  it('discards a byte that would skew the reduction', () => {
    // 243 is the first byte at or above the unbiased limit for 27 symbols. If it were
    // reduced rather than dropped it would produce `ROOM_CODE_ALPHABET[0]` again.
    const result = generateRoomCode(bytes(243, 244, 255, 0, 1, 2, 3, 4, 5, 6));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.code).toBe(
      [0, 1, 2, 3, 4, 5].map((index) => ROOM_CODE_ALPHABET[index]).join(''),
    );
  });

  it('reports exhaustion rather than returning a biased code', () => {
    const alwaysRejected: RandomBytes = (into) => into.fill(255);
    const result = generateRoomCode(alwaysRejected);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain(String(MAX_REJECTION_SAMPLING_ATTEMPTS));
  });
});

describe('normalizeRoomCode', () => {
  it('upper-cases what was typed', () => {
    expect(normalizeRoomCode('abcdef')).toBe('ABCDEF');
  });

  it('drops spaces and hyphens rather than refusing the whole code', () => {
    expect(normalizeRoomCode('ABC-DEF')).toBe('ABCDEF');
    expect(normalizeRoomCode(' abc def ')).toBe('ABCDEF');
  });

  it('drops a character the alphabet does not have, which shortens it visibly', () => {
    // Both halves of every ambiguous pair are excluded, so there is nothing to guess.
    for (const ambiguous of ['O', '0', 'I', '1', 'L', 'S', '5', 'Z', '2']) {
      expect(ROOM_CODE_ALPHABET, ambiguous).not.toContain(ambiguous);
        expect(normalizeRoomCode(`ABC${ambiguous}DE`)).toBe('ABCDE');
    }
  });

  it('does not truncate, so a value that is too long stays too long', () => {
    // The cap belongs to the box being typed in, not to normalising. A link carrying
    // 500 characters is a wrong link, not a code with extra on the end.
    expect(normalizeRoomCode('ABCDEFGHJK')).toBe('ABCDEFGHJK');
    expect(typedRoomCode('ABCDEFGHJK')).toHaveLength(ROOM_CODE_LENGTH);
  });

  it('is idempotent, and so is the capped form', () => {
    const once = normalizeRoomCode('a b-c d e f');
    expect(normalizeRoomCode(once)).toBe(once);

    const capped = typedRoomCode('a b-c d e f g h');
    expect(typedRoomCode(capped)).toBe(capped);
  });
});

describe('isCompleteRoomCode', () => {
  it('wants a full code of real symbols', () => {
    expect(isCompleteRoomCode('ABCDEF')).toBe(true);
    expect(isCompleteRoomCode('ABCDE')).toBe(false);
    expect(isCompleteRoomCode('abcdef')).toBe(false);
    expect(isCompleteRoomCode('ABCDE0')).toBe(false);
    expect(isCompleteRoomCode('')).toBe(false);
  });
});

describe('readInvite', () => {
  it('reads the code out of the query string', () => {
    expect(readInvite(`?${ROOM_CODE_QUERY_PARAM}=ABCDEF`)).toEqual({
      kind: 'code',
      code: 'ABCDEF',
    });
  });

  it('tidies a code that was pasted with the wrong case or a hyphen', () => {
    expect(readInvite(`?${ROOM_CODE_QUERY_PARAM}=abc-def`)).toEqual({
      kind: 'code',
      code: 'ABCDEF',
    });
  });

  it('says nothing was there when nothing was', () => {
    expect(readInvite('')).toEqual({ kind: 'none' });
    expect(readInvite('?other=ABCDEF')).toEqual({ kind: 'none' });
  });

  it('reports an unusable code without carrying it out of the URL', () => {
    const unreadable = { kind: 'unreadable' };
    expect(readInvite(`?${ROOM_CODE_QUERY_PARAM}=`)).toEqual(unreadable);
    expect(readInvite(`?${ROOM_CODE_QUERY_PARAM}=ABC`)).toEqual(unreadable);
    expect(readInvite(`?${ROOM_CODE_QUERY_PARAM}=${'x'.repeat(500)}`)).toEqual(unreadable);
  });
});

describe('inviteUrl', () => {
  it('keeps the subpath the app is served from', () => {
    // DEPLOY.md §1 — Pages serves from /lantern/, and the preview from /lantern/preview/.
    expect(inviteUrl('https://example.github.io/lantern/preview/', 'ABCDEF')).toBe(
      `https://example.github.io/lantern/preview/?${ROOM_CODE_QUERY_PARAM}=ABCDEF`,
    );
  });

  it('puts the code in the query string and never in the path', () => {
    const link = inviteUrl('https://example.github.io/lantern/', 'ABCDEF');
    expect(link).not.toBeNull();
    if (link === null) return;

    expect(new URL(link).pathname).toBe('/lantern/');
    expect(new URL(link).searchParams.get(ROOM_CODE_QUERY_PARAM)).toBe('ABCDEF');
  });

  it('replaces a code that is already on the URL rather than adding a second', () => {
    const link = inviteUrl(`https://example.com/?${ROOM_CODE_QUERY_PARAM}=AAAAAA`, 'BBBBBB');
    expect(link).toBe(`https://example.com/?${ROOM_CODE_QUERY_PARAM}=BBBBBB`);
  });

  it('leaves other parameters and the hash alone', () => {
    const link = inviteUrl('https://example.com/?keep=1#anchor', 'ABCDEF');
    expect(link).not.toBeNull();
    if (link === null) return;

    expect(new URL(link).searchParams.get('keep')).toBe('1');
    expect(new URL(link).hash).toBe('#anchor');
  });

  it('round-trips through readInvite', () => {
    const link = inviteUrl('https://example.github.io/lantern/', 'ABCDEF');
    expect(link).not.toBeNull();
    if (link === null) return;

    expect(readInvite(new URL(link).search)).toEqual({ kind: 'code', code: 'ABCDEF' });
  });

  it('answers null for something that is not a URL', () => {
    expect(inviteUrl('not a url', 'ABCDEF')).toBeNull();
  });
});
