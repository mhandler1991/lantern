---
description: Run the checks, push, and open a PR into dev
argument-hint: <issue-number>
allowed-tools: Bash(git:*), Bash(gh pr create:*), Bash(gh issue view:*), Bash(gh issue comment:*), Bash(npm run:*), Bash(npm test:*)
---

# Ship issue #$1

## State

- Branch: !`git branch --show-current`
- Changes: !`git status --short`
- Commits ahead of `dev`: !`git log --oneline origin/dev..HEAD`

## The issue being closed

!`gh issue view $1`

## Sequence

Run `CLAUDE.md` §11's end-of-session list, in order. Do not skip a step because it
"looks fine".

1. **Self-review against the issue's acceptance criteria**, item by item. Anything not
   met, say so plainly rather than shipping it quietly.
2. **Verify the prohibitions** (§9, §12):
   - no `any`, no `dangerouslySetInnerHTML`, no `console.log`
   - no commented-out code, no `TODO` without an issue number
   - no hardcoded limits — they live in `constants.ts`
   - **no rules text from any published book**
   - no `.env`, keys or tokens
3. **Run the checks and report the real output:**
   ```bash
   npm run typecheck && npm run lint && npm test
   ```
   If anything fails, fix the implementation. 🚫 Never change a test to make it pass.
4. **Stage specific files** — 🚫 never `git add .` — and commit with
   `type(scope): description — closes #$1`.
5. **Push**, then open a PR **into `dev`** using the §9 template. Title `[#$1] …`.
   The body must contain `Closes #$1`; the commit trailer alone will not close the
   issue, because merges land on `dev` rather than the default-branch-close path.
6. **Comment on the issue** with what shipped.

Report the PR URL and anything you could not verify.
