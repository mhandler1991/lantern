/**
 * The sheet, reduced to what a peer is allowed to see. DESIGN.md §2 — the single most
 * important design decision in the app: it solves bandwidth and privacy together, and
 * it is why the whole thing works without a database.
 *
 * Nine fields go. **Everything else stays on this machine.** Gold, journal, quests,
 * gear, spells known, talents, notes and history are not encrypted and sent — they are
 * *not sent*, and there is no code path here that could send them.
 *
 * The projection is built by one function, from one argument, returning an object
 * literal with nine keys written out. That shape is the privacy boundary: there is no
 * spread of the sheet, no `delete`, no denylist of fields to strip — a field added to
 * `Character` tomorrow is absent from the wire by construction rather than by anybody
 * remembering to exclude it. `projection.test.ts` walks `Character.shape` key by key to
 * prove it, so a new field that does leak fails a test on the machine that added it.
 *
 * 📌 This file builds a projection, says whether two of them differ, and wraps one in
 * the event that carries it. *When* to send is `state/use-presence.ts` — this module is
 * pure, with no transport and no clock.
 */

import { MAX_AC, PROTOCOL_VERSION } from '../constants';
import type { Character } from '../model/character';
import type { ItemLookup } from '../model/derived';
import { computeArmorClass } from '../model/derived';
import type { PublicCharacter, StateEvent } from './protocol';

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

/**
 * Whether two projections say the same thing. Field by field and element by element,
 * for the same reason the projection itself is written out longhand: a structural
 * comparison over `Object.keys` would silently start comparing whatever a tenth field
 * was, and a `JSON.stringify` comparison would answer "different" for two equal
 * projections whose keys happened to be built in a different order.
 *
 * This is what makes "debounced on change" mean *change*. A sheet re-renders for every
 * keystroke in a journal entry, and none of those is a fact about anyone else's party
 * view; without this every one of them would put 200 bytes on the wire.
 */
export function samePublicCharacter(a: PublicCharacter, b: PublicCharacter): boolean {
  return (
    a.name === b.name &&
    a.ancestry === b.ancestry &&
    a.className === b.className &&
    a.level === b.level &&
    a.hp.current === b.hp.current &&
    a.hp.max === b.hp.max &&
    a.ac === b.ac &&
    a.carryingLight === b.carryingLight &&
    a.luck === b.luck &&
    a.conditions.length === b.conditions.length &&
    a.conditions.every((condition, index) => condition === b.conditions[index])
  );
}

/**
 * The projection, in the event that carries it (DESIGN.md §3). Broadcast, and carrying
 * nothing besides the projection and the version — not a timestamp, not a sequence
 * number, not an id: the party view shows the latest thing each peer said, and a field
 * ordering those is a field a peer could use to pin a stale row in place.
 */
export function stateEvent(character: PublicCharacter): StateEvent {
  return { v: PROTOCOL_VERSION, t: 'state', character };
}
