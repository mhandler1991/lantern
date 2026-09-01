# CLAUDE.md — Lantern

> Read at the start of every session. Code name **Lantern** — the public name must not
> imply affiliation with The Arcane Library.
>
> ⚡ Claude does · 👤 you do · 🚫 never · 📌 note
>
> **`docs/rationale.md` explains why these rules exist.** It is not read by default.
> Open the entry (`R1`…`R17`) before changing or undoing the rule that cites it.

---

## 0. Document map

| Document | Read when |
|---|---|
| `PRD.md` | Starting any feature |
| `DESIGN.md` | Networking, the data model, or the look of anything |
| `DATA-MODEL.md` | A schema, a validator, or anything that reads a pack |
| `DEPLOY.md` | `vite.config.ts`, an asset path, or the deploy workflow |
| `docs/workflow.md` | Unsure how code ships, or which command to run |
| `docs/rationale.md` | **Only** when changing a rule that points there |
| GitHub Issues | Every session — issues anchor every branch, commit and PR |

🚫 Do not read all of them by default. An irrelevant document crowds out the relevant one.
**Always update `PRD.md` first** when a product decision changes.

---

## 1. Stack

Vite (static) · TypeScript strict · React 18 (function components + hooks) · Zod ·
Trystero (WebRTC) · Vitest + jsdom.

📌 **No backend, database or accounts.** If a task seems to need one, stop and flag it —
that is a product decision.

📌 **Hosted on GitHub Pages from `/lantern/`.** `vite.config.ts` sets `base: './'`, and
anything fetched at runtime resolves against `import.meta.env.BASE_URL`. 🚫 Never `'/'`
in either. A wrong runtime path produces no error at all — just missing content. → `R8`

---

## 2. Ground rules

1. **Read before writing.** Read the existing file before editing it.
2. **Context7 for library docs** before writing code against any library. Never rely on
   training data for an API. Always look up: Trystero, Zod, React, Vite, Vitest.
3. **`node_modules` is documentation.** When a library misbehaves, read the shipped source.
4. **No `any`.** Use `unknown` and narrow, or define the type.
5. **Errors are values.** Typed results at boundaries, no silent failures.
6. **Never `innerHTML` with pack or peer data.** Text nodes only. This is the XSS boundary
   and it is absolute.
7. **Validate outbound and inbound**, always, even single-player.
8. **Identity comes from the transport, never the payload.** Overwrite the sender field
   with the peer id the transport reports.
9. **Never ship rules text.** Names, mechanics and page references only. If a task would
   add rulebook prose, stop and flag it. This is a licensing boundary.
10. **Limits live in `constants.ts`.** No business-rule number inline.
11. **No `TODO` without an issue number**, except `// TODO: LATER` for deliberate deferrals.
12. **Never commit secrets**, and never hardcode an absolute path.
13. **Bulkify.** Related changes across several files land in one response. Do not ask
    permission to continue.

---

## 3. Working style

- **State assumptions inline, do not ask.** One question maximum per response, and only
  when the answer changes what gets built.
- **Batch related changes** and batch issue creation into one call.
- **Deliver complete, runnable code.** No partial implementations.
- **Skip pleasantries and do not restate these standards.** Lead with the answer.

### Writing responses ⚡

Every turn re-sends the whole conversation, so a long reply is billed once when written
and again on every later turn. Length is a cost, not a courtesy. → `R15`

- **Lead with the outcome.** What happened, what it means, what is next.
- **Aim for under 150 words.** A one-line answer is a complete answer.
- **Plain language over jargon.** "The check passed" beats "the workflow's status
  conclusion resolved to success."
- **Report numbers, not narration.** Say the test count and the failure; skip the tour of
  how you got there.
- 🚫 No recaps of what you just did in detail, no restating the user's request back, no
  tables where a sentence works, no bold on every other phrase.
- **Say what is uncertain or unfinished in one plain sentence.** Never bury it.

---

## 4. Architecture

```
src/
├── main.tsx
├── constants.ts          # every business-rule number
├── model/                # pure. no React, no DOM.
│   ├── character.ts      # types + derived values
│   ├── pack.ts           # types + resolution (define/extend/override)
│   ├── dice.ts           # rolling, rejection sampling
│   └── tables.ts         # table lookup
├── net/
│   ├── transport.ts      # interface
│   ├── trystero.ts       # implementation
│   └── protocol.ts       # events + Zod schemas
├── state/                # React state, hooks
├── ui/                   # components
└── styles/
```

**`model/` never imports React or touches the DOM.**

- **Derived values are computed, never stored.** AC, slots, modifiers, XP-to-next, spell
  DC. Storing them guarantees drift.
- **One writer per character.** The DM sends a request; the owning client applies it.
  🚫 Never write to another player's character.
- **Record, do not adjudicate.** A talent result is text on a sheet. 🚫 Never modify a stat
  from a table result.
- **Warn, do not block.** Degrade and continue. 🚫 Never destroy player data, never refuse
  to load a character.
- **Everything optional except the sheet.** The app must work alone, offline, with no room
  and no packs.

---

## 5. TypeScript

`strict: true`, no `any`, explicit return types on exports. Types over interfaces.
Discriminated unions for protocol events. Zod schemas are the source of truth at
boundaries — infer types from them.

```ts
export const RollEvent = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal('roll'),
  dice: z.array(DieResult).max(MAX_DICE_PER_ROLL),
  visibility: z.enum(['everyone', 'just-me', 'dm-only']),
});
export type RollEvent = z.infer<typeof RollEvent>;
```

| Element | Convention | Example |
|---|---|---|
| Types, components | UpperCamelCase | `PublicCharacter`, `DiceOverlay.tsx` |
| Functions, variables | lowerCamelCase | `resolvePacks()` |
| Files | kebab-case | `pack-resolver.ts` |
| Booleans | `is` `has` `can` `should` | `isRolling` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_PARTY_SIZE` |

---

## 6. React and styling

Function components only. Custom hooks for anything stateful and reusable. Keys are stable
ids, never array indices. 🚫 No state library until prop drilling genuinely hurts; then
Context. 🚫 Never `dangerouslySetInnerHTML`.

**Effects synchronise with the outside world. Deriving state in an effect is a bug.**

```tsx
const ac = useMemo(() => computeAC(character, items), [character, items]);   // ✅
useEffect(() => { setAc(computeAC(character, items)); }, [character, items]); // 🚫
```

Design tokens are CSS custom properties in `styles/tokens.css`. 🚫 No raw hex or pixel
value in a component — `color: var(--ink)`, never `#20180F`. Read `DESIGN.md` §6 before
changing anything visual.

---

## 7. Testing

Silent wrong answers live in `model/` and `net/`:

- `character.ts` — AC, slots, XP thresholds, modifiers, encumbrance
- `dice.ts` — rejection sampling, uniformity over a large sample, ranges per die
- `pack.ts` — define / extend / override resolution, load order, orphans
- `tables.ts` — range lookup, boundaries, gaps and overlaps
- `protocol.ts` — **hostile input**. Every schema gets a rejection test.

📌 **`app.smoke.test.tsx` mounts the whole app in jsdom.** Keep it forever. → `R10`

Not worth testing during build-out: component rendering detail, styling, transport
behaviour needing real peers (use `test-room.html`).

---

## 8. Git

```
main (production) ← dev (integration) ← feature/{issue}-{slug}
```

🚫 **Never push directly to `main` or `dev`.** ⚡ Claude opens PRs into `dev`, never `main`.
👤 You merge, and you tag every release.

**Commits:** `type(scope): imperative description — closes #{issue}`, 72 chars max.
Types `feat` `fix` `refactor` `test` `chore` `docs` `perf` · scopes `model` `net` `ui`
`state` `packs` `infra` `docs`. Use `— refs #{issue}` when it relates but does not complete.

📌 **Put the reasoning in the commit body.** GitHub seeds the PR body from it, and that is
what `/merged` reads when reconstructing the record cold. → `R4`

🚫 **Never in a commit:** `any` · `dangerouslySetInnerHTML` · `console.log` ·
commented-out code · `TODO` without an issue · hardcoded limits · **rules text from any
published book** · `.env`, keys or tokens · `git add .`

📌 `dev` is the default branch, deliberately. → `R6`

Full loop and the PR template: `docs/workflow.md`.

---

## 9. Tools

**Context7** ⚡ before writing code against any library (§2.2).

**GitHub** ⚡ via `gh` or MCP for issues, milestones, labels and PRs. Branches are always
created locally — 🚫 not MCP `create_branch`, which creates the remote first and makes the
first push get rejected. Every issue carries a phase milestone (`Phase 0`–`7` or
`Foundation`) and `owner:claude` ⚡ or `owner:you` 👤.

```bash
gh issue list --milestone "Phase 1"
gh issue view 12
npm run tokens                  # token + cost per session → R15
```

---

## 10. Session structure

📌 **One session per issue**, or per small cluster of coupled issues.

| Command | Does |
|---|---|
| `/start {issue} [what's broken]` | Loads the issue and repo state, then carries the work through to the PR |
| `/merged {pr}` | Syncs `dev`, records what shipped on the issue, logs findings, cleans up |

**Start** ⚡ — read `PRD.md` and only the §0 docs that apply · Context7 for any library ·
pull `dev`, branch locally, push with `-u`.

**During** ⚡ — implement, test, commit, push. Update `DATA-MODEL.md` or `DESIGN.md` in the
same session as the change. Flag scope discovered mid-session rather than absorbing it.

**End** ⚡ — the session that wrote the code finishes it. → `R3`

1. Self-review against each acceptance criterion; say plainly what is not met
2. Sweep: no `any`, no `innerHTML`, no hardcoded limits, **no rules text**, no secrets
3. `npm run typecheck && npm run lint && npm test`, reporting the real output
4. Commit with reasoning in the body, push, open the PR

👤 You merge. Then `/merged {pr}` writes the completion record — what shipped, decisions
and what was rejected, how each criterion was verified, what was left out, follow-ups
filed as issues.

### The audit log

One permanent issue (labelled `audit-log`) collects **findings** — what a cycle taught us
about how we work, not what shipped. `/merged` appends one comment per cycle.

Two tests, both required: **transferable** to another session or project, **and evidenced**
by a real command output. 🚫 Never pad — "No findings" is the normal answer. → `R14`

---

## 11. Never

- 🚫 Add rules text from a published book
- 🚫 Write to another player's character, or modify a stat from a table result
- 🚫 `innerHTML` / `dangerouslySetInnerHTML` with pack or peer data
- 🚫 Trust a sender id from a payload, or skip validation because it is "our own" data
- 🚫 Add a backend, database, or account system
- 🚫 Enable TURN without working credentials → `R9`
- 🚫 Set `base` to `'/'`, or use path-based routing → `R8`
- 🚫 Install a package without asking
- 🚫 Change a test to make it pass — fix the implementation
- 🚫 `git add .`, or commit to `dev` / `main` directly
- 🚫 Close an issue before acceptance criteria are confirmed
- 🚫 Build a pack directory, pack sharing, or a PDF importer (`DESIGN.md` §7)

---

*Shadowdark RPG © The Arcane Library, LLC. This project is independent and unaffiliated.*
