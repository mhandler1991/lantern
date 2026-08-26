# PRD — Lantern

> Product decisions: what we are building, why, and in what order.
> **Code name: Lantern** (internal only — the public name must not imply affiliation
> with The Arcane Library. See `DESIGN.md` §Licensing.)

---

## 1. What this is

A browser-based companion for playing **Shadowdark RPG** with friends who are not in
the same room. Players build characters, keep their sheets, roll dice, and see each
other's state. One player runs the table as DM.

**Peer to peer. No server, no database, no accounts.** Browsers talk directly to each
other over WebRTC. The whole app is static files, hosted free on **GitHub Pages**.

### What it is not

- Not a virtual tabletop. No maps, tokens, grids or fog of war.
- Not a rules engine. It records what you rolled; it never decides what that means.
- Not a rulebook. It ships names, mechanics and page references, never rules text.
- Not a replacement for owning Shadowdark.

---

## 2. Why it exists

The group already plays Shadowdark remotely with a hand-built HTML character sheet
passed around as a file. It works, and everything it cannot do is a coordination
problem: nobody can see anyone else's HP, the DM has no view of the party, torches are
tracked by whoever remembers, and character files are emailed around.

Every one of those is solved by putting the sheets in the same room.

---

## 3. Principles

These decide arguments. When a feature conflicts with one of these, the principle wins.

**1. Record, do not adjudicate.**
A talent that reads "+1 to melee attacks" lands on your sheet as text. The app does not
touch your attack bonus. Effects engines are where character-sheet apps go to die, and
the paper version never did it either.

**2. One writer per character.**
Only your browser edits your sheet. The DM *asks*; your client applies. This removes
conflict resolution entirely and mirrors how a real table works.

**3. Model authority, enforce nothing.**
The DM has real authority and the app should express it. It cannot and should not
enforce it: every client runs its own code. Approval is a record and a courtesy, not a
security boundary, and the UI must never imply otherwise.

**4. Warn, do not block.**
A pack referencing a missing item, a character using content that was turned off, a
peer sending something odd — warn, degrade, keep going. Never destroy player data and
never refuse to load a character.

**5. Ship no rules text.**
Names, mechanics and page references only. A DM who owns the book can load the rest for
their own table.

**6. Everything is optional except the sheet.**
Torch, approvals, packs, even the room. A player must be able to open the app, build a
character, and use it alone.

---

## 4. Scope

### In scope

| Area | What |
|---|---|
| **Character sheet** | Stats, HP, AC, gear, slots, spells, talents, gold, XP, journal, quests |
| **Creation** | Guided walkthrough, backwards navigation, roll or choose at every step |
| **Rooms** | 6-character code, optional password, invite link |
| **Party view** | Public projection of every character, marching order, light, scene |
| **Dice** | Corner overlay, 2D dice, visibility per roll, table lookups |
| **Random tables** | Talents, loot, monsters, creation, homebrew — rolled or chosen |
| **Content packs** | DM uploads JSON; classes, ancestries, spells, items, tables |
| **DM** | Secret rolls, request queue, table settings, scene, party view |
| **Portability** | Export/import a character as a file |

### Out of scope, permanently

- Maps, tokens, grids, fog of war
- Automatic stat modification from talents or items
- Accounts, cloud saves, or any server-side storage
- Chat or voice (they are already on a call)
- Systems other than Shadowdark

### Deferred

| Item | Why deferred |
|---|---|
| Mobile layout | Desktop first. Portrait needs its own seat layout, not a scaled one. |
| 3D dice | See `DESIGN.md` — no physics removes an entire class of bugs. Link out to The Table instead. |
| `grants` on table results | Needs an effects engine. Revisit only for flat stat bumps. |
| Serve packs from any peer | DM serving is fine for six people. |
| Split pack metadata from text | Only worth it once packs carry monster blocks or adventure text. |
| Campaign log export | The request queue is already a session record; export it later. |

---

## 5. Build order

Each phase is independently testable and leaves the app in a usable state. **Do not
reorder** — later phases depend on earlier ones being proven.

### Phase 0 — Transport spike 🔬

**Build `test-room.html` before any app code.** Bare Trystero, fixed room name, three
tabs, a peer counter and a log. No sheet, no dice, no UI.

This exists because the predecessor project spent five rounds and four wrong diagnoses
on a peer discovery bug, and the thing that finally located it was exactly this page.
Building it first costs an hour and is the single highest-value hour in the project.

**Done when:** three tabs on one machine, and a laptop plus a phone on cellular, all
show each other. Keep the page in the repo forever; it is the first thing you open when
networking misbehaves.

### Phase 1 — Data model and the sheet 📄

Character types, derived value calculations, localStorage persistence, export/import,
and the sheet UI. **Entirely local.** No networking, no packs.

Port the calculations from the existing HTML sheet: AC, slots, XP thresholds, modifiers,
torch burn-down.

**Done when:** you can build a character by hand, close the tab, reopen it, and export
a file that imports cleanly.

### Phase 2 — Content packs 📦

Pack schema, Zod validation, loading, override/extend resolution, the content screen.
Still local — packs load from a file picker.

**Done when:** the core pack drives every picker in the app, a homebrew pack adds a
class, and a malformed pack produces errors precise enough to paste into an AI.

### Phase 3 — Dice and tables 🎲

The corner overlay. Free rolls and table lookups, visibility control, CSPRNG with
rejection sampling. Still local — results appear only for you.

**Done when:** you can roll a weapon from your sheet and roll on a talent table, and the
result records without modifying anything.

### Phase 4 — Character creation 🧙

The walkthrough. Depends on packs (choices) and dice (rolling stats and tables).

**Done when:** a new player reaches a complete character without reading instructions,
and can go back to any step without losing later work.

### Phase 5 — Rooms 🔗

Transport (from the Phase 0 spike), lobby, room codes, presence, the public projection,
the party view, roll broadcast.

**Done when:** three real people on three networks see each other's HP change and each
other's rolls.

### Phase 6 — The DM 👑

Table settings, the request queue, secret rolls, scene, marching order, pack
distribution to peers.

**Done when:** a DM can run a real session without touching anything outside the app.

### Phase 7 — Ship 🚀

Deploy workflow, licensing attribution, format documentation, favicon and link preview,
the pack authoring guide.

**Read `DEPLOY.md` first.** GitHub Pages serves from a subpath, which breaks absolute
asset paths, and a wrong runtime path fails silently rather than erroring. That
combination cost real time on the predecessor project.

Deployment is not only a Phase 7 concern: a reachable HTTPS URL is needed from **Phase
0**, because a phone on cellular cannot reach `localhost` and cross-network peer testing
is the only honest connectivity test. Stand the deploy up early and use `/preview/`
throughout.

---

## 6. How to iterate

### The loop

1. **One GitHub issue per unit of work.** The issue anchors the branch, the commit and
   the PR. Issues carry a phase milestone (`Phase 0`–`Phase 7`, or `Foundation`), so the
   build order in §5 is visible on the board.
2. **Claude implements on a feature branch**, runs the checks, opens a PR into `dev`.
3. **You review and merge**, then tell Claude "merged #N" so it re-syncs.
4. **You test** against `/preview/`, hard-refreshed.

Full mechanics in `docs/workflow.md`.

### What to test at each phase

| Phase | The test that matters |
|---|---|
| 0 | Three tabs, then two devices on different networks |
| 1 | Build a character, reload, export, import into a fresh browser |
| 2 | Load a homebrew pack; turn it off with a character still using it |
| 3 | Roll every die type; roll a table; confirm nothing was modified |
| 4 | Hand it to someone who has never played and watch silently |
| 5 | Three people, three networks, twenty minutes |
| 6 | Run an actual session |

### Rules for iterating

**Play a session before polishing.** The predecessor project's most useful feedback came
from real use, not from review. Twenty minutes of actual play beats an hour of looking.

**When a bug resists two explanations, stop explaining and build an isolation test.**
Remove variables until only one thing can be wrong. This is why Phase 0 exists.

**Never ship a fix you have not observed working.** Say plainly when a fix is inferred
rather than confirmed, so the next test targets the right thing.

**Distrust library documentation.** Read the shipped source. In the predecessor project,
almost every hard constraint came from reading the bundle, not the README.

---

## 7. Success

**The bar:** the group plays a full session using it and does not open the old HTML file.

Secondary signals:
- A player builds a character without being talked through it
- The DM loads a homebrew pack and it just works
- Somebody outside the group uses it without asking how
