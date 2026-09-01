---
description: DEPRECATED — /start now carries through to the PR. Kept for reference only.
argument-hint: <issue-number>
allowed-tools: Bash(git:*), Bash(gh pr create:*), Bash(gh issue view:*), Bash(gh issue comment:*), Bash(npm run:*), Bash(npm test:*)
---

# Ship issue #$ARGUMENTS

> ## ⚠️ Deprecated — do not use
>
> `/start` now carries the work through to the PR itself, and `/merged` writes the
> completion record. This command is kept only so the reasoning below is not lost.
>
> **It was retired because it never ran.** The documented loop said `/start` → build →
> `/ship` → merge → `/merged`. The loop actually used skipped straight from build to
> merging on GitHub. Issue #3 closed with **0 comments** as the direct result: step 6
> here was the only thing that would have written the record, and it never fired. A gate
> that is not run is not a gate. Retired under #66.
>
> Everything below still describes work that must happen — it happens in the build
> session now, driven by `/start` steps 6–8. 🚫 Do not invoke this command; if you were
> reaching for it, the sequence you want is in `start.md`.


## State

- Branch: !`git branch --show-current`
- Changes: !`git status --short`
- Commits ahead of `dev`: !`git log --oneline origin/dev..HEAD`

## The issue being closed

!`gh issue view $ARGUMENTS`

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
   `type(scope): description — closes #$ARGUMENTS`.
5. **Push**, then open a PR **into `dev`** using the §9 template. Title `[#$ARGUMENTS] …`.
   The body must contain `Closes #$ARGUMENTS`; the commit trailer alone will not close the
   issue, because merges land on `dev` rather than the default-branch-close path.
6. **Comment on the issue** using the completion-comment shape in
   [`merged.md`](merged.md) §2 — what shipped, **decisions and what was rejected**, how
   each criterion was actually verified, scope deliberately left out, and follow-ups
   filed as real issues.

   📌 This is the same record `/merged` posts. Whichever runs first writes it; `/merged`
   checks for an existing `## Shipped in #` comment and does not duplicate it. The
   reasoning is freshest here, so if you are in the build session, write it here.

Report the PR URL and anything you could not verify.
