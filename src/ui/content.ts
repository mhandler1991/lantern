/**
 * The resolution stack as a sentence. DATA-MODEL.md §8:
 *
 * ```
 * Wizard = core (32 spells, 4 talents) + Frostbound (4 spells)
 * ```
 *
 * That line is the one thing a DM needs from the content screen that nothing else in the
 * app can tell them: *which pack put this here*. A list of loaded packs says what is on;
 * this says what it did. When a class picks up a talent nobody recognises, this is the
 * line that names the pack to turn off.
 *
 * It is `sources` on a resolved entry, rendered — plus one thing `sources` cannot carry.
 * **A spell names its classes, not the other way round** (DATA-MODEL.md §3), so a pack
 * that adds four wizard spells writes no extension at all and never appears in the
 * class's `sources`. Its contribution is a query (`spellsForClass`), which is why the
 * count is computed here rather than read off the resolver.
 *
 * Only classes and tables get a line, because they are the only two kinds anything can
 * be *added* to. A spell or an item that was replaced is a one-pack story and it is
 * already told: `resolvePacks` warns on every override, and the content screen prints
 * those warnings above this list.
 *
 * Pure, and no React. The component renders each line as a text node like every other
 * string that came out of a pack (CLAUDE.md §2.6).
 */

import type { PackId, Ref } from '../model/pack';
import type {
  EntrySource,
  PackSummary,
  ResolvedClass,
  ResolvedStack,
  ResolvedTable,
} from '../model/pack-resolver';
import { spellsForClass } from '../model/pack-resolver';

/** Nothing added. A floor, not a business rule. */
const NONE = 0;

/** The one count that takes a singular noun. */
const ONE = 1;

/** What one pack did to one entry. `parts` is empty for a pack that only defined it. */
export type StackContribution = {
  readonly packId: PackId;
  readonly packName: string;
  readonly parts: readonly string[];
};

/** One entry, and every pack that made it what it is, in load order. */
export type StackLine = {
  readonly ref: Ref;
  readonly kind: 'class' | 'table';
  readonly name: string;
  readonly contributions: readonly StackContribution[];
};

/**
 * `1 spell`, `32 spells`, `4 ancestries`. A count nobody can read as a plural is a count
 * read twice, and English will not let the `s` be assumed — `ancestrys` and `classs` are
 * why the plural is a parameter rather than a suffix.
 */
function count(amount: number, singular: string, plural = `${singular}s`): string {
  return `${amount} ${amount === ONE ? singular : plural}`;
}

/** One pack's sources against one entry, gathered while its first appearance is kept. */
type Gathered = {
  readonly packId: PackId;
  readonly packName: string;
  hasOverridden: boolean;
  talents: number;
  rows: number;
};

/**
 * Sources by pack, in the order each pack first contributed. A pack that both defines a
 * class and extends it — core defines the wizard and adds its talents in the same file —
 * is one entry in the list and one bracket in the line, not two.
 */
function gather(sources: readonly EntrySource[]): readonly Gathered[] {
  const byPack = new Map<PackId, Gathered>();

  for (const source of sources) {
    const held = byPack.get(source.packId) ?? {
      packId: source.packId,
      packName: source.packName,
      hasOverridden: false,
      talents: NONE,
      rows: NONE,
    };

    held.hasOverridden = held.hasOverridden || source.operation === 'override';
    held.talents += source.talentsAdded;
    held.rows += source.rowsAdded;
    byPack.set(source.packId, held);
  }

  return [...byPack.values()];
}

/**
 * A class: whoever defined or replaced it, whoever extended it, and whoever wrote spells
 * naming it. The spell packs come last because they are the packs `sources` does not know
 * about — everything the resolver recorded keeps the order the resolver recorded it in.
 */
function classLine(stack: ResolvedStack, resolved: ResolvedClass): StackLine {
  const spellsByPack = new Map<PackId, number>();
  for (const spell of spellsForClass(stack, resolved.ref)) {
    spellsByPack.set(spell.packId, (spellsByPack.get(spell.packId) ?? NONE) + ONE);
  }

  const gathered = gather(resolved.sources);
  const spellOnly = [...spellsByPack.keys()].filter(
    (packId) => !gathered.some((held) => held.packId === packId),
  );

  const contributions: StackContribution[] = gathered.map((held) => {
    const spells = spellsByPack.get(held.packId) ?? NONE;

    return {
      packId: held.packId,
      packName: held.packName,
      parts: [
        ...(held.hasOverridden ? ['replaces'] : []),
        ...(spells > NONE ? [count(spells, 'spell')] : []),
        ...(held.talents > NONE ? [count(held.talents, 'talent')] : []),
      ],
    };
  });

  for (const packId of spellOnly) {
    const spells = spellsByPack.get(packId) ?? NONE;
    // The pack's own name, from any spell it contributed: a pack that never touched
    // `sources` has no other record here of what it is called.
    const named = stack.packs.find((summary) => summary.id === packId);

    contributions.push({
      packId,
      packName: named?.name ?? packId,
      parts: [count(spells, 'spell')],
    });
  }

  return { ref: resolved.ref, kind: 'class', name: resolved.entry.name, contributions };
}

/**
 * A table: the pack whose rows survived, and everyone who added more.
 *
 * The rows an *overridden* definition carried are gone with it, so they are counted
 * against the pack that owns the winning entry rather than the pack that first defined
 * the reference — the number in the bracket is what is on the table now.
 */
function tableLine(resolved: ResolvedTable): StackLine {
  const contributions = gather(resolved.sources).map((held): StackContribution => {
    const own = held.packId === resolved.packId ? resolved.entry.rows.length : NONE;
    const rows = own + held.rows;

    return {
      packId: held.packId,
      packName: held.packName,
      parts: [
        ...(held.hasOverridden ? ['replaces'] : []),
        ...(rows > NONE ? [count(rows, 'row')] : []),
      ],
    };
  });

  return { ref: resolved.ref, kind: 'table', name: resolved.entry.name, contributions };
}

/** Every class, then every table, each in the order the stack holds them. */
export function resolutionStack(stack: ResolvedStack): readonly StackLine[] {
  return [
    ...stack.classes.map((resolved) => classLine(stack, resolved)),
    ...stack.tables.map((resolved) => tableLine(resolved)),
  ];
}

/**
 * What one pack brought, as a sentence: `4 classes, 32 spells, 2 tables`.
 *
 * Only what is actually in the file. A pack of four spells has one array (DATA-MODEL.md
 * §1), and listing its five empty ones as zeroes would bury the one number that matters.
 * A pack with nothing in it at all is a valid pack and says so rather than reading as an
 * error — it is a stub an author is part way through, which is the same reading
 * `pack.ts` gives an extension that adds nothing.
 */
export function describeContents(counts: PackSummary['counts']): string {
  const parts = [
    [counts.classes, 'class', 'classes'],
    [counts.ancestries, 'ancestry', 'ancestries'],
    [counts.spells, 'spell', 'spells'],
    [counts.items, 'item', 'items'],
    [counts.talents, 'talent', 'talents'],
    [counts.tables, 'table', 'tables'],
    [counts.extensions, 'extension', 'extensions'],
  ] as const;

  const described = parts
    .filter(([amount]) => amount > NONE)
    .map(([amount, singular, plural]) => count(amount, singular, plural));

  return described.length === NONE ? 'no content' : described.join(', ');
}

/** `Wizard = core (32 spells, 4 talents) + Frostbound (4 spells)`. */
export function stackLineText(line: StackLine): string {
  const contributions = line.contributions
    .map((held) =>
      held.parts.length === NONE ? held.packName : `${held.packName} (${held.parts.join(', ')})`,
    )
    .join(' + ');

  return `${line.name} = ${contributions}`;
}
