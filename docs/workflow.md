# Lantern — branching, CI/CD and sync workflow

> The developer ↔ Claude loop. How code moves from a feature branch → `dev` → `main`,
> what is automated, and exactly **what to tell Claude** at each step.
>
> Legend: ⚡ Claude · 👤 You

---

## 1. The big picture

```
main   ── production   https://<you>.github.io/lantern/          (tagged at releases)
  ▲
  │  PR (dev → main) + tag           👤 you
  │
dev    ── integration  https://<you>.github.io/lantern/preview/  — everything lands here first
  ▲
  │  PR (feature → dev) + merge      ⚡ Claude opens · 👤 you merge
  │
feature/<id>-<slug>  ── one per feature, always cut from dev
```

🚫 Never commit or push directly to `dev` or `main`. Everything goes through a branch
and a PR, including one-line fixes. Branch protection is by convention on this repo,
which means it is enforced by discipline.

📌 **`dev` is the repository's default branch, deliberately.** GitHub auto-closes an
issue only when a PR merges into the *default* branch, and every feature PR targets
`dev`. Setting `main` as default would leave `Closes #N` silently doing nothing. It also
means `gh pr create` picks the correct base without `--base dev`.

---

## 2. Automated versus manual

| Thing | Status | Notes |
|---|---|---|
| **Typecheck, lint, test** | ⚙️ GitHub Actions on every PR | `npm run typecheck`, `npm run lint`, `npm test`. **Blocks merge.** |
| **Deploy** | 🚀 GitHub Pages, automatic by branch | `main` → site root · `dev` → `/preview/`. Pages publishes **one** site per repo, so both branches build into it at different paths. See [`DEPLOY.md`](../DEPLOY.md). |
| **The smoke test** | ⚙️ Part of `npm test` | Mounts the app in jsdom. Catches the black-screen class of bug that syntax checking cannot see. |
| **Peer connectivity** | 🧑‍💻 Manual | `test-room.html` in three tabs, plus two devices on different networks. No CI can do this. |

**Why the CI gate exists.** The predecessor project shipped a blank page because an
import was deleted while its call site remained. `node --check` passed. A browser did
not. The test suite is the gate; do not merge around it.

---

## 3. Standard feature loop

| # | Step | Who | Detail |
|---|---|---|---|
| 1 | **Start** | ⚡ | `gh issue view {issue}`, then `git checkout dev && git pull origin dev && git checkout -b feature/{issue}-{slug}` |
| 2 | **Build** | ⚡ | Implement; run `npm run typecheck && npm test` locally |
| 3 | **PR** | ⚡ | Push with `-u`, open a PR **into `dev`** using the CLAUDE.md template |
| 4 | **Merge** | 👤 | Review and merge on GitHub |
| 5 | **Sync** | ⚡ | Tell Claude **"merged #N"** → it pulls `dev`, deletes the branch, confirms the tree is clean |
| 6 | **Test** | 👤 | Open `/preview/`. It is live a minute or two after step 4. **Hard-refresh** — Pages caches `index.html`. |

> ### ⚠️ Always sync after a merge
> Say **"merged #N"** every time. Claude then runs, without exception:
> `git checkout dev` → `git pull origin dev` → delete the merged branch → confirm clean.
>
> Skipping it leaves local `dev` behind, and the next session builds on stale code. This
> is the "I don't see my change" trap and it costs an hour every time.

---

## 4. Promote to production

| # | Step | Who |
|---|---|---|
| 1 | Say **"promote dev → main"** | 👤 |
| 2 | Open the `dev → main` PR | ⚡ |
| 3 | Merge, then tag `v0.{phase}.{patch}` and `git push origin main --tags` | 👤 |
| 4 | Pages redeploys the site root from `main` | 🚀 |

**Tags are the rollback handle.** Do not skip them. `v0.1.0` after Phase 1, and so on.

---

## 5. Testing before you promote

Beyond CI, do these by hand. They are the ones that have actually caught things.

**Every promotion:**
- [ ] Open `/preview/` (hard-refreshed) and build a character start to finish
- [ ] Export it, reimport it in a private window
- [ ] Roll every die type

**When networking changed:**
- [ ] `test-room.html` in three tabs — all show 2 peers
- [ ] The app in three tabs — host creates, two join by link, all see each other
- [ ] Laptop and phone **on cellular**, not wifi — both on the deployed URL, since a
      phone cannot reach `localhost`

> Two tabs on one machine connect over loopback and exercise no NAT traversal at all.
> They will always work and tell you nothing. **A phone on cellular is the honest test.**

**When packs changed:**
- [ ] Load a homebrew pack; confirm its content appears in pickers
- [ ] Turn it off with a character still using it — content stays, marked, read-only
- [ ] Load a deliberately broken pack; confirm errors name the exact path

---

## 6. Gotchas

- **Pull after every merge, before building.** A merged PR does not update local `dev`.
- **`localStorage` survives a redeploy.** After changing the character or prefs format,
  test with existing stored data, not just a clean browser. A stored value beats a new
  default forever unless you migrate it, and this has bitten before.
- **Hard-refresh when testing a deploy.** `Ctrl+Shift+R`. Pages caches `index.html`, and
  a cached page looks exactly like a fix that did not work.
- **Never hardcode `/` in a runtime path.** Pages serves from a subpath
  (`/lantern/`), and a wrong runtime path **fails silently** — no error, no broken
  icon, just missing content. Use `import.meta.env.BASE_URL`. See [`DEPLOY.md`](../DEPLOY.md) §2.
- **Peer bugs need the console.** Every peer event logs. When someone cannot connect,
  the log says whether the transport has peers or whether it is our layer.

---

## 7. Issues, milestones and branch naming

Work is tracked in **GitHub Issues** on this repo. One issue per unit of work; the issue
number anchors the branch, the commit and the PR.

**Milestones map 1:1 to the build order in [`PRD.md`](../PRD.md) §5:** `Foundation`, then
`Phase 0` through `Phase 7`. The milestone is how you see what a phase still owes.

| Label | Meaning |
|---|---|
| `owner:claude` ⚡ | Claude implements it |
| `owner:you` 👤 | Manual — a setting, a device test, a judgement call |
| `blocked` | Waiting on an earlier phase or an external decision |

Later-phase issues are deliberately low-resolution when created — acceptance criteria for
Phase 6 depend on decisions made in Phases 2–3. **Sharpen an issue before picking it up**,
not when filing it.

```bash
gh issue list --milestone "Phase 1"            # what this phase still owes
gh issue list --label owner:you                # what is waiting on you
```

### Branch naming

```
feature/{issue}-{slug}     # tied to a GitHub issue — e.g. feature/12-compute-ac
feature/{slug}             # no issue (a spike, an alignment pass)
fix/{issue}-{slug}         # bug fix
hotfix/{slug}              # urgent, branched from main, PR'd to main, back-merged to dev
```

---

## 8. What to tell Claude

| Moment | Say this |
|---|---|
| Starting | "Start #N" — or "Branch off dev for `<thing>`" + "no issue" — plus anything broken |
| Ready to ship | "Open a PR into dev" |
| After merging | **"Merged #N"** |
| Releasing | "Promote dev → main" |
| Reporting a bug | What you did, what happened, what you expected — and the console output if it is a peer bug |

---

## 9. When something breaks in a way that resists explanation

From the predecessor project, at a cost of five rounds and four wrong answers:

1. **Stop explaining. Build an isolation test.** Remove variables until one thing can be
   wrong. `test-room.html` exists because of this.
2. **Instrument the distinction that matters.** For peer bugs: does the transport have
   peers, or does it not? Those two failures look identical and need opposite fixes.
3. **Say when a fix is inferred rather than observed.** Then the next test targets the
   right thing instead of confirming a guess.
4. **Read the library's source.** Nearly every hard constraint came from the bundle, not
   the README.

---

*Companion to `CLAUDE.md` §9 and `PRD.md` §6. Update when the branch model, CI or deploy
mapping changes.*
