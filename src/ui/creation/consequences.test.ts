// What going back leaves standing. These are the silent-wrong-answer half of issue #36
// (CLAUDE.md §7): a flag that never appears loses a player's spells quietly, and a flag
// that appears when nothing changed teaches them to ignore the list.
//
// Every fixture is built through `parsePack`, like the resolver's own tests: a stack
// assembled by hand could hold a shape no real pack file can produce.

import { describe, expect, it } from 'vitest';
import { MAX_FLAG_EXCERPT } from '../../constants';
import type { Character } from '../../model/character';
import type { Pack } from '../../model/pack';
import { parsePack, reportProblems } from '../../model/pack';
import type { ResolvedStack } from '../../model/pack-resolver';
import { resolvePacks } from '../../model/pack-resolver';
import { newSpell, newTalent, rolledTalent } from '../../state/character-edits';
import { createCharacter } from '../../state/new-character';
import { flagged, flagsFor, hasFlags, stepsFlagged } from './consequences';

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

/**
 * One pack with the two shapes that matter: a class that casts and a class that does
 * not, each with its own talent list and its own table.
 */
const CORE = loaded({
  id: 'core',
  name: 'Core',
  classes: [
    {
      id: 'wizard',
      name: 'Wizard',
      hitDie: 'd4',
      weapons: ['dagger'],
      armor: ['none'],
      spellcasting: { stat: 'int', highestTierByLevel: [1, 1, 2] },
      talentTable: 'wizard-talents',
    },
    {
      id: 'fighter',
      name: 'Fighter',
      hitDie: 'd8',
      weapons: ['dagger'],
      armor: ['light'],
      talentTable: 'fighter-talents',
    },
  ],
  spells: [
    { id: 'spark', name: 'Spark', tier: 1, classes: ['core:wizard'], range: 'near', duration: 'instant' },
    { id: 'ward', name: 'Ward', tier: 1, classes: ['core:wizard'], range: 'self', duration: 'instant' },
    { id: 'blessing', name: 'Blessing', tier: 1, classes: ['core:priest'], range: 'near', duration: 'instant' },
  ],
  items: [{ id: 'dagger', name: 'Dagger', slots: 1, cost: { amount: 5, currency: 'gp' } }],
  talents: [
    { id: 'arcane-knack', name: 'Arcane knack' },
    { id: 'shield-wall', name: 'Shield wall' },
  ],
  tables: [
    { id: 'wizard-talents', name: 'Wizard talents', die: '2d6', rows: [{ roll: [2, 12], text: 'Something' }] },
    { id: 'fighter-talents', name: 'Fighter talents', die: '2d6', rows: [{ roll: [2, 12], text: 'Something' }] },
  ],
  extends: [
    { target: 'core:class:wizard', talents: ['arcane-knack'] },
    { target: 'core:class:fighter', talents: ['shield-wall'] },
  ],
});

const STACK: ResolvedStack = resolvePacks([CORE]);
const EMPTY: ResolvedStack = resolvePacks([]);

function withClass(reference: string | null, name = ''): Character {
  const character = createCharacter('c_flags');
  return { ...character, class: { ref: reference, name } };
}

/** A wizard who learned two of the wizard's spells, the way the picker writes them. */
function wizardWithSpells(): Character {
  const character = withClass('core:class:wizard');
  return {
    ...character,
    spells: [
      { ...newSpell(), ref: 'core:spell:spark' },
      { ...newSpell(), ref: 'core:spell:ward' },
    ],
  };
}

describe('what no longer follows from an earlier answer', () => {
  it('flags nothing while the answers still agree', () => {
    const flags = flagged(wizardWithSpells(), STACK);

    expect(flags).toEqual([]);
    expect(hasFlags(flags)).toBe(false);
  });

  // The case the whole module exists for: step 2 changed, step 7 did not.
  it('flags every spell when the class chosen instead does not cast', () => {
    const wizard = wizardWithSpells();
    const fighter: Character = { ...wizard, class: { ref: 'core:class:fighter', name: '' } };

    const flags = flagged(fighter, STACK);

    expect(flags.map((flag) => flag.what)).toEqual(['Spark', 'Ward']);
    expect(flags.every((flag) => flag.step === 'spells')).toBe(true);
    expect(flags[0]?.why).toContain('Fighter');
    // The rows are still on the sheet. Nothing here returns a character at all.
    expect(fighter.spells).toHaveLength(2);
  });

  it('flags only the spells a casting class does not have on its list', () => {
    const wizard = wizardWithSpells();
    const strayed: Character = {
      ...wizard,
      spells: [...wizard.spells, { ...newSpell(), ref: 'core:spell:blessing' }],
    };

    const flags = flagged(strayed, STACK);

    expect(flags.map((flag) => flag.what)).toEqual(['Blessing']);
    expect(flags[0]?.why).toContain('Wizard');
  });

  it('flags a talent that came from a list this class is not offered', () => {
    const character: Character = {
      ...withClass('core:class:wizard'),
      talents: [
        newTalent('Arcane knack', 'core:talent:arcane-knack'),
        newTalent('Shield wall', 'core:talent:shield-wall'),
        rolledTalent('Something', 'core:table:fighter-talents', 7),
      ],
    };

    const flags = flagged(character, STACK);

    expect(flags.map((flag) => flag.what)).toEqual(['Shield wall', 'Something']);
    expect(flags.every((flag) => flag.step === 'talents')).toBe(true);
  });

  it('never flags a talent rolled on the class’s own table', () => {
    const character: Character = {
      ...withClass('core:class:wizard'),
      talents: [rolledTalent('Something', 'core:table:wizard-talents', 7)],
    };

    expect(flagged(character, STACK)).toEqual([]);
  });

  // PRD.md principle 6: a row the player typed in was never chosen from a list, so
  // there is no list it can have fallen off.
  it('never flags a row the player wrote themselves', () => {
    const character: Character = {
      ...withClass('core:class:fighter'),
      spells: [{ ...newSpell(), ref: null, name: 'Something they made up' }],
      talents: [newTalent('Something they made up')],
    };

    expect(flagged(character, STACK)).toEqual([]);
  });

  // PRD.md principle 4: turning a pack off degrades, and `model/orphans.ts` already
  // reports it. Saying it again in different words would read as a second problem.
  it('says nothing when the packs are simply off', () => {
    const wizard = wizardWithSpells();

    expect(flagged(wizard, EMPTY)).toEqual([]);
    expect(flagged({ ...wizard, class: { ref: null, name: 'Wizard' } }, STACK)).toEqual([]);
  });

  it('says nothing when the class resolves but the spell no longer does', () => {
    const character: Character = {
      ...withClass('core:class:fighter'),
      spells: [{ ...newSpell(), ref: 'gone:spell:whatever', name: 'Whatever' }],
    };

    expect(flagged(character, STACK)).toEqual([]);
  });

  it('names a talent in the space a line has, without reproducing it', () => {
    const long = 'w'.repeat(MAX_FLAG_EXCERPT * 2);
    const character: Character = {
      ...withClass('core:class:wizard'),
      talents: [newTalent(long, 'core:talent:shield-wall'), newTalent('  ', 'core:talent:shield-wall')],
    };

    const [first, second] = flagged(character, STACK);

    expect(first?.what.length).toBeLessThanOrEqual(MAX_FLAG_EXCERPT + 1);
    expect(first?.what.endsWith('…')).toBe(true);
    expect(second?.what).toContain('nothing written in it');
  });

  it('keys every flag on the row it is about, so a list of them is stable', () => {
    const wizard = wizardWithSpells();
    const fighter: Character = { ...wizard, class: { ref: 'core:class:fighter', name: '' } };

    const flags = flagged(fighter, STACK);

    expect(new Set(flags.map((flag) => flag.id)).size).toBe(flags.length);
    expect(flags.map((flag) => flag.id)).toEqual(fighter.spells.map((spell) => spell.id));
  });

  it('sorts findings into the steps that answer them', () => {
    const character: Character = {
      ...withClass('core:class:fighter'),
      spells: [{ ...newSpell(), ref: 'core:spell:spark' }],
      talents: [newTalent('Arcane knack', 'core:talent:arcane-knack')],
    };

    const flags = flagged(character, STACK);

    expect(stepsFlagged(flags)).toEqual(new Set(['talents', 'spells']));
    expect(flagsFor(flags, 'spells').map((flag) => flag.what)).toEqual(['Spark']);
    expect(flagsFor(flags, 'gear')).toEqual([]);
    // Talents come before spells, because the sequence does: the list is a route back.
    expect(flags[0]?.step).toBe('talents');
  });
});
