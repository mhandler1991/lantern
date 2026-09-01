// The harness exists to tell two identical-looking failures apart (peer-harness.ts).
// If `diagnose` gets that wrong it sends the next debugging session in the wrong
// direction, which is precisely the cost Phase 0 was created to avoid — so every
// branch of it is asserted here.

import { describe, expect, it } from 'vitest';
import { MAX_HARNESS_LOG_LINES } from '../constants';
import {
  appendLogEntry,
  countOpenRelays,
  diagnose,
  formatLogEntry,
  formatTimestamp,
  idsSeenWithin,
  shortPeerId,
  type HarnessSnapshot,
  type LogEntry,
} from './peer-harness';

function snapshot(overrides: Partial<HarnessSnapshot> = {}): HarnessSnapshot {
  return {
    openRelays: 3,
    transportPeerIds: [],
    trackedPeerIds: [],
    heardFromPeerIds: [],
    settlingPeerIds: [],
    ...overrides,
  };
}

describe('diagnose', () => {
  it('blames signalling when no relay is open and no peer was ever seen', () => {
    const result = diagnose(snapshot({ openRelays: 0 }));

    expect(result.kind).toBe('no-signalling');
  });

  it('does not blame signalling when relays are up but nobody is here', () => {
    const result = diagnose(snapshot({ openRelays: 2 }));

    expect(result.kind).toBe('alone');
    expect(result.summary).toContain('2 relay');
  });

  // The distinction the whole page exists for: the transport has the peer, we do not.
  it('blames our layer when the transport reports a peer we never tracked', () => {
    const result = diagnose(
      snapshot({ transportPeerIds: ['aaaa1111', 'bbbb2222'], trackedPeerIds: ['aaaa1111'] }),
    );

    expect(result.kind).toBe('layer-missed-join');
    expect(result).toHaveProperty('peerIds', ['bbbb2222']);
  });

  it('blames our layer when we hold a peer the transport has dropped', () => {
    const result = diagnose(
      snapshot({
        transportPeerIds: ['aaaa1111'],
        trackedPeerIds: ['aaaa1111', 'cccc3333'],
        heardFromPeerIds: ['aaaa1111'],
      }),
    );

    expect(result.kind).toBe('layer-held-ghost');
    expect(result).toHaveProperty('peerIds', ['cccc3333']);
  });

  it('reports a connected peer that has sent nothing separately from a missing one', () => {
    const result = diagnose(
      snapshot({
        transportPeerIds: ['aaaa1111', 'bbbb2222'],
        trackedPeerIds: ['aaaa1111', 'bbbb2222'],
        heardFromPeerIds: ['aaaa1111'],
      }),
    );

    expect(result.kind).toBe('silent-peers');
    expect(result).toHaveProperty('peerIds', ['bbbb2222']);
  });

  // A peer that joined a millisecond ago has not had time to send anything. Calling
  // that a fault puts a red herring at the top of the log.
  it('does not call a peer silent while it is still settling', () => {
    const result = diagnose(
      snapshot({
        transportPeerIds: ['aaaa1111', 'bbbb2222'],
        trackedPeerIds: ['aaaa1111', 'bbbb2222'],
        heardFromPeerIds: ['aaaa1111'],
        settlingPeerIds: ['bbbb2222'],
      }),
    );

    expect(result.kind).toBe('healthy');
  });

  it('still reports a peer that stayed silent past the settle window', () => {
    const result = diagnose(
      snapshot({
        transportPeerIds: ['aaaa1111', 'bbbb2222'],
        trackedPeerIds: ['aaaa1111', 'bbbb2222'],
        heardFromPeerIds: ['aaaa1111'],
        settlingPeerIds: ['aaaa1111'],
      }),
    );

    expect(result.kind).toBe('silent-peers');
    expect(result).toHaveProperty('peerIds', ['bbbb2222']);
  });

  // Settling excuses silence, never a bookkeeping disagreement.
  it('reports a missed join even while the peer is settling', () => {
    const result = diagnose(
      snapshot({
        transportPeerIds: ['bbbb2222'],
        trackedPeerIds: [],
        settlingPeerIds: ['bbbb2222'],
      }),
    );

    expect(result.kind).toBe('layer-missed-join');
  });

  it('clears the transport when all three views agree', () => {
    const result = diagnose(
      snapshot({
        transportPeerIds: ['aaaa1111'],
        trackedPeerIds: ['aaaa1111'],
        heardFromPeerIds: ['aaaa1111'],
      }),
    );

    expect(result.kind).toBe('healthy');
  });

  // A missed join explains a silent peer. Reporting the symptom over the cause is how
  // a debugging session goes four wrong diagnoses deep.
  it('reports the missed join rather than the silence it causes', () => {
    const result = diagnose(
      snapshot({ transportPeerIds: ['aaaa1111'], trackedPeerIds: [], heardFromPeerIds: [] }),
    );

    expect(result.kind).toBe('layer-missed-join');
  });

  it('reports a ghost even when relays have since closed', () => {
    const result = diagnose(
      snapshot({ openRelays: 0, transportPeerIds: [], trackedPeerIds: ['cccc3333'] }),
    );

    expect(result.kind).toBe('layer-held-ghost');
  });
});

describe('idsSeenWithin', () => {
  const now = 1_000_000;

  it('keeps an id inside the window and drops one outside it', () => {
    const times = new Map([
      ['fresh', now - 1_000],
      ['stale', now - 30_000],
    ]);

    expect(idsSeenWithin(times, now, 10_000)).toEqual(['fresh']);
  });

  it('treats the boundary as inside the window', () => {
    expect(idsSeenWithin(new Map([['edge', now - 10_000]]), now, 10_000)).toEqual(['edge']);
  });
});

describe('log formatting', () => {
  const entry: LogEntry = {
    at: Date.UTC(2026, 0, 1, 12, 0, 0),
    source: 'transport',
    level: 'info',
    message: 'peer joined',
  };

  it('writes a wall-clock timestamp with milliseconds', () => {
    expect(formatTimestamp(entry.at)).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
  });

  it('puts the source in its own aligned column', () => {
    const transport = formatLogEntry(entry);
    const relay = formatLogEntry({ ...entry, source: 'relay' });

    expect(transport).toContain('transport  peer joined');
    expect(transport.indexOf('peer joined')).toBe(relay.indexOf('peer joined'));
  });

  it('marks anything that is not routine', () => {
    expect(formatLogEntry({ ...entry, level: 'warn' })).toContain('WARN: peer joined');
    expect(formatLogEntry(entry)).not.toContain('INFO');
  });
});

describe('appendLogEntry', () => {
  function line(n: number): LogEntry {
    return { at: n, source: 'harness', level: 'info', message: `line ${n}` };
  }

  it('appends without mutating the log it was given', () => {
    const log = [line(1)];
    const next = appendLogEntry(log, line(2), 10);

    expect(log).toHaveLength(1);
    expect(next.map((e) => e.message)).toEqual(['line 1', 'line 2']);
  });

  it('drops the oldest lines past the limit', () => {
    const full = Array.from({ length: 3 }, (_, i) => line(i));
    const next = appendLogEntry(full, line(3), 3);

    expect(next.map((e) => e.message)).toEqual(['line 1', 'line 2', 'line 3']);
  });

  it('is bounded by the shipped constant, so a page left open cannot grow forever', () => {
    let log: LogEntry[] = [];
    for (let i = 0; i < MAX_HARNESS_LOG_LINES + 50; i += 1) {
      log = appendLogEntry(log, line(i), MAX_HARNESS_LOG_LINES);
    }

    expect(log).toHaveLength(MAX_HARNESS_LOG_LINES);
  });
});

describe('countOpenRelays', () => {
  it('counts only sockets that are open', () => {
    const sockets = {
      'wss://a': { readyState: WebSocket.OPEN },
      'wss://b': { readyState: WebSocket.CONNECTING },
      'wss://c': { readyState: WebSocket.CLOSED },
      'wss://d': { readyState: WebSocket.OPEN },
    };

    expect(countOpenRelays(sockets)).toBe(2);
  });

  // Upstream types this `any`. A shape we cannot read reports as "signalling is down"
  // rather than inventing a number.
  it('reports zero for anything it cannot read', () => {
    expect(countOpenRelays(undefined)).toBe(0);
    expect(countOpenRelays(null)).toBe(0);
    expect(countOpenRelays('wss://a')).toBe(0);
    expect(countOpenRelays({ 'wss://a': null })).toBe(0);
    expect(countOpenRelays({ 'wss://a': {} })).toBe(0);
  });
});

describe('shortPeerId', () => {
  it('shortens a full peer id and leaves a short one alone', () => {
    expect(shortPeerId('a'.repeat(64))).toBe('aaaaaaaa');
    expect(shortPeerId('abc')).toBe('abc');
  });
});
