# Why things are the way they are

> **Nothing reads this file routinely — and that is the point.** It is linked from the
> exact rules it explains, so the trigger to open it is *"I am about to change this"*,
> never *"I am starting a session"*. A doc map entry pointing here would put all of it
> back into every session's context, which is what it was extracted to avoid.
>
> Read the entry before undoing the thing it describes. Most of these look like fussy
> over-specification until you know what they cost the first time.

---

## R1 — `git branch -D`, not `-d`, and the name comes from `headRefName`

This repo squash-merges. A squash rewrites the commit, so the local branch tip is never
an ancestor of `dev`, and `git branch -d` fails with `error: the branch is not fully
merged` — which reads exactly like a merge that did not land.

`-d` only ever appeared to work because the stale `origin/...` ref survived. Enabling
**Automatically delete head branches** removed that fallback, and `-d` then broke on
every merge. Two settings that look unrelated are coupled.

Force is safe **because** `/merged` confirms the PR is `MERGED` first. Never `-D` a
branch you have not verified that way, and never one you inferred rather than read from
the PR's `headRefName`.

## R2 — `git remote prune origin` was a silent no-op for months

It had been in the sync step from the start and had **never deleted anything**, because
`deleteBranchOnMerge` was `false`, so no remote branch was ever gone. PRs #62, #63 and
#64 all still had live remote branches. Fixed with `gh repo edit --delete-branch-on-merge`.

**The general rule:** a cleanup step that has never had anything to clean is
indistinguishable from one that works. Check.

## R3 — the loop is two commands, because `/ship` was never run

The documented loop was `/start` → build → `/ship` → merge → `/merged`. The loop actually
used was `/start` → build → merge → `/merged`. `/ship` held the only prohibition sweep
and the only issue-comment step, and **issue #3 closed with 0 comments** as a direct
result. Retired under #66; the file was deleted under #77 once this entry existed.

Nothing was dropped — the sweep and the checks moved into the build session, the record
moved to `/merged`. The sweep was the part with no substitute: *no rules text from any
published book* is a licensing boundary, not a style preference.

**The general rule: a gate that is not run is not a gate.** Put a step on a command that
actually fires, or accept that it does not exist.

## R4 — the completion record lives on `/merged`, not at commit time

Same reason as R3: `/merged` runs every cycle. It is idempotent (it greps for an existing
`## Shipped in #` first) so a build session that already wrote one is never duplicated.

Reasoning goes in the **commit body** because GitHub seeds the PR body from it, and that
is what `/merged` reads when reconstructing the record cold. That is the only reason the
ESLint 9-vs-10 rationale from #3 survived at all.

## R5 — `gh pr view --json closingIssuesReferences` returns `[]` and lies

It is populated from the PR **body** only. When the closing keyword rides in on the
commit message — which is what the commit convention produces, and what GitHub then
auto-seeds the body from — it returns an empty array even though the issue closed.
Verified on #64: empty array, issue #3 closed regardless.

Read `closes #N` out of the injected title, body and commits instead.

## R6 — `dev` is the default branch on purpose

GitHub auto-closes an issue only when a PR merges into the **default** branch, and every
feature PR targets `dev`. Making `main` default would leave `Closes #N` silently doing
nothing. It also means `gh pr create` picks the right base with no `--base`.

## R7 — slash command positionals are zero-indexed

`$0` is the first argument, not the command name — the opposite of shell habit. Verified
by probe: `/probe alpha beta gamma` → `$0`=`alpha`, `$1`=`beta`, `$2`=`gamma`.

It fails in a way that reads like a broken command rather than a broken placeholder:
`/start 2` against `` !`gh issue view $1` `` leaves `$1` unsubstituted, the shell expands
it to empty, and `gh` reports `accepts 1 arg(s), received 0`. Cost a whole issue (#61).

Prefer `$ARGUMENTS`. Use `$0` only where the argument line is a number followed by free
text and the number must not drag the prose into a shell command.

`allowed-tools` is deliberately narrow — specific `git`/`gh`/`npm` patterns, never
`Bash(*)` — so an injection point cannot become arbitrary shell execution. Prefer reading
a value out of already-injected text over adding a pipeline that a narrow grant may not
match.

## R8 — `base: './'` in `vite.config.ts`, and no hardcoded `/` at runtime

Pages serves a project site from a subpath. With Vite's default `base: '/'` every asset
reference becomes absolute and 404s. Anything fetched at runtime rather than imported
must resolve against `import.meta.env.BASE_URL`.

**A wrong runtime path fails silently** — no error, no broken-image icon, just missing
content. On the predecessor project this was a completely black screen with nothing in
the console but texture misses.

Same reason there is no path-based routing: Pages has no rewrite rules, so the room code
is a query parameter (`?r=CODE`).

## R9 — never enable TURN without working credentials

An unreachable TURN server does not fail loudly, it stalls ICE gathering. The predecessor
project shipped shared public relays that had been re-homed. **Dead relays are worse than
none.**

## R10 — the smoke test exists because of one specific bug

The predecessor project shipped a black screen: an import was deleted while its call site
stayed. `node --check` passed. A browser did not. Mounting the whole app in jsdom is the
only cheap thing that catches that class of bug. Keep it in the suite forever.

## R11 — CI and deploy are separate workflows, with inverted concurrency

Different trigger, different question. Deploy asks *"can this build and reach a URL?"* on
a push, after the merge. CI asks *"is this change safe to merge?"* before it. A `dev` push
can also arrive without a PR, so neither subsumes the other.

CI sets `cancel-in-progress: true` — a superseded check run is worthless. Deploy sets it
`false` — a half-finished deploy can leave the site inconsistent. Both are correct for
their own workflow; do not unify them.

CI's three checks carry `if: ${{ !cancelled() }}` so a typecheck failure does not mask a
test failure, costing a push/wait round trip per problem.

## R12 — never path-filter a check you intend to require

The instinct is `paths-ignore: ['**.md']` to save minutes on a docs-only PR. But a
`pull_request` check skipped by a path filter reports **nothing**, and a required check
that never reports sits permanently pending, blocking the merge forever.

Same family: `ci.yml` must trigger on PRs into `main` before `main` requires the check,
or every `dev → main` promotion deadlocks.

## R13 — `npm ci`, not `npm install`, in CI

`ci` fails on a lockfile that disagrees with `package.json`. `install` quietly resolves a
different tree than the one committed.

## R14 — the audit log, and why it must stay small

One permanent issue (labelled `audit-log`) collects findings about *how we work*. Eight
findings written in that format during the #3 → #66 sequence are what produced the current
two-command loop.

**Its failure mode is padding, not omission.** A log that manufactures an entry every
cycle carries no signal, and a skill distilled from filler is worse than no skill. Two
tests, both required: transferable, and evidenced by a real command output. "No findings"
is the normal answer.

## R15 — why replies are kept short (#77)

Measured across ten sessions: **46%** of spend was re-reading context, **30%** was writing
replies, at an average **80,000 tokens of context per turn**. One session ran 116 turns and
grew from 39K to 174K.

Because every turn re-sends the whole conversation, a token written early is billed once
at output rate and then re-read on every later turn. Over ~116 turns that is roughly
**$82/Mtok against a $25/Mtok sticker price**. Verbosity is close to quadratic, which is
why response length is a standard here and not a matter of taste.

`npm run tokens` reproduces the measurement.

## R16 — Jekyll and `.nojekyll`

Pages runs Jekyll by default, which silently skips files and folders beginning with an
underscore. Nothing does today; a future dependency emitting `_something` would vanish
without explanation. The deploy workflow touches `dist/.nojekyll`. Leave it there.

## R17 — `keep_files: true` on the Pages deploy

Pages publishes one site per repo. `main` goes to the root and `dev` to `/preview/` in the
same `gh-pages` branch. Without `keep_files`, deploying `dev` would wipe the production
build sitting at the root.

`/preview/` is a real HTTPS URL, which matters because **a phone on cellular cannot reach
`localhost`** — and cross-network peer testing is the only honest connectivity test.
