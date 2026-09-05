# Data model — Lantern

> The content pack format, the character format, and how to author them.
> A pack format is a contract players' characters depend on. Changing it casually
> breaks people's data.

---

## 1. Content packs

### The envelope

```json
{
  "format": "lantern-pack",
  "formatVersion": 1,
  "id": "frostbound",
  "name": "Frostbound",
  "version": "1.2.0",
  "author": "Max",
  "description": "A cold-weather supplement. Two classes, fourteen spells.",

  "classes": [],
  "ancestries": [],
  "spells": [],
  "items": [],
  "talents": [],
  "tables": [],
  "extends": []
}
```

Every content array is optional. A pack of four spells has one array.

| Field | Required | Notes |
|---|---|---|
| `format` | yes | Always `"lantern-pack"`. Rejects unrelated JSON early. |
| `formatVersion` | yes | Integer. Currently `1`. |
| `id` | yes | Lowercase, `a-z0-9-`, 2-32 chars. **Namespaces every id inside.** |
| `name` | yes | Shown in the UI. 1-60 chars. |
| `version` | yes | Semver. Used to detect an updated pack. |
| `author` | no | 0-60 chars. |
| `description` | no | 0-300 chars. |

`version` is only ever compared for equality — nothing orders or computes with it — so
the validator bounds it and checks it starts with a digit rather than enforcing strict
semver. `1.2.0`, `1.2.0-beta.1` and `2026.09` all pass; `v1` and prose do not.

**An optional field may be absent or `null`.** Both mean the same thing, everywhere, and
that includes `text` and `page` on every entry — a hand-written pack and a generated one
disagree about which to reach for and neither is wrong.

### IDs and namespacing

Every id inside a pack is namespaced by the pack id automatically:

```
pack "frostbound" + spell "hoarfrost"  →  frostbound:hoarfrost
```

You write `"id": "hoarfrost"`. One entry may name another in any of three forms, and
which segments are implied is filled in from the field the reference was written in:

| Form | Means | Example |
|---|---|---|
| `id` | In this pack. | a class's `"talentTable": "rimewalker-talents"` |
| `pack:id` | In another pack; the kind comes from the field. | a spell's `"classes": ["frostbound:rimewalker"]` |
| `pack:kind:id` | In another pack, written out. | a class's `"weapons": ["core:item:dagger"]` |

**A character sheet is stricter: it stores `pack:kind:id` and nothing else.** A sheet has
no field to imply a kind from, so the full form is the only one that can be resolved
years later against whatever packs happen to be loaded.

**Two packs can both define a Skald and nothing collides.** You get two Skalds, each
labelled with its source. Collisions happen only when someone writes `overrides`.

### The three operations

| Operation | How | Collides? |
|---|---|---|
| **define** | Put the thing in its array | Never |
| **extend** | Add an entry to `extends` | Never |
| **override** | Add `"overrides": "core:spell:fireball"` | Yes, deliberately. Warned. Last loaded wins. |

---

## 2. Enums

Constrained everywhere it is possible. Validatable, sortable, and **a list you can put
in a prompt** — which is most of why authoring with an AI works at all.

| Field | Allowed values |
|---|---|
| `stat` | `str` `dex` `con` `int` `wis` `cha` |
| `range` | `self` `close` `near` `far` |
| `duration` | `instant` `focus` `round` `minute` `hour` `day` `permanent` |
| `tier` | `1` `2` `3` `4` `5` |
| `die` | `d4` `d6` `d8` `d10` `d12` `d20` `d100` |
| `armorType` | `none` `light` `medium` `heavy` `shield` |
| `weaponType` | `melee` `ranged` `both` |
| `alignment` | `lawful` `neutral` `chaotic` |
| `currency` | `gp` `sp` `cp` |

Free text is allowed only in `name`, `text` and `description`.

---

## 3. Spells

```json
{
  "id": "hoarfrost",
  "name": "Hoarfrost",
  "tier": 2,
  "classes": ["wizard", "frostbound:rimewalker"],
  "range": "near",
  "duration": "focus",
  "text": "Optional. Present only in packs, never in core.",
  "page": 53
}
```

**The spell is the source of truth for which lists it is on.** A class names its list; a
spell declares its classes. This means adding spells to an existing class needs no
`extends` at all — just declare the class in the spell.

`text` optional. `page` optional; shown when `text` is absent.

## 4. Items

```json
{
  "id": "rimeblade",
  "name": "Rimeblade",
  "slots": 1,
  "cost": { "amount": 90, "currency": "gp" },
  "weapon": {
    "type": "melee",
    "damage": "1d8",
    "properties": ["versatile"]
  },
  "armor": null,
  "text": "Optional.",
  "page": null
}
```

`damage` is dice notation and **never an expression** — `1d8`, or `1d4/1d8` for a weapon
used in one hand or two. `1d8 + level/2` is refused, and nothing in the app would
evaluate it if it were not. `properties` are tags in the same shape as an id
(`versatile`, `two-handed`), not sentences, so a sheet can group by them; a property that
needs explaining goes in `text`.

`weapon` and `armor` are both optional and mutually exclusive in practice — **and that is
not enforced**. A shield that also hits is somebody's homebrew, not a malformed file. An
armour entry looks like:

```json
"armor": { "type": "light", "ac": 12, "addDex": true }
```

## 5. Classes

```json
{
  "id": "rimewalker",
  "name": "Rimewalker",
  "hitDie": "d6",
  "weapons": ["core:item:dagger", "core:item:staff"],
  "armor": ["none"],
  "spellcasting": {
    "stat": "wis",
    "highestTierByLevel": [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]
  },
  "talentTable": "rimewalker-talents",
  "text": "Optional.",
  "page": null
}
```

XP thresholds are uniform across Shadowdark classes, so there is no per-class
progression to model.

`spellcasting` is `null` for non-casters. `highestTierByLevel` is indexed by level − 1.

**A class referencing an item no pack defines warns and renders as plain text.** It does
not block the pack. (`PRD.md` principle 4.)

## 6. Ancestries

```json
{
  "id": "frostborn",
  "name": "Frostborn",
  "talent": "Optional text describing the ancestry knack.",
  "page": null
}
```

## 7. Tables

Random tables are first class. Talents, loot, monsters, creation, quirks — all one shape.

```json
{
  "id": "rimewalker-talents",
  "name": "Rimewalker talents",
  "die": "2d6",
  "rerollable": false,
  "rows": [
    { "roll": 2,      "text": "Choose a talent or +2 to a stat" },
    { "roll": [3, 6], "text": "+1 to melee and ranged attacks" },
    { "roll": [7, 9], "text": "+2 to your spellcasting checks" },
    { "roll": [10, 11], "text": "+1 to a stat of your choice" },
    { "roll": 12,     "text": "Choose any talent" }
  ]
}
```

- `roll` is a single number or an inclusive `[low, high]` range
- Ranges must not overlap and must cover the die's full span
- `die` accepts `2d6`, `1d20`, `d100` — count optional, defaults to 1
- `rerollable` lets a table offer a reroll before the result is kept. Absent or `null`
  means `false` — an omitted flag costs an author a default, never their pack
- Gaps and overlaps are **warnings, not refusals** (`PRD.md` principle 4). The schema
  checks that each row is well formed; coverage is checked where the lookup happens,
  `src/model/tables.ts`

**Table results are recorded, never applied.** There is no `grants` field, and a pack
that ships one is told so rather than having it silently ignored. That is deliberate
(`PRD.md` principle 1).

`src/model/pack.ts` is §§1-7 executable, and `pack.test.ts` parses the examples above
verbatim — the same arrangement §11 has with `character.ts`. Two arrays are still only
counted: `talents`, which this document gives no shape, and `extends`, whose `target`
means nothing without the resolution that applies it.

## 8. Extends

```json
"extends": [
  { "target": "core:class:wizard", "talents": ["frostbound:frost-affinity"] },
  { "target": "core:table:loot-minor", "rows": [ { "roll": [19, 20], "text": "A rimeblade" } ] }
]
```

Extensions apply in **load order**, so the pack list is reorderable and the resulting
stack is shown in the UI:

```
Wizard = core (32 spells, 4 talents) + Frostbound (4 spells) + Cursed Scroll 1 (2 talents)
```

An extension whose `target` no pack defines **warns and is skipped**. It does not fail
the pack.

---

## 9. Validation

Validation does two jobs from one implementation.

### Security

A pack arrives from another peer. It is hostile input.

- Whitelist every field. **Reject unknown keys** rather than ignoring them.
- Cap every string length and every array length.
- Enums are exact matches.
- Text renders as text nodes. **Never `innerHTML`.**
- No formulas, no expressions, no scripting. Nothing is ever evaluated.

### Repair

Error messages are written to be **pasted back into an AI**.

```
3 problems in "Frostbound":
  spells[4].range — expected one of: self, close, near, far — got "medium"
  spells[7] — missing required field: tier
  extends[0].target — no pack defines "core:class:skald"
```

Path, expectation, actual. A model fixes that in one turn. "Invalid pack" starts a
guessing game.

---

## 10. Authoring with an AI

Most people will not read a schema. They will paste a template and their notes into a
chat window, and **making that path work well is most of the adoption.**

Ship all of:

1. `schema/pack.schema.json` — JSON Schema, for models and editors
2. `docs/authoring-prompt.md` — the template below
3. `packs/example-pack.json` — one of everything
4. The in-app validator, with copy-pasteable errors

### The prompt template

```
You are generating a content pack for Lantern, a Shadowdark RPG companion app.

Output ONLY valid JSON. No commentary, no markdown fences.

Rules:
- format is "lantern-pack", formatVersion is 1
- ids are lowercase a-z0-9- and are NOT prefixed with the pack id
- Every content array is optional; omit what you do not need
- Enums are exact:
    stat: str dex con int wis cha
    range: self close near far
    duration: instant focus round minute hour day permanent
    die: d4 d6 d8 d10 d12 d20 d100
    armorType: none light medium heavy shield
    weaponType: melee ranged both
    currency: gp sp cp
- Table `roll` is a number or an inclusive [low, high] range.
  Ranges must not overlap and must cover the whole die.
- No formulas. "1d8" is fine, and "1d4/1d8" for a weapon used in one hand or two;
  "1d8 + level/2" is not.
- Reference another entry as `id` in this pack, or `pack:id`, or `pack:kind:id`.
- No HTML in any field.
- Do not copy text from a published rulebook you do not have the rights to.

Here is the schema: [paste schema/pack.schema.json]
Here is my content: [paste your notes]
```

### Advice worth giving authors

- **Start small.** Four spells validating beats a whole supplement that does not.
- **Paste the errors back.** They are written for exactly this.
- **Check what the model invented.** It will happily produce plausible spells you never
  wrote. Read the output.

---

## 11. Characters

The character is local and never sent whole. Export writes this file.

```json
{
  "format": "lantern-character",
  "formatVersion": 2,
  "id": "c_9f3a2b",
  "name": "Vess of the Low Road",
  "ancestry": { "ref": "core:ancestry:human", "name": "" },
  "class": { "ref": "core:class:thief", "name": "" },
  "alignment": "neutral",
  "level": 3,
  "xp": 6,
  "stats": { "str": 13, "dex": 16, "con": 11, "int": 9, "wis": 12, "cha": 6 },
  "hp": { "current": 11, "max": 17 },
  "luck": 1,
  "gold": { "gp": 22, "sp": 0, "cp": 0 },
  "items": [
    { "id": "r_7c1e4a", "ref": "core:item:shortsword", "name": "", "slots": 0, "qty": 1, "equipped": true },
    { "id": "r_18bd90", "ref": null, "name": "Silvered dagger", "slots": 1, "qty": 1, "equipped": false }
  ],
  "spells": [ { "id": "r_2b4801", "ref": "core:spell:magic-missile", "name": "" } ],
  "talents": [
    { "id": "r_91af22", "text": "Your torch burns a quarter longer than anyone else's", "source": "core:table:thief-talents", "rolled": 5 }
  ],
  "lights": [ { "id": "r_3d0255", "ref": "core:item:torch", "name": "", "litAt": null, "minutes": 60 } ],
  "conditions": ["blessed"],
  "journal": [ { "id": "r_5e7713", "at": 1735689600000, "text": "The innkeeper lied about the well." } ],
  "quests": [ { "id": "r_a4c9f0", "text": "Find out what is down the well", "done": false } ],
  "packsUsed": ["core", "frostbound"]
}
```

| Field | Shape | Notes |
|---|---|---|
| `id` | `[A-Za-z0-9_-]`, 1-32 | Generated locally. A storage key and a React key. |
| every row `id` | `[A-Za-z0-9_-]`, 1-32 | Generated locally when the row is added. Two torches are two rows with the same `ref`, so `ref` is not a key and an index is not one either. |
| `ancestry`, `class` | `{ ref, name }` | `ref` names pack content; `name` is the player's own words. `{ ref: null, name: "" }` is unchosen. |
| `alignment` | enum or `null` | Null before creation fills it in. A half-built character still loads. |
| `items[]`, `spells[]`, `lights[]` | `{ id, ref, name, … }` | Same pair. A sheet built with no packs loaded has a `name` and no `ref` — PRD.md principle 6. |
| `items[].slots` | 0-99 | What **one** of it costs to carry, when no loaded pack answers for the row. A pack's own `slots` wins; this is the fallback. |
| `level` | 0-10 | Zero is a real state, not an empty one. |
| `hp.current` | may be negative | A dying character is a state the sheet has to hold. |
| `conditions` | strings | The only private field the public projection carries (`DESIGN.md` §2). |
| `journal` | `{ at, text }` | `at` is epoch milliseconds. |
| `quests` | `{ text, done }` | |
| `lights[].litAt` | epoch ms or `null` | **When** it was lit, never how much is left. Remaining time is computed from the clock, so a backgrounded tab cannot drift it. |
| `talents[].rolled` | number or `null` | The face that produced it; null when it was chosen. |

Every object is **strict**: an unknown key is rejected, not ignored. That is what makes
"no derived values" enforceable rather than merely intended — a file carrying an `ac` or
an `xpToNext` is reported, not silently stripped and re-saved.

`src/model/character.ts` is this table, executable, and its tests parse the example
above verbatim. If the two ever disagree, the tests fail.

**Derived values are never stored.** AC, slot count, modifiers, XP-to-next and spell DC
are computed. Storing them guarantees they will disagree with reality. They live in
`src/model/derived.ts`, which takes the item and class facts it needs as an argument so a
sheet can still be read with a pack turned off — an unresolved reference is reported in
the result and costs nothing.

`packsUsed` lets the app warn when a character needs a pack that is not loaded, and
render those items as orphaned rather than losing them.

Talents store the **text** and the **source**, because that text may come from a pack
that is later turned off. The sheet must survive that.

**`name` is a fallback, never a cache.** Nothing in the app copies a pack's label onto a
sheet: a row either references pack content or carries the words a player typed. That is
what keeps "the sheet holds no pack content" true while still letting somebody open the
app with no packs at all and write *Shortsword* in a box.

---

## 12. Storage

The character lives in `localStorage` under **`lantern:character`**, as the same document
§11 describes — `format` and `formatVersion` included, with no wrapper of its own. What
is stored and what an export writes are byte-identical, so storage and import are brought
forward by one migration path and cannot drift apart.

| Key | Holds |
|---|---|
| `lantern:character` | The active sheet. |
| `lantern:character.rejected` | A value the app could not read, copied aside before anything overwrote it. Never read back; it exists so "corrupt" means "set aside" rather than "gone". |

### Reading

`loadCharacter()` returns one of four outcomes and throws none of them:

| Outcome | When | What the app does |
|---|---|---|
| `loaded` | Read, migrated if needed, validated. | Opens it. `migratedFrom` names the version it came from. |
| `empty` | Nothing stored. | Opens a new character. |
| `rejected` | Not JSON, not ours, from a newer build, or failed the schema. | Copies the raw text to the rejected key, opens a new character, and shows the problems. |
| `unavailable` | The browser refused — private mode, blocked site data. | Opens a new character and says edits will not be kept. |

A rejected value is **never overwritten in place by the loader**, and an existing
rejected copy is never replaced by a later one: the first thing that broke is the likelier
to be real player data.

### `formatVersion`

Checked on every read. `CHARACTER_MIGRATIONS` maps the version being migrated **from** to
the step that produces the next one, and `migrateCharacterDocument` walks the chain from
the stored version to the current one.

- A missing step is refused, never skipped.
- A step that does not leave the document at the version it claims is refused.
- A document from a **newer** build is refused and left exactly as it was found. This
  build cannot know what a later one added; downgrading it would be the data loss
  PRD.md principle 4 forbids.

**1 → 2** is the only step so far. Version 1 could name a thing only when a loaded pack
defined it, which made a character built with no packs unrepresentable; version 2 gives
every content row a `{ ref, name }` pair, an `id`, and — on items — a `slots` fallback.
The migration wraps a v1 `ancestry` and `class` ref, stamps an id on every row, and fills
the new fields with their empty values. Nothing is dropped, and a row already carrying a
key this build does not know keeps it: the parse that follows is what judges it.

The chain is also tested against injected migrations, with versions that do not exist, so
a future step is proven against machinery that already works.

### Writing

Autosave is debounced by `PERSIST_DEBOUNCE_MS`, because a sheet is edited keystroke by
keystroke, and flushed on `pagehide`, on the tab being hidden and on unmount — a debounce
that swallows the last keystroke is indistinguishable from losing it. Every write is
validated on the way out as well as in (`CLAUDE.md` §2.7): a character that would not load
back is reported rather than stored.

### Export and import

Export writes the stored document to a file and nothing else: `src/state/character-file.ts`
validates the sheet, stringifies it, and the bytes are **identical** to what
`lantern:character` holds. `character-file.test.ts` asserts the two strings are equal, so
the sentence above fails a test rather than a session if it ever stops being true.

The file is named `lantern-character-{slug}.json` — the format first, so a folder of them
sorts together and says what it is before anything opens it, then the character's own name
reduced to `[a-z0-9-]` and capped by `MAX_CHARACTER_FILE_SLUG_LENGTH`. A name that leaves
nothing behind (no name yet, or one in another script) is dropped rather than left as
hyphens: `lantern-character.json`.

Import is the reading path above with a file in front of it, in this order:

1. The file's own `size`, before a byte is read — an oversize file is refused, not decoded.
2. The decoded text's length, because a reported size is a claim and the text is another.
3. `JSON.parse`, `migrateCharacterDocument`, `parseCharacter` — the same three, in the same
   order, as a read from storage.

Every failure comes back as problems with paths (§9) and **nothing is replaced**: a
malformed file leaves the sheet on screen exactly as it was. A file that validates is not
applied either until it is confirmed — `ui/Portability.tsx` names the character the file
holds and asks, because replacing the sheet is the one irreversible thing a player can do
and a file picker fires the moment a file is chosen (PRD.md principle 4).

An imported character keeps its `id`. A round trip is the same character, not a copy of
one — which is what makes "export here, import there" a move between browsers rather than
a duplicate at the table.
