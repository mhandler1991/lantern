# Design — Lantern

> Architecture, protocol, visual language and the licensing position.
> Read this before touching networking, the data model, or the look of anything.

---

## 1. Shape of the system

```
Browser A ◄──── WebRTC data channel ────► Browser B
    │                                          │
    └── localStorage: full character           └── localStorage: full character
        (never leaves this machine)

Signalling: public Nostr relays, via Trystero.
Hosting:    GitHub Pages. Static files, HTTPS, served from a subpath. Nothing we run.
```

There is no server. There is nothing to log into and nothing to breach.

### Stack

| Layer | Choice | Why |
|---|---|---|
| Build | Vite | Static output. `base: './'` is mandatory — Pages serves from a subpath. See `DEPLOY.md`. |
| Language | TypeScript, strict | The data model is complex and packs are hostile input |
| UI | React | Heavy form and derived state; the predecessor's vanilla approach does not scale to a character sheet |
| Validation | Zod | Pack and payload validation is a security boundary, not a formality |
| Transport | Trystero | WebRTC with relay-based signalling, no server |
| Tests | Vitest | Vite-native, jsdom available |

---

## 2. What is shared and what is not

### The public projection

Every peer sees exactly this about every other player, and nothing else:

```ts
type PublicCharacter = {
  id: string;          // the peer id from the transport, never self-reported
  name: string;
  ancestry: string;
  className: string;
  level: number;
  hp: { current: number; max: number };
  ac: number;
  conditions: string[];
  carryingLight: boolean;
  luck: number;
};
```

Roughly 200 bytes. Broadcast debounced on change.

**Everything else stays local**: gold, journal, quests, gear, spells known, notes,
history. Not encrypted-and-sent. **Not sent.**

This is the single most important design decision in the app. It solves bandwidth and
privacy together, and it is the reason the whole thing works without a database.

### One writer per character

Only your browser writes your sheet. The DM sends a *request*; your client applies it.

```
DM ──"6 damage to Corvin"──► Corvin's browser ──► Corvin's HP changes ──► broadcast
```

There is no merge, no last-write-wins, no clock. Every field has exactly one owner and
everyone else asks.

---

## 3. The protocol

### Events

| Type | Direction | Purpose |
|---|---|---|
| `hello` | broadcast | Identity: name, projection, joinedAt |
| `state` | broadcast | Updated public projection |
| `roll` | broadcast | A roll and its result |
| `request` | to one peer | "May I", or "take 6 damage" |
| `response` | to one peer | Allowed / refused |
| `pack` | to one peer | A content pack, chunked |
| `scene` | broadcast | DM sets location, torch state, settings |

### Rules that are not negotiable

**Identity comes from the transport, never the payload.** On receipt, overwrite the
sender field with the peer id the transport reports. A peer can lie about its numbers;
it must not be able to act as someone else.

```ts
onMessage: (data, { peerId }) => handle({ ...data, from: peerId })
```

**Validate on the way out and on the way in.** Outbound catches our own bugs before they
reach a peer. Inbound is the wall. Both run even when there is one player.

**Version the protocol and reject mismatches.** There is no negotiation. A version bump
means old and new clients cannot see each other, which is correct and must be visible.

### Host

Longest present, ties broken by peer id. Every client computes it from data it already
has, so all clients agree with no election and host migration is automatic.

A peer can lie about `joinedAt` to claim the chair. It is a cosmetic role with no
authority over anyone's dice, so this is not worth a consensus protocol.

---

## 4. Dice

### 2D, and that is a simplification rather than a compromise

The predecessor project rendered physically simulated 3D dice. Because physics cannot be
trusted to agree across browsers, results had to be decided first and the dice **forced**
to land on them. Every expensive bug in that project came from the forcing: a broken d4
face swap, silent failures when the simulation hit its iteration limit, duplicated face
labels, and an entire verification layer to catch the animation disagreeing with the
result.

**With no physics there is nothing to force and nothing to verify.** Roll a number, show
a number.

Reused from that project: the roll protocol, and the 2D die silhouettes it already
carried as its low-GPU fallback.

If a group wants the felt, link out: "roll this on the table" opens The Table with the
pool prefilled. Two apps that know about each other beats one carrying the other's
weight.

### RNG

`crypto.getRandomValues` with **rejection sampling**. `% 20` is biased because 2^32 does
not divide evenly by 20. The skew is invisible in play and someone will eventually run a
million rolls and post the histogram.

### The overlay is one component

A table roll is a roll plus a lookup. Nothing else.

```
roll 2d6 → 8 → look up in a table → show that row's text
```

Free rolls come from the handle. **Table rolls are never chosen from the overlay** —
they arrive from context: level up opens your class's talent table, the DM's loot button
opens a loot table.

**The app never parses a result.** "+2 to your spellcasting checks" is a string from a
pack. We look up which row you rolled and print it. That is the whole operation.

### Visibility

Per roll, not per player: `everyone` | `just-me` | `dm-only`.

A secret roll must not broadcast its numbers at all. Sending them and hiding them client
side is not secret.

### Where others see it

Same corner as your own overlay, so the corner is universally where dice happen.
Non-interactive, self-dismissing, plus a permanent entry in the feed. Nobody's screen
gets hijacked.

---

## 5. Content packs

See `DATA-MODEL.md` for the schema. Design decisions:

**Three operations.** `define` adds (default, never collides). `extend` adds to something
that exists (never collides). `override` replaces by id (explicit, warned).

**IDs are namespaced by pack.** Two packs can both have a Skald and nothing collides —
you get two Skalds, each labelled with its source. A collision exists only when somebody
typed the word `overrides`, which makes the warning meaningful.

**`text` is optional everywhere.** Core ships without it and falls back to a page
reference; a pack may supply it. This one decision is what makes the licensing position
work, and it must be in the schema from day one.

**Enums over free text.** `"range": "near"` not `"60 feet"`. Validatable, sortable, and —
the reason people miss — **an enum is a list you can put in a prompt**.

**No formulas, no scripting, no HTML.** No expression evaluator. Text renders as text
nodes, never `innerHTML`. A pack arrives from another peer and is hostile input.

**Turning a pack off never destroys a character.** Anything already in use stays on the
sheet, marked and read only.

---

## 6. Visual language

> **A dark room with real paper on the table.**

📌 This section is implemented in `src/styles/tokens.css`, which is the only file
allowed to hold a raw colour or length. It has two layers: **palette** names the
material (`--parchment`, `--torch`), **roles** name the job (`--surface-page`,
`--rule-hairline`). Components use roles — the torch dims the room by reassigning
them, so a component reaching past a role into the palette stops dimming with it.

Shadowdark's own book design is deliberately stark: white pages, black bars, no ornament.
That is an OSR statement, and the licence FAQ explicitly permits matching it. But a book
is already a physical object in your hands and a screen has to earn that.

So: keep the structural language, give it material.

- **Chrome is the room.** Dark wood grain, leather, torchlight from above, corners
  falling away.
- **Content is paper.** Warm parchment, blotching, a fine tooth, a gold hairline ruled
  inside the edge, a real shadow.
- **Black banners stay.** The most recognisable thing about the book's design, and a
  black bar on parchment is exactly how it looks.
- **Long text reads as ink on paper**, which is a legibility decision as much as an
  aesthetic one.

### Type

| Face | Job |
|---|---|
| **Cinzel** | Headings, names, numbers. Roman inscriptional caps — where fantasy typography actually comes from. |
| **EB Garamond** | Prose. A character sheet is a document. |
| **Montserrat** | Small uppercase labels. Preserves the Shadowdark nod. |

### The torch

Shadowdark burns light in **real time**, and it is the mechanic nothing else handles
well. So it is the app's chrome rather than a widget.

Three DM-selected modes: **dims the room** (the interface darkens and sepia-shifts, then
closes to a pool of light), **bar only** (timer, no atmospherics), **off**.

Room-wide, so the table agrees on how atmospheric it is being. Changeable mid-session.

---

## 7. Licensing

**Shadowdark RPG is © The Arcane Library, LLC.** This project ships under the Shadowdark
RPG Third-Party License.

### The line

The licence permits referencing **game concepts and names**. It does **not** permit
**verbatim text** or artwork.

| Ship | Never ship |
|---|---|
| Spell, class, ancestry, item names | Spell descriptions |
| Tier, range, duration, slots, dice | Flavour or rules prose |
| AC, HP, slot and luck mechanics | Verbatim table text |
| Page references | Artwork |

The licence FAQ separately permits a similar look and feel, including the typeface and
black headers.

### Attribution is required

On an About screen and in the repo, whether or not money changes hands. Exact wording
comes from the licence; get the current text from the Creator Kit at
thearcanelibrary.com rather than copying it from here.

### Lines we hold

Content packs move responsibility to whoever uploads. That is the right place for it and
it is not a blanket shield. So:

- **No pack directory, no sharing, no marketplace.** A browsable list of community packs
  makes us a distributor.
- **Packs never touch anything we operate.** Trivially true with no backend, and an
  argument for keeping it that way.
- **No PDF import tool.** Shipping a scraper is materially different from accepting a
  file someone made.
- **Room-scoped by default**, with an explicit opt-in to keep a pack.
- **One line in the upload dialog**: you are responsible for having the rights to what
  you load.

### Naming

The public name must not imply affiliation. Not "Shadowdark Companion". "Lantern" is the
internal code name; confirm the public one before any marketing string ships.

---

## 8. Known risks

| Risk | Standing |
|---|---|
| **TURN / NAT traversal** | ~10-15% of connections need a relay. Trystero ships STUN only. Add TURN **only** with working credentials — the predecessor shipped dead public relays and it was worse than none. |
| **Characters live in one browser** | No account means no sync. Export is the mitigation and must be prominent. |
| **Trystero API churn** | Pinned at `0.25.4`, which is split across `@trystero-p2p/core` and `@trystero-p2p/nostr`; `trystero` itself only re-exports the Nostr strategy. `joinRoom(config, roomId, callbacks)` takes a third argument (`onJoinError`) and `leave()` is now async. **The README and every trained-on example are behind this.** The `.d.mts` files under `node_modules/@trystero-p2p/core/dist` are the truth — read them before upgrading. |
| **Pack schema is a contract** | Players' characters depend on it. Version it from day one. |
| **Protocol has no negotiation** | Version mismatches reject outright. Fine while everyone loads the same URL. |
| **Pages serves from a subpath** | Absolute asset paths 404 and runtime paths fail **silently**. `base: './'` plus `import.meta.env.BASE_URL` everywhere. |
| **Pages requires a public repo** | Free tier only. Netlify or Cloudflare Pages if it must stay private. |
