// The protocol is the hostile-input boundary (CLAUDE.md §7): every payload here came
// from another browser running code we did not write and cannot see. So the tests are
// mostly rejections — one per schema, plus the three rules DESIGN.md §3 says are not
// negotiable: no sender field, no version negotiation, validation in both directions.
//
// `SAMPLES` is typed per event type, so an eighth event added to the union without a
// sample fails `npm run typecheck` rather than quietly going untested.

import { describe, expect, it } from 'vitest';
import {
  MAX_AC,
  MAX_CHARACTER_LEVEL,
  MAX_CONDITIONS,
  MAX_DICE_PER_ROLL,
  MAX_EVENT_BYTES,
  MAX_LUCK,
  MAX_PACK_CHUNK_BYTES,
  MAX_PACK_CHUNKS,
  MAX_ROLL_MODIFIER,
  MIN_DIE_SIDES,
  PROTOCOL_VERSION,
} from '../constants';
import {
  describeRejection,
  encodeEvent,
  parseEvent,
  ProtocolEvent,
  PublicCharacter,
  receiveEvent,
  type EventType,
} from './protocol';

/** One valid event of every type, and the type system insists all seven are here. */
type EventSamples = { [K in EventType]: Extract<ProtocolEvent, { t: K }> };

const VESS: PublicCharacter = {
  name: 'Vess of the Low Road',
  ancestry: 'Human',
  className: 'Thief',
  level: 3,
  hp: { current: 11, max: 17 },
  ac: 13,
  conditions: ['blessed'],
  carryingLight: true,
  luck: 1,
};

const SAMPLES: EventSamples = {
  hello: { v: PROTOCOL_VERSION, t: 'hello', character: VESS, joinedAt: 1_700_000_000_000 },
  state: { v: PROTOCOL_VERSION, t: 'state', character: { ...VESS, hp: { current: 5, max: 17 } } },
  roll: {
    v: PROTOCOL_VERSION,
    t: 'roll',
    id: 'r_2b4801',
    label: 'Shortsword',
    dice: [{ sides: 6, value: 4 }],
    modifier: 3,
    visibility: 'everyone',
    lookup: null,
  },
  request: {
    v: PROTOCOL_VERSION,
    t: 'request',
    id: 'q_18bd90',
    body: { kind: 'adjust', field: 'hp', delta: -6, note: 'the bridge gives way' },
  },
  response: {
    v: PROTOCOL_VERSION,
    t: 'response',
    requestId: 'q_18bd90',
    decision: 'allowed',
    note: '',
  },
  pack: {
    v: PROTOCOL_VERSION,
    t: 'pack',
    packId: 'frostbound',
    seq: 0,
    total: 2,
    chunk: '{"format":"lantern-pack"',
  },
  scene: { v: PROTOCOL_VERSION, t: 'scene', location: 'The Sunken Vault', torch: 'dim' },
};

const EVENT_TYPES = Object.keys(SAMPLES) as EventType[];

/** A payload is `unknown` by the time it reaches us, so a hostile edit is too. */
function mangle(type: EventType, changes: Record<string, unknown>): unknown {
  return { ...SAMPLES[type], ...changes };
}

function without(type: EventType, key: string): unknown {
  const copy: Record<string, unknown> = { ...SAMPLES[type] };
  delete copy[key];
  return copy;
}

function rejectionOf(input: unknown): string {
  const result = parseEvent(input);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected a rejection');
  return result.rejection.kind;
}

describe('the union', () => {
  it('has a branch for every event DESIGN.md §3 lists, and no more', () => {
    expect(EVENT_TYPES).toEqual(['hello', 'state', 'roll', 'request', 'response', 'pack', 'scene']);
    expect(ProtocolEvent.options).toHaveLength(EVENT_TYPES.length);
  });

  it('accepts every sample and round-trips it through encode and parse', () => {
    for (const type of EVENT_TYPES) {
      const encoded = encodeEvent(SAMPLES[type]);
      expect(encoded.ok, type).toBe(true);
      if (!encoded.ok) continue;

      const parsed = parseEvent(JSON.parse(JSON.stringify(encoded.payload)));
      expect(parsed.ok, type).toBe(true);
      if (parsed.ok) expect(parsed.event).toEqual(SAMPLES[type]);
    }
  });

  it('refuses an unknown event type', () => {
    expect(rejectionOf({ v: PROTOCOL_VERSION, t: 'shutdown' })).toBe('malformed');
  });

  it('refuses anything that is not an object at all', () => {
    expect(rejectionOf('hello')).toBe('malformed');
    expect(rejectionOf(null)).toBe('malformed');
    expect(rejectionOf([SAMPLES.hello])).toBe('malformed');
  });
});

describe('the version', () => {
  it('is carried by every event, and missing it is a rejection', () => {
    for (const type of EVENT_TYPES) {
      expect(SAMPLES[type].v).toBe(PROTOCOL_VERSION);
      expect(rejectionOf(without(type, 'v')), type).toBe('malformed');
    }
  });

  it('rejects a mismatch outright, naming both versions', () => {
    const result = parseEvent(mangle('hello', { v: PROTOCOL_VERSION + 1 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const { rejection } = result;
    expect(rejection.kind).toBe('version-mismatch');
    if (rejection.kind !== 'version-mismatch') return;

    expect(rejection.theirs).toBe(PROTOCOL_VERSION + 1);
    expect(rejection.ours).toBe(PROTOCOL_VERSION);
    // DESIGN.md §3 — the rejection has to be showable, not merely detectable.
    expect(rejection.message).toContain(String(PROTOCOL_VERSION + 1));
    expect(rejection.message).toContain(String(PROTOCOL_VERSION));
  });

  it('reports a mismatch as a mismatch even when the rest of the event is nonsense', () => {
    expect(rejectionOf({ v: 99, t: 'roll', dice: 'lots' })).toBe('version-mismatch');
  });

  it('does not negotiate an older version', () => {
    expect(rejectionOf(mangle('scene', { v: PROTOCOL_VERSION - 1 }))).toBe('version-mismatch');
  });

  it('treats a version that is not a number as malformed, not as a mismatch', () => {
    expect(rejectionOf(mangle('hello', { v: '1' }))).toBe('malformed');
    expect(rejectionOf(mangle('hello', { v: null }))).toBe('malformed');
  });
});

describe('identity', () => {
  it('gives a payload nowhere to claim a sender', () => {
    // CLAUDE.md §2.8. Every event is strict, so a `from` is not ignored — it is refused.
    for (const type of EVENT_TYPES) {
      expect(rejectionOf(mangle(type, { from: 'f'.repeat(64) })), type).toBe('malformed');
      expect(rejectionOf(mangle(type, { peerId: 'f'.repeat(64) })), type).toBe('malformed');
    }
  });

  it('takes `from` from the transport', () => {
    const result = receiveEvent('abc123', SAMPLES.hello);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.received.from).toBe('abc123');
    expect(result.received.event).toEqual(SAMPLES.hello);
  });

  it('passes a rejection straight through rather than inventing an event', () => {
    const result = receiveEvent('abc123', { v: 9, t: 'hello' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.kind).toBe('version-mismatch');
  });
});

describe('the size wall', () => {
  it('drops a payload over the limit before parsing it', () => {
    const huge = mangle('scene', { location: 'x'.repeat(MAX_EVENT_BYTES) });
    expect(rejectionOf(huge)).toBe('too-large');
  });

  it('treats something that is not data as malformed', () => {
    const cycle: Record<string, unknown> = { ...SAMPLES.scene };
    cycle.self = cycle;
    expect(rejectionOf(cycle)).toBe('malformed');
  });
});

describe('the public projection', () => {
  it('carries no id — the transport says who a projection belongs to', () => {
    expect(rejectionOf(mangle('state', { character: { ...VESS, id: 'ff00' } }))).toBe('malformed');
  });

  it('sends nothing private', () => {
    // DESIGN.md §2 — gold, journal, quests, gear and spells are not sent at all.
    for (const key of ['gold', 'journal', 'quests', 'items', 'spells', 'talents']) {
      expect(rejectionOf(mangle('state', { character: { ...VESS, [key]: [] } })), key).toBe(
        'malformed',
      );
    }
  });

  it('bounds every number a peer reports', () => {
    const bad: Array<Partial<Record<keyof PublicCharacter, unknown>>> = [
      { level: MAX_CHARACTER_LEVEL + 1 },
      { level: -1 },
      { ac: MAX_AC + 1 },
      { ac: -1 },
      { luck: MAX_LUCK + 1 },
      { hp: { current: 4, max: -1 } },
      { hp: { current: 4.5, max: 10 } },
      { conditions: Array.from({ length: MAX_CONDITIONS + 1 }, () => 'blessed') },
      { conditions: [''] },
      { carryingLight: 'yes' },
    ];

    for (const change of bad) {
      expect(rejectionOf(mangle('state', { character: { ...VESS, ...change } }))).toBe('malformed');
    }
  });

  it('lets a dying character across, because refusing one loses a player their game', () => {
    const dying = mangle('state', { character: { ...VESS, hp: { current: -3, max: 17 } } });
    expect(parseEvent(dying).ok).toBe(true);
  });
});

describe('roll', () => {
  it('refuses a die that reports more than it has faces', () => {
    expect(rejectionOf(mangle('roll', { dice: [{ sides: 6, value: 9 }] }))).toBe('malformed');
    expect(rejectionOf(mangle('roll', { dice: [{ sides: 6, value: 0 }] }))).toBe('malformed');
  });

  it('refuses a die with fewer faces than a coin', () => {
    expect(rejectionOf(mangle('roll', { dice: [{ sides: MIN_DIE_SIDES - 1, value: 1 }] }))).toBe(
      'malformed',
    );
  });

  it('refuses an empty pool and one past the limit', () => {
    expect(rejectionOf(mangle('roll', { dice: [] }))).toBe('malformed');

    const pool = Array.from({ length: MAX_DICE_PER_ROLL + 1 }, () => ({ sides: 6, value: 1 }));
    expect(rejectionOf(mangle('roll', { dice: pool }))).toBe('malformed');
  });

  it('bounds the modifier in both directions', () => {
    expect(rejectionOf(mangle('roll', { modifier: MAX_ROLL_MODIFIER + 1 }))).toBe('malformed');
    expect(rejectionOf(mangle('roll', { modifier: -MAX_ROLL_MODIFIER - 1 }))).toBe('malformed');
  });

  it('cannot express a secret roll, because a secret roll is never sent', () => {
    // DESIGN.md §4 — broadcasting the numbers and hiding them client side is not secret.
    expect(rejectionOf(mangle('roll', { visibility: 'just-me' }))).toBe('malformed');
    expect(parseEvent(mangle('roll', { visibility: 'dm-only' })).ok).toBe(true);
  });

  it('carries no total, because a total is derived', () => {
    expect(rejectionOf(mangle('roll', { total: 7 }))).toBe('malformed');
  });

  it('takes a table lookup as a reference and a row', () => {
    const lookup = { table: 'core:table:thief-talents', row: 'Roll again twice' };
    expect(parseEvent(mangle('roll', { lookup })).ok).toBe(true);
    expect(rejectionOf(mangle('roll', { lookup: { table: 'not a ref', row: '' } }))).toBe(
      'malformed',
    );
  });
});

describe('request and response', () => {
  it('accepts the three kinds of request and refuses a fourth', () => {
    const bodies = [
      { kind: 'ask', text: 'May I search the altar?' },
      { kind: 'adjust', field: 'xp', delta: 3, note: '' },
      { kind: 'condition', condition: 'blessed', add: true, note: '' },
    ];
    for (const body of bodies) expect(parseEvent(mangle('request', { body })).ok).toBe(true);

    expect(rejectionOf(mangle('request', { body: { kind: 'setStat', field: 'str', to: 18 } }))).toBe(
      'malformed',
    );
  });

  it('refuses an empty question and an unknown field', () => {
    expect(rejectionOf(mangle('request', { body: { kind: 'ask', text: '' } }))).toBe('malformed');
    expect(
      rejectionOf(mangle('request', { body: { kind: 'adjust', field: 'str', delta: 1, note: '' } })),
    ).toBe('malformed');
  });

  it('answers a request id, never a peer id', () => {
    expect(rejectionOf(mangle('response', { requestId: 'f'.repeat(64) }))).toBe('malformed');
    expect(rejectionOf(mangle('response', { decision: 'maybe' }))).toBe('malformed');
  });
});

describe('pack chunks', () => {
  it('refuses a piece that claims to be past the end', () => {
    expect(rejectionOf(mangle('pack', { seq: 2, total: 2 }))).toBe('malformed');
    expect(rejectionOf(mangle('pack', { seq: 0, total: 0 }))).toBe('malformed');
    expect(rejectionOf(mangle('pack', { seq: -1, total: 2 }))).toBe('malformed');
  });

  it('refuses more pieces than the largest permitted pack could need', () => {
    expect(rejectionOf(mangle('pack', { seq: 0, total: MAX_PACK_CHUNKS + 1 }))).toBe('malformed');
    expect(parseEvent(mangle('pack', { seq: 0, total: MAX_PACK_CHUNKS })).ok).toBe(true);
  });

  it('bounds the chunk itself and the pack id', () => {
    expect(rejectionOf(mangle('pack', { chunk: 'x'.repeat(MAX_PACK_CHUNK_BYTES + 1) }))).toBe(
      'malformed',
    );
    expect(rejectionOf(mangle('pack', { packId: 'Frostbound' }))).toBe('malformed');
  });
});

describe('scene', () => {
  it('takes the three torch modes and nothing else', () => {
    for (const torch of ['dim', 'bar', 'off']) {
      expect(parseEvent(mangle('scene', { torch })).ok, torch).toBe(true);
    }
    expect(rejectionOf(mangle('scene', { torch: 'bright' }))).toBe('malformed');
  });
});

describe('encodeEvent', () => {
  it('validates on the way out, with nobody else at the table', () => {
    // CLAUDE.md §2.7. The bug this catches is ours, and this is the last machine that
    // can still be debugged when it happens.
    const wrong = { ...SAMPLES.roll, dice: [{ sides: 6, value: 12 }] } as ProtocolEvent;
    const result = encodeEvent(wrong);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.kind).toBe('malformed');
  });

  it('refuses to send something over the size limit', () => {
    const huge = { ...SAMPLES.scene, location: 'x'.repeat(MAX_EVENT_BYTES) } as ProtocolEvent;
    const result = encodeEvent(huge);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The name is too long before the payload is too large, so either wall may catch it;
    // what matters is that nothing oversized leaves.
    expect(['too-large', 'malformed']).toContain(result.rejection.kind);
  });

  it('strips nothing and adds nothing to a valid event', () => {
    const result = encodeEvent(SAMPLES.request);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload).toEqual(SAMPLES.request);
  });
});

describe('describeRejection', () => {
  it('names the kind and keeps the sentence', () => {
    const result = parseEvent(mangle('hello', { v: 42 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const line = describeRejection(result.rejection);
    expect(line).toContain('version-mismatch');
    expect(line).toContain('42');
  });

  it('lists what was wrong with a malformed event, path first', () => {
    const result = parseEvent(mangle('roll', { modifier: 'lots' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.rejection.kind !== 'malformed') throw new Error('expected malformed');

    expect(result.rejection.problems[0]?.path).toBe('modifier');
    expect(describeRejection(result.rejection)).toContain('modifier');
  });
});
