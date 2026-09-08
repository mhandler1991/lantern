// The bookmark, and everything a hostile or stale value under our key can be.
//
// Nothing here holds player data, so the assertions are about a different promise from
// the character store's: this one never throws, never resumes into a step this build
// does not have, and never lets a value some other tab wrote decide where the
// walkthrough opens. The step ids are invented in this file rather than imported from
// `ui/creation/creation.ts`, because the module under test does not know the real ones
// either — that seam is what keeps `state/` from importing `ui/`.

import { describe, expect, it } from 'vitest';
import {
  CREATION_FORMAT,
  CREATION_FORMAT_VERSION,
  MAX_CREATION_BYTES,
} from '../constants';
import { CREATION_KEY, clearCreation, loadCreation, saveCreation } from './creation-storage';
import type { StorageDriver } from './storage';

const STEPS = ['first', 'second', 'review'];
const isKnownStep = (step: string): boolean => STEPS.includes(step);

/** A driver over a plain object, so a test can plant anything under the key. */
function driverOver(store: Map<string, string>): StorageDriver {
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
  };
}

/** A browser that refuses site data: present, and hostile. DATA-MODEL.md §13. */
const REFUSING: StorageDriver = {
  getItem() {
    throw new DOMException('denied', 'SecurityError');
  },
  setItem() {
    throw new DOMException('denied', 'SecurityError');
  },
  removeItem() {
    throw new DOMException('denied', 'SecurityError');
  },
};

function planted(value: string): StorageDriver {
  return driverOver(new Map([[CREATION_KEY, value]]));
}

function stored(document: Record<string, unknown>): StorageDriver {
  return planted(JSON.stringify(document));
}

const GOOD = {
  format: CREATION_FORMAT,
  formatVersion: CREATION_FORMAT_VERSION,
  characterId: 'c_1f3a2b',
  step: 'second',
};

describe('resuming a walkthrough', () => {
  it('reads back what it wrote', () => {
    const driver = driverOver(new Map());

    expect(saveCreation({ characterId: 'c_1f3a2b', step: 'second' }, driver).ok).toBe(true);
    expect(loadCreation(isKnownStep, driver).progress).toEqual({
      characterId: 'c_1f3a2b',
      step: 'second',
    });
  });

  it('finds nothing when nothing is stored', () => {
    expect(loadCreation(isKnownStep, driverOver(new Map()))).toEqual({
      progress: null,
      failure: null,
    });
  });

  it('drops a step this build no longer has', () => {
    const driver = stored({ ...GOOD, step: 'ancestry-and-class' });

    expect(loadCreation(isKnownStep, driver).progress).toBeNull();
  });

  it('drops a value that is not ours, and never throws over one', () => {
    for (const value of [
      '{',
      'null',
      '"second"',
      '[]',
      JSON.stringify({ ...GOOD, format: 'lantern-character' }),
      JSON.stringify({ ...GOOD, formatVersion: CREATION_FORMAT_VERSION + 1 }),
      JSON.stringify({ ...GOOD, characterId: 'not a valid id' }),
      JSON.stringify({ ...GOOD, step: 42 }),
      JSON.stringify({ ...GOOD, resumeInto: 'wherever' }),
    ]) {
      expect(loadCreation(isKnownStep, planted(value)).progress, value).toBeNull();
    }
  });

  it('refuses to decode a value too large to be one of ours', () => {
    const huge = JSON.stringify({ ...GOOD, step: 'x'.repeat(MAX_CREATION_BYTES) });

    expect(huge.length).toBeGreaterThan(MAX_CREATION_BYTES);
    expect(loadCreation(isKnownStep, planted(huge)).progress).toBeNull();
  });

  it('reports a browser that will not let us look, and resumes nothing', () => {
    const load = loadCreation(isKnownStep, REFUSING);

    expect(load.progress).toBeNull();
    expect(load.failure?.kind).toBe('unavailable');
  });

  it('reports a browser that will not let us write, rather than throwing', () => {
    const saved = saveCreation({ characterId: 'c_1f3a2b', step: 'first' }, REFUSING);

    expect(saved.ok).toBe(false);
  });

  it('refuses to store a position that would not load back', () => {
    const driver = driverOver(new Map());
    const saved = saveCreation({ characterId: 'not a valid id', step: 'first' }, driver);

    expect(saved.ok).toBe(false);
    expect(driver.getItem(CREATION_KEY)).toBeNull();
  });

  it('clears the bookmark without touching anything else', () => {
    const store = new Map([['lantern:character', '{"kept":true}']]);
    const driver = driverOver(store);

    saveCreation({ characterId: 'c_1f3a2b', step: 'first' }, driver);
    clearCreation(driver);

    expect(driver.getItem(CREATION_KEY)).toBeNull();
    expect(store.get('lantern:character')).toBe('{"kept":true}');
  });
});
