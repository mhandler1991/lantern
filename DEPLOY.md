# Deploy — Lantern

> Hosting is **GitHub Pages**. This file exists because three of its constraints will
> silently break the app if they are not handled up front, and one of them produces a
> black screen with nothing in the console.

---

## 1. Why Pages fits

The app is peer to peer: no server, no database, no API keys, no environment variables.
A static file host is all it needs, so a free tier is genuinely free rather than
free-until-you-have-users.

Pages also happens to satisfy three requirements this app actually has:

| Requirement | Why it matters |
|---|---|
| **HTTPS** | WebRTC requires a secure context. So does the clipboard API for the invite link. Pages is HTTPS only. |
| **No build secrets** | Nothing to configure, so a public repository is safe. |
| **Query strings, not paths** | Invites are `?r=CODE`. Pages has no rewrite rules, so a path-based route would 404. This is why the room code is a query parameter. |

📌 **The repository must be public.** Pages on a private repo requires a paid plan. If
the repo must stay private, use Netlify or Cloudflare Pages instead — both do private
repos free and both serve from a domain root, which makes the `base` note below moot.

---

## 2. The three constraints

### `base: './'` — non-negotiable

```ts
// vite.config.ts
export default defineConfig({
  base: './',   // 🚫 never '/' — see below
});
```

Pages serves a project site from a **subpath**: `username.github.io/lantern/`. With
Vite's default `base: '/'`, every asset reference becomes absolute (`/assets/...`) and
**404s on a subpath**.

This is the same setting that lets the same build work from a domain root later, so
there is no reason to ever change it.

### Runtime-fetched assets must follow the base

Anything fetched at runtime rather than imported — fonts, pack files, sounds — must be
resolved against `import.meta.env.BASE_URL`, never a hardcoded `/`.

```ts
const url = `${import.meta.env.BASE_URL}packs/core.json`;   // ✅
const url = '/packs/core.json';                              // 🚫
```

**A wrong runtime path fails silently.** No error, no broken-image icon, just missing
content. In the predecessor project this produced a completely black screen with nothing
in the console but texture misses, and it cost real time to find.

### `.nojekyll`

Pages runs Jekyll by default, which **silently skips files and folders beginning with an
underscore**. Nothing does today; a future dependency emitting `_something` would vanish
without explanation. The workflow touches this file. Leave it there.

---

## 3. Two sites, one repo

Pages publishes **one** site per repository. It does not do per-branch preview URLs the
way Netlify and Vercel do.

Solution: publish both into one Pages site at different paths.

| Branch | URL | Purpose |
|---|---|---|
| `main` | `https://<you>.github.io/lantern/` | Production |
| `dev` | `https://<you>.github.io/lantern/preview/` | Integration testing |

`preview/` is a real deploy on a real HTTPS URL, which matters because **a phone on
cellular cannot reach `localhost`** — and testing peer connectivity across networks is
the only honest connectivity test there is.

---

## 4. The workflow

`.github/workflows/deploy.yml`. Publishes to the `gh-pages` branch, `main` at the root
and `dev` under `preview/`.

📌 **This is not the only workflow.** `.github/workflows/ci.yml` is the merge gate and
runs on `pull_request` into `dev`; this one runs on `push` to `main` and `dev`, after
the merge. Both re-run the checks deliberately — CI decides whether a change may land,
deploy decides whether a build may reach a URL, and a `dev` push can arrive without a
PR. Keep the action pins in the two files in step.

```yaml
name: Deploy

on:
  push:
    branches: [main, dev]
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      # The gate. A build that cannot start must never reach a URL.
      - run: npm run typecheck
      - run: npm test
      - run: npm run build

      # Jekyll would otherwise skip anything starting with an underscore.
      - run: touch dist/.nojekyll

      - uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
          # main -> root, dev -> /preview/
          destination_dir: ${{ github.ref_name == 'main' && '.' || 'preview' }}
          keep_files: true
```

`keep_files: true` matters: without it, deploying `dev` would wipe the production build
sitting at the root.

**One-time setup 👤:** Settings → Pages → Source: **Deploy from a branch** → `gh-pages` /
`root`. (Not "GitHub Actions" — that mode publishes a single artifact and cannot place
two branches at two paths.)

---

## 5. Two entry points

`test-room.html` deploys alongside the app and must be a second Vite input:

```ts
build: {
  rollupOptions: {
    input: {
      main: resolve(__dirname, 'index.html'),
      testRoom: resolve(__dirname, 'test-room.html'),
    },
  },
},
```

Live at `.../lantern/test-room.html` and `.../lantern/preview/test-room.html`.

Having it on a real HTTPS URL is the point — it is what you open on a phone when
somebody cannot connect.

---

## 6. What Pages does not solve

**TURN.** WebRTC needs a relay for peers behind symmetric NAT or a strict firewall,
roughly 10-15% of connections. No static host changes that.

⚠️ **Do not add TURN without working credentials.** An unreachable TURN server does not
fail loudly, it stalls ICE gathering. The predecessor project shipped shared public
relays that had been re-homed, and dead relays are **worse than none**. See
`DESIGN.md` §8.

**Caching.** Pages caches `index.html` briefly. After a deploy, hard-refresh
(`Ctrl+Shift+R`) before concluding a fix did not work. Hashed asset filenames mean the
bundle itself is never stale, but the HTML pointing at it can be.

---

## 7. Checklist before the first deploy

- [ ] Repository is **public** (or move to Netlify / Cloudflare Pages)
- [ ] `vite.config.ts` sets `base: './'`
- [ ] No hardcoded `/` in any runtime-fetched path
- [ ] `test-room.html` is a build input
- [ ] Workflow present, Pages source set to `gh-pages` / root
- [ ] `npm test` green locally

## 8. After every deploy

- [ ] Hard-refresh, confirm the app loads and dice roll
- [ ] Console clean — no 404s on assets or packs
- [ ] `test-room.html` in three tabs, all showing 2 peers
- [ ] Invite link opens with the code prefilled
- [ ] Phone **on cellular**, joining a table from the laptop
