---
description: Start work on a GitHub issue
argument-hint: <issue-number> [anything broken or delicate]
allowed-tools: Bash(gh issue view:*), Bash(git log:*), Bash(git status:*), Bash(git branch:*), Bash(git fetch:*)
---

# Start issue #$1

## The issue

!`gh issue view $1`

## Repo state

- Latest on `dev`: !`git fetch origin dev --quiet && git log --oneline -5 origin/dev`
- Working tree: !`git status --short`
- Current branch: !`git branch --show-current`

## What the developer flagged

`$ARGUMENTS`

Everything after the issue number is context about what is broken, delicate or recently
changed. If there is nothing after the number, there is nothing to flag.

## How to run this session

1. **Read the issue above first.** The acceptance criteria are the definition of done.
2. **Read `PRD.md`, then only the docs `CLAUDE.md` §0 says apply to this issue.**
   Do not read all five. The doc map is conditional on purpose:
   - `DESIGN.md` — networking, the data model, or the look of anything
   - `DATA-MODEL.md` — a schema, a validator, or anything that reads a pack
   - `DEPLOY.md` — `vite.config.ts`, any asset path, or the workflow
   `CLAUDE.md` is already in context. Do not spend a tool call re-reading it.
3. **Context7 for every library involved** before writing a line against it (§10).
   Trystero especially — `DESIGN.md` §8 flags recent API churn.
4. **Branch off `dev`** per §9:
   ```bash
   git checkout dev && git pull origin dev
   git checkout -b feature/$1-{slug}
   git push -u origin feature/$1-{slug}
   ```
5. **Implement, test, commit.** Commit trailer: `— closes #$1`.
6. **State assumptions inline rather than asking** (§3). Ask one question, and only
   when the answer would change what gets built.

Then confirm the branch and give a one-paragraph plan before writing code.
