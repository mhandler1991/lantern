# CLAUDE.md — Lantern

> Source of truth for all AI-assisted development on this project.
> Claude reads this file at the start of every session, without exception.
> Code name: **Lantern** (internal only — the public name must not imply affiliation
> with The Arcane Library)

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ⚡ | Claude can and should do this automatically |
| 👤 | You must do this manually |
| 🚫 | Never do this |
| 📌 | In scope now |
| 🔮 | Deferred |

---

## 0. Project document map

| Document | Purpose | Read when | Update when |
|---|---|---|---|
| `CLAUDE.md` (this file) | Dev standards, session rules, git workflow | Every session | A standard changes |
| `PRD.md` | What to build, why, build order, how to iterate | Starting any feature | A product decision changes — **always update the PRD first** |
| `DESIGN.md` | Architecture, protocol, visual language, licensing | Before touching networking, the data model, or the look of anything | Any architectural or licensing decision changes |
| `DATA-MODEL.md` | Pack and character schemas, validation, authoring | Before any change to a schema, validator, or anything that reads a pack | Same session as any schema change |
| `DEPLOY.md` | GitHub Pages hosting, base paths, the deploy workflow | Before touching `vite.config.ts`, any asset path, or the workflow | Hosting or build config changes |
| `docs/workflow.md` | Branching, CI, deploy, the sync loop | When unsure how code ships | The branch model or deploy mapping changes |
| Linear | Issue tracker — anchors every branch and commit | Every session | Issue status, completion comments, discovered work |

**Quick reference**
- *"What should this do?"* → `PRD.md`
- *"How is this put together?"* → `DESIGN.md`
- *"What shape is this data?"* → `DATA-MODEL.md`
- *"How do I write this correctly?"* → `CLAUDE.md`
- *"How does this ship?"* → `docs/workflow.md`
- *"Why did the deployed build break?"* → `DEPLOY.md`

---

## 1. Stack

- **Vite** — static output
- **TypeScript, strict** — no exceptions
- **React 18** — function components and hooks only
- **Zod** — pack and payload validation
- **Trystero** — WebRTC transport
- **Vitest** + jsdom

📌 No backend. No database. No accounts. If a task seems to need one, stop and flag it —
that is a product decision, not an implementation detail.

📌 **Hosted on GitHub Pages, from a subpath** (`/lantern/`). Two consequences that are
easy to get wrong and fail quietly:

- `vite.config.ts` sets `base: './'`. 🚫 Never `'/'`.
- Anything fetched at runtime resolves against `import.meta.env.BASE_URL`.
  🚫 Never a hardcoded `/`. A wrong runtime path produces **no error at all** — just
  missing content, which on the predecessor project meant a black screen with a clean
  console.

---

## 2. Non-negotiable ground rules

1. **Read before writing.** ⚡ Read the existing file before editing. Never assume.
2. **Use Context7 for library docs.** ⚡ Before writing code against any library, fetch
   current docs. Never rely on training data for an API.
3. **Read the shipped source when a library misbehaves.** The predecessor project's hard
   constraints came from reading bundles, not READMEs. `node_modules` is documentation.
4. **No `any`.** Use `unknown` and narrow it, or define the type.
5. **Errors are values.** Typed results at boundaries. No silent failures.
6. **Never `innerHTML` with pack or peer data.** Text nodes only. This is the XSS
   boundary and it is absolute.
7. **Validate outbound and inbound.** Both, always, even single-player.
8. **Identity comes from the transport, never the payload.** Overwrite the sender field
   with the peer id the transport reports.
9. **Never ship rules text.** Names, mechanics and page references only. If a task would
   add rulebook prose to the repo, stop and flag it.
10. **Limits live in `constants.ts`.** No business-rule number inline.
11. **No placeholders in committed code.** `TODO` requires a Linear id, except the
    `// TODO: LATER` pattern for deliberate deferrals.
12. **Never commit secrets.**
13. **Never hardcode an absolute path.** Runtime paths use `import.meta.env.BASE_URL`.
14. **Bulkify.** Related changes across several files land in one response. Do not ask
    permission to continue — proceed and summarise.

---

## 3. Efficiency rules

- **State assumptions inline, do not ask.** If a reasonable default exists, take it and
  note it.
- **Batch related changes** — a feature touching a type, a component, a validator and a
  doc is one response.
- **Batch Linear issue creation** into one call.
- **One question maximum per response**, and only when the answer would change the
  output.
- **Deliver complete, runnable code.** No partial implementations.
- **Do not restate standards** in responses.
- **Skip pleasantries.** Lead with the answer or the code.

---

## 4. Architecture rules

### Structure

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

**`model/` never imports React or touches the DOM.** It is the part worth unit testing
and the part that must stay portable.

### Rules with teeth

- **Derived values are computed, never stored.** AC, slots, modifiers, XP-to-next, spell
  DC. Storing them guarantees drift.
- **One writer per character.** The DM sends a request; the owning client applies it.
  🚫 Never write to another player's character.
- **Record, do not adjudicate.** A talent result is text on a sheet. 🚫 Never modify a
  stat from a table result.
- **Warn, do not block.** Missing references, orphaned content, odd payloads — degrade
  and continue. 🚫 Never destroy player data. 🚫 Never refuse to load a character.
- **Everything optional except the sheet.** The app must work alone, offline, with no
  room and no packs.

---

## 5. TypeScript standards

- `strict: true`, no `any`, explicit return types on exported functions
- Types over interfaces unless declaration merging is needed
- Discriminated unions for protocol events
- Zod schemas are the source of truth at boundaries; infer types from them

```ts
export const RollEvent = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal('roll'),
  dice: z.array(DieResult).max(MAX_DICE_PER_ROLL),
  visibility: z.enum(['everyone', 'just-me', 'dm-only']),
});
export type RollEvent = z.infer<typeof RollEvent>;
```

### Naming

| Element | Convention | Example |
|---|---|---|
| Types | UpperCamelCase | `PublicCharacter` |
| Functions, variables | lowerCamelCase | `resolvePacks()` |
| Files | kebab-case | `pack-resolver.ts` |
| Components | UpperCamelCase, matching filename | `DiceOverlay.tsx` |
| Booleans | `is` `has` `can` `should` | `isRolling`, `hasPack` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_PARTY_SIZE` |

---

## 6. React standards

- Function components only
- Custom hooks for anything stateful and reusable
- 🚫 No state library until prop drilling is genuinely painful; then Context, then
  reconsider
- 🚫 Never `dangerouslySetInnerHTML`
- Keys are stable ids, never array indices
- Effects are for synchronising with the outside world. Deriving state in an effect is
  a bug.

```tsx
// ✅
const ac = useMemo(() => computeAC(character, items), [character, items]);

// 🚫
useEffect(() => { setAc(computeAC(character, items)); }, [character, items]);
```

---

## 7. Styling

Design tokens as CSS custom properties in `styles/tokens.css`. 🚫 No raw hex or raw
pixel values in a component.

```css
color: var(--ink);        /* ✅ */
color: #20180F;           /* 🚫 */
```

Read `DESIGN.md` §6 before changing anything visual. The look is deliberate: **a dark
room with real paper on the table**, Cinzel for headings, EB Garamond for prose,
Montserrat for small labels.

---

## 8. Testing

### What must be tested

Silent wrong answers live here:

- `model/character.ts` — AC, slots, XP thresholds, modifiers, encumbrance
- `model/dice.ts` — rejection sampling, uniformity across a large sample, ranges per die
- `model/pack.ts` — define / extend / override resolution, load order, orphan handling
- `model/tables.ts` — range lookup, boundaries, gaps and overlaps
- `net/protocol.ts` — **hostile input**. Every schema gets a rejection test.

### The smoke test

📌 **`app.smoke.test.tsx` mounts the whole app in jsdom and asserts it renders.**

The predecessor project shipped a black screen because an import was deleted while its
call site stayed, and syntax checking cannot see that. Build this test in Phase 1 and
keep it in the suite forever.

### Not worth testing during build-out

Component rendering detail, styling, transport behaviour that needs real peers. Use
`test-room.html` for the last one.

---

## 9. Git workflow

> Full detail in [`docs/workflow.md`](docs/workflow.md).

```
main  (production — always deployable)
  └── dev  (integration)
        ├── feature/[LIN-ID]-slug
        └── fix/[LIN-ID]-slug
```

### Session start ⚡

```bash
git checkout dev
git pull origin dev
git checkout -b feature/LAN-{id}-{slug}
git push -u origin feature/LAN-{id}-{slug}
```

🚫 Do not use GitHub MCP `create_branch` — it creates the remote branch first, which
makes the local branch look diverged and the first push gets rejected.

### Commits

```
type(scope): imperative description — closes LAN-{id}
```

**Types:** `feat` `fix` `refactor` `test` `chore` `docs` `perf`
**Scopes:** `model` `net` `ui` `state` `packs` `infra` `docs`

```bash
feat(model): compute AC from equipped armour and dex — closes LAN-12
fix(net): overwrite sender id from the transport — closes LAN-31
test(packs): reject unknown keys in pack validation — closes LAN-19
docs: document the extends operation — closes LAN-20
```

Imperative, 72 characters max. `— refs LAN-{id}` when it relates but does not complete.

### 🚫 Never in a commit

- `any`, `dangerouslySetInnerHTML`, `console.log`
- Commented-out code
- `TODO` without a Linear id (except `// TODO: LATER`)
- Hardcoded limits — use `constants.ts`
- **Rules text from any published book**
- `.env`, keys, tokens
- `git add .` — stage specific files

### PRs ⚡

Claude opens the PR after pushing. Title: `[LAN-{id}] Description`.

```markdown
## [LAN-{id}] {Issue title}

### What
- [what was implemented]

### Why
One sentence.

### Files changed
- `path` — new / modified

### Checks
- [ ] `npm run typecheck` clean
- [ ] `npm test` passing
- [ ] Smoke test passing
- [ ] No rules text added
- [ ] Limits from `constants.ts`
- [ ] Docs updated if a schema or protocol changed
```

### Deploy

🚫 **Never push directly to `main` or `dev`.** Everything goes through a branch and a PR.

⚡ Claude opens PRs into `dev`, never `main`. 👤 You merge, and you tag every release.

---

## 10. MCP tools

### Context7 ⚡ required

Before writing code against any library.

```
"Use Context7 to get current Trystero docs before writing the transport"
"Use Context7 for current Zod docs before writing the pack schema"
"Use Context7 for React 18 hook docs"
```

Always look up: Trystero, Zod, React, Vite, Vitest.

### GitHub MCP ⚡

Opening and checking PRs. Branches are created locally (see §9).

### Linear MCP ⚡

Creating issues, updating status, completion comments. Every issue carries an owner:
⚡ Claude or 👤 You.

---

## 11. Session structure

### Start

1. ⚡ Read `CLAUDE.md` and `PRD.md`
2. ⚡ Pull the Linear issue, read acceptance criteria
3. ⚡ Read `DESIGN.md` or `DATA-MODEL.md` if the work touches protocol, packs or visuals
4. ⚡ Context7 for any library involved
5. ⚡ Pull `dev`, branch locally, push with `-u`

**You provide:** the Linear id, current state, anything broken or delicate.

### During

- ⚡ Implement, test, commit, push
- ⚡ Update `DATA-MODEL.md` or `DESIGN.md` in the same session as the change
- ⚡ Flag scope discovered mid-session rather than absorbing it

### End ⚡

1. Self-review against acceptance criteria
2. Verify: no `any`, no `innerHTML`, no hardcoded limits, no rules text
3. Verify: model logic has tests; smoke test passes
4. Commit, push, open the PR
5. Move the Linear issue to In Review with a completion comment

---

## 12. What Claude must never do

- 🚫 Add rules text from a published book to the repo
- 🚫 Write to another player's character
- 🚫 Modify a stat from a table result
- 🚫 `innerHTML` / `dangerouslySetInnerHTML` with pack or peer data
- 🚫 Trust a sender id from a payload
- 🚫 Skip validation because it is "our own" data
- 🚫 Add a backend, a database, or an account system
- 🚫 Enable TURN without working credentials — dead relays are worse than none
- 🚫 Set `base` to `'/'` in `vite.config.ts`, or hardcode `/` in a runtime path
- 🚫 Use path-based routing — Pages has no rewrite rules and it will 404. Query strings only.
- 🚫 Install a package without asking
- 🚫 Change a test to make it pass — fix the implementation
- 🚫 `git add .`
- 🚫 Commit to `dev` or `main` directly
- 🚫 Hardcode a limit inline
- 🚫 Mark a Linear issue Done before acceptance criteria are confirmed
- 🚫 Build a pack directory, pack sharing, or a PDF importer (see `DESIGN.md` §7)

---

*Code name: Lantern. Shadowdark RPG © The Arcane Library, LLC. This project is
independent and unaffiliated.*
