---
description: Sync dev after a PR merge and clean up the branch
argument-hint: <pr-number>
allowed-tools: Bash(git:*), Bash(gh pr view:*), Bash(gh issue list:*)
---

# Merged #$ARGUMENTS

## Before

- Current branch: !`git branch --show-current`
- Local branches: !`git branch -vv`
- The PR: !`gh pr view $ARGUMENTS --json number,title,state,mergedAt,headRefName,baseRefName`

## Sequence

`docs/workflow.md` §3 step 5, without exception. Skipping this leaves local `dev`
behind, and the next session builds on stale code — the "I don't see my change" trap.

```bash
git checkout dev
git pull origin dev
git branch -d {the merged branch}
git remote prune origin
git status --short
```

Then:

1. **Confirm the merge actually landed** — the commit is on `dev` and the tree is clean.
2. **Confirm the issue closed.** `Closes #N` fires only on merge into the default
   branch, which is `dev` by design. If the issue is still open, say so rather than
   assuming.
3. **Report what is next** in the current milestone:
   ```bash
   gh issue list --milestone "{current phase}" --state open
   ```

👤 Reminder for the developer: `/preview/` is live a minute or two after the merge.
**Hard-refresh it** — Pages caches `index.html`, and a cached page looks exactly like a
fix that did not work.
