// DATA-MODEL.md §9 prints one line as the example of what the content screen shows:
//
//   Wizard = core (32 spells, 4 talents) + Frostbound (4 spells)
//
// These tests build that line out of the real resolver, so the sentence in the document
// is checked against the code that produces it rather than described twice.

import { describe, expect, it } from 'vitest';
import { PACK_FORMAT, PACK_FORMAT_VERSION } from '../constants';
import type { Pack } from '../model/pack';
import { parsePack } from '../model/pack';
import type { ResolvedStack } from '../model/pack-resolver';
import { resolvePacks } from '../model/pack-resolver';
import { describeContents, resolutionStack, stackLineText } from './content';

/** Parsed rather than cast: a fixture that would not load is not a fixture. */
function packOf(input: Record<string, unknown>): Pack {
  const parsed = parsePack({ format: PACK_FORMAT, formatVersion: PACK_FORMAT_VERSION, ...input });
  if (!parsed.ok) {
    throw new Error(parsed.problems.map((problem) => `${problem.path} — ${problem.message}`).join('\n'));
  }
  return parsed.pack;
}

const spell = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  tier: 1,
  duration: 'instant',
  range: 'near',
  classes: ['core:wizard'],
  ...extra,
});

const core = packOf({
  id: 'core',
  name: 'Core',
  version: '1.0.0',
  classes: [
    {
      id: 'wizard',
      name: 'Wizard',
      hitDie: 'd4',
      weapons: ['dagger'],
      armor: ['none'],
      talentTable: 'wizard-talents',
    },
  ],
  spells: [spell('burning-hands', 'Burning hands'), spell('magic-missile', 'Magic missile')],
  tables: [
    {
      id: 'loot-minor',
      name: 'Minor loot',
      die: 'd20',
      rows: [
        { roll: [1, 10], text: 'A copper ring' },
        { roll: [11, 20], text: 'A tallow candle' },
      ],
    },
  ],
  extends: [{ target: 'core:class:wizard', talents: ['arcane-focus'] }],
});

const frostbound = packOf({
  id: 'frostbound',
  name: 'Frostbound',
  version: '1.2.0',
  spells: [spell('hoarfrost', 'Hoarfrost'), spell('rime', 'Rime')],
  extends: [
    { target: 'core:class:wizard', talents: ['frost-affinity'] },
    { target: 'core:table:loot-minor', rows: [{ roll: 20, text: 'A rimeblade' }] },
  ],
});

const lineFor = (stack: ResolvedStack, name: string): string => {
  const found = resolutionStack(stack).find((line) => line.name === name);
  if (found === undefined) throw new Error(`nothing in the stack is called ${name}`);
  return stackLineText(found);
};

describe('the resolution stack', () => {
  it('names every pack that made a class what it is, in load order', () => {
    const stack = resolvePacks([core, frostbound]);

    // The example from DATA-MODEL.md §9, at this fixture's scale.
    expect(lineFor(stack, 'Wizard')).toBe(
      'Wizard = Core (2 spells, 1 talent) + Frostbound (2 spells, 1 talent)',
    );
  });

  it('counts a pack that only wrote spells, which never appears in `sources`', () => {
    // A spell names its classes, not the other way round (DATA-MODEL.md §3), so a pack
    // of four wizard spells writes no extension and the resolver records no contribution
    // for it. It still contributed.
    const spellsOnly = packOf({
      id: 'cursed-scroll',
      name: 'Cursed Scroll 1',
      version: '1.0.0',
      spells: [spell('shadow-bolt', 'Shadow bolt')],
    });
    const stack = resolvePacks([core, spellsOnly]);

    expect(lineFor(stack, 'Wizard')).toBe('Wizard = Core (2 spells, 1 talent) + Cursed Scroll 1 (1 spell)');
  });

  it('says nothing in brackets for a pack that only defined the entry', () => {
    const stack = resolvePacks([
      packOf({
        id: 'plain',
        name: 'Plain',
        version: '1.0.0',
        classes: [
          { id: 'fighter', name: 'Fighter', hitDie: 'd8', weapons: [], armor: [], talentTable: 'x' },
        ],
      }),
    ]);

    expect(lineFor(stack, 'Fighter')).toBe('Fighter = Plain');
  });

  it('marks the pack that replaced an entry', () => {
    const replacement = packOf({
      id: 'grim',
      name: 'Grim',
      version: '1.0.0',
      classes: [
        {
          id: 'wizard',
          name: 'Warlock',
          hitDie: 'd4',
          weapons: [],
          armor: [],
          talentTable: 'x',
          overrides: 'core:class:wizard',
        },
      ],
    });
    const stack = resolvePacks([core, replacement]);

    // The name is the replacement's, and both packs are still named: the line is the
    // history of the entry, not a snapshot of it.
    expect(lineFor(stack, 'Warlock')).toBe('Warlock = Core (2 spells, 1 talent) + Grim (replaces)');
  });

  it('counts a table by the rows that are actually on it', () => {
    const stack = resolvePacks([core, frostbound]);

    expect(lineFor(stack, 'Minor loot')).toBe('Minor loot = Core (2 rows) + Frostbound (1 row)');
  });

  it('counts an overridden table against the pack whose rows survived', () => {
    const replacement = packOf({
      id: 'grim',
      name: 'Grim',
      version: '1.0.0',
      tables: [
        {
          id: 'loot-minor',
          name: 'Grim loot',
          die: 'd20',
          rows: [{ roll: [1, 20], text: 'A rusted nail' }],
          overrides: 'core:table:loot-minor',
        },
      ],
    });
    const stack = resolvePacks([core, replacement]);

    // Core's two rows went with the definition that was replaced; one row is on the table.
    expect(lineFor(stack, 'Grim loot')).toBe('Grim loot = Core + Grim (replaces, 1 row)');
  });

  it('gives a line to every class and every table, and to nothing else', () => {
    const lines = resolutionStack(resolvePacks([core, frostbound]));

    expect(lines.map((line) => line.kind)).toEqual(['class', 'table']);
    expect(lines.map((line) => line.ref)).toEqual(['core:class:wizard', 'core:table:loot-minor']);
  });

  it('has nothing to show when no pack is loaded', () => {
    expect(resolutionStack(resolvePacks([]))).toEqual([]);
  });
});

describe('what a pack brought', () => {
  it('lists only the arrays the file actually has', () => {
    const stack = resolvePacks([core, frostbound]);
    const [ofCore, ofFrostbound] = stack.packs;

    expect(describeContents(ofCore?.counts ?? { classes: 0, ancestries: 0, spells: 0, items: 0, talents: 0, tables: 0, extensions: 0 }))
      .toBe('1 class, 2 spells, 1 table, 1 extension');
    expect(describeContents(ofFrostbound?.counts ?? { classes: 0, ancestries: 0, spells: 0, items: 0, talents: 0, tables: 0, extensions: 0 }))
      .toBe('2 spells, 2 extensions');
  });

  it('says so plainly when a pack carries nothing yet', () => {
    const stack = resolvePacks([packOf({ id: 'stub', name: 'Stub', version: '0.1.0' })]);

    expect(describeContents(stack.packs[0]?.counts ?? { classes: 1, ancestries: 0, spells: 0, items: 0, talents: 0, tables: 0, extensions: 0 }))
      .toBe('no content');
  });
});
