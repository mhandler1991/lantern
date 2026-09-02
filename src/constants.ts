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

const ID_SEGMENT = `[a-z0-9-]{${ENTRY_ID_MIN_LENGTH},${ENTRY_ID_MAX_LENGTH}}`;

/**
 * The full form of a reference — `pack:kind:id`. Built from the same segment the bare
 * ids use, so a reference cannot admit a character an id would reject. A character
 * sheet stores references and nothing else about pack content, which is what lets a
 * pack be turned off without the sheet losing anything. DATA-MODEL.md §1.
 */
export const REF_PATTERN = new RegExp(`^${ID_SEGMENT}:${ID_SEGMENT}:${ID_SEGMENT}$`);

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

/**
 * 2 — every row that points at pack content also carries the player's own words, and
 * every row carries a local `id`. Version 1 could only name a thing a loaded pack
 * defined, which made a sheet built with no packs unrepresentable and contradicted
 * PRD.md principle 6. `state/character-storage.ts` migrates 1 forward.
 */
export const CHARACTER_FORMAT_VERSION = 2;

/** An exported character, as JSON. Import refuses anything larger. */
export const MAX_CHARACTER_BYTES = 512 * 1024;

export const MAX_CHARACTER_NAME_LENGTH = 60;

/**
 * A character id is generated locally and never leaves the machine except inside an
 * export file. It is bounded and pattern-checked anyway: it is used as a storage key
 * and as a React key, and an imported file is not ours.
 */
export const MAX_CHARACTER_ID_LENGTH = 32;
export const CHARACTER_ID_PATTERN = new RegExp(`^[A-Za-z0-9_-]{1,${MAX_CHARACTER_ID_LENGTH}}$`);

/**
 * Every row on a sheet — an item, a spell, a talent — carries one of these. It is a
 * React key that survives the row being edited (a key derived from the row's own text
 * changes as it is typed, which remounts the field and loses the caret), and from
 * Phase 6 it is how a DM request names the row it is about. Same shape and same bound
 * as a character id, and imported with the same suspicion.
 */
export const MAX_ROW_ID_LENGTH = 32;
export const ROW_ID_PATTERN = new RegExp(`^[A-Za-z0-9_-]{1,${MAX_ROW_ID_LENGTH}}$`);

/**
 * Level 0 is a real state, not an empty one — a character exists before it has a class.
 * The schema must be able to hold one, because refusing to load a half-built character
 * is exactly the failure PRD.md principle 4 forbids.
 */
export const MIN_CHARACTER_LEVEL = 0;

/**
 * What a blank sheet's six scores are before creation rolls or assigns them. It is a
 * placeholder, not a rule: it is `ABILITY_SCORE_BASELINE`, so a half-built character
 * shows a modifier of zero everywhere rather than a bonus nobody earned. Written as a
 * literal because that constant is declared further down this file and a forward
 * reference between two module-level `const`s throws on load; `constants.test.ts`
 * asserts the two agree.
 */
export const DEFAULT_STAT_SCORE = 10;

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
export const MAX_QUEST_LENGTH = 200;

/** Stacked in one inventory row. Arrows and rations, not a merchant's ledger. */
export const MAX_ITEM_QUANTITY = 999;

/**
 * What one of a thing costs to carry, when no loaded pack answers for it and the player
 * says so themselves. A bound on what may be typed into a box, not a rule about gear —
 * a pack's own `slots` is unaffected by it.
 */
export const MAX_ITEM_SLOTS = 99;

/** What a row starts at when it is added by hand. The player changes it. */
export const DEFAULT_ITEM_SLOTS = 1;
export const DEFAULT_ITEM_QUANTITY = 1;

/**
 * A light source burns in real time (DESIGN.md §6). Packs carry their own `minutes`;
 * this is only the fallback when an entry omits it.
 */
export const DEFAULT_LIGHT_MINUTES = 60;

/** A light that burns longer than a session is not a light source, it is a sun. */
export const MAX_LIGHT_MINUTES = 24 * 60;

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

// ---------------------------------------------------------------------------
// Transport. DESIGN.md §1 — Trystero over public Nostr relays.
// ---------------------------------------------------------------------------

/**
 * Trystero namespaces every topic by this, so two apps sharing a relay never see each
 * other. It is not a secret and it is not a room code — it identifies the software.
 * Changing it makes every existing client invisible, exactly like PROTOCOL_VERSION.
 */
export const TRYSTERO_APP_ID = 'lantern-p2p-v1';

/**
 * Every Lantern event travels on one Trystero action. One channel rather than one per
 * event type, because the event's own `t` field already discriminates it (DESIGN.md §3)
 * and a second dispatch layer would be a second place for the two to disagree.
 */
export const TRYSTERO_ACTION_NAMESPACE = 'lantern';

/**
 * Trystero encodes the action name into a fixed field of every frame and throws if the
 * name does not fit. 32 bytes in 0.25.4 — it was 12 in earlier versions, so this is
 * exactly the kind of number DESIGN.md §8 warns changes underneath us. Asserted in
 * `constants.test.ts` against the name above, so a rename that overflows fails a test
 * rather than a room join.
 */
export const TRYSTERO_ACTION_NAMESPACE_MAX_BYTES = 32;

// ---------------------------------------------------------------------------
// The peer-discovery harness — test-room.html. PRD.md §5 Phase 0.
// ---------------------------------------------------------------------------

/**
 * Fixed and hardcoded on purpose. The harness answers "can two browsers find each
 * other at all", and a room code to type in is one more thing that can be wrong.
 */
export const HARNESS_ROOM_ID = 'lantern-transport-harness';

/**
 * The harness broadcasts a beat on its own action channel. This is the only thing that
 * proves application-level messages cross the wire rather than merely that a peer
 * connection exists — the two failures look identical without it.
 */
export const HARNESS_HEARTBEAT_MS = 3_000;

/** A connected peer whose last beat is older than this is reported as silent. */
export const HARNESS_SILENCE_MS = 10_000;

/**
 * How long a peer — and the page itself — is given before its state is worth reporting.
 * A peer that joined a millisecond ago has not sent a beat yet and is not a fault; a
 * page 40ms old has no relay socket open yet and is not a network outage. Warning about
 * either puts a red herring at the top of the log, which is the one thing this page
 * must never do. Two heartbeat intervals, so one beat can be missed before it counts.
 */
export const HARNESS_SETTLE_MS = HARNESS_HEARTBEAT_MS * 2;

/** How often the harness re-reads the transport and re-renders. */
export const HARNESS_RECONCILE_MS = 2_000;

/** The log is a ring buffer. A page left open overnight must not exhaust the tab. */
export const MAX_HARNESS_LOG_LINES = 500;

// ---------------------------------------------------------------------------
// Derived values. CLAUDE.md §4 — computed on read, never stored.
// ---------------------------------------------------------------------------

/**
 * A modifier is `(score − BASELINE) / PER_POINTS`, rounded down. Both halves are named
 * because the shape of that formula is a product decision about the system being
 * played, not an arithmetic detail: a pack for a different game would move both.
 */
export const ABILITY_SCORE_BASELINE = 10;
export const ABILITY_POINTS_PER_MODIFIER = 2;

/** AC with nothing worn, before dexterity. Armour entries in a pack replace it. */
export const UNARMORED_AC = 10;

/** Carry capacity is strength, or this, whichever is larger. */
export const MIN_CARRY_SLOTS = 10;

/** Coins are weightless until there are enough of them; this many fill one slot. */
export const COINS_PER_SLOT = 100;

/**
 * XP needed to advance is `level × this`, and resets on each level — which is why a
 * sheet can hold `level: 3, xp: 6` (DATA-MODEL.md §11) rather than a running total.
 */
export const XP_PER_LEVEL = 10;

/** A spellcasting check is against this plus the spell's tier. */
export const SPELL_DC_BASE = 10;
