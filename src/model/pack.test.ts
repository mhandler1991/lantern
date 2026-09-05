// A pack arrives from another peer, so the envelope is a security boundary before it is
// anything else (DATA-MODEL.md §9). The tests come in the two halves that implies: what
// an honest author must be able to load, and what a hostile file must not get past.
//
// `FROSTBOUND` is the envelope from DATA-MODEL.md §1, copied exactly. If the doc and the
// schema ever disagree, this file fails — the only way a written contract stays honest.

import { describe, expect, it } from 'vitest';
import {
  EntryId,
  EntryName,
  EntryText,
  Overrides,
  Pack,
  PackId,
  PageReference,
  Ref,
  formatProblems,
  parsePack,
} from './pack';
import {
  ENTRY_ID_MAX_LENGTH,
  MAX_ENTRIES_PER_ARRAY,
  MAX_EXTENDS_PER_PACK,
  MAX_NAME_LENGTH,
  MAX_PAGE_NUMBER,
  MAX_TEXT_LENGTH,
  PACK_AUTHOR_MAX_LENGTH,
  PACK_DESCRIPTION_MAX_LENGTH,
  PACK_ID_MAX_LENGTH,
  PACK_ID_MIN_LENGTH,
  PACK_NAME_MAX_LENGTH,
  PACK_VERSION_MAX_LENGTH,
} from '../constants';

const FROSTBOUND = {
  format: 'lantern-pack',
  formatVersion: 1,
  id: 'frostbound',
  name: 'Frostbound',
  version: '1.2.0',
  author: 'Max',
  description: 'A cold-weather supplement. Two classes, fourteen spells.',

  classes: [],
  ancestries: [],
  spells: [],
  items: [],
  talents: [],
  tables: [],
  extends: [],
} as const;

/** The envelope with one field replaced or removed, so a test states only its own field. */
function envelope(over: Record<string, unknown> = {}): unknown {
  const merged: Record<string, unknown> = { ...FROSTBOUND, ...over };
  for (const [key, value] of Object.entries(over)) {
    if (value === undefined) delete merged[key];
  }
  return merged;
}

describe('what must load', () => {
  it('accepts the envelope from DATA-MODEL.md §1 unchanged', () => {
    const result = parsePack(FROSTBOUND);
    expect(result.ok).toBe(true);
  });

  it('accepts a pack with no content arrays at all', () => {
    const result = parsePack({
      format: 'lantern-pack',
      formatVersion: 1,
      id: 'four-spells',
      name: 'Four spells',
      version: '1.0.0',
    });
    expect(result.ok).toBe(true);
  });

  it.each(['classes', 'ancestries', 'spells', 'items', 'talents', 'tables', 'extends'])(
    'treats %s as optional on its own',
    (array) => {
      expect(parsePack(envelope({ [array]: undefined })).ok).toBe(true);
    },
  );

  it.each(['author', 'description'])('accepts %s absent, null, or written', (field) => {
    expect(parsePack(envelope({ [field]: undefined })).ok).toBe(true);
    expect(parsePack(envelope({ [field]: null })).ok).toBe(true);
    expect(parsePack(envelope({ [field]: 'something' })).ok).toBe(true);
  });

  it.each(['1.2.0', '1.0.0-beta.1', '2026.09', '0.1', '3'])('accepts version %s', (version) => {
    expect(parsePack(envelope({ version })).ok).toBe(true);
  });

  it('holds the longest name, author and description an author may write', () => {
    const result = parsePack(
      envelope({
        name: 'n'.repeat(PACK_NAME_MAX_LENGTH),
        author: 'a'.repeat(PACK_AUTHOR_MAX_LENGTH),
        description: 'd'.repeat(PACK_DESCRIPTION_MAX_LENGTH),
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('accepts the shortest and longest pack id', () => {
    expect(parsePack(envelope({ id: 'a'.repeat(PACK_ID_MIN_LENGTH) })).ok).toBe(true);
    expect(parsePack(envelope({ id: 'a'.repeat(PACK_ID_MAX_LENGTH) })).ok).toBe(true);
  });
});

describe('what must be refused', () => {
  it('rejects unknown keys rather than stripping them', () => {
    const result = parsePack(envelope({ onLoad: 'alert(1)' }));
    expect(result.ok).toBe(false);
  });

  it('names the unknown key it refused, so an author can find it', () => {
    const result = parsePack(envelope({ scripts: [] }));
    if (result.ok) throw new Error('expected the pack to be refused');
    expect(formatProblems(result.problems)).toContain('scripts');
  });

  it('keeps a stripped key from ever reaching a caller', () => {
    // The failure this guards against is silent: a schema that strips returns `ok` and
    // an object the author cannot see lost a field. Refusal is the only safe answer.
    const result = Pack.safeParse(envelope({ extra: 1 }));
    expect(result.success).toBe(false);
  });

  it.each(['format', 'formatVersion', 'id', 'name', 'version'])(
    'refuses a pack missing %s',
    (field) => {
      expect(parsePack(envelope({ [field]: undefined })).ok).toBe(false);
    },
  );

  it('refuses unrelated JSON on its first field', () => {
    const character = { format: 'lantern-character', formatVersion: 2, id: 'c_9f3a2b' };
    const result = parsePack(character);
    if (result.ok) throw new Error('expected a character file to be refused');
    expect(result.problems.some((problem) => problem.path === 'format')).toBe(true);
  });

  it('refuses a format version it does not implement', () => {
    expect(parsePack(envelope({ formatVersion: 2 })).ok).toBe(false);
    expect(parsePack(envelope({ formatVersion: '1' })).ok).toBe(false);
  });

  it.each([null, undefined, 'a pack', 42, []])('refuses %s as a whole pack', (input) => {
    expect(parsePack(input).ok).toBe(false);
  });

  it.each(['Frostbound', 'frost bound', 'frost_bound', 'frost:bound', 'f', '../etc'])(
    'refuses %s as a pack id',
    (id) => {
      expect(parsePack(envelope({ id })).ok).toBe(false);
    },
  );

  it('refuses an empty name and an empty pack id', () => {
    expect(parsePack(envelope({ name: '' })).ok).toBe(false);
    expect(parsePack(envelope({ id: '' })).ok).toBe(false);
  });

  it.each([
    ['name', PACK_NAME_MAX_LENGTH],
    ['author', PACK_AUTHOR_MAX_LENGTH],
    ['description', PACK_DESCRIPTION_MAX_LENGTH],
    ['version', PACK_VERSION_MAX_LENGTH],
    ['id', PACK_ID_MAX_LENGTH],
  ])('caps %s at its constant', (field, max) => {
    expect(parsePack(envelope({ [field]: 'a'.repeat(max + 1) })).ok).toBe(false);
  });

  it.each(['', 'v1.2.0', 'the second one', '1.2.0 <script>'])(
    'refuses %s as a version',
    (version) => {
      expect(parsePack(envelope({ version })).ok).toBe(false);
    },
  );

  it.each(['classes', 'ancestries', 'spells', 'items', 'talents', 'tables'])(
    'caps %s at MAX_ENTRIES_PER_ARRAY',
    (array) => {
      const entries = new Array(MAX_ENTRIES_PER_ARRAY + 1).fill({});
      expect(parsePack(envelope({ [array]: entries })).ok).toBe(false);
      expect(parsePack(envelope({ [array]: entries.slice(0, MAX_ENTRIES_PER_ARRAY) })).ok).toBe(
        true,
      );
    },
  );

  it('caps extends at its own constant', () => {
    const extensions = new Array(MAX_EXTENDS_PER_PACK + 1).fill({});
    expect(parsePack(envelope({ extends: extensions })).ok).toBe(false);
    expect(parsePack(envelope({ extends: extensions.slice(0, MAX_EXTENDS_PER_PACK) })).ok).toBe(
      true,
    );
  });

  it.each(['spells', 'extends'])('refuses %s that is not an array', (array) => {
    expect(parsePack(envelope({ [array]: { length: 1 } })).ok).toBe(false);
    expect(parsePack(envelope({ [array]: 'none' })).ok).toBe(false);
  });
});

describe('the leaves every entry is built from', () => {
  it('reports an id inside a pack bare, never namespaced', () => {
    expect(EntryId.safeParse('hoarfrost').success).toBe(true);
    expect(EntryId.safeParse('frostbound:hoarfrost').success).toBe(false);
    expect(EntryId.safeParse('a'.repeat(ENTRY_ID_MAX_LENGTH + 1)).success).toBe(false);
  });

  it('reads a cross-pack reference in its full three-part form', () => {
    expect(Ref.safeParse('core:class:wizard').success).toBe(true);
    expect(Ref.safeParse('core:class').success).toBe(false);
    expect(Ref.safeParse('core:class:wizard:extra').success).toBe(false);
  });

  it('accepts a pack id on its own, without a kind or an id after it', () => {
    expect(PackId.safeParse('core').success).toBe(true);
    expect(PackId.safeParse('core:class:wizard').success).toBe(false);
  });

  it('leaves text optional and bounded wherever it appears', () => {
    // DESIGN.md §5 — core ships without `text`, and that is what makes the licensing
    // position work. A schema that required it would make core unrepresentable.
    expect(EntryText.safeParse(undefined).success).toBe(true);
    expect(EntryText.safeParse(null).success).toBe(true);
    expect(EntryText.safeParse('t'.repeat(MAX_TEXT_LENGTH)).success).toBe(true);
    expect(EntryText.safeParse('t'.repeat(MAX_TEXT_LENGTH + 1)).success).toBe(false);
  });

  it('takes a page reference as a page number or nothing', () => {
    expect(PageReference.safeParse(53).success).toBe(true);
    expect(PageReference.safeParse(null).success).toBe(true);
    expect(PageReference.safeParse(undefined).success).toBe(true);
    expect(PageReference.safeParse(0).success).toBe(false);
    expect(PageReference.safeParse(MAX_PAGE_NUMBER + 1).success).toBe(false);
    expect(PageReference.safeParse('53').success).toBe(false);
  });

  it('takes an override as a full reference to the thing being replaced', () => {
    expect(Overrides.safeParse('core:spell:fireball').success).toBe(true);
    expect(Overrides.safeParse(undefined).success).toBe(true);
    expect(Overrides.safeParse('fireball').success).toBe(false);
  });

  it('requires a name and bounds it', () => {
    expect(EntryName.safeParse('Hoarfrost').success).toBe(true);
    expect(EntryName.safeParse('').success).toBe(false);
    expect(EntryName.safeParse('n'.repeat(MAX_NAME_LENGTH)).success).toBe(true);
    expect(EntryName.safeParse('n'.repeat(MAX_NAME_LENGTH + 1)).success).toBe(false);
  });
});

describe('the report', () => {
  it('gives a path and an expectation for every problem, ready to paste', () => {
    const result = parsePack(envelope({ id: 'Frostbound', version: 'v1' }));
    if (result.ok) throw new Error('expected the pack to be refused');

    const report = formatProblems(result.problems);
    expect(result.problems.map((problem) => problem.path)).toEqual(['id', 'version']);
    expect(report.split('\n')).toHaveLength(2);
  });
});
