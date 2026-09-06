/**
 * What a picker offers, and what a row is called once something has been picked.
 *
 * PRD.md §5's Phase 2 is done when "the core pack drives every picker in the app", and
 * this module is the join: `model/pack-resolver.ts` answers what the table has, and this
 * turns that into the two things a control needs — a list of options, and the word to
 * print for a reference somebody already chose.
 *
 * Three decisions carry it.
 *
 * **A choice is a reference, never a copy.** Picking Rimeblade stores
 * `frostbound:item:rimeblade` and leaves `name` empty (DATA-MODEL.md §12 — `name` is a
 * fallback, never a cache). The word on the screen is read back out of the stack every
 * render, so turning the pack off costs the sheet nothing it had and turning it back on
 * restores the label without an edit.
 *
 * **Options keep load order.** `ResolvedStack` holds each kind in load order and an
 * override keeps the position of what it replaced, so a supplement being turned on never
 * reshuffles a list somebody was reading. Sorting here would throw that away.
 *
 * **Two entries with one name are told apart by their pack, and only then.** Ids are
 * namespaced, so two packs may both define a Skald and neither is a collision
 * (DESIGN.md §5). A player still has to pick one, so the label carries the pack — but
 * only for the names that actually repeat, because `Torch (Core)` on every row is noise.
 *
 * Pure, and no React: a `<select>` renders each label as a text node like every other
 * string that came out of a pack (CLAUDE.md §2.6).
 */

import type { Ref } from '../model/pack';
import type { ResolvedStack } from '../model/pack-resolver';
import { spellsForClass } from '../model/pack-resolver';
import { orphanLabel } from './format';

/** Nothing counted yet. A floor, not a business rule. */
const NONE = 0;

/** A name nothing else in the list shares. */
const UNIQUE = 1;

/** One option in a picker: what it sets, and what it reads as. */
export type Choice = {
  readonly ref: Ref;
  readonly label: string;
};

/** Everything the sheet's pickers offer, resolved from the packs that are on. */
export type SheetChoices = {
  readonly ancestries: readonly Choice[];
  readonly classes: readonly Choice[];
  readonly items: readonly Choice[];
  readonly spells: readonly Choice[];
};

/** The shape every resolved entry shares, which is all a picker reads off one. */
type Offerable = {
  readonly ref: Ref;
  readonly packName: string;
  readonly entry: { readonly name: string };
};

/**
 * One kind, as options. A name that appears twice carries the pack that supplied it, so
 * the player picking between two Skalds can see which is which.
 */
export function offer(entries: readonly Offerable[]): readonly Choice[] {
  const timesNamed = new Map<string, number>();
  for (const entry of entries) {
    timesNamed.set(entry.entry.name, (timesNamed.get(entry.entry.name) ?? NONE) + UNIQUE);
  }

  return entries.map((entry) => ({
    ref: entry.ref,
    label:
      (timesNamed.get(entry.entry.name) ?? UNIQUE) > UNIQUE
        ? `${entry.entry.name} (${entry.packName})`
        : entry.entry.name,
  }));
}

/**
 * Every picker on the sheet, from one stack and the class the character has chosen.
 *
 * Spells are the one list narrowed by something on the sheet: **a spell names its
 * classes, not the other way round** (DATA-MODEL.md §3), so a class that resolves is
 * asked what is on its list. A character with no class, or one from a pack that is off,
 * is offered every spell loaded rather than none — an empty picker would read as a
 * missing pack, and the sheet records what a player says they know (PRD.md principle 1).
 */
export function sheetChoices(stack: ResolvedStack, classRef: Ref | null): SheetChoices {
  const isClassLoaded = classRef !== null && stack.byRef.get(classRef)?.kind === 'class';

  return {
    ancestries: offer(stack.ancestries),
    classes: offer(stack.classes),
    items: offer(stack.items),
    spells: offer(
      isClassLoaded && classRef !== null ? spellsForClass(stack, classRef) : stack.spells,
    ),
  };
}

/** True when a loaded pack answers for this reference, and so owns what it is called. */
export function isFromPack(stack: ResolvedStack, reference: Ref | null): boolean {
  return reference !== null && stack.byRef.has(reference);
}

/**
 * What a row's name box shows: the pack's word for it while a pack answers, the player's
 * own words when nothing does, and the reference itself when there are neither — a row
 * that reads as an empty box has been lost as far as anyone looking at the sheet can
 * tell, and nothing here is lost (DATA-MODEL.md §5).
 */
export function displayName(stack: ResolvedStack, reference: Ref | null, own: string): string {
  const found = reference === null ? undefined : stack.byRef.get(reference);
  if (found !== undefined) return found.entry.name;

  return orphanLabel(own, reference);
}

/** The tier a loaded pack gives a spell, or `null` for a row no pack answers for. */
export function spellTier(stack: ResolvedStack, reference: Ref | null): number | null {
  const found = reference === null ? undefined : stack.byRef.get(reference);
  if (found === undefined || found.kind !== 'spell') return null;

  return found.entry.tier;
}
