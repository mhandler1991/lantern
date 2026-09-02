// The transport contract's pure half. `checkEventSize` is the wall an inbound payload
// hits before anything else looks at it (CLAUDE.md §2.7), so its boundary and its
// "this is not data at all" cases are asserted rather than assumed.

import { describe, expect, it } from 'vitest';
import { MAX_EVENT_BYTES } from '../constants';
import {
  checkEventSize,
  failure,
  measureEventBytes,
  ok,
  PEER_ID_DISPLAY_LENGTH,
  shortPeerId,
  describeError,
} from './transport';

describe('shortPeerId', () => {
  it('keeps the head of a peer id and leaves a short one alone', () => {
    expect(shortPeerId('a'.repeat(64))).toBe('a'.repeat(PEER_ID_DISPLAY_LENGTH));
    expect(shortPeerId('abc')).toBe('abc');
    expect(shortPeerId('')).toBe('');
  });
});

describe('describeError', () => {
  it('reads a message off an Error and stringifies anything else', () => {
    expect(describeError(new Error('relay closed'))).toBe('relay closed');
    expect(describeError('relay closed')).toBe('relay closed');
    expect(describeError(undefined)).toBe('undefined');
  });
});

describe('measureEventBytes', () => {
  it('measures bytes, not characters', () => {
    // A four-byte emoji inside a JSON string: two quotes plus four bytes.
    expect(measureEventBytes('🔦')).toBe(6);
    expect(measureEventBytes({ a: 1 })).toBe(JSON.stringify({ a: 1 }).length);
  });

  it('answers null for anything that is not data', () => {
    expect(measureEventBytes(undefined)).toBeNull();
    expect(measureEventBytes(() => undefined)).toBeNull();
    expect(measureEventBytes(1n)).toBeNull();

    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(measureEventBytes(cycle)).toBeNull();
  });
});

describe('checkEventSize', () => {
  it('accepts a payload exactly at the limit and refuses one byte more', () => {
    // JSON.stringify wraps a string in two quotes, so the body is two bytes short.
    const atLimit = 'x'.repeat(MAX_EVENT_BYTES - 2);
    const overLimit = `${atLimit}x`;

    expect(checkEventSize(atLimit)).toEqual(ok(MAX_EVENT_BYTES));

    const refused = checkEventSize(overLimit);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.kind).toBe('too-large');
      expect(refused.error.message).toContain(String(MAX_EVENT_BYTES));
    }
  });

  it('refuses a payload that is not JSON as malformed rather than throwing', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;

    expect(checkEventSize(cycle)).toEqual(failure('malformed', 'payload is not JSON-serialisable'));
    expect(checkEventSize(undefined).ok).toBe(false);
  });

  it('accepts the ordinary case', () => {
    const event = { v: 1, t: 'hello' };
    expect(checkEventSize(event)).toEqual(ok(JSON.stringify(event).length));
  });
});
