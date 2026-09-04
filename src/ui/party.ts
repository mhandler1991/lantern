/**
 * The party view's arithmetic, kept out of the component so it can be checked without a
 * DOM.
 *
 * Every function here takes a **public projection** and nothing else, because that is
 * all one peer ever has about another (DESIGN.md §2). None of them takes a `Character`,
 * and that is the point: a helper that could reach a sheet is a helper that could put
 * one on screen for the wrong person.
 *
 * 📌 Everything a peer sends is hostile input (CLAUDE.md §2.7). The schema bounds it,
 * but bounded is not sensible — a peer may legitimately report `hp: { current: -4,
 * max: 0 }`, and every function below has to answer for that rather than divide by it.
 */

import type { PresenceMember } from '../net/presence';
import type { PublicCharacter } from '../net/protocol';
import { shortPeerId } from '../net/transport';

/** Nothing left, none carried, none of a thing. A floor, not a rule of the game. */
const NONE = 0;

/** A bar is drawn as a percentage of itself. A scale, not a business rule. */
const FULL_BAR = 100;

/** A line of people is counted from the front, and the front is one. */
const FIRST_POSITION = 1;

/** Where one character stands in the line, and who they are. */
export type Seat = {
  readonly member: PresenceMember;
  /** 1-based, and what the numbers down the left of the party view say. */
  readonly position: number;
};

/**
 * The party in marching order.
 *
 * Today that is seat order — longest present first (`net/presence.ts`) — which is
 * arbitrary as a marching line but has the one property that matters: every browser at
 * the table derives it from the same facts and gets the same answer, so nobody argues
 * about who is in front. Phase 6 gives the DM a real order to set, and this function is
 * the single place it lands: the component numbers whatever it is handed.
 */
export function marchingOrder(members: readonly PresenceMember[]): readonly Seat[] {
  return members.map((member, index) => ({ member, position: index + FIRST_POSITION }));
}

/**
 * How much of the HP bar to fill, 0 to 100.
 *
 * Three cases a peer can honestly produce and one it can send to break us: a `max` of
 * zero is a sheet whose HP has not been set (the blank character is a real character —
 * DATA-MODEL.md §11), a `current` below zero is somebody bleeding out, and a `current`
 * above `max` is a blessing. The bar shows empty, empty and full; none of them divides
 * by zero and none of them draws outside the track.
 */
export function hpBarPercent(hp: PublicCharacter['hp']): number {
  if (hp.max <= NONE) return NONE;

  const filled = Math.round((hp.current / hp.max) * FULL_BAR);
  return Math.min(Math.max(filled, NONE), FULL_BAR);
}

/**
 * Whether this character's HP has run out. It is emphasis on a number the peer sent, not
 * a ruling about them (PRD.md principle 1) — the app does not know or say what happens
 * at zero, only that the number is there and is worth seeing across the table.
 *
 * A sheet with no maximum yet is not down: its zero means "not filled in".
 */
export function isDown(hp: PublicCharacter['hp']): boolean {
  return hp.max > NONE && hp.current <= NONE;
}

/**
 * The name to draw. A peer that has connected but whose `hello` has not landed is real
 * and is drawn — its id is all we honestly have, so its id is what is shown, and a row
 * that appeared only once a hello arrived would make a slow peer look like a broken one.
 *
 * 🚫 The string this returns is peer data. It reaches the DOM as a text node and never
 * as markup (CLAUDE.md §2.6); `ui/hostile-peer.test.tsx` holds that line.
 */
export function memberName(character: PublicCharacter | null, id: string): string {
  if (character === null) return `${shortPeerId(id)}…`;
  return character.name.trim() === '' ? 'An unnamed character' : character.name;
}

/**
 * "Level 3 Human Thief", and "Level 0" for a character that has neither yet. Ancestry
 * and class travel as words rather than refs (DESIGN.md §2), so this needs no pack and
 * cannot fail to resolve one — but either may be empty, and a sheet mid-creation is the
 * normal way that happens rather than a fault.
 */
export function describeCharacter(character: PublicCharacter): string {
  const words = [character.ancestry.trim(), character.className.trim()].filter(
    (word) => word !== '',
  );

  return [`Level ${character.level}`, ...words].join(' ');
}

/**
 * The conditions, each one once.
 *
 * Our own sheet cannot hold a repeat (`state/character-edits.ts` refuses one), but a
 * peer's can: `['poisoned', 'poisoned']` passes the schema, and a condition is its own
 * React key because a bare string has no id to key on. Collapsing repeats is both the
 * honest reading — being poisoned twice is being poisoned — and what keeps the key
 * unique without falling back to an array index (CLAUDE.md §6).
 */
export function distinctConditions(conditions: readonly string[]): readonly string[] {
  return [...new Set(conditions)];
}
