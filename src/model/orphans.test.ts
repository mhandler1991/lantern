// Turning a pack off must never destroy a character (PRD.md principle 4, DESIGN.md §5),
// and there are three moments where it could: the moment it goes off, the reload that
// follows while it is still off, and the moment it comes back. Every test here is one of
// those three, and every one of them asserts that the rows are still there.
//
// The packs are built through `parsePack` rather than hand-typed, for the reason
// `pack-resolver.test.ts` gives: a fixture the schema would refuse proves nothing. The
// characters go through `parseCharacter` for the same reason — and because a sheet that
// came back off disk with a pack missing is exactly the reload case.

import { describe, expect, it } from 'vitest';
import type { Character } from './character';
import { parseCharacter, reportProblems as reportCharacter } from './character';
import { orphanReport, packOfRef, packsResolvedFrom, updatePacksUsed } from './orphans';
import { parsePack, reportProblems, type Pack } from './pack';
import { resolvePacks } from './pack-resolver';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function loaded(fields: Record<string, unknown>): Pack {
  const result = parsePack({
    format: 'lantern-pack',
    formatVersion: 1,
    version: '1.0.0',
    ...fields,
  });
  if (!result.ok) throw new Error(reportProblems(result.problems, String(fields['name'])));

  return result.pack;
}

const torch = (overrides: Record<string, unknown> = {}) => ({
  id: 'torch',
  name: 'Torch',
  slots: 1,
  cost: { amount: 5, currency: 'sp' },
  ...overrides,
});

const CORE = loaded({
  id: 'core',
  name: 'Core',
  items: [torch()],
  ancestries: [{ id: 'human', name: 'Human' }],
  tables: [
    {
      id: 'thief-talents',
      name: 'Thief talents',
      die: 'd12',
      rows: [{ roll: [2, 12], text: 'A knack' }],
    },
  ],
});

const FROSTBOUND = loaded({
  id: 'frostbound',
  name: 'Frostbound',
  items: [{ id: 'rimeblade', name: 'Rimeblade', slots: 1, cost: { amount: 40, currency: 'gp' } }],
  ancestries: [{ id: 'thawborn', name: 'Thawborn' }],
  spells: [
    {
      id: 'hoarfrost',
      name: 'Hoarfrost',
      tier: 1,
      classes: ['core:wizard'],
      range: 'near',
      duration: 'instant',
    },
  ],
});

/** Frostbound as a supplement that replaces a core item rather than adding one. */
const OVERRIDING = loaded({
  id: 'frostbound',
  name: 'Frostbound',
  items: [torch({ id: 'longer-torch', name: 'Torch', slots: 1, overrides: 'core:item:torch' })],
});

/** A sheet built with Frostbound: an ancestry, an item, a spell and a talent from it. */
const SHEET: unknown = {
  format: 'lantern-character',
  formatVersion: 2,
  id: 'c_vess',
  name: 'Vess',
  ancestry: { ref: 'frostbound:ancestry:thawborn', name: '' },
  class: { ref: null, name: 'Thief' },
  alignment: null,
  level: 1,
  xp: 0,
  stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  hp: { current: 5, max: 5 },
  luck: 0,
  gold: { gp: 0, sp: 0, cp: 0 },
  items: [
    { id: 'r_blade', ref: 'frostbound:item:rimeblade', name: '', slots: 0, qty: 1, equipped: true },
    { id: 'r_rope', ref: null, name: 'Rope', slots: 1, qty: 1, equipped: false },
  ],
  spells: [{ id: 'r_frost', ref: 'frostbound:spell:hoarfrost', name: '' }],
  talents: [
    {
      id: 'r_talent',
      text: 'Your torch burns a quarter longer than anyone else born to the ice',
      source: 'frostbound:table:thawborn-talents',
      rolled: 5,
    },
  ],
  lights: [{ id: 'r_torch', ref: 'core:item:torch', name: '', litAt: null, minutes: 60 }],
  conditions: [],
  journal: [],
  quests: [],
  packsUsed: ['core', 'frostbound'],
};

/** The sheet as it comes off disk or out of a file — the path a reload takes. */
function sheet(overrides: Record<string, unknown> = {}): Character {
  const result = parseCharacter({ ...(SHEET as Record<string, unknown>), ...overrides });
  if (!result.ok) throw new Error(reportCharacter(result.problems, 'the fixture'));

  return result.character;
}

/** Loaded, and nothing on the sheet points at it. The case a stale record is dropped in. */
const CURSED_SCROLL = loaded({
  id: 'cursed-scroll',
  name: 'Cursed Scroll',
  items: [{ id: 'quill', name: 'Quill', slots: 1, cost: { amount: 1, currency: 'sp' } }],
});

const BOTH = resolvePacks([CORE, FROSTBOUND]);
const CORE_ONLY = resolvePacks([CORE]);
const NOTHING = resolvePacks([]);

// ---------------------------------------------------------------------------

describe('a pack that is on', () => {
  it('orphans nothing it answers for', () => {
    const report = orphanReport(sheet(), BOTH);

    expect(report.rows.size).toBe(0);
    expect(report.isAncestryOrphaned).toBe(false);
    expect(report.missingPacks).toEqual([]);
  });

  it('never orphans a row the player typed in, whatever is loaded', () => {
    expect(orphanReport(sheet(), NOTHING).rows.has('r_rope')).toBe(false);
  });
});

describe('turning a pack off', () => {
  const report = orphanReport(sheet(), CORE_ONLY);

  it('keeps every row and marks the ones the pack answered for', () => {
    const after = sheet();

    expect(after.items).toHaveLength(2);
    expect(after.spells).toHaveLength(1);
    expect(report.rows.has('r_blade')).toBe(true);
    expect(report.rows.has('r_frost')).toBe(true);
    expect(report.isAncestryOrphaned).toBe(true);
  });

  it('leaves the rows another loaded pack still answers for alone', () => {
    expect(report.rows.has('r_torch')).toBe(false);
    expect(report.rows.has('r_rope')).toBe(false);
  });

  it('names the pack to turn back on', () => {
    expect(report.missingPacks).toEqual(['frostbound']);
  });

  it('leaves the talent working, because it stored its words rather than a reference', () => {
    const after = sheet();
    const [talent] = after.talents;

    expect(talent?.text).toContain('born to the ice');
    expect(report.rows.has('r_talent')).toBe(false);
  });

  it('warns about a pack that only ever contributed a talent table', () => {
    // Nothing on this sheet resolves through Frostbound any more — the only trace it
    // left is the talent's `source`, and that is what `packsUsed` is for.
    const talentOnly = sheet({
      ancestry: { ref: null, name: 'Thawborn' },
      items: [],
      spells: [],
    });

    expect(orphanReport(talentOnly, CORE_ONLY).missingPacks).toEqual(['frostbound']);
    expect(orphanReport(talentOnly, CORE_ONLY).rows.size).toBe(0);
  });

  it('warns when the pack that is off had been overriding something', () => {
    // The sheet points at `core:item:torch` and core is still on, so nothing is orphaned
    // — but what that reference means changed when the supplement went off, and the only
    // record of that is `packsUsed`.
    const stamped = updatePacksUsed(sheet({ packsUsed: [] }), resolvePacks([CORE, OVERRIDING]));

    expect(stamped.packsUsed).toContain('frostbound');
    expect(orphanReport(stamped, CORE_ONLY).missingPacks).toEqual(['frostbound']);
  });
});

describe('reloading while a pack is off', () => {
  it('parses the sheet back with every reference intact', () => {
    const after = sheet();

    expect(after.items.map((item) => item.ref)).toEqual(['frostbound:item:rimeblade', null]);
    expect(after.ancestry.ref).toBe('frostbound:ancestry:thawborn');
    expect(after.packsUsed).toEqual(['core', 'frostbound']);
  });

  it('reports the same thing it reported before the reload', () => {
    expect(orphanReport(sheet(), CORE_ONLY).missingPacks).toEqual(['frostbound']);
  });

  it('keeps a recorded pack that is not loaded, rather than deciding it is unused', () => {
    // The whole point: an edit made while Frostbound is off must not quietly drop it
    // from the record, or the warning would disappear on the next keystroke.
    const edited = updatePacksUsed(sheet({ name: 'Vess of the Low Road' }), CORE_ONLY);

    expect(edited.packsUsed).toContain('frostbound');
  });

  it('drops a recorded pack that is loaded and answers for nothing', () => {
    // Loaded and contributing nothing is the one case the app can actually judge, so it
    // is the only case a record is dropped in: the warning stays true rather than
    // naming packs the player stopped using.
    const stack = resolvePacks([CORE, FROSTBOUND, CURSED_SCROLL]);
    const recorded = { packsUsed: ['core', 'frostbound', 'cursed-scroll'] };
    const unused = updatePacksUsed(sheet(recorded), stack);

    expect(unused.packsUsed).not.toContain('cursed-scroll');
    expect(unused.packsUsed).toContain('frostbound');
  });

  it('keeps a recorded pack it cannot check, because nothing loaded can answer for it', () => {
    const recorded = { packsUsed: ['core', 'frostbound', 'cursed-scroll'] };
    const unknown = updatePacksUsed(sheet(recorded), BOTH);

    expect(unknown.packsUsed).toContain('cursed-scroll');
  });

  it('returns the character untouched when the record was already right', () => {
    const before = sheet();

    expect(updatePacksUsed(before, BOTH)).toBe(before);
  });
});

describe('turning the pack back on', () => {
  it('restores every row to full behaviour', () => {
    const report = orphanReport(sheet(), BOTH);

    expect(report.rows.size).toBe(0);
    expect(report.isAncestryOrphaned).toBe(false);
    expect(report.isClassOrphaned).toBe(false);
    expect(report.missingPacks).toEqual([]);
  });

  it('resolves the reference to the pack that answers for it again', () => {
    expect(BOTH.byRef.has('frostbound:item:rimeblade')).toBe(true);
    expect(orphanReport(sheet(), CORE_ONLY).rows.has('r_blade')).toBe(true);
  });
});

describe('the record of what a sheet depends on', () => {
  it('names the pack every reference points at', () => {
    expect(packsResolvedFrom(sheet(), BOTH)).toEqual(['frostbound', 'core']);
  });

  it('names the pack that won a reference as well as the one it points at', () => {
    const stack = resolvePacks([CORE, OVERRIDING]);
    const lightOnly = sheet({
      ancestry: { ref: null, name: '' },
      items: [],
      spells: [],
      talents: [],
    });

    expect(packsResolvedFrom(lightOnly, stack)).toEqual(['core', 'frostbound']);
  });

  it('reads the pack off a reference', () => {
    expect(packOfRef('frostbound:item:rimeblade')).toBe('frostbound');
  });
});
