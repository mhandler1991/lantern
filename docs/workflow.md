# Workflow — branching, commands, CI, deploy

> How code ships, and which command to run. Rules in [`../CLAUDE.md`](../CLAUDE.md).
> Why any of it is shaped this way: [`rationale.md`](rationale.md) — not read by default.
>
> ⚡ Claude · 👤 You

---

## 1. The shape

```
main   ── production   https://<you>.github.io/lantern/          (tagged at releases)
  ▲  PR + tag                                              👤
dev    ── integration  https://<you>.github.io/lantern/preview/
  ▲  PR + merge                            ⚡ opens · 👤 merges
feature/<issue>-<slug>                     always cut from dev
```

🚫 Never commit or push directly to `dev` or `main` — including one-line fixes. Branch
protection here is by convention, so it is enforced by discipline.

📌 `dev` is the default branch deliberately. → `R6`

---

## 2. The loop

```
/start 5  →  ⚡ build · sweep · check · commit · push · PR  →  👤 merge  →  /merged 71
                                                                    │
                                                        new session ─┘  /start 6
```

| # | Step | Who | Say this |
|---|---|---|---|
| 1 | **Start** | 👤→⚡ | **`/start {issue}`** |
| 2 | **Build → PR** | ⚡ | — (same session, no second command) |
| 3 | **Merge** | 👤 | — |
| 4 | **Sync + record** | 👤→⚡ | **`/merged {pr}`** |
| 5 | **Test** | 👤 | Open `/preview/`, **hard-refreshed** |

⚠️ **`/start` takes the issue number. `/merged` takes the PR number.** Different numbers,
easiest mistake to make.

📌 **Start a new session per issue.** `/start` re-derives everything from `gh` and `git`,
so a fresh session costs nothing and keeps context on the work.

### `/start {issue} [anything broken]`

```bash
/start 2
/start 13 export broke after #12
```

Injects the issue body, the last 5 commits on `origin/dev`, the working tree and the
current branch. Then reads `PRD.md` plus only the docs `CLAUDE.md` §0 says apply, runs
Context7 for any library, branches off `dev`, and carries the work through to the PR.

> **The trailing text is the only thing it cannot derive.** `gh` gives it the issue and
> `git` gives it the state — but nothing tells it you noticed the torch timer drifting
> last night.

### `/merged {pr}`

```bash
/merged 71
```

`checkout dev` → `pull` → delete the merged branch → prune → confirm clean → confirm the
issue closed → **record what shipped** → **log any findings** → list what is open.

> **Do not skip it.** It looks optional and is not. Skipping leaves local `dev` behind and
> the next session builds on stale code — the "I don't see my change" trap, an hour every
> time. It is also the only step that reliably writes down *why* the work was done this way.

It uses `git branch -D` with the name read from the PR's `headRefName`. → `R1`

**The completion record** goes on the issue that just closed: what shipped, decisions and
what was rejected, how each criterion was verified, what was deliberately left out, and
follow-ups **filed as real issues**. Idempotent — it checks for an existing
`## Shipped in #` comment first. Written from memory in the build session, or reconstructed
from the PR when run cold, and it says which. → `R4`

**The findings log** goes on one permanent issue (labelled `audit-log`), one comment per
cycle headed `## Cycle #{PR}`, so it is addressable as `#{PR}/F{n}`. It records what the
cycle taught us about *how we work* — not what shipped, not work to do (that is a real
issue), not implementation choices (that is the commit body).

Two tests, both required: **transferable** and **evidenced**. 🚫 Never pad — "No findings"
is the normal answer, and a cold `/merged` should return it more often. → `R14`

---

## 3. Automated vs manual

| Thing | Status |
|---|---|
| Typecheck, lint, test | ⚙️ Actions on every PR into `dev`. **Blocks merge** once the ruleset requires it. |
| Deploy | 🚀 `main` → site root · `dev` → `/preview/`. See [`../DEPLOY.md`](../DEPLOY.md). |
| Smoke test | ⚙️ Part of `npm test` — catches the black-screen class of bug. → `R10` |
| Peer connectivity | 🧑‍💻 Manual. `test-room.html`, three tabs plus two networks. No CI can do it. |

CI (`ci.yml`) and deploy (`deploy.yml`) are separate workflows with deliberately inverted
concurrency settings. → `R11`

---

## 4. The PR

Title `[#{issue}] Description`, body containing `Closes #{issue}`.

```markdown
## [#{issue}] {Issue title}

Closes #{issue}

### What
- [what was implemented]

### Why
One sentence.

### Decisions
Each real choice and what was rejected.

### Checks
- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean
- [ ] `npm test` passing
- [ ] No rules text added
- [ ] Docs updated if a schema or protocol changed
```

---

## 5. Promote to production

1. 👤 Say **"promote dev → main"**
2. ⚡ Opens the `dev → main` PR
3. 👤 Merge, then tag `v0.{phase}.{patch}` and `git push origin main --tags`
4. 🚀 Pages redeploys the site root

**Tags are the rollback handle.** Do not skip them.

**Before promoting**, by hand: open `/preview/` hard-refreshed and build a character start
to finish · export it and reimport in a private window · roll every die type. When
networking changed, also: `test-room.html` in three tabs · the app in three tabs, host
plus two joiners · laptop and phone **on cellular**, since a phone cannot reach
`localhost`.

---

## 6. Odds and ends

**Working without an issue.** Spikes and alignment passes do not need one — say *"branch
off dev for X, no issue"*. Branch naming drops the number: `feature/{slug}`.

**Fixing a command.** They are markdown in [`../.claude/commands/`](../.claude/commands/),
version controlled and merged like anything else. **If a ritual is wrong, fix it in a PR,
not in your muscle memory.** Frontmatter plus a prompt body, with three substitutions:
`$ARGUMENTS` (everything typed after the command), `$0`/`$1`/`$2` (**zero-indexed**
positionals), and `` !`cmd` `` (runs the command and injects its output).

⚠️ Prefer `$ARGUMENTS` — the zero-indexing is the opposite of shell habit and fails in a
way that reads like a broken command. → `R7`

**What stays manual** 👤: merging and tagging · testing `/preview/` hard-refreshed · peer
connectivity on a real phone on cellular · saying what is broken, the one input `/start`
cannot derive.
