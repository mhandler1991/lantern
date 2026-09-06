# Authoring a content pack with an AI

> A pack is a JSON file. You can write one by hand, and most people will not — they will
> paste a template and their notes into a chat window and load what comes back.
> This page is that template, and what to do when the app says no.
>
> `DATA-MODEL.md` is the full contract. You should not need it to get a pack loading.

**You are responsible for what you load.** Put your own words in a pack, or words you
have the rights to. Lantern ships names, mechanics and page references and nothing else,
and the app never uploads your pack anywhere — a pack you load stays in your browser and
goes to the people in your room.

---

## 1. The loop

1. Paste the prompt below into a chat, with `schema/pack.schema.json` and your notes.
2. Save what comes back as `my-pack.json`.
3. Open Lantern, find the **Content** panel, and pick the file under **Pack file**.
4. If it refuses, press **Copy the problems**, paste the whole block back into the same
   chat, and load the file it gives you next.

Step 4 is why the errors look the way they do. Every problem in the file is reported at
once, each as `path — what was expected — what was there`, so a model fixes the lot in
one turn. Copy the whole block, heading and all: picking three lines out of nine is how
you end up doing this four times.

---

## 2. The prompt

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
- A talent is `{ "id": ..., "name": ... }` with optional `text` and `page`, and
  nothing else. There is no `grants` field anywhere in the format: the app records
  a talent, it never applies one.
- No formulas. "1d8" is fine, and "1d4/1d8" for a weapon used in one hand or two;
  "1d8 + level/2" is not.
- Reference another entry as `id` in this pack, or `pack:id`, or `pack:kind:id`.
- No HTML in any field.
- Do not copy text from a published rulebook you do not have the rights to.

Here is the schema: [paste schema/pack.schema.json]
Here is my content: [paste your notes]
```

Two things worth adding to the end of it when they apply:

- **Building on the core pack.** "The core pack's id is `core`. Its classes are
  `fighter`, `priest`, `thief`, `wizard`; reference one as `core:class:wizard`."
- **A pack of spells for a class that already exists.** "Every spell names the classes
  whose list it is on. Do not write an `extends` block." A spell declares its classes,
  so adding to a class needs no extension at all.

---

## 3. What to check before you load it

A model will produce plausible spells you never wrote. Read the file. Beyond that, four
things account for most refusals:

| It wrote | It should have written |
|---|---|
| `"id": "frostbound:hoarfrost"` | `"id": "hoarfrost"` — the pack id is added on load |
| `"tier": "2"` | `"tier": 2` — a number, not a string |
| `"range": "60 feet"` | `"range": "near"` — a band, from the list |
| `"damage": "1d8 + your level"` | `"damage": "1d8"` — nothing is ever evaluated |

And one that is not an error but is usually a mistake: **`overrides` collides on purpose.**
Leave it out unless you mean to replace something. Two packs can both define a Skald and
nothing collides — you get two Skalds, each labelled with the pack it came from.

---

## 4. The example

`packs/example-pack.json` is one of everything: a class, an ancestry, two spells, two
items, a talent, a table, and both kinds of `extends`. It is homebrew invented for that file, so
you can copy any of it. Reading it beside the schema is faster than reading either alone.

It also shows the two operations that are not just "put the thing in an array":

- **extend** — `"target": "core:class:fighter"` with a `talents` list adds to a class
  another pack defined. It never collides, and if the target is not loaded the extension
  is skipped and the rest of the pack still loads.
- **override** — `"overrides": "core:item:torch"` on an entry *replaces* the core torch,
  keeping its reference and its place in the list. The app warns when you load it. That
  warning is the feature: it is how a DM knows a supplement changed something underneath
  them.

The pack's second extension points at its own table, so the file stands alone. Yours will
usually point at somebody else's.

**A talent comes in two shapes and they are not interchangeable.** An entry in `talents`
is a *named* talent — a choice a class can be offered — and it is what an `extends` block
names. A row on a talent *table* is the result a die produced, and it is words. The
example has both: `cold-forged` in `talents`, offered to the core fighter by the first
extension, and the rows of `rimewalker-talents`. Either way a talent reaches a character
as text, so nothing on a sheet points back at your pack for it.

---

## 5. Start small

Four spells that validate beat a supplement that does not. Load them, look at the content
screen, then paste the next batch. The pack list is reorderable and nothing is permanent:
a loaded pack lasts as long as the browser tab.

*Shadowdark RPG © The Arcane Library, LLC. This project is independent and unaffiliated.*
