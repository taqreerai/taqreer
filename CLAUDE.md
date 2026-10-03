# Taqreer — Agent Brief

Bilingual (Arabic + English) AI presentation platform. The user provides content +
brand; **Claude designs each slide as HTML**; the browser renders it 1:1; a patched
`dom-to-pptx` + custom OOXML post-processor exports a high-fidelity PPTX. Decks are
generated **and** edited in one in-canvas studio. **RTL/BiDi quality is the product
differentiator.** Live on https://taqreer.ai.

**📖 Full system reference → [CONTEXT.md](CONTEXT.md)** — stack, branding, routing,
i18n, auth, the 4 flows, the generation engine + Inngest, export pipeline, the studio,
data model, credits/billing, platform services, infra/deploy, env vars, API surface,
repo map. The live design-system reference is the **`/ar/brand`** route (source of
truth: `app/globals.css`).

> ⚠️ **Next.js 16 + Turbopack** — APIs/conventions differ from older Next.js. When
> unsure, read `node_modules/next/dist/docs/` before writing code.

---

## ‼️ Non-negotiable conventions

- **`dev` is the ONLY working branch.** Never `git checkout -b`. Small fixes deploy
  straight from `dev` (`./deploy.sh` = git push-to-deploy: pushes `dev`+`main`, builds on
  the box, atomic-swaps, health-checks `/ar`); schema / webhook / feature changes get a
  `dev → main` PR for CodeRabbit BEFORE deploying. `deploy.sh` refuses a dirty tree.
- **Ask before any edit that wasn't explicitly requested.** Exploratory questions are not
  edit requests. Diagnose → propose → wait for the go.
- **Debug to a PROVEN root cause** before fixing; never stack half-baked fixes (revert a
  failed attempt before trying the next). Reproduce, instrument, trace what the code
  really did.
- **No em dash** anywhere (copy, comments, commits, PRs, generated HTML) — comma / colon
  / hyphen instead. Avoid the en dash too.
- **Latin numerals only (0-9)** in user-facing copy, even inside Arabic strings.
- **Bilingual = translate AND mirror direction** in the same pass. Logical CSS only
  (`start`/`end`, `ms`/`me`, `text-start`, `inset-inline-*`) — never physical
  `left`/`right`/`ml`. `stripLocale(pathname)` before ANY pathname check. Internal links
  via `localizedHref`; locale switches via `switchLocaleHref`.
- **Design discipline:** never hardcode visuals — check the design system FIRST (the live
  **`/ar/brand`** route + `app/globals.css`), reuse existing tokens / primitives, add a
  class to globals.css before inventing. Flat system, one blue accent. Verify in BOTH
  light and dark.
- **Realtime → in-place state updates, never `router.refresh`** (router.refresh only on
  user-initiated actions like Retry).
- **Run `/security-review`** after new API routes, upload / auth / sanitize edits, schema
  changes, or Inngest prompt-pipeline edits. Skip for pure CSS / comments.
- **Deck HTML lives in TWO stores** — `PresentationVersion.slideJson` (what the viewer
  reads) and `SlideVersion.slideJson` (per-slide history). Manual DB repairs patch BOTH.
- **`dom-to-pptx` / `bidi-postprocess`** are patched via patch-package; changes run
  through the export spike first. Don't reintroduce coordinate math — the browser does
  layout.
- Use **playwright / code-simplifier / security-guidance / frontend-design** plugins by
  default, but stay inside Taqreer's existing tokens + primitives.

---

## Local dev

```bash
npm install                  # postinstall applies the dom-to-pptx patch
docker compose up -d         # postgres 16 + redis 7
npx prisma migrate deploy    # local only — DATABASE_URL must be localhost
npm run dev                  # Next.js :3000
npx inngest-cli@latest dev   # Inngest dev server :8288
```

`.env.local` needs `DATABASE_URL` (docker localhost, NOT supabase), `ANTHROPIC_API_KEY`,
the `NEXT_PUBLIC_SUPABASE_*` + service-role keys, `INNGEST_EVENT_KEY` /
`INNGEST_SIGNING_KEY` (+ `INNGEST_DEV=1`), Stripe + Sentry. No test runner.
`npm run lint` → `eslint .`. After a schema change: `npx prisma generate` + restart the
dev server (stale in-memory client). One-off ops run via `tsx scripts/*.ts`.

---

## Gotchas

- Turbopack sometimes serves a stale `globals.css` chunk after an edit — make a second
  real content change to force a clean recompile.
- `set-state-in-effect` is a lint error — derive initial state in the `useState`
  initializer, not a mount effect.
- Page scroll is on `<body>` (RTL scrollbar sits left); `scrollbar-gutter: stable`
  required (modals lock `overflow:hidden`).
- Editor iframe reload needs `reloadKey` baked into the `srcDoc` (`SlideEditor.tsx`).
- `prisma.config.ts` loads `dotenv/config` so `DATABASE_URL` wins; restart the dev server
  after any schema change.
- macOS `ssh taqreer` REQUIRES `IPQoS none` in `~/.ssh/config` (the network drops
  DSCP-marked packets).

---

## Cloud sessions (claude.ai/code)

A cloud session gets a clean clone of `taqreerai/taqreer` and NOTHING from the owner's
machine: no `.env.local`, no docker DB, no Inngest, no `ssh taqreer`, no local MCPs
(OpenSEO, browser), no auto-memory. Current state + pending work:
**[docs/HANDOFF.md](docs/HANDOFF.md)**, read it first.

- **What works here:** code edits, `npm run lint`, `npx tsc --noEmit -p .`, `npm run build`.
  Setup: `npm ci` (postinstall applies the dom-to-pptx patch) then `npx prisma generate`
  (needs no env; `prisma.config.ts` has a localhost fallback URL).
- **What does NOT work:** running the app, generating decks, uploads, logged-in pages,
  prod DB / logs, deploying. Never ask for or store prod secrets (Stripe live key,
  Supabase service role) in the cloud environment.
- **Branch:** commit to `dev` and `git push origin dev`. If the environment forces its
  own branch, open a PR into `dev`. Never push to `main` (`deploy.sh` owns it).
- **Commits:** `git -c user.name="Osama" -c user.email="dsignerarts@gmail.com" commit`,
  message ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. All GitHub
  activity is as `taqreerai`, never `ultimehdi`.
- **Deploy is local-only:** the owner pulls `dev`, tests on localhost, then runs
  `./deploy.sh` from the desktop. Nothing reaches taqreer.ai from a cloud session. Say
  clearly in the final message what still needs a local test.
- **Never flag `deck_freeze_pixelgate_failed`** (or other `deck_freeze_*`) warnings: by
  design, not a bug.
- **Be token-frugal:** the owner is on a capped credit budget. Read files by range
  (MimicFlow.tsx, deck-generate.ts and create/page.tsx are 1,500-3,000+ lines), keep
  tasks scoped, don't re-read what you just edited.
