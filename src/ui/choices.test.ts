// What a picker offers, and what a row is called once something has been picked.
//
// The interesting cases are all about *which* pack answered: two packs that both name a
// Skald, a spell list narrowed by a class, and a reference whose pack went off. None of
// them needs React, which is why they are tested here rather than through a component.

import { describe, expect, it } from 'vitest';
import type { Pack } from '../model/pack';
import { parsePack, reportProblems } from '../model/pack';
import { resolvePacks } from '../model/pack-resolver';
import { displayName, isFromPack, offer, sheetChoices, spellTier, talentWords } from './choices';

function pack(fields: Record<string, unknown>): Pack {
  const result = parsePack({ format: 'lantern-pack', formatVersion: 1, version: '1.0.0', ...fields });
  if (!result.ok) throw new Error(reportProblems(result.problems, String(fields['id'])));

  return result.pack;
}

const CORE = pack({
  id: 'core',
  name: 'Core',
  ancestries: [{ id: 'human', name: 'Human' }],
  classes: [
    { id: 'wizard', name: 'Wizard', hitDie: 'd4', weapons: [], armor: ['none'], talentTable: 'wizard-talents' },
    { id: 'thief', name: 'Thief', hitDie: 'd4', weapons: [], armor: ['none'], talentTable: 'thief-talents' },
  ],
  items: [{ id: 'torch', name: 'Torch', slots: 1, cost: { amount: 5, currency: 'sp' } }],
  spells: [
    { id: 'light', name: 'Light', tier: 1, classes: ['wizard'], range: 'near', duration: 'focus' },
    { id: 'mend', name: 'Mend', tier: 2, classes: ['core:priest'], range: 'close', duration: 'instant' },
  ],
  // No `text`, which is what core actually ships (DESIGN.md §5): a name and a page.
  talents: [
    { id: 'grit', name: 'Grit', page: 27 },
    { id: 'nimble', name: 'Nimble' },
  ],
  extends: [{ target: 'core:class:wizard', talents: ['grit', 'nimble'] }],
});

const FROSTBOUND = pack({
  id: 'frostbound',
  name: 'Frostbound',
  classes: [
    {
      id: 'rimewalker',
      name: 'Rimewalker',
      hitDie: 'd6',
      weapons: [],
      armor: ['none'],
      spellcasting: { stat: 'wis', highestTierByLevel: [1, 2] },
      talentTable: 'rimewalker-talents',
    },
    // The same word as a core class, from another pack. Not a collision (DESIGN.md §5).
    { id: 'wizard', name: 'Wizard', hitDie: 'd4', weapons: [], armor: ['none'], talentTable: 'ice-talents' },
  ],
  spells: [
    { id: 'hoarfrost', name: 'Hoarfrost', tier: 2, classes: ['rimewalker'], range: 'near', duration: 'focus' },
  ],
  // The same word as a core talent, from another pack — a Skald problem, not a collision.
  talents: [
    { id: 'cold-forged', name: 'Cold-forged', text: 'Weather never counts against you.' },
    { id: 'grit', name: 'Grit', text: 'You shrug off the cold.' },
  ],
  extends: [
    { target: 'core:class:wizard', talents: ['cold-forged', 'grit'] },
    // A reference no pack defines. The resolver warns and the class keeps it; a picker
    // has no words to copy from it, so it is not offered (PRD.md principle 4).
    { target: 'frostbound:class:rimewalker', talents: ['thaw'] },
  ],
});

/** A pack whose items say which of them burn, and one that plainly does not. */
const LAMPS = pack({
  id: 'lamps',
  name: 'Lamps',
  items: [
    { id: 'storm-torch', name: 'Storm torch', slots: 1, cost: { amount: 2, currency: 'gp' }, light: { minutes: 90 } },
    { id: 'bastard-sword', name: 'Bastard sword', slots: 1, cost: { amount: 10, currency: 'gp' } },
    { id: 'lantern', name: 'Lantern', slots: 1, cost: { amount: 5, currency: 'gp' }, light: { minutes: 60 } },
  ],
});

const BOTH = resolvePacks([CORE, FROSTBOUND]);
const ONLY_CORE = resolvePacks([CORE]);
const NOTHING = resolvePacks([]);

describe('the options a picker offers', () => {
  it('is what the loaded packs hold, in load order', () => {
    expect(sheetChoices(BOTH, null).classes.map((choice) => choice.ref)).toEqual([
      'core:class:wizard',
      'core:class:thief',
      'frostbound:class:rimewalker',
      'frostbound:class:wizard',
    ]);
  });

  it('is empty with no packs loaded, so the field falls back to a box to type in', () => {
    const choices = sheetChoices(NOTHING, null);

    expect(choices.ancestries).toEqual([]);
    expect(choices.classes).toEqual([]);
    expect(choices.items).toEqual([]);
    expect(choices.spells).toEqual([]);
    expect(choices.talents).toEqual([]);
  });

  it('names the pack only where two entries share a word', () => {
    const labels = sheetChoices(BOTH, null).classes.map((choice) => choice.label);

    expect(labels).toEqual(['Wizard (Core)', 'Thief', 'Rimewalker', 'Wizard (Frostbound)']);
  });

  it('leaves a unique name alone', () => {
    expect(offer(ONLY_CORE.classes).map((choice) => choice.label)).toEqual(['Wizard', 'Thief']);
  });
});

describe('the spells a picker offers', () => {
  it('is the chosen class\'s list, because a spell names its classes', () => {
    expect(sheetChoices(BOTH, 'core:class:wizard').spells.map((choice) => choice.label)).toEqual([
      'Light',
    ]);
  });

  it('follows the class across packs', () => {
    expect(
      sheetChoices(BOTH, 'frostbound:class:rimewalker').spells.map((choice) => choice.label),
    ).toEqual(['Hoarfrost']);
  });

  it('offers everything loaded when no class is chosen', () => {
    expect(sheetChoices(BOTH, null).spells).toHaveLength(3);
  });

  it('offers everything loaded when the class is from a pack that is off', () => {
    expect(sheetChoices(ONLY_CORE, 'frostbound:class:rimewalker').spells).toHaveLength(2);
  });
});

describe('the talents a picker offers', () => {
  it('is what extensions gave the chosen class, and only that class', () => {
    expect(sheetChoices(ONLY_CORE, 'core:class:wizard').talents.map((choice) => choice.ref)).toEqual(
      ['core:talent:grit', 'core:talent:nimble'],
    );
    expect(sheetChoices(ONLY_CORE, 'core:class:thief').talents).toEqual([]);
  });

  it('is empty for a character with no class, rather than every talent loaded', () => {
    // Unlike spells: a talent reaches a class because an extension named it, so an
    // unchosen class has been offered nothing. The free-text row records the rest.
    expect(sheetChoices(BOTH, null).talents).toEqual([]);
  });

  it('is empty for a class from a pack that is off', () => {
    expect(sheetChoices(ONLY_CORE, 'frostbound:class:rimewalker').talents).toEqual([]);
  });

  it('names the pack where a supplement adds a talent core already named', () => {
    const labels = sheetChoices(BOTH, 'core:class:wizard').talents.map((choice) => choice.label);

    expect(labels).toEqual(['Grit (Core)', 'Nimble', 'Cold-forged', 'Grit (Frostbound)']);
  });

  it('drops a talent no loaded pack defines, and calls it neither an error nor a gap', () => {
    const stack = resolvePacks([CORE, FROSTBOUND]);

    expect(stack.byRef.get('frostbound:class:rimewalker')).toMatchObject({
      talents: ['frostbound:talent:thaw'],
    });
    expect(sheetChoices(stack, 'frostbound:class:rimewalker').talents).toEqual([]);
    expect(stack.warnings.some((warning) => warning.message.includes('frostbound:talent:thaw'))).toBe(
      true,
    );
  });
});

describe('the words picking a talent puts on the sheet', () => {
  it('is the entry\'s text when it has some', () => {
    expect(talentWords(BOTH, 'frostbound:talent:cold-forged')).toBe(
      'Weather never counts against you.',
    );
  });

  it('is the name and the page when it has none, which is the core case', () => {
    expect(talentWords(BOTH, 'core:talent:grit')).toBe('Grit (p. 27)');
  });

  it('is the name alone when there is no page either, and never an empty paragraph', () => {
    expect(talentWords(BOTH, 'core:talent:nimble')).toBe('Nimble');
  });

  it('is nothing at all for a reference that is not a talent a pack answers for', () => {
    expect(talentWords(BOTH, 'core:item:torch')).toBe('');
    expect(talentWords(ONLY_CORE, 'frostbound:talent:cold-forged')).toBe('');
    expect(talentWords(BOTH, null)).toBe('');
  });
});

describe('the lights a picker offers', () => {
  it('is the items that say they give light, and not the sword beside them', () => {
    const choices = sheetChoices(resolvePacks([LAMPS]), null);

    expect(choices.lights.map((choice) => choice.label)).toEqual(['Storm torch', 'Lantern']);
    expect(choices.items).toHaveLength(3);
  });

  it('keeps load order, so turning a pack on never reshuffles the list', () => {
    const choices = sheetChoices(resolvePacks([CORE, LAMPS]), null);

    // Core's torch says nothing about light, so it is not on the list — but the two
    // that do are still in the order the stack holds them.
    expect(choices.lights.map((choice) => choice.label)).toEqual(['Storm torch', 'Lantern']);
  });

  it('offers every item while nothing loaded says anything about light', () => {
    const choices = sheetChoices(ONLY_CORE, null);

    // A homebrew torch in a pack written before the block existed is still a torch, and
    // an unpickable one would be the app losing content (PRD.md principle 4).
    expect(choices.lights).toEqual(choices.items);
    expect(choices.lights.map((choice) => choice.label)).toEqual(['Torch']);
  });

  it('is empty with no packs loaded, so the field falls back to a box to type in', () => {
    expect(sheetChoices(NOTHING, null).lights).toEqual([]);
  });
});

describe('what a row is called', () => {
  it('is the pack\'s word while a pack answers, whatever the row carries', () => {
    expect(displayName(BOTH, 'core:item:torch', '')).toBe('Torch');
    expect(displayName(BOTH, 'core:item:torch', 'Stub of a torch')).toBe('Torch');
  });

  it('is the player\'s own words when nothing references anything', () => {
    expect(displayName(BOTH, null, 'Silvered dagger')).toBe('Silvered dagger');
  });

  it('is the reference itself when the pack is off and there are no words', () => {
    expect(displayName(ONLY_CORE, 'frostbound:class:rimewalker', '')).toBe(
      'frostbound:class:rimewalker',
    );
  });

  it('keeps the player\'s words over a reference that no longer resolves', () => {
    expect(displayName(ONLY_CORE, 'frostbound:item:rimeblade', 'My blade')).toBe('My blade');
  });
});

describe('what a pack answers for', () => {
  it('is a reference a loaded pack defines, and nothing else', () => {
    expect(isFromPack(BOTH, 'core:item:torch')).toBe(true);
    expect(isFromPack(ONLY_CORE, 'frostbound:class:rimewalker')).toBe(false);
    expect(isFromPack(BOTH, null)).toBe(false);
  });

  it('gives a spell its tier, and gives a row that is not a spell none', () => {
    expect(spellTier(BOTH, 'core:spell:mend')).toBe(2);
    expect(spellTier(BOTH, 'core:item:torch')).toBeNull();
    expect(spellTier(ONLY_CORE, 'frostbound:spell:hoarfrost')).toBeNull();
    expect(spellTier(BOTH, null)).toBeNull();
  });
});
