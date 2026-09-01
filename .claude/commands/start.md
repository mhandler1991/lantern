---
description: Start work on a GitHub issue
argument-hint: <issue-number> [anything broken or delicate]
allowed-tools: Bash(gh issue view:*), Bash(git log:*), Bash(git status:*), Bash(git branch:*), Bash(git fetch:*)
---

# Start issue #$0

## The issue

!`gh issue view $0`

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
   git checkout -b feature/$0-{slug}
   git push -u origin feature/$0-{slug}
   ```
5. **Implement.** State assumptions inline rather than asking (§3). Ask one question,
   and only when the answer would change what gets built.

## Finishing the work — no `/ship` step

📌 **`/ship` is deprecated (#66).** This session carries the work through to the PR. The
gate that used to live there now lives here, and it is not optional — it is the only
mechanical check on `CLAUDE.md` §12, and "no rules text from any published book" is a
licensing boundary, not a style preference.

6. **Self-review against each acceptance criterion**, item by item. Anything not met,
   say so plainly rather than shipping it quietly.
7. **Prohibition sweep** (§9, §12) — actually look, do not assume:
   - no `any`, no `dangerouslySetInnerHTML`, no `console.log`
   - no commented-out code, no `TODO` without an issue number
   - no hardcoded limits — they live in `constants.ts`
   - **no rules text from any published book**
   - no `.env`, keys or tokens
8. **Run the checks and report the real output:**
   ```bash
   npm run typecheck && npm run lint && npm test
   ```
   If anything fails, fix the implementation. 🚫 Never change a test to make it pass.
9. **Stage specific files** — 🚫 never `git add .` — and commit with
   `type(scope): description — closes #$0`.

   📌 Put the *reasoning* in the commit body: why this pin, this library, this approach,
   and what was rejected. GitHub seeds the PR body from it, so it is what survives to
   the issue when `/merged` reconstructs the record cold.
10. **Push, then open the PR into `dev`** using the §9 template. Title `[#$0] …`, body
    containing `Closes #$0`.

👤 You merge. Then run **`/merged {pr}`** — that is where the completion record gets
written to the issue.

Then confirm the branch and give a one-paragraph plan before writing code.
