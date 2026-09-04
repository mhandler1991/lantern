// The protocol is the hostile-input boundary (CLAUDE.md §7): every payload here came
// from another browser running code we did not write and cannot see. So the tests are
// mostly rejections — one per schema, plus the three rules DESIGN.md §3 says are not
// negotiable: no sender field, no version negotiation, validation in both directions.
//
// `SAMPLES` is typed per event type, so an eighth event added to the union without a
// sample fails `npm run typecheck` rather than quietly going untested.

import { describe, expect, it } from 'vitest';
import {
  ENTRY_ID_MAX_LENGTH,
  MAX_AC,
  MAX_CHARACTER_LEVEL,
  MAX_CHARACTER_NAME_LENGTH,
  MAX_CONDITION_LENGTH,
  MAX_CONDITIONS,
  MAX_DICE_PER_ROLL,
  MAX_EVENT_BYTES,
  MAX_LUCK,
  MAX_NAME_LENGTH,
  MAX_PACK_CHUNK_BYTES,
  MAX_PACK_CHUNKS,
  MAX_REF_LENGTH,
  MAX_ROLL_MODIFIER,
  MAX_ROW_ID_LENGTH,
  MAX_TEXT_LENGTH,
  MIN_DIE_SIDES,
  PACK_ID_MAX_LENGTH,
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

// ---------------------------------------------------------------------------
// The systematic passes (#40). Every schema, every field, driven off the samples.
// ---------------------------------------------------------------------------

/**
 * Values that are wrong for a field, chosen against the shape of the real one so a
 * substitution is never accidentally valid — `[{...}]` is the array candidate rather
 * than `[]` because an empty `conditions` is fine, and `true` is skipped for a field
 * that is a boolean to begin with.
 */
const WRONG_VALUES: readonly { readonly label: string; readonly value: unknown }[] = [
  { label: 'a string', value: 'hostile' },
  { label: 'a number', value: 9_999_999 },
  { label: 'a boolean', value: true },
  { label: 'null', value: null },
  { label: 'an object', value: { hostile: true } },
  { label: 'an array', value: [{ hostile: true }] },
];

function wrongValuesFor(valid: unknown): typeof WRONG_VALUES {
  return WRONG_VALUES.filter(({ value }) =>
    valid === null ? value !== null : typeof value !== typeof valid || typeof value === 'object',
  );
}

type Edit = { readonly why: string; readonly value: unknown };

/**
 * Every hostile edit of one valid object: each field dropped, each field replaced with a
 * value of the wrong type, and one key too many. Generated rather than written out, so a
 * field added to a schema is covered the day it is added.
 */
function assault(valid: Record<string, unknown>): readonly Edit[] {
  const edits: Edit[] = [];

  for (const [key, value] of Object.entries(valid)) {
    const dropped: Record<string, unknown> = { ...valid };
    delete dropped[key];
    edits.push({ why: `without ${key}`, value: dropped });

    for (const wrong of wrongValuesFor(value)) {
      edits.push({ why: `${key} as ${wrong.label}`, value: { ...valid, [key]: wrong.value } });
    }
  }

  edits.push({ why: 'with a key nothing declares', value: { ...valid, surprise: 1 } });

  return edits;
}

/** The nested objects an event carries, each with the event it travels inside. */
const NESTED: readonly {
  readonly what: string;
  readonly valid: Record<string, unknown>;
  readonly inside: (value: unknown) => unknown;
}[] = [
  {
    what: 'the projection',
    valid: { ...VESS },
    inside: (character) => mangle('state', { character }),
  },
  {
    what: 'hit points',
    valid: { current: 11, max: 17 },
    inside: (hp) => mangle('state', { character: { ...VESS, hp } }),
  },
  {
    what: 'a die',
    valid: { sides: 6, value: 4 },
    inside: (die) => mangle('roll', { dice: [die] }),
  },
  {
    what: 'a table lookup',
    valid: { table: 'core:table:thief-talents', row: 'Roll again twice' },
    inside: (lookup) => mangle('roll', { lookup }),
  },
  {
    what: 'an ask',
    valid: { kind: 'ask', text: 'May I search the altar?' },
    inside: (body) => mangle('request', { body }),
  },
  {
    what: 'an adjustment',
    valid: { kind: 'adjust', field: 'hp', delta: -6, note: '' },
    inside: (body) => mangle('request', { body }),
  },
  {
    what: 'a condition change',
    valid: { kind: 'condition', condition: 'blessed', add: true, note: '' },
    inside: (body) => mangle('request', { body }),
  },
];

describe('every field of every schema', () => {
  it('is required, is typed, and admits no neighbour', () => {
    for (const type of EVENT_TYPES) {
      for (const edit of assault({ ...SAMPLES[type] })) {
        expect(rejectionOf(edit.value), `${type}: ${edit.why}`).toBe('malformed');
      }
    }
  });

  it('holds the same way inside every nested schema', () => {
    for (const nested of NESTED) {
      // The wrapper is only hostile because of the edit, so a bug in it would show up
      // here as everything passing rather than as everything failing.
      expect(parseEvent(nested.inside(nested.valid)).ok, `${nested.what} unedited`).toBe(true);

      for (const edit of assault(nested.valid)) {
        expect(rejectionOf(nested.inside(edit.value)), `${nested.what}: ${edit.why}`).toBe(
          'malformed',
        );
      }
    }
  });
});

describe('oversized strings', () => {
  /** Every bounded string on the wire: what it is, its bound, and where it sits. */
  const BOUNDED: readonly {
    readonly what: string;
    readonly limit: number;
    readonly build: (text: string) => unknown;
  }[] = [
    {
      what: 'a character name',
      limit: MAX_CHARACTER_NAME_LENGTH,
      build: (name) => mangle('state', { character: { ...VESS, name } }),
    },
    {
      what: 'an ancestry',
      limit: MAX_NAME_LENGTH,
      build: (ancestry) => mangle('state', { character: { ...VESS, ancestry } }),
    },
    {
      what: 'a class name',
      limit: MAX_NAME_LENGTH,
      build: (className) => mangle('state', { character: { ...VESS, className } }),
    },
    {
      what: 'a condition',
      limit: MAX_CONDITION_LENGTH,
      build: (condition) => mangle('state', { character: { ...VESS, conditions: [condition] } }),
    },
    { what: 'a roll label', limit: MAX_NAME_LENGTH, build: (label) => mangle('roll', { label }) },
    {
      what: 'a table row',
      limit: MAX_TEXT_LENGTH,
      build: (row) => mangle('roll', { lookup: { table: 'core:table:carousing', row } }),
    },
    {
      what: 'a question',
      limit: MAX_TEXT_LENGTH,
      build: (text) => mangle('request', { body: { kind: 'ask', text } }),
    },
    {
      what: "an adjustment's note",
      limit: MAX_TEXT_LENGTH,
      build: (note) => mangle('request', { body: { kind: 'adjust', field: 'xp', delta: 1, note } }),
    },
    {
      what: "an answer's note",
      limit: MAX_TEXT_LENGTH,
      build: (note) => mangle('response', { note }),
    },
    {
      what: 'a pack chunk',
      limit: MAX_PACK_CHUNK_BYTES,
      build: (chunk) => mangle('pack', { chunk }),
    },
    {
      what: 'a location',
      limit: MAX_NAME_LENGTH,
      build: (location) => mangle('scene', { location }),
    },
  ];

  it('are refused, and a string exactly at the bound is not', () => {
    for (const field of BOUNDED) {
      expect(parseEvent(field.build('x'.repeat(field.limit))).ok, `${field.what} at the bound`).toBe(
        true,
      );
      expect(rejectionOf(field.build('x'.repeat(field.limit + 1))), field.what).toBe('malformed');
    }
  });

  it('are refused whatever they are made of', () => {
    // A bound is a character count and one character can be four bytes on the wire. The
    // byte wall is `checkEventSize` and it has already run; this is the wall on what may
    // be kept, and it counts characters the same way whatever they are.
    const wide = 'aa'.repeat(MAX_NAME_LENGTH);
    expect(rejectionOf(mangle('scene', { location: wide }))).toBe('malformed');
  });
});

describe('identifiers', () => {
  /** Ids are patterned as well as bounded, and the pattern is the narrower of the two. */
  const IDS: readonly {
    readonly what: string;
    readonly longest: string;
    readonly build: (id: string) => unknown;
  }[] = [
    {
      what: 'a roll id',
      longest: 'x'.repeat(MAX_ROW_ID_LENGTH),
      build: (id) => mangle('roll', { id }),
    },
    {
      what: 'a request id',
      longest: 'x'.repeat(MAX_ROW_ID_LENGTH),
      build: (requestId) => mangle('response', { requestId }),
    },
    {
      what: 'a pack id',
      longest: 'x'.repeat(PACK_ID_MAX_LENGTH),
      build: (packId) => mangle('pack', { packId }),
    },
    {
      what: 'a table reference',
      longest: [
        'x'.repeat(ENTRY_ID_MAX_LENGTH),
        'x'.repeat(ENTRY_ID_MAX_LENGTH),
        'x'.repeat(ENTRY_ID_MAX_LENGTH),
      ].join(':'),
      build: (table) => mangle('roll', { lookup: { table, row: '' } }),
    },
  ];

  it('take the longest legal id and nothing past it', () => {
    for (const id of IDS) {
      expect(parseEvent(id.build(id.longest)).ok, `${id.what} at the bound`).toBe(true);
      expect(rejectionOf(id.build(`${id.longest}x`)), id.what).toBe('malformed');
    }
    // The longest reference is three ids and two colons, and it is exactly the bound.
    expect(IDS.find((id) => id.what === 'a table reference')?.longest).toHaveLength(MAX_REF_LENGTH);
  });

  it('refuse anything shaped like a path, a tag or an empty string', () => {
    for (const id of IDS) {
      for (const hostile of ['', '../../etc', 'a b', '<script>', 'x/y', 'x.y']) {
        expect(rejectionOf(id.build(hostile)), `${id.what}: ${JSON.stringify(hostile)}`).toBe(
          'malformed',
        );
      }
    }
  });
});

describe('oversized arrays', () => {
  it('take a full pool and refuse one more', () => {
    const pool = Array.from({ length: MAX_DICE_PER_ROLL }, () => ({ sides: 6, value: 1 }));
    expect(parseEvent(mangle('roll', { dice: pool })).ok).toBe(true);
    expect(rejectionOf(mangle('roll', { dice: [...pool, { sides: 6, value: 1 }] }))).toBe(
      'malformed',
    );
  });

  it('take a full condition list and refuse one more', () => {
    const conditions = Array.from({ length: MAX_CONDITIONS }, () => 'blessed');
    expect(parseEvent(mangle('state', { character: { ...VESS, conditions } })).ok).toBe(true);
    expect(
      rejectionOf(
        mangle('state', { character: { ...VESS, conditions: [...conditions, 'cursed'] } }),
      ),
    ).toBe('malformed');
  });
});

describe('prototype pollution', () => {
  const POLLUTED = 'lanternPollution';

  /**
   * An object literal assigns *through* `__proto__`; only `JSON.parse` gives a real own
   * key by that name, which is exactly what arrives off the wire. Zod 4.5 strips it from
   * every object and reports it as an unrecognized key under a strict schema — proven
   * here rather than trusted, because the day that changes is the day this matters.
   */
  function withKey(value: object, key: string): unknown {
    const body = JSON.stringify(value);
    return JSON.parse(`{${JSON.stringify(key)}:{"${POLLUTED}":true},${body.slice(1)}`);
  }

  const POISON = ['__proto__', 'constructor', 'prototype'];

  it('is refused at the top of every event', () => {
    for (const type of EVENT_TYPES) {
      for (const key of POISON) {
        const payload = withKey(SAMPLES[type], key);
        expect(
          Object.getOwnPropertyNames(payload as object),
          `${type}: ${key} is a real own key`,
        ).toContain(key);
        expect(rejectionOf(payload), `${type}: ${key}`).toBe('malformed');
      }
    }
  });

  it('is refused inside a nested object too', () => {
    for (const key of POISON) {
      expect(rejectionOf(mangle('state', { character: withKey(VESS, key) })), key).toBe('malformed');
      expect(
        rejectionOf(mangle('state', { character: { ...VESS, hp: withKey(VESS.hp, key) } })),
        key,
      ).toBe('malformed');
      expect(
        rejectionOf(mangle('roll', { dice: [withKey({ sides: 6, value: 4 }, key)] })),
        key,
      ).toBe('malformed');
    }
  });

  it('leaves Object.prototype exactly as it found it', () => {
    const before = Object.getOwnPropertyNames(Object.prototype);

    for (const type of EVENT_TYPES) {
      for (const key of POISON) parseEvent(withKey(SAMPLES[type], key));
    }

    expect(({} as Record<string, unknown>)[POLLUTED]).toBeUndefined();
    expect(Object.getOwnPropertyNames(Object.prototype)).toEqual(before);
  });

  it('hands back a plain object built by the schema, not the one that arrived', () => {
    const arrived: unknown = JSON.parse(JSON.stringify(SAMPLES.scene));
    const result = parseEvent(arrived);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Anything downstream may spread this. It is Zod's object, so there is nothing in it
    // the sender put there.
    expect(result.event).not.toBe(arrived);
    expect(Object.getPrototypeOf(result.event)).toBe(Object.prototype);
  });
});

describe('text that is markup', () => {
  // PRD.md principle 4 — warn, do not block. A name with a tag in it is a name, and
  // refusing it would lose a player their seat. It is text and it stays text: the DOM
  // half of this is `ui/hostile-peer.test.tsx`, which proves it reaches a text node.
  const MARKUP = '<img src=x onerror="alert(1)">';

  /** Does this event carry that exact string anywhere, unescaped and unaltered? */
  function carries(value: unknown, text: string): boolean {
    if (typeof value === 'string') return value === text;
    if (Array.isArray(value)) return value.some((item) => carries(item, text));
    if (value !== null && typeof value === 'object') {
      return Object.values(value).some((item) => carries(item, text));
    }
    return false;
  }

  it('crosses unchanged, because it is text and nothing else', () => {
    const carriers: readonly { readonly what: string; readonly build: () => unknown }[] = [
      { what: 'a name', build: () => mangle('state', { character: { ...VESS, name: MARKUP } }) },
      {
        what: 'a condition',
        build: () => mangle('state', { character: { ...VESS, conditions: [MARKUP] } }),
      },
      { what: 'a roll label', build: () => mangle('roll', { label: MARKUP }) },
      { what: 'a location', build: () => mangle('scene', { location: MARKUP }) },
      {
        what: 'a question',
        build: () => mangle('request', { body: { kind: 'ask', text: MARKUP } }),
      },
      { what: 'an answer', build: () => mangle('response', { note: MARKUP }) },
    ];

    for (const carrier of carriers) {
      const result = parseEvent(carrier.build());
      expect(result.ok, carrier.what).toBe(true);
      if (result.ok) expect(carries(result.event, MARKUP), carrier.what).toBe(true);
    }
  });

  it('is not escaped, decoded or otherwise interpreted on the way through', () => {
    const result = parseEvent(mangle('scene', { location: MARKUP }));
    expect(result.ok).toBe(true);
    if (result.ok && result.event.t === 'scene') expect(result.event.location).toBe(MARKUP);
  });
});

describe('nothing reaches the caller as a throw', () => {
  // CLAUDE.md §2.5 — a payload that fails is a value describing the failure. Everything
  // below is something a transport can hand up, and none of it is an event.
  const NOT_DATA: readonly { readonly what: string; readonly value: unknown }[] = [
    { what: 'undefined', value: undefined },
    { what: 'a function', value: () => 1 },
    { what: 'a symbol', value: Symbol('hostile') },
    { what: 'a bigint', value: 1n },
    { what: 'NaN', value: { v: NaN, t: 'scene' } },
    { what: 'Infinity', value: { v: Infinity, t: 'scene' } },
    { what: 'a Map', value: new Map([['v', 1]]) },
    { what: 'a Date', value: new Date(0) },
    {
      what: 'an object whose toJSON throws',
      value: {
        toJSON: () => {
          throw new Error('no');
        },
      },
    },
  ];

  it('turns anything at all into a rejection', () => {
    for (const input of NOT_DATA) {
      expect(() => parseEvent(input.value), input.what).not.toThrow();
      expect(['malformed', 'too-large', 'version-mismatch'], input.what).toContain(
        rejectionOf(input.value),
      );
    }
  });

  it('survives a structure deep enough to overflow a stack', () => {
    let deep: unknown = 'floor';
    for (let depth = 0; depth < 100_000; depth += 1) deep = [deep];

    expect(() => parseEvent(deep)).not.toThrow();
    // Either wall may catch it — what matters is that it is a value and not a crash.
    expect(['malformed', 'too-large']).toContain(rejectionOf(deep));
  });
});
