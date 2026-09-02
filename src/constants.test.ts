// Constants are copied into schemas and UI, so the ones that have to agree with each
// other are asserted here rather than trusted to stay in step.

import { describe, expect, it } from 'vitest';
import {
  ENTRY_ID_MAX_LENGTH,
  ENTRY_ID_PATTERN,
  MAX_DIE_SIDES,
  MAX_PACK_CHUNK_BYTES,
  MAX_EVENT_BYTES,
  MAX_REF_LENGTH,
  MAX_TABLE_ROWS,
  PACK_ID_MAX_LENGTH,
  REF_PATTERN,
  PACK_ID_MIN_LENGTH,
  PACK_ID_PATTERN,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from './constants';

describe('pack id pattern', () => {
  it('is built from the length bounds rather than repeating them', () => {
    expect(PACK_ID_PATTERN.test('a'.repeat(PACK_ID_MIN_LENGTH))).toBe(true);
    expect(PACK_ID_PATTERN.test('a'.repeat(PACK_ID_MAX_LENGTH))).toBe(true);
    expect(PACK_ID_PATTERN.test('a'.repeat(PACK_ID_MIN_LENGTH - 1))).toBe(false);
    expect(PACK_ID_PATTERN.test('a'.repeat(PACK_ID_MAX_LENGTH + 1))).toBe(false);
  });

  it('rejects anything that is not lowercase, digits or a hyphen', () => {
    expect(PACK_ID_PATTERN.test('frost-bound-2')).toBe(true);
    expect(PACK_ID_PATTERN.test('Frostbound')).toBe(false);
    expect(PACK_ID_PATTERN.test('frost bound')).toBe(false);
    expect(PACK_ID_PATTERN.test('frost:bound')).toBe(false);
    expect(PACK_ID_PATTERN.test('frost.bound')).toBe(false);
  });

  it('is not stateful — no /g, so repeated tests agree', () => {
    expect(PACK_ID_PATTERN.flags).not.toContain('g');
    expect(ENTRY_ID_PATTERN.flags).not.toContain('g');
    expect(PACK_ID_PATTERN.test('frostbound')).toBe(PACK_ID_PATTERN.test('frostbound'));
  });
});

describe('room codes', () => {
  it('has no ambiguous glyph, and no duplicate', () => {
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[01OIL5S2Z]/);
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(ROOM_CODE_ALPHABET.length);
  });

  it('is a big enough keyspace that codes do not collide in practice', () => {
    expect(ROOM_CODE_ALPHABET.length ** ROOM_CODE_LENGTH).toBeGreaterThan(1e8);
  });
});

describe('caps that depend on each other', () => {
  it('lets a table hold a row for every face of the largest die', () => {
    expect(MAX_TABLE_ROWS).toBeGreaterThanOrEqual(MAX_DIE_SIDES);
  });

  it('sizes a namespaced reference to fit three bare ids and two colons', () => {
    expect(MAX_REF_LENGTH).toBe(ENTRY_ID_MAX_LENGTH * 3 + 2);
    expect('core:class:wizard'.length).toBeLessThanOrEqual(MAX_REF_LENGTH);
  });

  it('keeps a pack chunk inside what a single event may carry', () => {
    expect(MAX_PACK_CHUNK_BYTES).toBeLessThan(MAX_EVENT_BYTES);
  });

  it('admits nothing in a reference that a bare id would reject', () => {
    expect(REF_PATTERN.test('core:class:wizard')).toBe(true);
    expect(REF_PATTERN.test('frost-bound:table:loot-minor-2')).toBe(true);
    expect(REF_PATTERN.test('core:class')).toBe(false);
    expect(REF_PATTERN.test('core:class:wizard:extra')).toBe(false);
    expect(REF_PATTERN.test('Core:Class:Wizard')).toBe(false);
    expect(REF_PATTERN.flags).not.toContain('g');
  });

  it('cannot match a reference longer than the cap allows', () => {
    const segment = 'a'.repeat(ENTRY_ID_MAX_LENGTH);
    const longest = [segment, segment, segment].join(':');
    expect(REF_PATTERN.test(longest)).toBe(true);
    expect(longest.length).toBe(MAX_REF_LENGTH);
    expect(REF_PATTERN.test(`${longest}a`)).toBe(false);
  });
});
