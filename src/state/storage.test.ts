// The failure modes are the point. A browser that happily reads and writes needs no
// wrapper at all; this file exists for Safari private browsing, blocked site data and
// a full origin, none of which a clean jsdom will produce on its own.

import { afterEach, describe, expect, it } from 'vitest';
import type { StorageDriver } from './storage';
import { defaultStorageDriver, readText, removeKey, writeText } from './storage';

const KEY = 'lantern:test';

/** Every method throws — an origin that is not allowed site data at all. */
const blockedDriver: StorageDriver = {
  getItem() {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  },
  setItem() {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  },
  removeItem() {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  },
};

function quotaDriver(name: string, code?: number): StorageDriver {
  const error = new DOMException('exceeded the quota', name);
  if (code !== undefined) Object.defineProperty(error, 'code', { value: code });

  return {
    getItem: () => null,
    setItem() {
      throw error;
    },
    removeItem: () => undefined,
  };
}

afterEach(() => {
  localStorage.clear();
});

describe('a storage that works', () => {
  it('round trips a value', () => {
    expect(writeText(KEY, 'hello')).toEqual({ ok: true });
    expect(readText(KEY)).toEqual({ ok: true, value: 'hello' });
  });

  it('reports a missing key as null rather than as a failure', () => {
    expect(readText('lantern:nothing-here')).toEqual({ ok: true, value: null });
  });

  it('removes a key', () => {
    writeText(KEY, 'hello');
    expect(removeKey(KEY)).toEqual({ ok: true });
    expect(readText(KEY)).toEqual({ ok: true, value: null });
  });

  it('resolves a driver from the platform', () => {
    expect(defaultStorageDriver()).not.toBeNull();
  });
});

describe('a storage that refuses', () => {
  it('reports a throwing read as unavailable instead of throwing', () => {
    const result = readText(KEY, blockedDriver);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('unavailable');
  });

  it('reports a throwing write as failed instead of throwing', () => {
    const result = writeText(KEY, 'hello', blockedDriver);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('failed');
  });

  it('reports a throwing remove instead of throwing', () => {
    const result = removeKey(KEY, blockedDriver);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('failed');
  });

  it('treats a null driver as unavailable', () => {
    expect(readText(KEY, null)).toEqual({
      ok: false,
      failure: { kind: 'unavailable', detail: 'localStorage is not available on this origin' },
    });
    expect(writeText(KEY, 'x', null).ok).toBe(false);
    expect(removeKey(KEY, null).ok).toBe(false);
  });
});

describe('a storage that is full', () => {
  // Four spellings of the same condition, which is why the check is not `name === '…'`.
  it.each([
    ['QuotaExceededError', undefined],
    ['NS_ERROR_DOM_QUOTA_REACHED', undefined],
    ['SomeOtherName', 22],
    ['SomeOtherName', 1014],
  ])('recognises %s / code %s as a full origin', (name, code) => {
    const result = writeText(KEY, 'hello', quotaDriver(name, code));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('quota');
  });

  it('does not mistake an ordinary failure for a full origin', () => {
    const result = writeText(KEY, 'hello', quotaDriver('SecurityError'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('failed');
  });
});
