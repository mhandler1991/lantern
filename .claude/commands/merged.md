---
description: Sync dev after a PR merge, record what shipped on the issue, clean up the branch
argument-hint: <pr-number>
allowed-tools: Bash(git:*), Bash(gh pr view:*), Bash(gh pr diff:*), Bash(gh issue view:*), Bash(gh issue list:*), Bash(gh issue comment:*), Bash(gh issue create:*)
---

# Merged #$ARGUMENTS

- Current branch: !`git branch --show-current`
- The PR: !`gh pr view $ARGUMENTS --json number,title,state,mergedAt,headRefName,baseRefName,body`
- Commits: !`gh pr view $ARGUMENTS --json commits -q '.commits[] | "- " + .messageHeadline + "\n" + (.messageBody // "")'`
- Files changed: !`gh pr diff $ARGUMENTS --name-only`
- The audit log: !`gh issue list --label audit-log --state open --limit 1 --json number,title -q '.[] | "#\(.number) \(.title)"'`

## 1. Sync

```bash
git checkout dev
git pull origin dev
git branch -D {headRefName from the PR above}
git remote prune origin
git status --short
```

📌 **`-D`, and the name comes from `headRefName`** — never inferred. Safe only because the
PR above is confirmed `MERGED`. → `docs/rationale.md` `R1`

Then confirm plainly, do not assume: the commit is on `dev` and the tree is clean, and the
issue actually closed. If it is still open, say so.

## 2. Record what shipped

**Which issue?** Read `closes #N` out of the injected title, body and commits. If they
disagree or none is present, ask — 🚫 never guess and comment on the wrong ticket.
🚫 Do not use `gh pr view --json closingIssuesReferences`; it returns `[]` and lies. → `R5`

Skip if a record already exists:

```bash
gh issue view {issue} --json comments -q '.comments[].body' | grep -q 'Shipped in #'
```

Otherwise `gh issue comment {issue} --body '...'` with this shape. Drop empty sections,
never pad:

```markdown
## Shipped in #{PR}

### What
One or two lines. The diff says the rest.

### Decisions
Each real choice, and what was rejected — anything a future session would re-litigate.

### Verified
Per criterion: the command run and its real result. Not "done".

### Deliberately not done
Scope consciously left out, so it reads as a decision later, not an oversight.

### Follow-ups
Discovered work, **filed as real issues** (`gh issue create`) and linked by number.
```

📌 **If this session did not do the build**, write from the injected PR material and say
plainly that it is reconstructed. 🚫 Never invent a rationale the PR does not evidence.

## 3. Log the findings

§2 records what shipped on this issue. This records **what the cycle taught us about how
we work**, on the one permanent issue injected above (resolved by label). If that line came
back empty, say so and skip — 🚫 never guess the number.

**Two tests, both required:** *transferable* to another session or project, and *evidenced*
by a real command, output, file or number.

📌 **"No findings" is normal and the correct answer most cycles.** Padding destroys the
only thing the log is for. 🚫 Never pad. Work items are follow-up issues; implementation
choices are commit bodies. → `R14`

Skip if already logged:

```bash
gh issue view {log issue} --json comments -q '.comments[].body' | grep -q '## Cycle #$ARGUMENTS'
```

```markdown
## Cycle #{PR} — {issue title}

### F1. {The finding, as a transferable rule, one line}
- **Category:** workflow · tooling · docs · process · code-standard · repo-config
- **Evidence:** what actually happened. Command, output, file, number.
- **Response:** an edit, an issue number, or `logged only`.
- **Confidence:** `verified` (observed) · `inferred` (reasoned, not yet seen)
```

Or just `No findings.` under the heading.

## 4. What is next

```bash
gh issue list --milestone "{current phase}" --state open
```

👤 `/preview/` is live a minute or two after the merge. **Hard-refresh it** — a cached page
looks exactly like a fix that did not work.
