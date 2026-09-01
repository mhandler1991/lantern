/**
 * Every business-rule number in Lantern. CLAUDE.md §2.10 — no limit inline, anywhere.
 *
 * Three kinds of number live here and they are not interchangeable:
 *
 *   - **Protocol and format versions.** Changing one is a breaking change for peers or
 *     for saved characters. DESIGN.md §3 — there is no negotiation.
 *   - **Validation caps.** The wall against hostile input. A pack or a payload arrives
 *     from another peer, so every string and every array is bounded before it is trusted
 *     (DATA-MODEL.md §9). These are ours to choose: generous enough that no honest
 *     author hits one, small enough that a malicious peer cannot exhaust memory.
 *   - **Shape of the game.** Party size, room code length, how many dice one roll may
 *     contain. Product decisions from PRD.md §4.
 *
 * 🚫 Nothing here is rules text, and nothing here adjudicates. A cap is a bound on
 * input, never a statement about what a character may do.
 */

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

/**
 * Bumping this makes old and new clients invisible to each other, deliberately.
 * A mismatch is rejected outright and shown; it is never negotiated. DESIGN.md §3.
 */
export const PROTOCOL_VERSION = 1;

/**
 * Hard ceiling on a single decoded event. Trystero fragments large payloads for us, so
 * this is a memory bound rather than a transport one: an inbound message larger than
 * this is dropped before it is parsed.
 */
export const MAX_EVENT_BYTES = 64 * 1024;

/**
 * Packs travel to peers in pieces (DESIGN.md §3, `pack`). 16 KB is the size every
 * WebRTC data channel implementation handles without its own fragmentation.
 */
export const MAX_PACK_CHUNK_BYTES = 16 * 1024;

/** A peer that has sent nothing in this long is treated as gone. */
export const PEER_TIMEOUT_MS = 30_000;

/** The public projection is re-broadcast on change, coalesced over this window. */
export const BROADCAST_DEBOUNCE_MS = 250;

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

/** PRD.md §4 — a 6-character code, short enough to read aloud over a call. */
export const ROOM_CODE_LENGTH = 6;

/**
 * No `0`/`O`, `1`/`I`/`L`, `5`/`S`, `2`/`Z`. The code is spoken down a voice call and
 * typed by someone who is not looking at it, so ambiguous glyphs cost more than the
 * keyspace they buy. 27 symbols over 6 places is still ~387 million rooms.
 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRTUVWXY346789';

/** PRD.md §4 — invites are `?r=CODE`, because Pages cannot rewrite paths. DEPLOY.md §1. */
export const ROOM_CODE_QUERY_PARAM = 'r';

/**
 * Six is the table, not a technical limit: full-mesh WebRTC and one DM serving packs to
 * everyone both stay comfortable there. PRD.md §4 deferred "serve packs from any peer"
 * on exactly this reasoning.
 */
export const MAX_PARTY_SIZE = 6;

/** The room password is a courtesy lock, not a security boundary. DESIGN.md §2. */
export const MAX_ROOM_PASSWORD_LENGTH = 64;

// ---------------------------------------------------------------------------
// Dice
// ---------------------------------------------------------------------------

/**
 * A pool larger than this is a mistake or an attack, never a roll somebody meant.
 * The overlay draws each die, so this also bounds what the corner has to render.
 */
export const MAX_DICE_PER_ROLL = 100;

/** d100 is the largest die any pack may name. DATA-MODEL.md §2. */
export const MAX_DIE_SIDES = 100;

/** A modifier outside this band is a typo. Warned, clamped, never silently applied. */
export const MAX_ROLL_MODIFIER = 999;

/**
 * Rejection sampling discards values that would skew a `%` reduction (DESIGN.md §4).
 * The loop is bounded so a pathological RNG cannot hang the tab; exceeding it is a
 * reportable error, not a silent fallback to a biased result.
 */
export const MAX_REJECTION_SAMPLING_ATTEMPTS = 64;

/** How long a result stays on screen before the overlay dismisses itself. */
export const DICE_OVERLAY_DWELL_MS = 6_000;

// ---------------------------------------------------------------------------
// Content packs — the envelope. DATA-MODEL.md §1.
// ---------------------------------------------------------------------------

export const PACK_FORMAT = 'lantern-pack';
export const PACK_FORMAT_VERSION = 1;

export const PACK_ID_MIN_LENGTH = 2;
export const PACK_ID_MAX_LENGTH = 32;
export const PACK_NAME_MAX_LENGTH = 60;
export const PACK_AUTHOR_MAX_LENGTH = 60;
export const PACK_DESCRIPTION_MAX_LENGTH = 300;
export const PACK_VERSION_MAX_LENGTH = 32;

/**
 * Lowercase, `a-z0-9-`. Built from the length constants above rather than repeating
 * them, so the bound and the pattern cannot drift apart.
 */
export const PACK_ID_PATTERN = new RegExp(
  `^[a-z0-9-]{${PACK_ID_MIN_LENGTH},${PACK_ID_MAX_LENGTH}}$`,
);

/** A whole pack, as JSON, before parsing. A file larger than this is refused. */
export const MAX_PACK_BYTES = 2 * 1024 * 1024;

/** How many packs may be loaded at once, core included. */
export const MAX_PACKS_LOADED = 32;

// ---------------------------------------------------------------------------
// Content packs — entries. DATA-MODEL.md §§3-8.
// ---------------------------------------------------------------------------

/** Ids inside a pack are written bare and namespaced on load: `frostbound:hoarfrost`. */
export const ENTRY_ID_MIN_LENGTH = 1;
export const ENTRY_ID_MAX_LENGTH = 48;
export const ENTRY_ID_PATTERN = new RegExp(
  `^[a-z0-9-]{${ENTRY_ID_MIN_LENGTH},${ENTRY_ID_MAX_LENGTH}}$`,
);

/** A cross-pack reference: `core:class:wizard`. Three bare ids and two colons. */
export const MAX_REF_LENGTH = ENTRY_ID_MAX_LENGTH * 3 + 2;

/** Free text is allowed in exactly three places: `name`, `text`, `description`. */
export const MAX_NAME_LENGTH = 60;
export const MAX_TEXT_LENGTH = 1_000;
export const MAX_DESCRIPTION_LENGTH = 300;

/** Per content array — classes, spells, items, talents, tables, ancestries. */
export const MAX_ENTRIES_PER_ARRAY = 500;

/** d100 tables exist, so a table must be able to hold a row for every face. */
export const MAX_TABLE_ROWS = 100;
export const MAX_EXTENDS_PER_PACK = 200;

/** Weapon properties, class weapon and armour lists, a spell's class list. */
export const MAX_TAGS_PER_ENTRY = 32;

/** Shown when `text` is absent. A page reference the size of a phone book is a typo. */
export const MAX_PAGE_NUMBER = 9_999;

/** DATA-MODEL.md §2 — spell tiers run 1 to 5. */
export const MIN_SPELL_TIER = 1;
export const MAX_SPELL_TIER = 5;

/** DATA-MODEL.md §5 — `highestTierByLevel` is indexed by level − 1, one entry per level. */
export const MAX_CHARACTER_LEVEL = 10;

// ---------------------------------------------------------------------------
// Characters. DATA-MODEL.md §11.
// ---------------------------------------------------------------------------

export const CHARACTER_FORMAT = 'lantern-character';
export const CHARACTER_FORMAT_VERSION = 1;

/** An exported character, as JSON. Import refuses anything larger. */
export const MAX_CHARACTER_BYTES = 512 * 1024;

export const MAX_CHARACTER_NAME_LENGTH = 60;
export const MIN_STAT = 1;
export const MAX_STAT = 30;
export const MAX_HP = 999;
export const MAX_LUCK = 99;
export const MAX_XP = 9_999;
export const MAX_COIN = 999_999;

/** Bounds on the lists a sheet carries. Generous — nobody honest reaches one. */
export const MAX_ITEMS = 200;
export const MAX_SPELLS_KNOWN = 200;
export const MAX_TALENTS = 100;
export const MAX_LIGHTS = 20;
export const MAX_CONDITIONS = 20;
export const MAX_CONDITION_LENGTH = 40;
export const MAX_JOURNAL_ENTRIES = 500;
export const MAX_JOURNAL_ENTRY_LENGTH = 4_000;
export const MAX_QUESTS = 100;

/**
 * A light source burns in real time (DESIGN.md §6). Packs carry their own `minutes`;
 * this is only the fallback when an entry omits it.
 */
export const DEFAULT_LIGHT_MINUTES = 60;

/** How often the torch bar re-reads the clock. Burn-down is computed from timestamps,
 *  never accumulated by tick, so a backgrounded tab cannot drift. */
export const LIGHT_TICK_MS = 1_000;

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** localStorage keys are prefixed so nothing on the origin collides with the app. */
export const STORAGE_PREFIX = 'lantern:';

/** Bumped only when a stored shape changes in a way that needs migrating. */
export const STORAGE_VERSION = 1;

/** Writes to localStorage are coalesced; a character sheet is edited keystroke by keystroke. */
export const PERSIST_DEBOUNCE_MS = 500;
