# Slash commands — cheat sheet

> The three session rituals, as commands. Source: [`.claude/commands/`](../.claude/commands/).
> Full mechanics in [`workflow.md`](workflow.md) §3 · rules in [`../CLAUDE.md`](../CLAUDE.md) §11.
>
> Legend: ⚡ Claude · 👤 You

---

## The loop

```
/start 2  →  build  →  /ship 2  →  👤 merge on GitHub  →  /merged 61  →  👤 test /preview/
                                                                │
                                                    new session ─┘  /start 3
```

| | Command | Takes | When |
|---|---|---|---|
| 1 | `/start {issue}` | **issue** № | First message of a new session |
| 3 | `/ship {issue}` | **issue** № | Work done, tested locally, before you touch GitHub |
| 5 | `/merged {pr}` | **PR** № | Immediately after clicking Merge |

⚠️ **`/merged` takes the PR number. The other two take the issue number.** They are
different numbers and it is the easiest mistake to make.

---

## `/start {issue} [anything broken]`

Loads the issue and the state of the world, then runs the [`CLAUDE.md`](../CLAUDE.md) §11
Start list.

```bash
/start 2
/start 13 export broke after #12
/start 27 the d100 histogram looked skewed last night
```

**Injects before the first tool call:** full issue body · last 5 commits on `origin/dev` ·
working tree · current branch.

**Then:** reads `PRD.md` plus **only** the docs §0 says apply · Context7 for any library ·
branches `feature/{issue}-{slug}` off `dev` · gives you a one-paragraph plan.

> **The trailing text is the only thing it cannot derive.** `gh` gives it the issue and
> `git` gives it the state — but nothing tells it you noticed the torch timer drifting
> last night. Everything after the number is free text.

---

## `/ship {issue}`

Runs the [`CLAUDE.md`](../CLAUDE.md) §11 End list, in order, without skipping.

```bash
/ship 2
```

1. Self-review against **each** acceptance criterion
2. Prohibition sweep — `any` · `dangerouslySetInnerHTML` · `console.log` · commented-out
   code · `TODO` without an issue № · hardcoded limits · **rules text** · secrets
3. `npm run typecheck && npm run lint && npm test`, reporting the real output
4. Stage **specific files** (🚫 never `git add .`), commit `— closes #{issue}`
5. Push, open the PR **into `dev`**, body containing `Closes #{issue}`
6. Comment on the issue

> A failing check gets the **implementation** fixed, never the test. Anything it could
> not verify gets said out loud rather than quietly passed.

---

## `/merged {pr}`

The [`workflow.md`](workflow.md) §3 step 5 sync.

```bash
/merged 61
```

`checkout dev` → `pull` → delete the merged branch → prune → confirm clean → confirm the
issue closed → list what is still open in the milestone.

> **Do not skip this.** It is the one that looks optional and is not. Skipping leaves
> local `dev` behind and the next session builds on stale code — the "I don't see my
> change" trap, which §3 notes costs an hour every time.
>
> Per-issue sessions make it *partly* redundant, since `/start` pulls `dev` too. It still
> earns its place: it deletes the stale branch and confirms the issue actually closed.

---

## What stays manual 👤

| Step | Why it is not a command |
|---|---|
| **Merging the PR** | [`CLAUDE.md`](../CLAUDE.md) §9 — you merge, you tag |
| **Testing `/preview/`** | Hard-refresh first; Pages caches `index.html` and a cached page looks exactly like a fix that did not work |
| **Peer connectivity** | A phone **on cellular** is the honest test. No CI can do it. |
| **Promote to production** | Say "promote dev → main", then tag `v0.{phase}.{patch}` |
| **Anything broken** | The one input `/start` cannot derive |

---

## Working without an issue

Spikes and alignment passes do not need one:

```
Branch off dev for <thing>, no issue
```

Branch naming drops the number: `feature/{slug}`. ([`workflow.md`](workflow.md) §7)

---

## Fixing a command

They are markdown files in [`.claude/commands/`](../.claude/commands/), version
controlled and merged like anything else. **If a ritual turns out to be wrong, fix it in
a PR — not in your muscle memory.**

Each is frontmatter plus a prompt body. Three substitutions:

| Syntax | Does |
|---|---|
| `$ARGUMENTS` | Everything you typed after the command |
| `$0`, `$1`, `$2` | **Zero-indexed** positional arguments — `$0` is the first word |
| `` !`cmd` `` | Runs the shell command and **injects its output into the prompt** |

⚠️ **The positional placeholders are zero-indexed in Claude Code 2.1.245.** `$0` is the
first argument, not the command name. Verified by probe:
`/probe alpha beta gamma` → `$0`=`alpha`, `$1`=`beta`, `$2`=`gamma`.

This is the opposite of what shell habit expects, and it fails in a way that reads like a
broken command rather than a broken placeholder. `/start 2` against a body containing
`` !`gh issue view $1` `` leaves `$1` **unsubstituted** — there is no second argument — so
the shell expands it to the empty string and `gh` reports:

```
accepts 1 arg(s), received 0
```

**Prefer `$ARGUMENTS`.** It is stable, and for `/ship` and `/merged` — which take exactly
one number — it is exactly right. `/start` uses `$0` because its argument line is a number
followed by free text, and `$0` takes the number without dragging the prose into the
shell command.

`allowed-tools` scopes what the injected commands may run. It is deliberately narrow —
specific `git` / `gh` / `npm` patterns, never `Bash(*)` — so an injection point cannot
become arbitrary shell execution.

---

*Companion to [`workflow.md`](workflow.md) §3 and §8, and [`../CLAUDE.md`](../CLAUDE.md)
§11. Update when a command changes.*
