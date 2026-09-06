/**
 * What a sheet still points at when the pack that answered for it is turned off.
 *
 * PRD.md principle 4 and DESIGN.md §5 are one sentence here: **turning a pack off never
 * destroys a character**. Nothing in this file removes a row, rewrites one, or copies a
 * pack's words onto a sheet. It answers two questions and the UI does the rest — which
 * rows have a reference no enabled pack resolves, and which packs this sheet needs that
 * are not currently on.
 *
 * Three decisions carry the module.
 *
 * **A row is orphaned by its reference, not by its pack.** `ref` is the whole test: a
 * row the player typed in has none and can never be orphaned (PRD.md principle 6), and a
 * row whose reference resolves is not orphaned no matter which pack answered. That keeps
 * the check independent of load order, of overrides, and of how the stack was built.
 *
 * **Talents are not in here at all.** A talent stores the words rather than a reference
 * (DATA-MODEL.md §11) for exactly this case, so a talent from a pack that is off is not
 * degraded and must not be marked as if it were. Its `source` still counts towards
 * `packsUsed` — that is what lets the pack be re-offered — but the row keeps working.
 *
 * **`packsUsed` is maintained here, and it is not a derived value.** Most of it is
 * derivable from the references on the sheet, but the case the field exists for is not:
 * a pack that *overrode* `core:item:torch` leaves no trace in the reference, so once it
 * is off there is nothing left to derive it from. So the record is stamped while the
 * pack can still be seen, and an id whose pack is not loaded is carried forward
 * untouched — the app cannot see what it contributes, so it does not get to decide it
 * contributes nothing.
 */

import type { Character, PackId, Ref, RowId } from './character';
import type { ResolvedStack } from './pack-resolver';

/** `core:item:torch` — the pack is the first segment, as `packsUsed` carries it. */
const SEPARATOR = ':';
const PACK_SEGMENT = 0;

/** What is orphaned on one sheet, against one stack of enabled packs. */
export type OrphanReport = {
  /** Every row id whose `ref` no enabled pack resolves. Items, spells and lights. */
  readonly rows: ReadonlySet<RowId>;
  /** The two content references a sheet holds that are not rows. */
  readonly isAncestryOrphaned: boolean;
  readonly isClassOrphaned: boolean;
  /**
   * Packs this sheet needs that are not loaded: what `packsUsed` records and is not on,
   * then any pack named by a reference that failed to resolve. The second half is there
   * because a sheet can arrive from an export whose record is thinner than its rows, and
   * a row nobody can explain is worse than a pack named twice. A warning, never a block.
   */
  readonly missingPacks: readonly PackId[];
};

/** The pack a reference names. A reference is `pack:kind:id` and the schema guarantees it. */
export function packOfRef(reference: Ref): PackId {
  return reference.split(SEPARATOR)[PACK_SEGMENT] ?? reference;
}

/** Every reference on the sheet that names content a pack has to answer for. */
function contentRefs(character: Character): readonly Ref[] {
  return [
    character.ancestry.ref,
    character.class.ref,
    ...character.items.map((item) => item.ref),
    ...character.spells.map((spell) => spell.ref),
    ...character.lights.map((light) => light.ref),
  ].filter((reference): reference is Ref => reference !== null);
}

/** True when no enabled pack answers for this reference. `null` is a typed-in row. */
function isOrphaned(stack: ResolvedStack, reference: Ref | null): boolean {
  return reference !== null && !stack.byRef.has(reference);
}

/**
 * Which packs this sheet depends on right now: the pack every reference names, plus the
 * pack that actually **won** each reference that resolves.
 *
 * Those two differ exactly when something was overridden, which is the whole reason the
 * second half is here — a sheet holding `core:item:torch` while a supplement overrides it
 * depends on the supplement, and the reference does not say so.
 */
export function packsResolvedFrom(character: Character, stack: ResolvedStack): readonly PackId[] {
  const packs = new Set<PackId>();

  for (const reference of contentRefs(character)) {
    packs.add(packOfRef(reference));

    const found = stack.byRef.get(reference);
    if (found !== undefined) packs.add(found.packId);
  }

  // A talent is never orphaned, but the table it came from is still a pack this sheet was
  // built with, and DATA-MODEL.md §11 keeps `source` so that pack can be re-offered.
  for (const talent of character.talents) {
    if (talent.source !== null) packs.add(packOfRef(talent.source));
  }

  return [...packs];
}

/**
 * The sheet's `packsUsed`, brought up to date against the packs that are on.
 *
 * Stamped rather than derived on read, because the app can only see what a pack
 * contributes while it is loaded. The rule is one line: what this sheet depends on now,
 * plus every id already recorded whose pack is **not loaded** — an id the app cannot
 * check is an id it does not get to drop. A recorded pack that is loaded and contributes
 * nothing falls away, so the warning below stays true rather than accumulating packs the
 * player stopped using.
 *
 * Returns the character unchanged when nothing moved, so this can sit in front of every
 * edit without making one.
 */
export function updatePacksUsed(character: Character, stack: ResolvedStack): Character {
  const loaded = new Set(stack.packs.map((summary) => summary.id));
  const needed = packsResolvedFrom(character, stack);

  const packsUsed = [
    ...character.packsUsed.filter((id) => !loaded.has(id) || needed.includes(id)),
    ...needed.filter((id) => !character.packsUsed.includes(id)),
  ];

  const isUnchanged =
    packsUsed.length === character.packsUsed.length &&
    packsUsed.every((id, position) => id === character.packsUsed[position]);

  return isUnchanged ? character : { ...character, packsUsed };
}

/**
 * What is orphaned, and what is missing. 🚫 Never throws, never blocks, and never reads
 * anything off a row but its `ref`.
 */
export function orphanReport(character: Character, stack: ResolvedStack): OrphanReport {
  const loaded = new Set(stack.packs.map((summary) => summary.id));

  const rows = new Set<RowId>();
  const missing = new Set(character.packsUsed.filter((id) => !loaded.has(id)));

  const mark = (id: RowId | null, reference: Ref | null): void => {
    if (!isOrphaned(stack, reference) || reference === null) return;

    if (id !== null) rows.add(id);
    missing.add(packOfRef(reference));
  };

  for (const item of character.items) mark(item.id, item.ref);
  for (const spell of character.spells) mark(spell.id, spell.ref);
  for (const light of character.lights) mark(light.id, light.ref);
  mark(null, character.ancestry.ref);
  mark(null, character.class.ref);

  return {
    rows,
    isAncestryOrphaned: isOrphaned(stack, character.ancestry.ref),
    isClassOrphaned: isOrphaned(stack, character.class.ref),
    missingPacks: [...missing],
  };
}
