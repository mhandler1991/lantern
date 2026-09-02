// A blank sheet is a real character. If it did not validate, the app could not save the
// thing it falls back to — and the fallback is what every failure path returns to.

import { describe, expect, it } from 'vitest';
import { CHARACTER_ID_PATTERN, DEFAULT_STAT_SCORE, MIN_CHARACTER_LEVEL } from '../constants';
import { abilityModifier } from '../model/derived';
import { parseCharacter } from '../model/character';
import { createCharacter, newCharacter, newCharacterId } from './new-character';

describe('a new character', () => {
  it('validates', () => {
    const parsed = parseCharacter(newCharacter());
    expect(parsed.ok).toBe(true);
  });

  it('starts before creation rather than empty', () => {
    const character = createCharacter('c_test');

    expect(character.level).toBe(MIN_CHARACTER_LEVEL);
    expect(character.class).toBeNull();
    expect(character.ancestry).toBeNull();
    expect(character.name).toBe('');
  });

  it('shows no bonus nobody earned', () => {
    expect(abilityModifier(DEFAULT_STAT_SCORE)).toBe(0);
  });

  it('is pure — the same id gives the same character', () => {
    expect(createCharacter('c_test', 'Vess')).toEqual(createCharacter('c_test', 'Vess'));
  });
});

describe('a new character id', () => {
  it('matches the pattern the schema enforces', () => {
    expect(newCharacterId()).toMatch(CHARACTER_ID_PATTERN);
  });

  it('does not collide across a run', () => {
    const ids = new Set(Array.from({ length: 1_000 }, newCharacterId));
    expect(ids.size).toBe(1_000);
  });
});
