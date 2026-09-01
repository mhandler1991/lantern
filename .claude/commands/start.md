---
description: Start work on a GitHub issue
argument-hint: <issue-number> [anything broken or delicate]
allowed-tools: Bash(gh issue view:*), Bash(git log:*), Bash(git status:*), Bash(git branch:*), Bash(git fetch:*)
---

# Start issue #$0

!`gh issue view $0`

- Latest on `dev`: !`git fetch origin dev --quiet && git log --oneline -5 origin/dev`
- Working tree: !`git status --short`
- Current branch: !`git branch --show-current`

## What the developer flagged

`$ARGUMENTS`

Everything after the issue number is context about what is broken or delicate. Nothing
after the number means nothing to flag.

## Build

1. **The acceptance criteria above are the definition of done.**
2. **Read `PRD.md`, then only the docs `CLAUDE.md` §0 says apply.** 🚫 Not all of them —
   an irrelevant document crowds out the relevant one. `CLAUDE.md` is already in context.
3. **Context7 for every library involved** before writing a line against it. Trystero
   especially — `DESIGN.md` §8 flags recent API churn.
4. **Branch off `dev`:**
   ```bash
   git checkout dev && git pull origin dev
   git checkout -b feature/$0-{slug}
   git push -u origin feature/$0-{slug}
   ```
5. **Implement.** State assumptions inline rather than asking. One question maximum, and
   only when the answer changes what gets built.

📌 **Notice findings as you go** — a doc that was wrong, a tool that lied, a step that could
not do what it claimed. This session is the only place that knowledge exists; `/merged` §3
writes it to the audit log. The bar is high: transferable *and* evidenced. Most sessions
produce none, and that is the right answer. 🚫 Never manufacture one.

## Finish — this session, no second command

6. **Self-review against each criterion.** Say plainly what is not met rather than shipping
   it quietly.
7. **Sweep — actually look, do not assume:** no `any`, no `dangerouslySetInnerHTML`, no
   `console.log`, no commented-out code, no `TODO` without an issue, no hardcoded limits,
   **no rules text from any published book**, no `.env`, keys or tokens.
8. **`npm run typecheck && npm run lint && npm test`** — report the real output. If it
   fails, fix the implementation. 🚫 Never change a test to make it pass.
9. **Stage specific files** (🚫 never `git add .`) and commit
   `type(scope): description — closes #$0`, with the **reasoning in the body** — GitHub
   seeds the PR body from it.
10. **Push, open the PR into `dev`.** Title `[#$0] …`, body containing `Closes #$0`.
    Template in `docs/workflow.md` §4.

👤 You merge, then run `/merged {pr}`.

Confirm the branch and give a one-paragraph plan before writing code.
