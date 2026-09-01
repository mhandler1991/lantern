---
description: Sync dev after a PR merge, record what shipped on the issue, clean up the branch
argument-hint: <pr-number>
allowed-tools: Bash(git:*), Bash(gh pr view:*), Bash(gh pr diff:*), Bash(gh issue view:*), Bash(gh issue list:*), Bash(gh issue comment:*), Bash(gh issue create:*)
---

# Merged #$ARGUMENTS

## Before

- Current branch: !`git branch --show-current`
- Local branches: !`git branch -vv`
- The PR: !`gh pr view $ARGUMENTS --json number,title,state,mergedAt,headRefName,baseRefName,body`
- Commits in the PR: !`gh pr view $ARGUMENTS --json commits -q '.commits[] | "- " + .messageHeadline + "\n" + (.messageBody // "")'`
- Files changed: !`gh pr diff $ARGUMENTS --name-only`

## 1. Sync

`docs/workflow.md` §3 step 5, without exception. Skipping this leaves local `dev`
behind, and the next session builds on stale code — the "I don't see my change" trap.

```bash
git checkout dev
git pull origin dev
git branch -D {headRefName from the PR above}
git remote prune origin
git status --short
```

📌 **`-D`, not `-d`, and the branch name comes from the PR's `headRefName`.** The repo
allows squash merges, and a squash rewrites the commit — so the local branch tip is
never an ancestor of `dev` and `-d` fails with `error: the branch is not fully merged`,
which reads exactly like a merge that did not land. Force is safe here *because* the
PR above has already been confirmed `MERGED`. 🚫 Never `-D` a branch you have not
verified that way, and never one you inferred rather than read from `headRefName`.

Then confirm, and say so plainly rather than assuming:

1. **The merge landed** — the commit is on `dev` and the tree is clean.
2. **The issue closed.** `Closes #N` fires only on merge into the default branch, which
   is `dev` by design. If it is still open, say so.

## 2. Record what shipped

The build session is where the reasoning exists. It is worth nothing in scrollback.

**Which issue?** Read the `closes #N` / `fixes #N` reference out of the PR title, body
and commit messages injected above. If they disagree or none is present, ask — 🚫 never
guess an issue number and comment on the wrong ticket.

🚫 **Do not reach for `gh pr view --json closingIssuesReferences`.** It is populated from
the PR *body* only. When the closing keyword rides in on the commit message instead —
which is what `/ship` step 4 produces, and what GitHub auto-seeds the PR body from — it
returns `[]` even though the issue closed. Verified on #64: empty array, issue #3 closed
regardless. The injected text above is the reliable source.

**First check whether this already happened** — `/ship` may have posted it:

```bash
gh issue view {issue} --json comments -q '.comments[].body' | grep -q 'Shipped in #'
```

Exit `0` means a record is already there — skip to §3. Exit `1` means post one:

```bash
gh issue comment {issue} --body '...'
```

Use this shape. Drop any section that would be empty — never pad it:

```markdown
## Shipped in #{PR}

### What
One or two lines. The diff says the rest.

### Decisions
Each real choice, and **what was rejected**. Version pins, library choices, anything a
future session would otherwise re-litigate or "helpfully" undo.

### Verified
Per acceptance criterion: the command actually run and its real result. Not "done".

### Deliberately not done
Scope consciously left out, and why — so it reads as a decision later, not an oversight.

### Follow-ups
Discovered work, filed as issues and linked by number.
```

📌 **Follow-ups become real issues.** `gh issue create`, then link them. Work described
only in prose is work that will be rediscovered from scratch.

📌 **If this session did not do the build**, write from the PR body, commits and file
list injected above, and say plainly that it is reconstructed from the PR rather than
recalled. 🚫 Never invent a rationale that is not evidenced there — a confident wrong
reason is worse than a missing one.

## 3. What is next

```bash
gh issue list --milestone "{current phase}" --state open
```

👤 Reminder for the developer: `/preview/` is live a minute or two after the merge.
**Hard-refresh it** — Pages caches `index.html`, and a cached page looks exactly like a
fix that did not work.
