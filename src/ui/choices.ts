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
 * restores the label without an edit. **A talent is the one exception**, and the format
 * makes it one: the sheet stores the words and a `source` naming where they came from
 * (DATA-MODEL.md §12), so `talentWords` below copies rather than references.
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
import type { ResolvedStack, ResolvedTalent } from '../model/pack-resolver';
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
  /** The items a pack says burn — every item, while nothing loaded says anything. */
  readonly lights: readonly Choice[];
  readonly spells: readonly Choice[];
  /** The talents extensions offered this character's class, and nothing else. */
  readonly talents: readonly Choice[];
};

/** The shape every resolved entry shares, which is all a picker reads off one. */
type Offerable = {
  readonly ref: Ref;
  readonly packName: string;
  readonly entry: { readonly name: string };
};

/**
 * When an option says which pack it came from.
 *
 * `when-ambiguous` is the sheet's answer and the reason is at the top of this file:
 * `Torch (Core)` on every row of a gear list is noise, and the only names that actually
 * need telling apart are the ones that repeat.
 *
 * `always` is the walkthrough's, and it is issue #35's third criterion — "content from
 * any loaded pack appears, labelled with its source". Creation is the one moment where
 * the question is not "which torch" but "what has this table got, and who supplied it":
 * a player choosing a class for the first time is deciding whether to take the one the
 * DM's supplement added, and a bare name does not tell them that a supplement is why it
 * is on the list at all.
 */
export type PackLabel = 'when-ambiguous' | 'always';

/**
 * One kind, as options. A name that appears twice carries the pack that supplied it, so
 * the player picking between two Skalds can see which is which — and under `always`,
 * every option carries it whether it repeats or not.
 */
export function offer(
  entries: readonly Offerable[],
  packLabel: PackLabel = 'when-ambiguous',
): readonly Choice[] {
  const timesNamed = new Map<string, number>();
  for (const entry of entries) {
    timesNamed.set(entry.entry.name, (timesNamed.get(entry.entry.name) ?? NONE) + UNIQUE);
  }

  return entries.map((entry) => ({
    ref: entry.ref,
    label:
      packLabel === 'always' || (timesNamed.get(entry.entry.name) ?? UNIQUE) > UNIQUE
        ? `${entry.entry.name} (${entry.packName})`
        : entry.entry.name,
  }));
}

/**
 * Every picker on the sheet, from one stack and the class the character has chosen.
 *
 * Two lists are narrower than the kind they come from, and for opposite reasons.
 *
 * **Spells** are narrowed by something on the sheet: **a spell names its classes, not
 * the other way round** (DATA-MODEL.md §3), so a class that resolves is asked what is on
 * its list. A character with no class, or one from a pack that is off, is offered every
 * spell loaded rather than none — an empty picker would read as a missing pack, and the
 * sheet records what a player says they know (PRD.md principle 1).
 *
 * **Talents** are narrowed hardest of the three, and they are the one list that does not
 * fall back. A talent reaches a class because an extension named it (DATA-MODEL.md §9) —
 * so a character with no class has been offered nothing, and offering every talent
 * loaded would be handing one class's choices to another. The free-text row beside the
 * picker is what records a talent from anywhere else (PRD.md principle 1), which is why
 * an empty list here costs the player nothing.
 *
 * **Lights** are narrowed by the packs themselves: an item that says it gives light
 * (DATA-MODEL.md §4) belongs on the light picker and a bastard sword does not. The
 * fallback is the same shape and the same reason — while nothing loaded says anything
 * about light, every item is offered, because a homebrew torch in a pack written before
 * the block existed is still a torch and refusing to offer it would lose it.
 */
export function sheetChoices(
  stack: ResolvedStack,
  classRef: Ref | null,
  packLabel: PackLabel = 'when-ambiguous',
): SheetChoices {
  const isClassLoaded = classRef !== null && stack.byRef.get(classRef)?.kind === 'class';
  const lights = stack.items.filter((item) => (item.entry.light ?? null) !== null);

  return {
    ancestries: offer(stack.ancestries, packLabel),
    classes: offer(stack.classes, packLabel),
    items: offer(stack.items, packLabel),
    lights: offer(lights.length === NONE ? stack.items : lights, packLabel),
    spells: offer(
      isClassLoaded && classRef !== null ? spellsForClass(stack, classRef) : stack.spells,
      packLabel,
    ),
    talents: offer(talentsForClass(stack, classRef), packLabel),
  };
}

/**
 * The talents on a class's list that a loaded pack still defines.
 *
 * A reference nothing defines is dropped rather than offered: the sheet copies a
 * talent's **words**, and a reference with no entry behind it has none to copy. It is
 * not an error either — the resolver already warned when the extension was applied, and
 * the class keeps the reference for when the pack that defines it comes back on
 * (PRD.md principle 4).
 */
function talentsForClass(stack: ResolvedStack, classRef: Ref | null): readonly ResolvedTalent[] {
  const found = classRef === null ? undefined : stack.byRef.get(classRef);
  if (found === undefined || found.kind !== 'class') return [];

  const offered: ResolvedTalent[] = [];
  for (const reference of found.talents) {
    const talent = stack.byRef.get(reference);
    if (talent !== undefined && talent.kind === 'talent') offered.push(talent);
  }

  return offered;
}

/**
 * What picking a talent writes on the sheet: its words, copied.
 *
 * This is the one picker that copies rather than references, and DATA-MODEL.md §12 is
 * why — a talent stores `text` plus a `source` naming where it came from, so the pack
 * can go off without the sheet losing a paragraph the player is playing with. Nothing
 * reads this back afterwards; the words are the player's from the moment they land.
 *
 * **An entry with no `text` is the core case, not a broken one** (DESIGN.md §5 — core
 * ships no rules text and falls back to a page reference). Its name and page are the
 * only words it has, so they are what gets written: a row reading `Grit (p. 27)` is a
 * talent the player can look up, and an empty paragraph is a row that lost one.
 */
export function talentWords(stack: ResolvedStack, reference: Ref | null): string {
  const found = reference === null ? undefined : stack.byRef.get(reference);
  if (found === undefined || found.kind !== 'talent') return '';

  const { name, text, page } = found.entry;
  if (text !== null && text !== undefined && text !== '') return text;

  return page === null || page === undefined ? name : `${name} (p. ${page})`;
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

/**
 * What a loaded pack says a row hits for — `1d8`, or `1d4/1d8` for a weapon used in one
 * hand or two (DATA-MODEL.md §4). `null` for a row nothing answers for, and for one that
 * is not a weapon.
 *
 * Read back out of the stack every render like every other thing a pack answers for, so
 * a supplement that overrides a blade changes what its row rolls without touching what
 * the sheet holds. A row the player typed in themselves has no damage here and gets no
 * button: the sheet is not the place to invent what somebody's own words hit for.
 *
 * 🚫 Nothing evaluates it. The string is split into notations and handed to
 * `model/dice.ts`; what the number means once it is rolled is the table's business
 * (PRD.md principle 1).
 */
export function weaponDamage(stack: ResolvedStack, reference: Ref | null): string | null {
  const found = reference === null ? undefined : stack.byRef.get(reference);
  if (found === undefined || found.kind !== 'item') return null;

  return found.entry.weapon?.damage ?? null;
}
