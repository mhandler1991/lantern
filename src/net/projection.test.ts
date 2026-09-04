// The projection is a privacy boundary, so the test is about what is *absent*: nine
// fields go, and a sheet full of gold, journal entries and gear produces none of them.
//
// 📌 #44 owns the exhaustive version — every field of a full sheet, walked. This is the
// wall for the one projection #43 puts on the wire, in `hello`.

import { describe, expect, it } from 'vitest';
import { MAX_AC, UNARMORED_AC } from '../constants';
import type { Character, Light } from '../model/character';
import type { ItemLookup } from '../model/derived';
import { createCharacter } from '../state/new-character';
import { toPublicCharacter } from './projection';
import { PublicCharacter } from './protocol';

const NO_PACKS: ItemLookup = () => null;

const PUBLIC_FIELDS = [
  'name',
  'ancestry',
  'className',
  'level',
  'hp',
  'ac',
  'conditions',
  'carryingLight',
  'luck',
] as const;

describe('toPublicCharacter', () => {
  it('sends exactly the nine public fields and nothing else', () => {
    const character = createCharacter('c_vess', 'Vess of the Low Road');
    const projection = toPublicCharacter(character, NO_PACKS);

    expect(Object.keys(projection).sort()).toEqual([...PUBLIC_FIELDS].sort());
    expect(PublicCharacter.safeParse(projection).success).toBe(true);
  });

  it('leaves everything private on this machine', () => {
    const character = {
      ...createCharacter('c_vess', 'Vess of the Low Road'),
      gold: { gp: 500, sp: 0, cp: 0 },
      journal: [{ id: 'j1', at: 1, text: 'The stair went down further than it should have.' }],
      quests: [{ id: 'q1', text: 'Find the lantern', done: false }],
      packsUsed: ['core'],
    };

    const projection: Record<string, unknown> = { ...toPublicCharacter(character, NO_PACKS) };

    for (const field of ['gold', 'journal', 'quests', 'items', 'spells', 'talents', 'lights', 'xp', 'stats', 'id', 'packsUsed']) {
      expect(projection[field], `${field} left the client`).toBeUndefined();
    }
  });

  it('names ancestry and class in words, because the reader may not have the pack', () => {
    const character = createCharacter('c_vess', 'Vess');
    const projection = toPublicCharacter(
      {
        ...character,
        ancestry: { ref: 'core:ancestry:elf', name: 'Elf' },
        class: { ref: 'core:class:thief', name: 'Thief' },
      },
      NO_PACKS,
    );

    expect(projection.ancestry).toBe('Elf');
    expect(projection.className).toBe('Thief');
  });

  it('computes AC rather than reading it, and keeps it inside what the wire accepts', () => {
    const character = createCharacter('c_vess', 'Vess');

    expect(toPublicCharacter(character, NO_PACKS).ac).toBe(UNARMORED_AC);

    // A pack that answers with an absurd armour value is still a player who has to
    // appear in the party. Clamped, not refused (PRD.md principle 4).
    const absurd: ItemLookup = () => ({
      slots: 1,
      armor: { type: 'medium', ac: 10_000, addDex: false },
    });
    const armored: Character = {
      ...character,
      items: [
        { id: 'i1', ref: 'core:item:plate', name: 'Plate', qty: 1, slots: 1, equipped: true },
      ],
    };

    expect(toPublicCharacter(armored, absurd).ac).toBe(MAX_AC);
  });

  it('reports a light that is burning', () => {
    const character = createCharacter('c_vess', 'Vess');
    const torch: Light = { id: 'l1', ref: null, name: 'Torch', litAt: null, minutes: 60 };

    expect(toPublicCharacter({ ...character, lights: [torch] }, NO_PACKS).carryingLight).toBe(
      false,
    );
    expect(
      toPublicCharacter({ ...character, lights: [{ ...torch, litAt: 1 }] }, NO_PACKS)
        .carryingLight,
    ).toBe(true);
  });
});
