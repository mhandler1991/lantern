/**
 * The sheet, reduced to what a peer is allowed to see. DESIGN.md §2 — the single most
 * important design decision in the app: it solves bandwidth and privacy together, and
 * it is why the whole thing works without a database.
 *
 * Nine fields go. **Everything else stays on this machine.** Gold, journal, quests,
 * gear, spells known, talents, notes and history are not encrypted and sent — they are
 * *not sent*, and there is no code path here that could send them.
 *
 * 📌 This file builds one projection. #44 owns broadcasting it on change, debounced,
 * and the test that walks every field of a full sheet to prove nothing else leaves.
 * #43 needs it now because `hello` carries a projection (DESIGN.md §3).
 */

import { MAX_AC } from '../constants';
import type { Character } from '../model/character';
import type { ItemLookup } from '../model/derived';
import { computeArmorClass } from '../model/derived';
import type { PublicCharacter } from './protocol';

/** Zero is the floor of an armour class on the wire, not a rule of the game. */
const NONE = 0;

/**
 * Build the public projection of a sheet.
 *
 * `ac` is computed here rather than read, because it is derived and derived values are
 * never stored (CLAUDE.md §4). It is then clamped to the range the wire schema accepts:
 * a sheet that somehow reaches an absurd AC is a sheet whose owner should still appear
 * in the party, and an unclamped number would fail outbound validation and quietly take
 * the whole `hello` with it (PRD.md principle 4 — warn, do not block).
 *
 * `carryingLight` is "has a light burning" — a source that was lit and not put out. The
 * burn-down itself is computed from `litAt` wherever it is shown (DESIGN.md §6); it is
 * deliberately not folded in here, because that would make one peer's party view differ
 * from another's by the drift between their clocks.
 */
export function toPublicCharacter(character: Character, lookup: ItemLookup): PublicCharacter {
  const { ac } = computeArmorClass(character, lookup);

  return {
    name: character.name,
    ancestry: character.ancestry.name,
    className: character.class.name,
    level: character.level,
    hp: { current: character.hp.current, max: character.hp.max },
    ac: Math.min(Math.max(ac, NONE), MAX_AC),
    conditions: [...character.conditions],
    carryingLight: character.lights.some((light) => light.litAt !== null),
    luck: character.luck,
  };
}
