// A pack arrives from another peer, so the envelope is a security boundary before it is
// anything else (DATA-MODEL.md §10). The tests come in the two halves that implies: what
// an honest author must be able to load, and what a hostile file must not get past.
//
// `FROSTBOUND` is the envelope from DATA-MODEL.md §1, copied exactly. If the doc and the
// schema ever disagree, this file fails — the only way a written contract stays honest.

import { describe, expect, it } from 'vitest';
import {
  AncestryEntry,
  ClassEntry,
  EntryId,
  EntryName,
  EntryRef,
  EntryText,
  ItemEntry,
  Overrides,
  Pack,
  PackExtension,
  PackId,
  PageReference,
  Ref,
  SpellEntry,
  TableEntry,
  TalentEntry,
  formatProblems,
  parsePack,
  reportProblems,
} from './pack';
import {
  ENTRY_ID_MAX_LENGTH,
  MAX_ARMOR_AC,
  MAX_CHARACTER_LEVEL,
  MAX_COIN,
  MAX_ENTRIES_PER_ARRAY,
  MAX_EXTENDS_PER_PACK,
  MAX_NAME_LENGTH,
  MAX_PACK_ITEM_SLOTS,
  MAX_PAGE_NUMBER,
  MAX_TABLE_DIE_COUNT,
  MAX_TABLE_ROLL,
  MAX_TABLE_ROWS,
  MAX_TAGS_PER_ENTRY,
  MAX_TALENT_REFS_PER_EXTENSION,
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

/**
 * One of each, copied from DATA-MODEL.md §§3-8 exactly the way `FROSTBOUND` copies §1.
 * These are what an author reading the document would write, so a schema that refuses
 * one of them has broken the contract rather than tightened it.
 */
const SPELL = {
  id: 'hoarfrost',
  name: 'Hoarfrost',
  tier: 2,
  classes: ['wizard', 'frostbound:rimewalker'],
  range: 'near',
  duration: 'focus',
  text: 'Optional. Present only in packs, never in core.',
  page: 53,
} as const;

const ITEM = {
  id: 'rimeblade',
  name: 'Rimeblade',
  slots: 1,
  cost: { amount: 90, currency: 'gp' },
  weapon: {
    type: 'melee',
    damage: '1d8',
    properties: ['versatile'],
  },
  armor: null,
  text: 'Optional.',
  page: null,
} as const;

const CLASS = {
  id: 'rimewalker',
  name: 'Rimewalker',
  hitDie: 'd6',
  weapons: ['core:item:dagger', 'core:item:staff'],
  armor: ['none'],
  spellcasting: {
    stat: 'wis',
    highestTierByLevel: [1, 1, 2, 2, 3, 3, 4, 4, 5, 5],
  },
  talentTable: 'rimewalker-talents',
  text: 'Optional.',
  page: null,
} as const;

const ANCESTRY = {
  id: 'frostborn',
  name: 'Frostborn',
  talent: 'Optional text describing the ancestry knack.',
  page: null,
} as const;

const TALENT = {
  id: 'frost-affinity',
  name: 'Frost affinity',
  text: 'Optional. Present only in packs, never in core.',
  page: 27,
} as const;

const TABLE = {
  id: 'rimewalker-talents',
  name: 'Rimewalker talents',
  die: '2d6',
  rerollable: false,
  rows: [
    { roll: 2, text: 'Choose a talent or +2 to a stat' },
    { roll: [3, 6], text: '+1 to melee and ranged attacks' },
    { roll: [7, 9], text: '+2 to your spellcasting checks' },
    { roll: [10, 11], text: '+1 to a stat of your choice' },
    { roll: 12, text: 'Choose any talent' },
  ],
} as const;

/** DATA-MODEL.md §9's two extensions, copied the same way. */
const EXTENSION = {
  target: 'core:class:wizard',
  talents: ['frostbound:frost-affinity'],
} as const;

const ROW_EXTENSION = {
  target: 'core:table:loot-minor',
  rows: [{ roll: [19, 20], text: 'A rimeblade' }],
} as const;

/** Which fixture belongs in which array, for the tests that walk every array. */
const SAMPLE: Record<string, unknown> = {
  classes: CLASS,
  ancestries: ANCESTRY,
  spells: SPELL,
  items: ITEM,
  tables: TABLE,
  talents: TALENT,
  extends: EXTENSION,
};

/** An entry with one field replaced, or — when the value is `undefined` — removed. */
function entry(base: Record<string, unknown>, over: Record<string, unknown> = {}): unknown {
  const merged: Record<string, unknown> = { ...base, ...over };
  for (const [key, value] of Object.entries(over)) {
    if (value === undefined) delete merged[key];
  }
  return merged;
}

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
      // Filled with a valid entry rather than `{}`: since #20 the arrays are described,
      // so `{}` would now fail on its own missing fields and the test would stop
      // proving anything about the count.
      const entries = new Array(MAX_ENTRIES_PER_ARRAY + 1).fill(SAMPLE[array]);
      expect(parsePack(envelope({ [array]: entries })).ok).toBe(false);
      expect(parsePack(envelope({ [array]: entries.slice(0, MAX_ENTRIES_PER_ARRAY) })).ok).toBe(
        true,
      );
    },
  );

  it('caps extends at its own constant', () => {
    const extensions = new Array(MAX_EXTENDS_PER_PACK + 1).fill(EXTENSION);
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

  // DATA-MODEL.md §10 prints these two lines. They are produced here rather than written
  // by hand, so the document and the validator cannot drift apart.
  it('writes §10\'s line for a value outside an enum', () => {
    const spells = [SPELL, SPELL, SPELL, SPELL, { ...SPELL, range: 'medium' }];
    const result = parsePack(envelope({ spells }));
    if (result.ok) throw new Error('expected the pack to be refused');

    expect(formatProblems(result.problems)).toBe(
      '  spells[4].range — expected one of: self, close, near, far — got "medium"',
    );
  });

  it('writes §10\'s line for a field that is not there', () => {
    const spells = [...Array(7).fill(SPELL), { ...SPELL, tier: undefined }];
    const result = parsePack(envelope({ spells }));
    if (result.ok) throw new Error('expected the pack to be refused');

    expect(formatProblems(result.problems)).toBe('  spells[7] — missing required field: tier');
  });

  it('says every shape a value could have taken, on one line', () => {
    const tables = [{ ...TABLE, rows: [{ roll: 'seven', text: 'A rimeblade' }] }];
    const result = parsePack(envelope({ tables }));
    if (result.ok) throw new Error('expected the pack to be refused');

    expect(formatProblems(result.problems)).toBe(
      '  tables[0].rows[0].roll — expected a number or a list — got "seven"',
    );
  });

  it('heads the block with the pack the paths belong to', () => {
    const result = parsePack(envelope({ id: 'Frostbound', version: 'v1' }));
    if (result.ok) throw new Error('expected the pack to be refused');

    expect(reportProblems(result.problems, FROSTBOUND.name)).toContain(
      '2 problems in "Frostbound":',
    );
  });

  it('never says only that the pack is invalid', () => {
    // Six ways to be wrong at once, none of which may come back as a bare refusal.
    const result = parsePack(
      envelope({
        id: 'Frostbound',
        version: 'v1',
        onLoad: 'alert(1)',
        spells: [{ ...SPELL, range: 'medium', tier: 9 }],
        tables: [{ ...TABLE, rows: [{ roll: 'seven', text: 'A rimeblade' }] }],
      }),
    );
    if (result.ok) throw new Error('expected the pack to be refused');

    for (const problem of result.problems) {
      expect(problem.message).not.toBe('Invalid input');
      expect(problem.message).toMatch(/^(expected|missing|unknown)/u);
    }
    expect(result.problems.length).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------
// The entries. DATA-MODEL.md §§3-9.
// ---------------------------------------------------------------------------

describe('spells', () => {
  it('accepts the spell from DATA-MODEL.md §3 unchanged', () => {
    expect(SpellEntry.safeParse(SPELL).success).toBe(true);
  });

  it.each(['id', 'name', 'tier', 'classes', 'range', 'duration'])(
    'refuses a spell missing %s',
    (field) => {
      expect(SpellEntry.safeParse(entry(SPELL, { [field]: undefined })).success).toBe(false);
    },
  );

  it.each(['text', 'page'])('leaves %s absent or null', (field) => {
    expect(SpellEntry.safeParse(entry(SPELL, { [field]: undefined })).success).toBe(true);
    expect(SpellEntry.safeParse(entry(SPELL, { [field]: null })).success).toBe(true);
  });

  it('takes the five tiers and nothing either side of them', () => {
    for (const tier of [1, 2, 3, 4, 5]) {
      expect(SpellEntry.safeParse(entry(SPELL, { tier })).success).toBe(true);
    }
    for (const tier of [0, 6, '2', 2.5, null]) {
      expect(SpellEntry.safeParse(entry(SPELL, { tier })).success).toBe(false);
    }
  });

  it('matches range and duration exactly', () => {
    // "medium" is DATA-MODEL.md §10's own worked example of a rejected value.
    expect(SpellEntry.safeParse(entry(SPELL, { range: 'medium' })).success).toBe(false);
    expect(SpellEntry.safeParse(entry(SPELL, { range: 'Near' })).success).toBe(false);
    expect(SpellEntry.safeParse(entry(SPELL, { duration: 'concentration' })).success).toBe(false);
    expect(SpellEntry.safeParse(entry(SPELL, { duration: 'permanent' })).success).toBe(true);
  });

  it('names classes bare within a pack and in full across packs', () => {
    expect(SpellEntry.safeParse(entry(SPELL, { classes: ['wizard'] })).success).toBe(true);
    expect(SpellEntry.safeParse(entry(SPELL, { classes: ['core:class:wizard'] })).success).toBe(
      true,
    );
    expect(SpellEntry.safeParse(entry(SPELL, { classes: ['Wizard'] })).success).toBe(false);
    expect(SpellEntry.safeParse(entry(SPELL, { classes: 'wizard' })).success).toBe(false);
  });

  it('caps the class list and allows it to be empty', () => {
    const many = new Array(MAX_TAGS_PER_ENTRY + 1).fill('wizard');
    expect(SpellEntry.safeParse(entry(SPELL, { classes: many })).success).toBe(false);
    expect(SpellEntry.safeParse(entry(SPELL, { classes: [] })).success).toBe(true);
  });

  it('adds a spell to an existing class with no extends at all', () => {
    // The point of the spell owning its class list (DATA-MODEL.md §3): a four-spell pack
    // for the wizard is four entries and no extension.
    const result = parsePack({
      format: 'lantern-pack',
      formatVersion: 1,
      id: 'four-spells',
      name: 'Four spells',
      version: '1.0.0',
      spells: [entry(SPELL, { classes: ['core:class:wizard'] })],
    });
    expect(result.ok).toBe(true);
  });

  it('refuses an unknown key on a spell', () => {
    expect(SpellEntry.safeParse(entry(SPELL, { grants: '+1 str' })).success).toBe(false);
  });
});

describe('items', () => {
  it('accepts the item from DATA-MODEL.md §4 unchanged', () => {
    expect(ItemEntry.safeParse(ITEM).success).toBe(true);
  });

  it.each(['id', 'name', 'slots', 'cost'])('refuses an item missing %s', (field) => {
    expect(ItemEntry.safeParse(entry(ITEM, { [field]: undefined })).success).toBe(false);
  });

  it('lets a thing be weightless and caps what one of it costs to carry', () => {
    expect(ItemEntry.safeParse(entry(ITEM, { slots: 0 })).success).toBe(true);
    expect(ItemEntry.safeParse(entry(ITEM, { slots: MAX_PACK_ITEM_SLOTS })).success).toBe(true);
    expect(ItemEntry.safeParse(entry(ITEM, { slots: MAX_PACK_ITEM_SLOTS + 1 })).success).toBe(
      false,
    );
    expect(ItemEntry.safeParse(entry(ITEM, { slots: -1 })).success).toBe(false);
    expect(ItemEntry.safeParse(entry(ITEM, { slots: 0.5 })).success).toBe(false);
  });

  it('quotes a cost in one of the three coins', () => {
    for (const currency of ['gp', 'sp', 'cp']) {
      expect(ItemEntry.safeParse(entry(ITEM, { cost: { amount: 1, currency } })).success).toBe(
        true,
      );
    }
    expect(ItemEntry.safeParse(entry(ITEM, { cost: { amount: 1, currency: 'ep' } })).success).toBe(
      false,
    );
    expect(ItemEntry.safeParse(entry(ITEM, { cost: { amount: 0, currency: 'gp' } })).success).toBe(
      true,
    );
    expect(
      ItemEntry.safeParse(entry(ITEM, { cost: { amount: MAX_COIN + 1, currency: 'gp' } })).success,
    ).toBe(false);
    expect(ItemEntry.safeParse(entry(ITEM, { cost: '90gp' })).success).toBe(false);
  });

  it.each(['weapon', 'armor'])('leaves the %s block absent or null', (block) => {
    expect(ItemEntry.safeParse(entry(ITEM, { [block]: undefined })).success).toBe(true);
    expect(ItemEntry.safeParse(entry(ITEM, { [block]: null })).success).toBe(true);
  });

  it('reads the armour block DATA-MODEL.md §4 shows', () => {
    const armor = { type: 'light', ac: 12, addDex: true };
    expect(ItemEntry.safeParse(entry(ITEM, { weapon: null, armor })).success).toBe(true);
    expect(
      ItemEntry.safeParse(entry(ITEM, { armor: { ...armor, ac: MAX_ARMOR_AC + 1 } })).success,
    ).toBe(false);
    expect(ItemEntry.safeParse(entry(ITEM, { armor: { ...armor, type: 'plate' } })).success).toBe(
      false,
    );
    expect(ItemEntry.safeParse(entry(ITEM, { armor: { ...armor, addDex: 'yes' } })).success).toBe(
      false,
    );
    expect(ItemEntry.safeParse(entry(ITEM, { armor: { type: 'light', ac: 12 } })).success).toBe(
      false,
    );
  });

  it.each(['1d8', 'd6', '2d6', '1d4/1d8', '1d100'])('takes %s as damage', (damage) => {
    expect(ItemEntry.safeParse(entry(ITEM, { weapon: { ...ITEM.weapon, damage } })).success).toBe(
      true,
    );
  });

  it.each(['1d8 + level/2', '1d7', '1d8+1', 'd8/1d10/2d6', '', 'a lot', '<script>'])(
    'refuses %s as damage — it is a notation, never a formula',
    (damage) => {
      expect(ItemEntry.safeParse(entry(ITEM, { weapon: { ...ITEM.weapon, damage } })).success).toBe(
        false,
      );
    },
  );

  it('keeps weapon properties as tags rather than a sentence', () => {
    const weapon = ITEM.weapon;
    expect(ItemEntry.safeParse(entry(ITEM, { weapon: { ...weapon, properties: [] } })).success).toBe(
      true,
    );
    expect(
      ItemEntry.safeParse(entry(ITEM, { weapon: { ...weapon, properties: ['two-handed'] } }))
        .success,
    ).toBe(true);
    expect(
      ItemEntry.safeParse(entry(ITEM, { weapon: { ...weapon, properties: ['Versatile, thrown'] } }))
        .success,
    ).toBe(false);
  });

  it('matches the weapon type exactly', () => {
    for (const type of ['melee', 'ranged', 'both']) {
      expect(ItemEntry.safeParse(entry(ITEM, { weapon: { ...ITEM.weapon, type } })).success).toBe(
        true,
      );
    }
    expect(
      ItemEntry.safeParse(entry(ITEM, { weapon: { ...ITEM.weapon, type: 'thrown' } })).success,
    ).toBe(false);
  });

  it('refuses an unknown key on an item and inside its blocks', () => {
    expect(ItemEntry.safeParse(entry(ITEM, { magical: true })).success).toBe(false);
    expect(
      ItemEntry.safeParse(entry(ITEM, { weapon: { ...ITEM.weapon, bonus: 1 } })).success,
    ).toBe(false);
  });
});

describe('classes', () => {
  it('accepts the class from DATA-MODEL.md §5 unchanged', () => {
    expect(ClassEntry.safeParse(CLASS).success).toBe(true);
  });

  it.each(['id', 'name', 'hitDie', 'weapons', 'armor', 'talentTable'])(
    'refuses a class missing %s',
    (field) => {
      expect(ClassEntry.safeParse(entry(CLASS, { [field]: undefined })).success).toBe(false);
    },
  );

  it('takes a single die as the hit die, never a notation', () => {
    expect(ClassEntry.safeParse(entry(CLASS, { hitDie: 'd8' })).success).toBe(true);
    expect(ClassEntry.safeParse(entry(CLASS, { hitDie: '2d6' })).success).toBe(false);
    expect(ClassEntry.safeParse(entry(CLASS, { hitDie: 'd7' })).success).toBe(false);
    expect(ClassEntry.safeParse(entry(CLASS, { hitDie: 6 })).success).toBe(false);
  });

  it('names weapons bare within a pack and in full across packs', () => {
    expect(ClassEntry.safeParse(entry(CLASS, { weapons: ['dagger'] })).success).toBe(true);
    expect(ClassEntry.safeParse(entry(CLASS, { weapons: ['core:item:dagger'] })).success).toBe(
      true,
    );
    expect(ClassEntry.safeParse(entry(CLASS, { weapons: ['all simple weapons'] })).success).toBe(
      false,
    );
    const many = new Array(MAX_TAGS_PER_ENTRY + 1).fill('dagger');
    expect(ClassEntry.safeParse(entry(CLASS, { weapons: many })).success).toBe(false);
  });

  it('lists armour it may wear from the enum and nothing else', () => {
    expect(ClassEntry.safeParse(entry(CLASS, { armor: ['none', 'light', 'shield'] })).success).toBe(
      true,
    );
    expect(ClassEntry.safeParse(entry(CLASS, { armor: [] })).success).toBe(true);
    expect(ClassEntry.safeParse(entry(CLASS, { armor: ['plate'] })).success).toBe(false);
  });

  it('holds a non-caster as null and a caster as the block', () => {
    expect(ClassEntry.safeParse(entry(CLASS, { spellcasting: null })).success).toBe(true);
    expect(ClassEntry.safeParse(entry(CLASS, { spellcasting: undefined })).success).toBe(true);
    expect(
      ClassEntry.safeParse(
        entry(CLASS, { spellcasting: { stat: 'int', highestTierByLevel: [1] } }),
      ).success,
    ).toBe(true);
  });

  it('bounds the spellcasting block to one tier per level', () => {
    const tiers = new Array(MAX_CHARACTER_LEVEL + 1).fill(1);
    expect(
      ClassEntry.safeParse(entry(CLASS, { spellcasting: { stat: 'wis', highestTierByLevel: tiers } }))
        .success,
    ).toBe(false);
    expect(
      ClassEntry.safeParse(
        entry(CLASS, { spellcasting: { stat: 'wis', highestTierByLevel: [1, 6] } }),
      ).success,
    ).toBe(false);
    expect(
      ClassEntry.safeParse(
        entry(CLASS, { spellcasting: { stat: 'luck', highestTierByLevel: [1] } }),
      ).success,
    ).toBe(false);
  });

  it('names its talent table bare or in full', () => {
    expect(ClassEntry.safeParse(entry(CLASS, { talentTable: 'core:table:wizard-talents' })).success).toBe(
      true,
    );
    expect(ClassEntry.safeParse(entry(CLASS, { talentTable: 'Wizard talents' })).success).toBe(
      false,
    );
  });

  it('refuses an unknown key on a class', () => {
    expect(ClassEntry.safeParse(entry(CLASS, { xpTable: [10, 20] })).success).toBe(false);
  });
});

describe('ancestries', () => {
  it('accepts the ancestry from DATA-MODEL.md §6 unchanged', () => {
    expect(AncestryEntry.safeParse(ANCESTRY).success).toBe(true);
  });

  it.each(['id', 'name'])('refuses an ancestry missing %s', (field) => {
    expect(AncestryEntry.safeParse(entry(ANCESTRY, { [field]: undefined })).success).toBe(false);
  });

  it('leaves the talent absent or null — core ships without it', () => {
    expect(AncestryEntry.safeParse(entry(ANCESTRY, { talent: undefined })).success).toBe(true);
    expect(AncestryEntry.safeParse(entry(ANCESTRY, { talent: null })).success).toBe(true);
    expect(
      AncestryEntry.safeParse(entry(ANCESTRY, { talent: 't'.repeat(MAX_TEXT_LENGTH + 1) })).success,
    ).toBe(false);
  });

  it('takes a page reference in place of the words', () => {
    expect(AncestryEntry.safeParse(entry(ANCESTRY, { talent: null, page: 21 })).success).toBe(true);
    expect(AncestryEntry.safeParse(entry(ANCESTRY, { page: MAX_PAGE_NUMBER + 1 })).success).toBe(
      false,
    );
  });

  it('refuses an unknown key on an ancestry', () => {
    expect(AncestryEntry.safeParse(entry(ANCESTRY, { statBonus: 'str' })).success).toBe(false);
  });
});

describe('talents', () => {
  it('accepts the talent from DATA-MODEL.md §7 unchanged', () => {
    expect(TalentEntry.safeParse(TALENT).success).toBe(true);
  });

  it.each(['id', 'name'])('refuses a talent missing %s', (field) => {
    expect(TalentEntry.safeParse(entry(TALENT, { [field]: undefined })).success).toBe(false);
  });

  it('takes a page reference in place of the words, the way core ships', () => {
    expect(TalentEntry.safeParse(entry(TALENT, { text: undefined })).success).toBe(true);
    expect(TalentEntry.safeParse(entry(TALENT, { text: null })).success).toBe(true);
    expect(TalentEntry.safeParse(entry(TALENT, { text: null, page: undefined })).success).toBe(
      true,
    );
    expect(
      TalentEntry.safeParse(entry(TALENT, { text: 't'.repeat(MAX_TEXT_LENGTH + 1) })).success,
    ).toBe(false);
  });

  // The reason the entry exists: an extension names a talent by id, so a talent must be
  // a thing with an id rather than only ever a row of words on a table (DATA-MODEL.md §7).
  it('is named by an extension exactly as its own id is written', () => {
    expect(TalentEntry.safeParse(entry(TALENT, { id: 'frost-affinity' })).success).toBe(true);
    expect(
      PackExtension.safeParse({
        target: 'core:class:wizard',
        talents: ['frostbound:frost-affinity'],
      }).success,
    ).toBe(true);
  });

  /**
   * 🚫 The field the format does not have, on the entry an author is most likely to try
   * putting it on. A talent is recorded, never applied (PRD.md principle 1), and a pack
   * that ships `grants` is told so rather than having it silently dropped — which is the
   * same promise `TableRow` makes, tested the same way.
   */
  it('refuses a talent that tries to grant something', () => {
    expect(TalentEntry.safeParse(entry(TALENT, { grants: { attack: 1 } })).success).toBe(false);
    expect(TalentEntry.safeParse(entry(TALENT, { classes: ['core:class:fighter'] })).success).toBe(
      false,
    );
  });
});

describe('tables', () => {
  it('accepts the table from DATA-MODEL.md §8 unchanged', () => {
    expect(TableEntry.safeParse(TABLE).success).toBe(true);
  });

  it.each(['id', 'name', 'die', 'rows'])('refuses a table missing %s', (field) => {
    expect(TableEntry.safeParse(entry(TABLE, { [field]: undefined })).success).toBe(false);
  });

  it.each(['2d6', '1d20', 'd100', 'd4', `${MAX_TABLE_DIE_COUNT}d10`])(
    'reads %s as the die a table is rolled on',
    (die) => {
      expect(TableEntry.safeParse(entry(TABLE, { die })).success).toBe(true);
    },
  );

  it.each(['d7', '3', '2 d6', 'd', 'two d6', `${MAX_TABLE_DIE_COUNT + 1}d10`, 'd20+1'])(
    'refuses %s as a die',
    (die) => {
      expect(TableEntry.safeParse(entry(TABLE, { die })).success).toBe(false);
    },
  );

  it('treats an absent rerollable as false rather than refusing the table', () => {
    const absent = TableEntry.safeParse(entry(TABLE, { rerollable: undefined }));
    if (!absent.success) throw new Error('expected a table with no rerollable to load');
    expect(absent.data.rerollable).toBe(false);

    const explicit = TableEntry.safeParse(entry(TABLE, { rerollable: true }));
    if (!explicit.success) throw new Error('expected rerollable: true to load');
    expect(explicit.data.rerollable).toBe(true);

    const nulled = TableEntry.safeParse(entry(TABLE, { rerollable: null }));
    if (!nulled.success) throw new Error('expected a null rerollable to load');
    expect(nulled.data.rerollable).toBe(false);
  });

  it('takes a roll as one face or an inclusive band of them', () => {
    const rows = (roll: unknown): unknown => entry(TABLE, { rows: [{ roll, text: 'A result' }] });
    expect(TableEntry.safeParse(rows(7)).success).toBe(true);
    expect(TableEntry.safeParse(rows([3, 6])).success).toBe(true);
    expect(TableEntry.safeParse(rows([4, 4])).success).toBe(true);
    expect(TableEntry.safeParse(rows([6, 3])).success).toBe(false);
    expect(TableEntry.safeParse(rows([1, 2, 3])).success).toBe(false);
    expect(TableEntry.safeParse(rows([3])).success).toBe(false);
    expect(TableEntry.safeParse(rows('3-6')).success).toBe(false);
    expect(TableEntry.safeParse(rows(0)).success).toBe(false);
    expect(TableEntry.safeParse(rows(2.5)).success).toBe(false);
    expect(TableEntry.safeParse(rows(MAX_TABLE_ROLL + 1)).success).toBe(false);
  });

  it('requires every row to say something, and caps how many there are', () => {
    expect(TableEntry.safeParse(entry(TABLE, { rows: [{ roll: 1, text: '' }] })).success).toBe(
      false,
    );
    expect(TableEntry.safeParse(entry(TABLE, { rows: [{ roll: 1 }] })).success).toBe(false);
    expect(TableEntry.safeParse(entry(TABLE, { rows: [] })).success).toBe(true);

    const rows = new Array(MAX_TABLE_ROWS + 1).fill({ roll: 1, text: 'A result' });
    expect(TableEntry.safeParse(entry(TABLE, { rows })).success).toBe(false);
    expect(TableEntry.safeParse(entry(TABLE, { rows: rows.slice(0, MAX_TABLE_ROWS) })).success).toBe(
      true,
    );
  });

  it('has no grants field on a row, and refuses one', () => {
    // PRD.md principle 1 — a result is recorded, never applied. Applying one needs an
    // effects engine, which PRD.md §4 defers indefinitely. A pack that ships `grants` is
    // told so rather than having the field quietly ignored.
    const granting = entry(TABLE, {
      rows: [{ roll: 1, text: '+1 to melee attacks', grants: { str: 1 } }],
    });
    const result = TableEntry.safeParse(granting);
    expect(result.success).toBe(false);
    expect(Object.keys(TableEntry.shape.rows.element.shape)).toEqual(['roll', 'text']);
  });

  it('leaves gaps and overlaps to the lookup rather than refusing the pack', () => {
    // PRD.md principle 4 — a table missing a row for 7 still answers for everything
    // else. Coverage is `model/tables.ts`; this schema only says the rows are well formed.
    const gapped = entry(TABLE, {
      rows: [
        { roll: [2, 6], text: 'The low half' },
        { roll: [8, 12], text: 'The high half' },
      ],
    });
    expect(TableEntry.safeParse(gapped).success).toBe(true);

    const overlapping = entry(TABLE, {
      rows: [
        { roll: [2, 8], text: 'One' },
        { roll: [6, 12], text: 'Another' },
      ],
    });
    expect(TableEntry.safeParse(overlapping).success).toBe(true);
  });

  it('refuses an unknown key on a table', () => {
    expect(TableEntry.safeParse(entry(TABLE, { d: 6 })).success).toBe(false);
  });
});

describe('extensions', () => {
  it('parses both of the extensions DATA-MODEL.md §9 writes', () => {
    expect(PackExtension.safeParse(EXTENSION).success).toBe(true);
    expect(PackExtension.safeParse(ROW_EXTENSION).success).toBe(true);
  });

  it('takes a target in the full form only, where no field implies a kind', () => {
    expect(PackExtension.safeParse({ target: 'core:class:wizard' }).success).toBe(true);
    expect(PackExtension.safeParse({ target: 'core:wizard' }).success).toBe(false);
    expect(PackExtension.safeParse({ target: 'wizard' }).success).toBe(false);
    expect(PackExtension.safeParse({ talents: ['gift'] }).success).toBe(false);
  });

  it('adds talents in any of the three forms an entry may write', () => {
    const bare = 'frost-affinity';
    const forms = [bare, `frostbound:${bare}`, `frostbound:talent:${bare}`];
    expect(PackExtension.safeParse({ ...EXTENSION, talents: forms }).success).toBe(true);
  });

  it('refuses a row an extension adds that a table would have refused', () => {
    const rows = [{ roll: [20, 19], text: 'Backwards' }];
    expect(PackExtension.safeParse({ ...ROW_EXTENSION, rows }).success).toBe(false);
    expect(PackExtension.safeParse({ ...ROW_EXTENSION, rows: [{ roll: 1 }] }).success).toBe(false);
  });

  it('caps what one extension may add', () => {
    const talents = new Array(MAX_TALENT_REFS_PER_EXTENSION + 1).fill('gift');
    const rows = new Array(MAX_TABLE_ROWS + 1).fill({ roll: 1, text: 'A thing' });
    expect(PackExtension.safeParse({ ...EXTENSION, talents }).success).toBe(false);
    expect(PackExtension.safeParse({ ...ROW_EXTENSION, rows }).success).toBe(false);
  });

  it('refuses a field that would edit an entry rather than add to it', () => {
    expect(PackExtension.safeParse({ ...EXTENSION, name: 'Wizard, better' }).success).toBe(false);
    expect(PackExtension.safeParse({ ...EXTENSION, remove: ['core:spell:light'] }).success).toBe(
      false,
    );
  });
});

describe('an entry inside a pack', () => {
  it('reports its problem with the array, the index and the field', () => {
    const result = parsePack(envelope({ spells: [entry(SPELL, { range: 'medium' })] }));
    if (result.ok) throw new Error('expected the pack to be refused');
    expect(result.problems.map((problem) => problem.path)).toEqual(['spells[0].range']);
  });

  it('accepts one of everything, as a pack an author would actually write', () => {
    const result = parsePack(
      envelope({
        classes: [CLASS],
        ancestries: [ANCESTRY],
        spells: [SPELL],
        items: [ITEM],
        talents: [TALENT],
        tables: [TABLE],
      }),
    );
    if (!result.ok) throw new Error(`expected the pack to load:\n${formatProblems(result.problems)}`);
    expect(result.pack.spells?.[0]?.name).toBe('Hoarfrost');
  });

  it('lets any entry declare what it overrides, and only in the full form', () => {
    const overriding = entry(SPELL, { overrides: 'core:spell:fireball' });
    expect(SpellEntry.safeParse(overriding).success).toBe(true);
    expect(SpellEntry.safeParse(entry(SPELL, { overrides: 'fireball' })).success).toBe(false);
    expect(ItemEntry.safeParse(entry(ITEM, { overrides: 'core:item:sword' })).success).toBe(true);
    expect(ClassEntry.safeParse(entry(CLASS, { overrides: 'core:class:wizard' })).success).toBe(
      true,
    );
    expect(
      AncestryEntry.safeParse(entry(ANCESTRY, { overrides: 'core:ancestry:dwarf' })).success,
    ).toBe(true);
    expect(TableEntry.safeParse(entry(TABLE, { overrides: 'core:table:loot' })).success).toBe(true);
    expect(
      TalentEntry.safeParse(entry(TALENT, { overrides: 'core:talent:grit' })).success,
    ).toBe(true);
  });
});

describe('a reference from one entry to another', () => {
  it('reads all three forms DATA-MODEL.md writes references in', () => {
    // §5 writes a class's talent table bare and its weapons in full; §3 writes a spell's
    // class as `pack:id`, with the kind implied by the field. A schema that refused any
    // of the three would refuse a pack copied out of the document.
    expect(EntryRef.safeParse('rimewalker-talents').success).toBe(true);
    expect(EntryRef.safeParse('frostbound:rimewalker').success).toBe(true);
    expect(EntryRef.safeParse('core:table:rimewalker-talents').success).toBe(true);
  });

  it('stops at three segments, and admits no character an id would reject', () => {
    expect(EntryRef.safeParse('core:table:talents:extra').success).toBe(false);
    expect(EntryRef.safeParse('Rimewalker Talents').success).toBe(false);
    expect(EntryRef.safeParse('core:').success).toBe(false);
    expect(EntryRef.safeParse('').success).toBe(false);
  });

  it('keeps a sheet reference exact, where no field implies a kind', () => {
    expect(Ref.safeParse('core:class:wizard').success).toBe(true);
    expect(Ref.safeParse('frostbound:rimewalker').success).toBe(false);
  });
});
