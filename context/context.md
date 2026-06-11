# Taqreer — Status & Handover

Bilingual (Arabic + English) AI presentation platform. The user provides content
+ brand; **Claude designs each slide as HTML**; the browser renders it 1:1; a
patched `dom-to-pptx` + custom OOXML post-processor exports a high-fidelity PPTX.
Decks are generated **and** edited in a full in-canvas studio.

> **Structured map** (stack, routes, i18n, theming, design system, components,
> flows, backend): **[context/architecture.md](architecture.md)**. This file is
> the higher-level status + handover. Change history is the git log.

---

## Status at a glance

| Area | State |
|---|---|
| HTML-first generation (all 4 flows author `<section>` HTML) | ✅ |
| Flows: **Create / Enhance / Mimic / Datasheet** (+ use-template) | ✅ |
| **In-canvas studio editor** (`/project/[id]`, `DeckView`) — generate ⟶ edit | ✅ |
| Per-slide versioning, comments, AI partial-regen | ✅ |
| Export: **PPTX · PDF · PNG · HTML** | ✅ |
| Templates (library + use-template flow) | ✅ |
| **Bilingual** `[lang]` (ar/en, chrome dir vs canvas dir) | ✅ |
| **Light / dark themes** (`tq_theme` cookie, no flash) | ✅ |
| **Blue design system** (flat, one accent) + brand guidelines page | ✅ |
| Realtime (project/user channels) + notifications | ✅ |
| **Pricing / credits / billing (Stripe)** | ⏳ **not built — the next major work** |
| Admin panel | ⏳ planned (spec only) |

The product is functionally complete end-to-end. The one remaining major build is
**monetization** (credits + Stripe). A few small polish items remain (below).

---

## The one remaining major build — subscription & billing

Source of truth: **[context/subscriptionmodel.md](subscriptionmodel.md)** (LOCKED
tiers Free $0 / Starter $15 / Plus $30 / Pro $70 + the credit model). Nothing is
shipped yet; the build plan (5 phases):

1. **Credit ledger** — a `Credit` model + atomic `tryConsume` (the schema already
   captures `UsageEvent` + token usage; needs a `TokenUsage`/`Credit` table).
2. **Wire consume/refund** into every Claude entry point (`deck-generate.ts` etc.),
   resolving the effective preset after any auto-upgrade.
3. **Stripe** — checkout / portal / webhook (test mode first).
4. **`/pricing` + paywall + balance pill + per-preset cost estimate** on
   `GenerateSplitButton`.
5. **Live keys.**

⚠️ Open decision: the auto-upgrade target (opus-fast vs opus-balanced) is a margin
risk — confirm before wiring Phase 2.

**Admin panel** is spec-only: **[context/admin-panel-plan.md](admin-panel-plan.md)**
(Stripe wiring, PostHog visitor analytics; `User.role` + Notification fan-out +
`UsageEvent` already exist as a head start).

---

## Small open polish items (not major builds)

- **i18n**: enable the `no-literal-string` lint, add hreflang / per-locale OG
  images. (`User.locale` persistence + the string/direction sweep are done.)
- **Realtime**: notifications fan-out is wired — give it an end-to-end cross-tab
  pass before relying on it in prod (local dev can't deliver broadcasts; the
  status poll is the fallback).
- **Studio zoom**: zoom is preview-only — the edit iframe can't be CSS-scaled
  (coords don't follow). Next step is an edit⇄preview toggle + zoom on the inline
  `SlideRenderer`.
- **Pre-launch**: server-side HTML sanitization for generated decks (see the
  top-of-file TODO in `components/slides/SlideRenderer.tsx`); a couple of
  prompt-level fidelity tweaks (gradient text, contrast).
- **Design**: rule on the two file-type export tints (`--tq-export-html` violet /
  `--tq-export-png` magenta) — the only non-blue brand hues left.

---

## How the studio works (it's a real editor now)

`/project/[id]` (`DeckView`) is one surface for **both** generation and editing —
the generating shell (disabled, streaming) transitions seamlessly into the editor
(enabled), no remount. In the editor:
- **Manual edits** happen in-canvas: text + style via `StylePill`/`MorePopover`/
  `FontControl`, layer reorder in `LayersPanel`, slide reorder in `SlideNavSidebar`.
  Edits are an **in-place content save** (no new version).
- **AI path**: full regenerate or per-slide partial regen (a comment flagged
  `forAi` drives partial regen); restore from per-slide history.
- Undo/redo is a client stack; history = checkpoints on Save + 10-min idle.
- Realtime events drive **in-place state updates, never `router.refresh`**.

(So the old "Preview Window is review-only, no manual editor" rule is retired —
the editor exists.)

---

## Conventions & non-negotiables

- **`dev` is the only branch.** Never `git checkout -b`. CodeRabbit reviews
  `dev → main` PRs. Push on request / milestone / >3 commits.
- **Design discipline**: never hardcode visuals — tokens / add a class to
  `app/globals.css` first; read the globals.css legend before any visual change;
  reuse existing primitives. The design system is flat + **one blue accent**.
- **Bilingual**: translate **and** mirror direction (logical CSS only);
  `stripLocale()` before any pathname check; `localizedHref`/`switchLocaleHref`
  for internal nav; **Latin numerals only**; **no em dash** in copy.
- **Both themes**: verify visuals in light *and* dark (flip and compare).
- **Realtime → in-place state**, never `router.refresh`.
- **Don't reintroduce coordinate math** — the HTML pivot deleted bbox arithmetic /
  RTL coordinate mirroring; the browser does layout.
- **`dom-to-pptx` / `bidi-postprocess` changes** run through the export spike
  first; the library is **patched via patch-package** (postinstall applies it).
- **Run `/security-review`** after new API routes, upload/auth/sanitize edits,
  schema changes, or Inngest prompt-pipeline edits.
- Stale-chunk gotcha: a globals.css edit sometimes needs a second real change to
  force a clean Turbopack recompile.

---

## Local dev — one-pager

```bash
# prerequisites: Node 20+, Docker Desktop
npm install                  # postinstall auto-applies the dom-to-pptx patch

# .env.local (from the team). Required:
#   DATABASE_URL=postgresql://taqreer_user:...@localhost:5432/taqreer   # docker, NOT supabase
#   ANTHROPIC_API_KEY=sk-ant-...
#   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY=...
#   INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY=...

docker compose up -d         # postgres 16 + redis 7
npx prisma migrate deploy    # local only — DATABASE_URL must be localhost

npm run dev                  # Next.js :3000
npx inngest-cli@latest dev   # Inngest dev server :8288

# helpful scripts (scripts/):
npx tsx scripts/wipe-decks.ts            # wipe decks + storage (keeps users)
npx tsx scripts/setup-storage.ts         # one-time Supabase bucket setup (idempotent)
```

---

## Reference docs

- **[context/architecture.md](architecture.md)** — the structured architecture +
  design-system map.
- **[context/subscriptionmodel.md](subscriptionmodel.md)** — pricing / credit /
  billing source of truth.
- **[context/admin-panel-plan.md](admin-panel-plan.md)** — admin panel spec.
- **Memory** (`~/.claude/projects/-Users-osama-taqreer/memory/`, loaded each
  session via `MEMORY.md`) — workflow rules + project context; re-read when in
  doubt.

---

*Living document — current state, not a changelog. History is the git log.*
