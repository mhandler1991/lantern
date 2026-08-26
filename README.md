# Lantern

A browser companion for playing **Shadowdark RPG** with friends who are not in the same
room. Build characters, keep your sheet, roll dice, and see the rest of the party.

**Peer to peer. No server, no database, no accounts.** Browsers talk directly over
WebRTC. The whole thing is static files on **GitHub Pages**.

- **Production** — `https://<you>.github.io/lantern/`
- **Preview** (`dev` branch) — `https://<you>.github.io/lantern/preview/`

> **Code name.** "Lantern" is internal. The public name must not imply affiliation with
> The Arcane Library.

---

## What it does

- **Character sheets** — stats, HP, AC, gear and slots, spells, talents, gold, XP,
  journal, quests
- **Guided creation** — step by step, roll or choose at every step, go back without
  losing later work
- **Shared rooms** — six-character code, optional password, one link to invite
- **The party at a glance** — everyone's HP, AC, conditions, marching order, and who is
  carrying light
- **Dice** — a small corner overlay, per-roll visibility, and random tables for talents,
  loot and creation
- **Real-time torches** — Shadowdark burns light on the clock, and the whole table sees
  the same one
- **Content packs** — the DM loads homebrew or their own material as JSON and it appears
  for everyone
- **A DM side** — secret rolls, a request queue, table settings and the scene

## What it deliberately does not do

- No maps, tokens or grids. It is not a virtual tabletop.
- **It never modifies your character from a roll.** A talent that reads "+1 to melee"
  lands as text; you apply it, the way paper always did.
- **It ships no rules text.** Spell names, tiers, ranges, durations and page references
  only.

---

## Getting started

```bash
npm install
npm run dev          # http://localhost:5173
```

```bash
npm test             # unit tests + the app smoke test
npm run typecheck
npm run build
```

### Peer connectivity

```
http://localhost:5173/test-room.html
```

Bare transport, no app code, a fixed room. Open it in three tabs; each should show two
peers. **This is the first thing to open when networking misbehaves** — it separates a
library or network problem from one of ours in about ten seconds.

---

## Documentation

| File | What it covers |
|---|---|
| [`PRD.md`](PRD.md) | What we are building, why, build order, how to iterate |
| [`DESIGN.md`](DESIGN.md) | Architecture, protocol, visual language, licensing |
| [`DATA-MODEL.md`](DATA-MODEL.md) | Pack and character schemas, validation, authoring with an AI |
| [`CLAUDE.md`](CLAUDE.md) | Development standards |
| [`DEPLOY.md`](DEPLOY.md) | GitHub Pages hosting, base paths, the deploy workflow |
| [`docs/workflow.md`](docs/workflow.md) | Branching, CI, deploy, the sync loop |

---

## Content packs

The app ships names, mechanics and page references. A DM who owns the book can load the
rest **for their own table** as a JSON pack, which also covers homebrew and third-party
material.

Packs go to the peers in the room and nowhere else. There is no directory, no sharing,
and nothing hosted. See [`DATA-MODEL.md`](DATA-MODEL.md) for the format and an AI
authoring template.

**You are responsible for having the rights to anything you load.**

---

## Known limitations

- **Your character lives in one browser.** No account means no sync. Export regularly —
  the button is on the sheet.
- **About 10-15% of connections need a TURN relay** and none is configured by default.
  Peers behind symmetric NAT or a strict firewall will join a room and never connect.
  See `DESIGN.md` §8.
- **Desktop first.** A phone will load it; the layout is not designed for one yet.
- **The repository must be public** for free GitHub Pages hosting. See
  [`DEPLOY.md`](DEPLOY.md) for alternatives if that is a problem.

---

## Licence and attribution

This product is an independent work published under the **Shadowdark RPG Third-Party
License** and is **not affiliated with The Arcane Library, LLC**.

**Shadowdark RPG © The Arcane Library, LLC.**

The exact attribution wording required by the licence is in the free Creator Kit at
thearcanelibrary.com. Use that text, not a paraphrase of it.

The code is [MIT](LICENSE). The licence covers the software only — not Shadowdark, and
not any content pack you load.
