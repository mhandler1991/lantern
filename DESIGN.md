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
type PublicCharacter = {   // net/protocol.ts — exactly what travels
  name: string;
  ancestry: string;        // a word, not a ref: the peer reading it may not have the pack
  className: string;
  level: number;
  hp: { current: number; max: number };
  ac: number;              // derived on the sender's machine, bounded here as a claim
  conditions: string[];
  carryingLight: boolean;
  luck: number;
};

type PartyMember = { id: string } & PublicCharacter;   // `id` added on receipt
```

**There is no `id` on the wire.** It is the peer id the transport reports, added when
the event is received (`ReceivedEvent`), so a peer has no field in which to claim to be
someone else. §3's identity rule is a property of the schema rather than a step someone
has to remember.

Roughly 200 bytes. Broadcast debounced on change — `state`, over
`BROADCAST_DEBOUNCE_MS`, from `state/use-presence.ts`.

Two rules about *when*, both in the hook:

- **Compared before it is scheduled.** The sheet re-renders on every keystroke and
  almost none of those keystrokes touch one of the nine fields, so a change is a change
  to the projection (`samePublicCharacter`) rather than a change to the sheet. Without
  it, typing a journal entry would broadcast the party view's worth of bytes per letter.
- **Trailing, and dropped on the way out.** The value worth sending is the one the
  player stopped on, not the first frame of a drag. A broadcast still pending when the
  room closes is discarded rather than flushed — the opposite of a pending save, because
  an unwritten save is data the player loses and an unsent projection is a message to a
  table we are walking away from.

The projection also travels in `hello`, to each peer as it arrives, so a peer that joins
after a change is told the current sheet and needs no broadcast of its own.

**Everything else stays local**: gold, journal, quests, gear, spells known, notes,
history. Not encrypted-and-sent. **Not sent.**

### The party view

`ui/PartyView.tsx` draws exactly the nine fields above, one block per seat: marching
number, name, host and "you" tags, a light mark, level·ancestry·class, an HP bar with the
numbers beside it, AC, luck, and conditions as chips. It is what the projection is *for*,
and it is the boundary made visible — a player reading it is reading everything anyone at
the table can see about them, which is why the panel says so in as many words.

**It has no handlers at all.** No button, no input, no `onChange` anywhere in the file.
That is "one writer per character" as a property of the component rather than a rule to
remember: there is nothing in it that could write. Phase 6's request queue sits beside it
and still writes nothing — it asks the owning client to.

**Marching order is seat order until the DM sets one** (Phase 6). Arbitrary as a line of
people, but derived identically on every client, so nobody argues about who is in front.
`marchingOrder` in `ui/party.ts` is the single place a DM-set order lands.

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
| `hello` | to one peer, on connection | Identity: name, projection, joinedAt |
| `state` | broadcast | Updated public projection |
| `roll` | broadcast | A roll and its result |
| `request` | to one peer | "May I", or "take 6 damage" |
| `response` | to one peer | Allowed / refused |
| `pack` | to one peer | A content pack, chunked |
| `scene` | broadcast | DM sets location and torch mode |

`net/protocol.ts` is that table, executable: a `z.discriminatedUnion` over `t`, every
branch a `strictObject` spreading a shared `{ v }` envelope so none can forget the
version. Three notes on what the schemas deliberately do **not** hold:

- **No `total` on a roll.** It is the dice plus the modifier. A derived value on the
  wire is a derived value stored, and sending one means either recomputing and ignoring
  it or trusting a number a peer chose.
- **No `just-me` visibility.** A secret roll is not broadcast at all, so the wire type
  cannot express one. §4's rule lives in the type rather than in a reviewer's memory.
- **No `to` on a request.** The recipient is the peer `sendTo` was given; a second copy
  inside the payload is a second chance for the two to disagree.

A `pack` travels as `MAX_PACK_CHUNK_BYTES` slices of its JSON, at most
`MAX_PACK_CHUNKS` of them, reassembled in `seq` order before the pack parser sees it.

### Rules that are not negotiable

**Identity comes from the transport, never the payload.** No event carries a sender
field at all — there is nothing to overwrite, because there was never anywhere to write
the lie. A peer can lie about its numbers; it must not be able to act as someone else.

```ts
onMessage: ({ from, data }) => receiveEvent(from, data)   // the only `from` there is
```

A payload that carries one anyway is refused whole rather than read with the claim
ignored, and the refusal *names* it (`identityClaimsIn`): a spoof and a stale build are
both "unrecognized key" to Zod, and they are not the same thing to whoever is reading
the log. `net/spoofing.test.ts` proves the path end to end — a peer sending any event
under any name for a sender lands on its own row and no one else's.

A peer id is not a credential. Trystero generates its own with `genId(20)`, but the id
we are *told* about arrives in a signalling payload the remote peer wrote, so a peer
picks the string it is known by. What it cannot pick is which connection its message
arrives on, and that is what attribution is.

**Validate on the way out and on the way in.** Outbound catches our own bugs before they
reach a peer. Inbound is the wall. Both run even when there is one player.

**Version the protocol and reject mismatches.** There is no negotiation. A version bump
means old and new clients cannot see each other, which is correct and must be visible.
`parseEvent` checks `v` *before* the union so the rejection can name both versions —
"this peer speaks protocol 2 and you speak 1" is something a user can act on, and
"invalid literal at v" is not.

**Validation runs in both directions, always.** `encodeEvent` puts an outbound event
through the same union, with one player at the table and no room open. The bug it
catches is ours, and this is the last machine on which it can still be debugged.

### Host

Longest present, ties broken by peer id. Every client computes it from data it already
has, so all clients agree with no election and host migration is automatic — a host that
leaves is replaced by the roster losing a row, and nothing is announced or handed over.

`net/presence.ts` is that rule, and three things in it are what make "all clients agree"
true rather than hopeful:

- **Only a peer that has said `hello` is a candidate.** `joinedAt` arrives there and
  nowhere else. A connected peer whose `hello` has not landed is *present* — it is in
  the roster and it is drawn — but seating it would mean seating a different host on
  every client for as long as one hello was in flight, because whether we have heard
  from it yet is a fact about our machine and not about the room.
- **The tie-break compares code units, not locales.** `localeCompare` orders strings
  differently under different locales and ICU builds, which is exactly how two browsers
  at one table would disagree about which of two peers is first.
- **Nothing is timed out locally.** A peer leaves when the transport says it left. An
  idle-eviction timer fires at a different moment on every client and splits the roster.

`hello` is sent to each peer as it connects rather than broadcast on join: at the moment
we join the peer list is empty, so a broadcast reaches nobody. `onPeerJoin` fires on both
sides of every new connection, so one directed `hello` per join tells exactly the peer
that needs telling, exactly once.

A peer can lie about `joinedAt` to claim the chair. It is a cosmetic role with no
authority over anyone's dice, so this is not worth a consensus protocol.

### The transport boundary

`net/transport.ts` is the interface — `broadcast`, `sendTo`, `getPeers`, `leave`, and
peer join/leave/message callbacks. It imports no library. `net/trystero.ts` is the only
file in the app that imports Trystero, and it names the slice of that API it uses as
`RoomLike`/`JoinRoomLike`, with the real `joinRoom` assigned to it at module load. That
assignment is the guard §8 asks for: an upgrade that moves a signature fails
`npm run typecheck` in one file instead of failing a room join in a browser.

Three things the boundary is responsible for:

- **Identity.** An inbound message arrives as `{ from, data }` where `from` is the peer
  id the transport reports. `data` stays `unknown` until `net/protocol.ts` parses it. An
  id the library reports that we cannot use — missing, empty, past `MAX_PEER_ID_LENGTH`
  — drops the message as `unattributable` rather than attributing it to a guess.
- **Errors as values.** Join, send and leave return a `Result`. Sending to a peer that
  has gone is `unknown-peer` — Trystero's own `send` only prints a console warning and
  resolves, which would read to the caller as delivery.
- **`MAX_EVENT_BYTES`.** Checked outbound and inbound. Trystero decodes a payload before
  we see it, so inbound this bounds what is parsed and kept, not what is received.

Every peer event is logged, `console.info` by default, because a peer bug is diagnosed
from a console — usually somebody else's, after the fact. A payload that fails validation
is logged there too, as a warning, and shown in the lobby: the banner is gone the moment
the next one arrives, and the console is what is still there afterwards.

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

**A pack owns the words on a row it answers for.** Picking from a pack stores a reference,
never a copy, and the name is read back out of the stack every render — so a supplement
that overrides an item changes what the sheet says without touching what it holds. The
fields a pack answers for are therefore read only while it is on, for the same reason
they are read only when it is off: a typed value would be discarded the moment the pack
answered again. The way out is the picker's own first option, which puts the field back
to the player's own words.

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
The modes and the DM's control of them are Phase 6; the burn itself is not.

**Burning down is arithmetic, never a countdown.** A light stores when it was lit and how
long it burns, and nothing else (`DATA-MODEL.md` §12). `model/light.ts` turns that pair
plus a moment into what is left — pure, with `now` as an argument — and
`state/use-light-clock.ts` re-renders so the sum is redone against a newer clock.

That hook's interval is a **repaint trigger, not an accumulator**: every tick reads
`Date.now()` afresh, so a tick that fires late, early or never changes when the number is
redrawn and never what it is. It runs only while something is actually alight, and
re-reads on `visibilitychange` because a throttled tab's next tick can be a minute away
and looking at the torch is the first thing a player does on coming back. A reload, a
backgrounded tab and a clock corrected over NTP are then one case at three distances —
a later `now` against the same stored `litAt`. A clock that moved *backwards* reads as no
time passed: a torch is never longer for having been lit in the future.

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
| **Trystero API churn** | Pinned at `0.25.4`, which is split across `@trystero-p2p/core` and `@trystero-p2p/nostr`; `trystero` itself only re-exports the Nostr strategy. `joinRoom(config, roomId, callbacks)` takes a third argument (`onJoinError`) and `leave()` is now async. **The README and every trained-on example are behind this.** The `.d.mts` files under `node_modules/@trystero-p2p/core/dist` are the truth — read them before upgrading. `net/trystero.ts` pins the surface we use behind `JoinRoomLike`, checked at compile time. |
| **Pack schema is a contract** | Players' characters depend on it. Version it from day one. |
| **Protocol has no negotiation** | Version mismatches reject outright. Fine while everyone loads the same URL. |
| **Pages serves from a subpath** | Absolute asset paths 404 and runtime paths fail **silently**. `base: './'` plus `import.meta.env.BASE_URL` everywhere. |
| **Pages requires a public repo** | Free tier only. Netlify or Cloudflare Pages if it must stay private. |
