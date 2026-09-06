/**
 * What the app actually reads: one stack, resolved from every loaded pack in load order.
 *
 * `pack.ts` answers "is this file a pack". This answers the question after it — **what
 * does the table have, given all of them at once** — and DATA-MODEL.md §1's three
 * operations are the whole of it:
 *
 *   - **define** adds, and never collides. Every id is namespaced by its pack on the way
 *     in, so two packs both defining a Skald produce two Skalds, each labelled with its
 *     source. That is not collision handling; it is the absence of a collision.
 *   - **extend** adds to something that exists, and never collides either. Extensions
 *     apply in load order, which is why the pack list is reorderable.
 *   - **override** replaces by id. It is the one operation that collides, on purpose,
 *     because somebody typed the word — so it warns, and the last loaded one wins.
 *
 * **Nothing here fails.** PRD.md principle 4 is the load-bearing rule of this file: an
 * extension pointing at nothing, two entries claiming one id, a pack overriding content
 * that was never loaded — every one is a warning and the stack is built anyway. The
 * alternative is a DM whose table stops working because a supplement mentions a book
 * they turned off.
 *
 * Warnings are `Problem`s, the same shape a malformed pack reports (DATA-MODEL.md §9),
 * so `reportProblems` puts a resolution fault and a schema fault in one pasteable block.
 * The path is `pack.array[index].field` — which pack, which entry, which field.
 *
 * 🚫 Nothing here adjudicates. A talent an extension adds to a class is a reference the
 * sheet records; this file never reads it, and never modifies a stat (PRD.md principle 1).
 */

import type { ItemLookup } from './derived';
import {
  EntryKind,
  type AncestryEntry,
  type ClassEntry,
  type EntryRef,
  type ItemEntry,
  type Pack,
  type PackId,
  type Ref,
  type SpellEntry,
  type TableEntry,
  type TableRow,
} from './pack';
import type { Problem } from './problems';

/** An empty count, and the first index. Neither is a rule of the game. */
const NONE = 0;

/** How a reference is written: `pack:kind:id`. */
const SEPARATOR = ':';

/** Where the kind sits in the full form. */
const KIND_SEGMENT = 1;

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/** Every kind a pack actually defines. `talent` is a kind nothing has a shape for yet. */
export type DefinedKind = Exclude<EntryKind, 'talent'>;

/** The five described entry types, as one union. */
export type PackEntry = ClassEntry | AncestryEntry | SpellEntry | ItemEntry | TableEntry;

/**
 * Fill in the segments an entry left implied and return the one form everything else
 * keys on (DATA-MODEL.md §1):
 *
 * ```
 * "dagger",           kind item,  in core        →  core:item:dagger
 * "frostbound:rimewalker", kind class, in core   →  frostbound:class:rimewalker
 * "core:item:dagger", kind anything, anywhere    →  core:item:dagger
 * ```
 *
 * The kind comes from the **field the reference was written in** — a class's `weapons`
 * can only name items — which is exactly why a character sheet may not leave it implied
 * and stores the full form instead. Pure, and it never looks at what is loaded: whether
 * the thing exists is a separate question from what it is called.
 */
export function normalizeRef(reference: EntryRef, kind: EntryKind, fromPack: PackId): Ref {
  const [first, second, third] = reference.split(SEPARATOR);

  if (third !== undefined) return reference;
  if (second !== undefined) return `${first ?? fromPack}${SEPARATOR}${kind}${SEPARATOR}${second}`;

  return `${fromPack}${SEPARATOR}${kind}${SEPARATOR}${reference}`;
}

/** The kind a full reference names, or `undefined` for a kind this app has no word for. */
function kindOf(reference: Ref): EntryKind | undefined {
  const parsed = EntryKind.safeParse(reference.split(SEPARATOR)[KIND_SEGMENT]);

  return parsed.success ? parsed.data : undefined;
}

// ---------------------------------------------------------------------------
// The stack
// ---------------------------------------------------------------------------

/**
 * One pack's contribution to one entry, in load order. This is what makes the stack
 * inspectable rather than merely correct: DATA-MODEL.md §8's line —
 *
 * ```
 * Wizard = core (32 spells, 4 talents) + Frostbound (4 spells) + Cursed Scroll 1 (2 talents)
 * ```
 *
 * is this list, rendered. A pack that contributed nothing is not in it, so an extension
 * whose additions were all skipped never appears to have applied.
 */
export type EntrySource = {
  readonly packId: PackId;
  readonly packName: string;
  readonly operation: 'define' | 'override' | 'extend';
  readonly talentsAdded: number;
  readonly rowsAdded: number;
};

/** What every resolved entry carries, whatever kind it is. */
type Provenance = {
  /** The namespaced identity: `frostbound:class:rimewalker`. */
  readonly ref: Ref;
  /** The pack whose content won — the overriding pack, when one did. */
  readonly packId: PackId;
  /** Its name, so the UI can label two Skalds apart without a second lookup. */
  readonly packName: string;
  readonly sources: readonly EntrySource[];
};

/** `talents` is what extensions added; a class defines none of its own (DATA-MODEL.md §5). */
export type ResolvedClass = Provenance & {
  readonly kind: 'class';
  readonly entry: ClassEntry;
  readonly talents: readonly Ref[];
};

/** `rows` is the entry's own rows, then every extension's, in load order. */
export type ResolvedTable = Provenance & {
  readonly kind: 'table';
  readonly entry: TableEntry;
  readonly rows: readonly TableRow[];
};

export type ResolvedAncestry = Provenance & {
  readonly kind: 'ancestry';
  readonly entry: AncestryEntry;
};
export type ResolvedSpell = Provenance & {
  readonly kind: 'spell';
  readonly entry: SpellEntry;
};
export type ResolvedItem = Provenance & {
  readonly kind: 'item';
  readonly entry: ItemEntry;
};

export type ResolvedEntry =
  ResolvedClass | ResolvedAncestry | ResolvedSpell | ResolvedItem | ResolvedTable;

/** A loaded pack as the content screen shows it: what it is, and how much it brought. */
export type PackSummary = {
  readonly id: PackId;
  readonly name: string;
  readonly version: string;
  readonly counts: {
    readonly classes: number;
    readonly ancestries: number;
    readonly spells: number;
    readonly items: number;
    readonly talents: number;
    readonly tables: number;
    readonly extensions: number;
  };
};

/**
 * Everything loaded, resolved. The per-kind arrays are what a picker iterates; `byRef`
 * is what a character sheet resolves a stored reference through.
 *
 * **Order is load order, then the order inside each pack.** An override keeps the
 * position of the entry it replaced rather than jumping to the end, so turning a
 * supplement on does not reshuffle a list somebody was reading.
 */
export type ResolvedStack = {
  readonly packs: readonly PackSummary[];
  readonly classes: readonly ResolvedClass[];
  readonly ancestries: readonly ResolvedAncestry[];
  readonly spells: readonly ResolvedSpell[];
  readonly items: readonly ResolvedItem[];
  readonly tables: readonly ResolvedTable[];
  readonly byRef: ReadonlyMap<Ref, ResolvedEntry>;
  readonly warnings: readonly Problem[];
};

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** An entry mid-resolution: the winning content, plus what extensions have added. */
type Working<E extends PackEntry> = {
  readonly ref: Ref;
  readonly kind: DefinedKind;
  packId: PackId;
  packName: string;
  entry: E;
  talents: Ref[];
  rows: TableRow[];
  sources: EntrySource[];
};

/** The half of `Working` an extension touches, whatever kind of entry it belongs to. */
type Extensible = {
  readonly ref: Ref;
  readonly kind: DefinedKind;
  talents: Ref[];
  rows: TableRow[];
  sources: EntrySource[];
};

/** Everything defined so far, one map per kind, each in first-appearance order. */
type Definitions = {
  readonly class: Map<Ref, Working<ClassEntry>>;
  readonly ancestry: Map<Ref, Working<AncestryEntry>>;
  readonly spell: Map<Ref, Working<SpellEntry>>;
  readonly item: Map<Ref, Working<ItemEntry>>;
  readonly table: Map<Ref, Working<TableEntry>>;
};

/** What every content array's entries have in common, as far as resolution cares. */
type Definable = {
  readonly id: string;
  readonly overrides?: string | null | undefined;
};

const contribution = (
  pack: Pack,
  operation: EntrySource['operation'],
  talentsAdded = NONE,
  rowsAdded = NONE,
): EntrySource => ({
  packId: pack.id,
  packName: pack.name,
  operation,
  talentsAdded,
  rowsAdded,
});

/**
 * Put an entry at a reference, keeping the history of whatever was there before. A
 * `Map` keyed by reference is what makes "last loaded wins" and "keeps its position"
 * the same line of code: setting an existing key replaces the value and leaves the
 * insertion order alone.
 */
function place<E extends PackEntry>(
  into: Map<Ref, Working<E>>,
  ref: Ref,
  kind: DefinedKind,
  pack: Pack,
  entry: E,
  operation: EntrySource['operation'],
): void {
  const existing = into.get(ref);

  into.set(ref, {
    ref,
    kind,
    packId: pack.id,
    packName: pack.name,
    entry,
    talents: existing?.talents ?? [],
    rows: existing?.rows ?? [],
    sources: [...(existing?.sources ?? []), contribution(pack, operation)],
  });
}

/**
 * Pass one, over one content array: define what has no `overrides`, and replace what
 * has. An override is **within a kind** — the kind is written into the reference the
 * author typed — so a spell claiming to override an item is a mistake with an obvious
 * reading: they wrote an entry, and it is kept as a definition of its own.
 */
function collect<E extends PackEntry & Definable>(
  into: Map<Ref, Working<E>>,
  kind: DefinedKind,
  array: string,
  packs: readonly Pack[],
  pick: (pack: Pack) => readonly E[] | undefined,
  warn: (path: string, message: string) => void,
): void {
  for (const pack of packs) {
    (pick(pack) ?? []).forEach((entry, index) => {
      const at = `${pack.id}.${array}[${index}]`;
      const own = normalizeRef(entry.id, kind, pack.id);
      const target = entry.overrides ?? null;

      if (target === null) {
        const existing = into.get(own);
        if (existing !== undefined) {
          warn(
            `${at}.id`,
            `${own} is already defined by "${existing.packName}" — the later entry wins`,
          );
        }
        place(into, own, kind, pack, entry, 'define');
        return;
      }

      if (kindOf(target) !== kind) {
        warn(
          `${at}.overrides`,
          `${target} is not a ${kind} — a ${kind} may only override a ${kind}; kept as ${own}`,
        );
        place(into, own, kind, pack, entry, 'define');
        return;
      }

      const replaced = into.get(target);
      if (replaced === undefined) {
        warn(
          `${at}.overrides`,
          `no loaded pack defines ${target} — kept there anyway, so a sheet holding it resolves`,
        );
      } else {
        warn(
          `${at}.overrides`,
          `replaces ${target} from "${replaced.packName}" — the last pack loaded wins`,
        );
      }

      place(into, target, kind, pack, entry, 'override');
    });
  }
}

/** The entry a reference names, whatever kind it is, or `undefined` if nothing does. */
function find(definitions: Definitions, reference: Ref): Extensible | undefined {
  switch (kindOf(reference)) {
    case 'class':
      return definitions.class.get(reference);
    case 'ancestry':
      return definitions.ancestry.get(reference);
    case 'spell':
      return definitions.spell.get(reference);
    case 'item':
      return definitions.item.get(reference);
    case 'table':
      return definitions.table.get(reference);
    case 'talent':
    case undefined:
      return undefined;
  }
}

/**
 * Pass two: apply every extension, in load order, against everything pass one defined.
 *
 * **Extensions are applied after all definitions, not as each pack loads**, and that is
 * the difference between a reorderable list and a fragile one: a pack listed first may
 * extend a pack listed last, and moving a pack up the list changes the *order* additions
 * land in, never whether they land at all.
 */
function applyExtensions(
  definitions: Definitions,
  packs: readonly Pack[],
  warn: (path: string, message: string) => void,
): void {
  for (const pack of packs) {
    (pack.extends ?? []).forEach((extension, index) => {
      const at = `${pack.id}.extends[${index}]`;
      const target = find(definitions, extension.target);

      if (target === undefined) {
        warn(
          `${at}.target`,
          `no loaded pack defines ${extension.target} — the extension is skipped`,
        );
        return;
      }

      const talents = extension.talents ?? [];
      const rows = extension.rows ?? [];
      let talentsAdded = NONE;
      let rowsAdded = NONE;

      if (talents.length > NONE && target.kind !== 'class') {
        warn(
          `${at}.talents`,
          `${extension.target} is a ${target.kind} — talents may only be added to a class`,
        );
      } else {
        talents.forEach((talent, position) => {
          // Talents have no shape in DATA-MODEL.md, so this is a reference the sheet
          // records and nothing reads (PRD.md principle 1). Duplicates are dropped
          // rather than kept: the list becomes React keys, and it is worth saying so.
          const reference = normalizeRef(talent, 'talent', pack.id);
          if (target.talents.includes(reference)) {
            warn(`${at}.talents[${position}]`, `${extension.target} already offers ${reference}`);
            return;
          }
          target.talents.push(reference);
          talentsAdded += 1;
        });
      }

      if (rows.length > NONE && target.kind !== 'table') {
        warn(
          `${at}.rows`,
          `${extension.target} is a ${target.kind} — rows may only be added to a table`,
        );
      } else {
        // 🚫 Gaps and overlaps are not checked here, the same way `pack.ts` does not
        // check them: a row an extension adds over one that exists is a real fault and
        // it is `model/tables.ts`'s to report, where the lookup that falls through it
        // lives (DATA-MODEL.md §7).
        target.rows.push(...rows);
        rowsAdded = rows.length;
      }

      if (talentsAdded > NONE || rowsAdded > NONE) {
        target.sources.push(contribution(pack, 'extend', talentsAdded, rowsAdded));
      }
    });
  }
}

const summarize = (pack: Pack): PackSummary => ({
  id: pack.id,
  name: pack.name,
  version: pack.version,
  counts: {
    classes: pack.classes?.length ?? NONE,
    ancestries: pack.ancestries?.length ?? NONE,
    spells: pack.spells?.length ?? NONE,
    items: pack.items?.length ?? NONE,
    talents: pack.talents?.length ?? NONE,
    tables: pack.tables?.length ?? NONE,
    extensions: pack.extends?.length ?? NONE,
  },
});

/**
 * Resolve every loaded pack into one stack. **The order of `packs` is the load order**,
 * and it is the caller's — the content screen lets a DM reorder it, and calling this
 * again with the list rearranged is the whole of what reordering does.
 *
 * Takes packs that already parsed (`parsePack`). Never throws, never refuses: what it
 * could not make sense of comes back in `warnings` beside a stack that works without it.
 */
export function resolvePacks(packs: readonly Pack[]): ResolvedStack {
  const warnings: Problem[] = [];
  const warn = (path: string, message: string): void => {
    warnings.push({ path, message });
  };

  const seen = new Set<PackId>();
  packs.forEach((pack, index) => {
    if (seen.has(pack.id)) {
      // Two packs sharing an id share every reference inside them, so this is not a
      // near miss: the later pack's entries land on the earlier one's. Say so once,
      // here, rather than as a duplicate-id warning per entry further down.
      warn(`packs[${index}].id`, `another loaded pack already uses the id ${pack.id}`);
    }
    seen.add(pack.id);
  });

  const definitions: Definitions = {
    class: new Map(),
    ancestry: new Map(),
    spell: new Map(),
    item: new Map(),
    table: new Map(),
  };

  collect(definitions.class, 'class', 'classes', packs, (pack) => pack.classes, warn);
  collect(definitions.ancestry, 'ancestry', 'ancestries', packs, (pack) => pack.ancestries, warn);
  collect(definitions.spell, 'spell', 'spells', packs, (pack) => pack.spells, warn);
  collect(definitions.item, 'item', 'items', packs, (pack) => pack.items, warn);
  collect(definitions.table, 'table', 'tables', packs, (pack) => pack.tables, warn);

  applyExtensions(definitions, packs, warn);

  const classes = [...definitions.class.values()].map((working): ResolvedClass => ({
    ref: working.ref,
    kind: 'class',
    packId: working.packId,
    packName: working.packName,
    entry: working.entry,
    talents: working.talents,
    sources: working.sources,
  }));

  const tables = [...definitions.table.values()].map((working): ResolvedTable => ({
    ref: working.ref,
    kind: 'table',
    packId: working.packId,
    packName: working.packName,
    entry: working.entry,
    rows: [...working.entry.rows, ...working.rows],
    sources: working.sources,
  }));

  const ancestries = [...definitions.ancestry.values()].map((working): ResolvedAncestry => ({
    ref: working.ref,
    kind: 'ancestry',
    packId: working.packId,
    packName: working.packName,
    entry: working.entry,
    sources: working.sources,
  }));

  const spells = [...definitions.spell.values()].map((working): ResolvedSpell => ({
    ref: working.ref,
    kind: 'spell',
    packId: working.packId,
    packName: working.packName,
    entry: working.entry,
    sources: working.sources,
  }));

  const items = [...definitions.item.values()].map((working): ResolvedItem => ({
    ref: working.ref,
    kind: 'item',
    packId: working.packId,
    packName: working.packName,
    entry: working.entry,
    sources: working.sources,
  }));

  const byRef = new Map<Ref, ResolvedEntry>();
  for (const entry of [...classes, ...ancestries, ...spells, ...items, ...tables]) {
    byRef.set(entry.ref, entry);
  }

  return {
    packs: packs.map(summarize),
    classes,
    ancestries,
    spells,
    items,
    tables,
    byRef,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Reading the stack
// ---------------------------------------------------------------------------

/**
 * The entry a reference names, with the segments a pack left implied filled in from the
 * field it was written in. `undefined` is the answer for content no loaded pack
 * defines — a class naming an item from a pack that is turned off — and the caller
 * warns and renders the reference as plain text (DATA-MODEL.md §5). 🚫 It never blocks.
 */
export function lookup(
  stack: ResolvedStack,
  reference: EntryRef,
  kind: EntryKind,
  fromPack: PackId,
): ResolvedEntry | undefined {
  return stack.byRef.get(normalizeRef(reference, kind, fromPack));
}

/**
 * The stack as `model/derived.ts` reads it: a reference in, the two facts an AC or a
 * slot count needs out, and `null` for anything no loaded pack defines.
 *
 * A sheet stores the full `pack:kind:id` form and nothing else (DATA-MODEL.md §1), so
 * there is nothing to imply here and no `kind` argument to take — an unresolved
 * reference is answered `null` and the row's own value stands (`derived.ts`: a loaded
 * pack's answer wins, the row is the fallback). 🚫 It never throws and never blocks.
 */
export function itemLookup(stack: ResolvedStack): ItemLookup {
  return (reference) => {
    const found = stack.byRef.get(reference);
    if (found === undefined || found.kind !== 'item') return null;

    return { slots: found.entry.slots, armor: found.entry.armor ?? null };
  };
}

/**
 * Every spell on a class's list. **The spell names its classes, not the other way
 * round** (DATA-MODEL.md §3), which is why a pack adding four wizard spells needs no
 * extension at all — and why this is a query rather than a field.
 */
export function spellsForClass(stack: ResolvedStack, classRef: Ref): readonly ResolvedSpell[] {
  return stack.spells.filter((spell) =>
    spell.entry.classes.some(
      (reference) => normalizeRef(reference, 'class', spell.packId) === classRef,
    ),
  );
}
