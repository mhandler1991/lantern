// Two things must hold no matter what is under `lantern:packs`: the app still starts,
// and whatever was stored is still reachable afterwards. Every test here is one of those
// two, or one of the bounds that keep the store inside a quota it does not own.

import { afterEach, describe, expect, it } from 'vitest';
import {
  KEPT_PACKS_FORMAT,
  KEPT_PACKS_FORMAT_VERSION,
  MAX_ENTRIES_PER_ARRAY,
  MAX_KEPT_PACKS,
  MAX_KEPT_PACKS_BYTES,
  MAX_PACK_SOURCE_NAME_LENGTH,
  MAX_TEXT_LENGTH,
  PACK_FORMAT,
  PACK_FORMAT_VERSION,
} from '../constants';
import type { Pack } from '../model/pack';
import type { KeptPack } from './pack-storage';
import {
  KEPT_PACKS_KEY,
  REJECTED_PACKS_KEY,
  fitsKeptPacks,
  keptPacksText,
  loadKeptPacks,
  readRejectedPacks,
  saveKeptPacks,
} from './pack-storage';
import type { StorageDriver } from './storage';

afterEach(() => {
  localStorage.clear();
});

/** A pack with one spell in it — the smallest thing that survives `parsePack`. */
function pack(id: string, options: { name?: string; spells?: number; text?: string } = {}): Pack {
  const { name = id, spells = 1, text } = options;

  return {
    format: PACK_FORMAT,
    formatVersion: PACK_FORMAT_VERSION,
    id,
    name,
    version: '1.0.0',
    spells: Array.from({ length: spells }, (_unused, index) => ({
      id: `ember-${index}`,
      name: `Ember ${index}`,
      tier: 1,
      duration: 'instant',
      range: 'near',
      classes: [],
      ...(text === undefined ? {} : { text }),
    })),
  } as Pack;
}

const kept = (id: string, isEnabled = true): KeptPack => ({
  name: `${id}.json`,
  isEnabled,
  pack: pack(id),
});

/** What is under the live key, decoded. Nothing in the app reads it this way. */
const storedValue = (): unknown => JSON.parse(localStorage.getItem(KEPT_PACKS_KEY) ?? 'null');

// ---------------------------------------------------------------------------
// The round trip
// ---------------------------------------------------------------------------

describe('keeping packs', () => {
  it('brings the packs back in order, with the on/off state they were stored with', () => {
    const entries = [kept('frostbound'), kept('cursed-scroll', false)];
    expect(saveKeptPacks(entries)).toEqual({ ok: true, count: 2 });

    const load = loadKeptPacks();

    expect(load.entries).toEqual(entries);
    expect(load.problems).toEqual([]);
    expect(load.failure).toBeNull();
  });

  it('reports an empty store as empty rather than as a fault', () => {
    expect(loadKeptPacks()).toEqual({
      entries: [],
      problems: [],
      kept: false,
      quarantined: false,
      failure: null,
    });
  });

  it('clears the key when the last pack stops being kept, rather than storing nothing', () => {
    saveKeptPacks([kept('frostbound')]);

    expect(saveKeptPacks([])).toEqual({ ok: true, count: 0 });
    expect(localStorage.getItem(KEPT_PACKS_KEY)).toBeNull();
  });

  it('stores its own envelope, so a stored list says what format it is', () => {
    saveKeptPacks([kept('frostbound')]);

    expect(storedValue()).toMatchObject({
      format: KEPT_PACKS_FORMAT,
      formatVersion: KEPT_PACKS_FORMAT_VERSION,
      packs: [{ name: 'frostbound.json', isEnabled: true }],
    });
  });

  it('validates on the way out as well as in — a pack that would not load back is refused', () => {
    // CLAUDE.md §2.7. The reference is nonsense, so `parsePack` refuses it, and the
    // failure is reported while the DM is looking at the screen rather than next visit.
    const broken = { ...kept('frostbound'), pack: { ...pack('frostbound'), id: 'NOT AN ID' } as Pack };

    const saved = saveKeptPacks([broken]);

    expect(saved.ok).toBe(false);
    expect(saved.ok === false && saved.reason).toBe('invalid');
    expect(saved.ok === false && saved.reason === 'invalid' && saved.problems[0]?.path).toContain('packs[0]');
    expect(localStorage.getItem(KEPT_PACKS_KEY)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The bounds
// ---------------------------------------------------------------------------

describe('the bounds on what may be stored', () => {
  it('refuses more packs than it stores, and stores nothing when it does', () => {
    const many = Array.from({ length: MAX_KEPT_PACKS + 1 }, (_unused, index) => kept(`pack-${index}`));

    expect(fitsKeptPacks(many)).toBe(false);
    expect(saveKeptPacks(many)).toEqual({ ok: false, reason: 'too-large' });
    expect(localStorage.getItem(KEPT_PACKS_KEY)).toBeNull();
  });

  it('refuses a set of packs larger than the store, whatever the count', () => {
    // Three packs, each well inside `MAX_PACK_BYTES` and each a pack `parsePack` accepts.
    // The naive "store every loaded pack" is 32 of these — 64 MB against a quota of about
    // five — which is the whole reason this bound is a constant of its own.
    const heavy = (id: string): KeptPack => ({
      name: `${id}.json`,
      isEnabled: true,
      pack: pack(id, { spells: MAX_ENTRIES_PER_ARRAY, text: 'x'.repeat(MAX_TEXT_LENGTH) }),
    });
    const packs = [heavy('one'), heavy('two'), heavy('three')];

    expect(keptPacksText(packs).length).toBeGreaterThan(MAX_KEPT_PACKS_BYTES);
    expect(packs.length).toBeLessThan(MAX_KEPT_PACKS);
    expect(fitsKeptPacks(packs)).toBe(false);
    expect(saveKeptPacks(packs)).toEqual({ ok: false, reason: 'too-large' });
  });

  it('stores at most what a file name is worth, so a path cannot grow the store', () => {
    const long = { ...kept('frostbound'), name: 'f'.repeat(MAX_PACK_SOURCE_NAME_LENGTH * 2) };
    saveKeptPacks([long]);

    const load = loadKeptPacks();
    expect(load.problems).toEqual([]);
    expect(load.entries[0]?.name.length).toBe(MAX_PACK_SOURCE_NAME_LENGTH);
  });
});

// ---------------------------------------------------------------------------
// Stored is not trusted
// ---------------------------------------------------------------------------

describe('a stored value this build cannot read', () => {
  /** Whatever is written straight to the key — another tab, an older build, a hand. */
  const store = (raw: string): void => localStorage.setItem(KEPT_PACKS_KEY, raw);

  it('sets the value aside rather than dropping it, and says what was wrong', () => {
    store('{ not json at all');

    const load = loadKeptPacks();

    expect(load.entries).toEqual([]);
    expect(load.problems[0]?.path).toBe('(root)');
    expect(load.kept).toBe(true);
    expect(load.quarantined).toBe(true);
    expect(localStorage.getItem(REJECTED_PACKS_KEY)).toBe('{ not json at all');
  });

  it('keeps the packs that parsed and reports the one that did not, by position', () => {
    store(
      JSON.stringify({
        format: KEPT_PACKS_FORMAT,
        formatVersion: KEPT_PACKS_FORMAT_VERSION,
        packs: [
          { name: 'frostbound.json', isEnabled: true, pack: pack('frostbound') },
          { name: 'broken.json', isEnabled: true, pack: { ...pack('broken'), formatVersion: 99 } },
        ],
      }),
    );

    const load = loadKeptPacks();

    expect(load.entries.map((entry) => entry.pack.id)).toEqual(['frostbound']);
    expect(load.problems[0]?.path).toContain('packs[1]');
    expect(load.quarantined).toBe(true);
  });

  it('runs every stored pack through parsePack — a stored pack gets no more trust than a file', () => {
    store(
      JSON.stringify({
        format: KEPT_PACKS_FORMAT,
        formatVersion: KEPT_PACKS_FORMAT_VERSION,
        packs: [{ name: 'evil.json', isEnabled: true, pack: { id: 'evil', spells: 'lots' } }],
      }),
    );

    const load = loadKeptPacks();

    expect(load.entries).toEqual([]);
    expect(load.problems.length).toBeGreaterThan(0);
  });

  it('refuses a store from another format, or another version of this one', () => {
    store(JSON.stringify({ format: 'something-else', formatVersion: 1, packs: [] }));
    expect(loadKeptPacks().problems[0]?.path).toBe('format');

    localStorage.clear();
    store(
      JSON.stringify({
        format: KEPT_PACKS_FORMAT,
        formatVersion: KEPT_PACKS_FORMAT_VERSION + 1,
        packs: [],
      }),
    );
    expect(loadKeptPacks().problems[0]?.path).toBe('formatVersion');
  });

  it('refuses a name or an on/off state that is not what it claims to be', () => {
    store(
      JSON.stringify({
        format: KEPT_PACKS_FORMAT,
        formatVersion: KEPT_PACKS_FORMAT_VERSION,
        packs: [
          { name: 42, isEnabled: true, pack: pack('frostbound') },
          { name: 'x.json', isEnabled: 'yes', pack: pack('cursed-scroll') },
        ],
      }),
    );

    const load = loadKeptPacks();

    expect(load.entries).toEqual([]);
    expect(load.problems.map((problem) => problem.path)).toEqual([
      'packs[0].name',
      'packs[1].isEnabled',
    ]);
  });

  it('restores what it stores and no more when the list is longer than the bound', () => {
    store(
      JSON.stringify({
        format: KEPT_PACKS_FORMAT,
        formatVersion: KEPT_PACKS_FORMAT_VERSION,
        packs: Array.from({ length: MAX_KEPT_PACKS + 2 }, (_unused, index) => ({
          name: `pack-${index}.json`,
          isEnabled: true,
          pack: pack(`pack-${index}`),
        })),
      }),
    );

    const load = loadKeptPacks();

    expect(load.entries.length).toBe(MAX_KEPT_PACKS);
    expect(load.problems[0]?.path).toBe('packs');
    expect(load.quarantined).toBe(true);
  });

  it('refuses a value larger than the store without decoding it', () => {
    store(`"${'a'.repeat(MAX_KEPT_PACKS_BYTES)}"`);

    const load = loadKeptPacks();

    expect(load.entries).toEqual([]);
    expect(load.problems[0]?.message).toContain('characters');
  });

  it('never replaces a quarantined value with a later one', () => {
    localStorage.setItem(REJECTED_PACKS_KEY, 'the first thing that broke');
    store('{ also broken');

    const load = loadKeptPacks();

    expect(load.kept).toBe(false);
    expect(load.quarantined).toBe(true);
    expect(localStorage.getItem(REJECTED_PACKS_KEY)).toBe('the first thing that broke');
  });

  // The acceptance criterion in one test: what is handed back is what was stored, and
  // reading it writes nothing at all.
  it('hands the quarantined bytes back exactly, and writes nothing doing it', () => {
    const raw = '{ not a store, and never was }';
    localStorage.setItem(REJECTED_PACKS_KEY, raw);

    const writes: string[] = [];
    const watched: StorageDriver = {
      getItem: (key) => localStorage.getItem(key),
      setItem: (key) => writes.push(key),
      removeItem: (key) => writes.push(key),
    };

    expect(readRejectedPacks(watched)).toEqual({ ok: true, text: raw });
    expect(readRejectedPacks(watched)).toEqual({ ok: true, text: raw });
    expect(writes).toEqual([]);
  });

  it('reports nothing parked as empty rather than as a failure', () => {
    expect(readRejectedPacks()).toEqual({ ok: false, reason: 'empty' });
  });
});

// ---------------------------------------------------------------------------
// A browser that will not play
// ---------------------------------------------------------------------------

describe('storage that refuses', () => {
  const blocked: StorageDriver = {
    getItem() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
    setItem() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
    removeItem: () => undefined,
  };

  it('reports unavailable rather than empty, so nothing claims a pack was lost', () => {
    const load = loadKeptPacks(blocked);

    expect(load.entries).toEqual([]);
    expect(load.problems).toEqual([]);
    expect(load.failure?.kind).toBe('unavailable');
  });

  it('reports a full origin as a full origin, and keeps the packs loaded', () => {
    const full: StorageDriver = {
      getItem: () => null,
      setItem() {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      removeItem: () => undefined,
    };

    const saved = saveKeptPacks([kept('frostbound')], full);

    expect(saved.ok).toBe(false);
    expect(saved.ok === false && saved.reason === 'storage' && saved.failure.kind).toBe('quota');
  });

  it('does not pretend a value was set aside when the copy could not be written', () => {
    const readable: StorageDriver = {
      getItem: (key) => (key === KEPT_PACKS_KEY ? '{ not json at all' : null),
      setItem() {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      removeItem: () => undefined,
    };

    const load = loadKeptPacks(readable);

    expect(load.kept).toBe(false);
    expect(load.quarantined).toBe(false);
    expect(load.problems.length).toBeGreaterThan(0);
  });
});
