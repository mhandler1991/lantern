// What a picker offers, and what a row is called once something has been picked.
//
// The interesting cases are all about *which* pack answered: two packs that both name a
// Skald, a spell list narrowed by a class, and a reference whose pack went off. None of
// them needs React, which is why they are tested here rather than through a component.

import { describe, expect, it } from 'vitest';
import type { Pack } from '../model/pack';
import { parsePack, reportProblems } from '../model/pack';
import { resolvePacks } from '../model/pack-resolver';
import { displayName, isFromPack, offer, sheetChoices, spellTier } from './choices';

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
