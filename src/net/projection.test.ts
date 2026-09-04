// The projection is a privacy boundary, so the test is about what is *absent*: nine
// fields go, and a sheet full of gold, journal entries and gear produces none of them.
//
// Two halves. The first is the projection itself — the nine fields, and what each of
// them is built from. The second, below, is the boundary walked exhaustively: every
// field of `Character` classified, and a sheet with something identifiable in every one
// of them encoded exactly as a peer would receive it, then searched for each thing that
// must not be in it. The classification is what makes the walk hold in future — a field
// added to the sheet fails that test until somebody says what happens to it on the wire.

import { describe, expect, it } from 'vitest';
import {
  CHARACTER_FORMAT,
  CHARACTER_FORMAT_VERSION,
  MAX_AC,
  PROTOCOL_VERSION,
  UNARMORED_AC,
} from '../constants';
import type { Light } from '../model/character';
import { Character } from '../model/character';
import type { ItemLookup } from '../model/derived';
import { createCharacter } from '../state/new-character';
import { samePublicCharacter, stateEvent, toPublicCharacter } from './projection';
import { encodeEvent, PublicCharacter } from './protocol';
import type { JsonValue } from './transport';
import { measureEventBytes } from './transport';

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

// ---------------------------------------------------------------------------
// The privacy boundary, walked field by field. Issue #44.
// ---------------------------------------------------------------------------

/**
 * How each field of a `Character` is allowed to appear on the wire. This map is the
 * test: `Character.shape` is compared against it, so a field added to the sheet
 * tomorrow fails here until somebody says which of these four it is — and three of the
 * four are checked below against a sheet that has something distinctive in every field.
 *
 *   - `value`  — travels as it stands.
 *   - `name`   — only the human-readable name inside it travels, never the ref.
 *   - `flag`   — reduced to a single number or boolean; nothing of the rows survives.
 *   - `none`   — does not leave this machine at all, in any form.
 */
type Exposure = 'value' | 'name' | 'flag' | 'none';

const EXPOSURE: Readonly<Record<keyof Character, Exposure>> = {
  name: 'value',
  level: 'value',
  hp: 'value',
  luck: 'value',
  conditions: 'value',

  ancestry: 'name',
  class: 'name',

  // Worn armour and the dexterity modifier become one number, `ac`; lit torches become
  // one boolean. No row and no score survives either reduction.
  items: 'flag',
  lights: 'flag',
  stats: 'flag',

  format: 'none',
  formatVersion: 'none',
  id: 'none',
  alignment: 'none',
  xp: 'none',
  gold: 'none',
  spells: 'none',
  talents: 'none',
  journal: 'none',
  quests: 'none',
  packsUsed: 'none',
};

/**
 * A sheet with something identifiable in every single field. Every private value is a
 * string nobody would write by accident or a number no public field can hold, so
 * "did this leave?" is answered by searching the encoded payload for it rather than by
 * trusting a shape assertion.
 */
const FULL: Character = {
  format: CHARACTER_FORMAT,
  formatVersion: CHARACTER_FORMAT_VERSION,

  id: 'c_privateidentifier',
  name: 'Vess of the Low Road',

  ancestry: { ref: 'privatepack:ancestry:privateancestryref', name: 'Elf' },
  class: { ref: 'privatepack:class:privateclassref', name: 'Thief' },
  alignment: 'chaotic',

  level: 3,
  xp: 9_871,

  stats: { str: 17, dex: 16, con: 15, int: 14, wis: 13, cha: 12 },
  hp: { current: 7, max: 11 },
  luck: 1,
  gold: { gp: 654_321, sp: 654_322, cp: 654_323 },

  items: [
    {
      id: 'r_privateitemrow',
      ref: 'privatepack:item:privateitemref',
      name: 'A private thing in a private sack',
      slots: 2,
      qty: 97,
      equipped: true,
    },
  ],
  spells: [
    { id: 'r_privatespellrow', ref: 'privatepack:spell:privatespellref', name: 'A private word' },
  ],
  talents: [
    {
      id: 'r_privatetalentrow',
      text: 'A private note the player wrote about a talent',
      source: 'privatepack:table:privatetalentref',
      rolled: 19,
    },
  ],
  lights: [
    {
      id: 'r_privatelightrow',
      ref: 'privatepack:item:privatelightref',
      name: 'A private lantern',
      litAt: 1_712_345_678,
      minutes: 61,
    },
  ],
  conditions: ['bleeding'],
  journal: [
    { id: 'r_privatejournalrow', at: 1_712_345_679, text: 'A private line of a private diary' },
  ],
  quests: [{ id: 'r_privatequestrow', text: 'A private errand', done: false }],

  packsUsed: ['privatepack'],
};

/** Every key name anywhere in a value, however deeply nested. */
function deepKeys(value: unknown): Set<string> {
  const keys = new Set<string>();

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const element of node) walk(element);
      return;
    }
    if (typeof node !== 'object' || node === null) return;

    for (const [key, child] of Object.entries(node)) {
      keys.add(key);
      walk(child);
    }
  };

  walk(value);
  return keys;
}

/** What actually goes down the wire: the event, encoded, exactly as a peer would read it. */
function wireOf(character: Character): { payload: JsonValue; text: string } {
  const encoded = encodeEvent(stateEvent(toPublicCharacter(character, NO_PACKS)));
  if (!encoded.ok) throw new Error(`the projection did not encode: ${encoded.rejection.message}`);

  return { payload: encoded.payload, text: JSON.stringify(encoded.payload) };
}

describe('what leaves the client', () => {
  it('classifies every field of the sheet, so a new one cannot be added silently', () => {
    // The point of this assertion: adding a field to `Character` fails here until
    // somebody has said what happens to it on the wire, and the tests below then hold
    // that answer to a sheet with the field filled in.
    expect(Object.keys(Character.shape).sort()).toEqual(Object.keys(EXPOSURE).sort());
  });

  it('puts only the nine public field names on the wire, at any depth', () => {
    const { payload } = wireOf(FULL);

    expect(deepKeys(payload)).toEqual(
      new Set([
        'v',
        't',
        'character',
        ...PUBLIC_FIELDS,
        // The two halves of `hp`, which is the only nested object there is.
        'current',
        'max',
      ]),
    );
  });

  it('sends no private value of a full sheet, in any form', () => {
    const { text } = wireOf(FULL);

    // Everything on the sheet that must not appear, as it would appear in JSON.
    // Two things are deliberately not searched for, both because they are small
    // integers a search cannot tell from a public one: `formatVersion`, which would
    // match the protocol version, and the stat scores, which would match the `ac` their
    // own dexterity modifier is folded into. Their absence is what the key walk above
    // and the exact payload below are for.
    const secrets = [
      FULL.id,
      FULL.format,
      FULL.ancestry.ref,
      FULL.class.ref,
      String(FULL.alignment),
      String(FULL.xp),
      ...Object.values(FULL.gold).map(String),
      ...FULL.items.flatMap((item) => [item.id, String(item.ref), item.name, String(item.qty)]),
      ...FULL.spells.flatMap((spell) => [spell.id, String(spell.ref), spell.name]),
      ...FULL.talents.flatMap((talent) => [
        talent.id,
        talent.text,
        String(talent.source),
        String(talent.rolled),
      ]),
      ...FULL.lights.flatMap((light) => [
        light.id,
        String(light.ref),
        light.name,
        String(light.litAt),
        String(light.minutes),
      ]),
      ...FULL.journal.flatMap((entry) => [entry.id, entry.text, String(entry.at)]),
      ...FULL.quests.flatMap((quest) => [quest.id, quest.text]),
      ...FULL.packsUsed,
    ];

    for (const secret of secrets) {
      expect(text, `"${secret}" left the client`).not.toContain(secret);
    }
  });

  it('is around 200 bytes, which is what makes broadcasting it on change affordable', () => {
    // DESIGN.md §2. The bound is loose on purpose — it is a guard against the
    // projection quietly growing a field, not a byte budget to tune against.
    expect(measureEventBytes(wireOf(FULL).payload)).toBeLessThan(400);
  });

  it('carries the sheet a peer is meant to see', () => {
    const { payload } = wireOf(FULL);

    expect(payload).toEqual({
      v: PROTOCOL_VERSION,
      t: 'state',
      character: {
        name: 'Vess of the Low Road',
        ancestry: 'Elf',
        className: 'Thief',
        level: 3,
        hp: { current: 7, max: 11 },
        // Unarmoured, plus this sheet's dexterity modifier. Computed, never read.
        ac: UNARMORED_AC + 3,
        conditions: ['bleeding'],
        carryingLight: true,
        luck: 1,
      },
    });
  });
});

describe('samePublicCharacter', () => {
  const base = toPublicCharacter(FULL, NO_PACKS);

  it('holds a projection equal to itself, and to a fresh copy of the same sheet', () => {
    expect(samePublicCharacter(base, base)).toBe(true);
    expect(samePublicCharacter(base, toPublicCharacter(FULL, NO_PACKS))).toBe(true);
  });

  it('sees a change in any one of the nine fields', () => {
    const changes: readonly PublicCharacter[] = [
      { ...base, name: 'Ash' },
      { ...base, ancestry: 'Dwarf' },
      { ...base, className: 'Wizard' },
      { ...base, level: base.level + 1 },
      { ...base, hp: { current: base.hp.current - 1, max: base.hp.max } },
      { ...base, hp: { current: base.hp.current, max: base.hp.max + 1 } },
      { ...base, ac: base.ac + 1 },
      { ...base, conditions: [] },
      { ...base, conditions: ['blinded'] },
      { ...base, conditions: [...base.conditions, 'blinded'] },
      { ...base, carryingLight: !base.carryingLight },
      { ...base, luck: base.luck + 1 },
    ];

    for (const changed of changes) {
      expect(samePublicCharacter(base, changed), JSON.stringify(changed)).toBe(false);
      expect(samePublicCharacter(changed, base), JSON.stringify(changed)).toBe(false);
    }
  });

  it('ignores everything the sheet changed that a peer cannot see', () => {
    // The whole reason the comparison exists: a journal entry being typed re-renders
    // the sheet on every keystroke, and none of those keystrokes is anyone else's
    // business or worth 200 bytes on the wire.
    const scribbling: Character = {
      ...FULL,
      gold: { gp: 1, sp: 2, cp: 3 },
      journal: [{ id: 'r_privatejournalrow', at: 2, text: 'a' }],
      xp: 1,
    };

    expect(samePublicCharacter(base, toPublicCharacter(scribbling, NO_PACKS))).toBe(true);
  });
});
