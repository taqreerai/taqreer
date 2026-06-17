# Launch progress + continuation guide

Updated 2026-06-17 (admin/ops console + PostHog analytics + conversion funnel - see
the "Latest session" block below FIRST). Read this + context/deploy.md to resume
launch work in a fresh session. The launch plan's full reasoning lives in the
conversation that produced it; this file is the operational state.

## How work flows (IMPORTANT for any new session)

- ALL file edits happen LOCALLY in /Users/osama/taqreer. Never edit on the
  server. Commit, then deploy.
- `./deploy.sh` = GIT PUSH-TO-DEPLOY (since 2026-06-14, replaced rsync): pushes
  dev+main to GitHub, then `git push prod dev:main` to the box's bare repo
  (taqreer:/root/taqreer-app.git). The tracked post-receive hook
  (scripts/post-receive.sh) checks main out into the live work-tree, npm ci +
  prisma migrate deploy, builds into .next-build, atomic-swaps to .next-deploy,
  pm2 reload, health-checks /ar (expect 200). `--rebuild` re-runs the hook on
  current main with no new commit (after an .env change); `--force` skips the
  clean-tree guard. The pushed main SHA is exactly what prod runs.
- Server access: `ssh taqreer` (root@178.105.88.35, key ~/.ssh/taqreer_hetzner,
  password auth disabled). macOS ssh REQUIRES `IPQoS none` in ~/.ssh/config.
- Runtime secrets: ONLY in /root/taqreer/.env on the server (chmod 600).
  Includes prod DATABASE_URL, COMING_SOON (currently 0 = gate OFF),
  COMING_SOON_KEY, NEXT_DIST_DIR, live Stripe keys, SENTRY_AUTH_TOKEN.
- Prod DB: **Supabase Pro Postgres** (eu-central-1, session pooler) since 2026-06-16; RLS on all public tables. (Was server-local Postgres 16, now a stopped standby.)
  psql access: `ssh taqreer` then use DATABASE_URL from the app .env.
- Deck HTML lives in TWO places (PresentationVersion.slideJson = what the
  viewer reads; SlideVersion.slideJson = per-slide history). Manual repairs
  must patch BOTH.

## ⚡ Latest session (2026-06-17) - Admin/ops console + PostHog analytics + conversion funnel (READ FIRST)

**Admin/ops console BUILT + LIVE on prod** (Phase C item; went well beyond the
"read-only v1" spec - it's a full read+write console). Route group
`app/[lang]/(app)/admin/{layout,page,templates,users,broadcast}`, gated by
`lib/api/admin-context.ts` requireAdminPage()/requireAdminApi() on `User.role`.
Grant admin via `tsx scripts/set-admin.ts <email>` (run ON THE BOX against the prod
DATABASE_URL for prod). **Prod dev@taqreer.ai set role=admin.** Four screens, ALL
real data (mock retired):
- Overview: KPI stats / plan split / recent activity (real Prisma + LIVE Stripe
  balance) + PostHog reads (sources-by-channel, geo globe, online-now, unique
  visitors / pageviews, device/browser/os, conversion funnel).
- Templates: curator-only featuring via `Template.featuredOrder` (rewired marquee).
- Users: real list + credit grants (grantTopup) + ban/unban + hard delete (Prisma
  cascade + Supabase auth admin delete). Admin excluded from the table + counts.
- Broadcast: bilingual EN+AR fan-out (fanOutNotification, per-viewer-locale render),
  AdminBroadcast history, 30-day TTL cron (notifications-cleanup). Bell got a
  persistent unread dot + Read all; notifications now render by the URL locale (not
  the browser-wide cookie - fixed a 2-tab cross-locale bug).

**PostHog analytics WIRED (EU project 204126)** - closes the Phase D PostHog item +
the old "globe/device deferred to PostHog" gap.
- **Capture** (consent-gated, components/analytics/PostHogProvider.tsx): inits only
  on tq_cookie_consent=accept; identify(supabase uid) on login; api_host =
  **https://d.taqreer.ai** = PostHog MANAGED reverse proxy. Root-cause lesson from a
  long 503 hunt: posthog-js gzip browser requests get 503'd direct AND through a
  hand-rolled Next rewrite proxy; the MANAGED proxy handles them natively (and dodges
  ad-blockers). All 6 PostHog setup checks GREEN. Reach for the managed proxy FIRST.
- **Read** (server-only, lib/analytics/posthog.ts): Query API (HogQL) with the
  PERSONAL api key, feeding the Overview. Env: NEXT_PUBLIC_POSTHOG_KEY (phc_, public,
  write) + NEXT_PUBLIC_POSTHOG_HOST (eu.i.posthog.com; used by the read layer) +
  POSTHOG_PERSONAL_API_KEY (phx_, SECRET) + POSTHOG_PROJECT_ID=204126, in .env.local
  + prod .env. GOTCHA: prod .env had a STALE phc_ key from a prior setup - keep
  capture + read on the SAME project.
- **Conversion funnel** (PR #78, dev->main, AWAITING CodeRabbit): server-side events
  signed_up -> deck_created -> deck_exported -> purchase_completed (posthog-node,
  lib/analytics/posthog-server.ts, distinctId = supabase uid) at safe non-locked
  points (user-sync, projects route after the Inngest send, pdf/png export routes +
  pptx client-side, stripe webhook); windowFunnel HogQL; ConversionFunnel card.

**Also:** SPF/DKIM/DMARC confirmed (Resend); merged the 2-step signup back to one
screen (dropped Google from the email path).

**Remaining admin-panel item (optional):** AdminAuditLog - no record of admin writes
(grants/bans/deletes/broadcasts) yet; do this before granting anyone else admin.

**NEXT: website responsive / mobile layout** = the Phase D mobile audit of the 5
public surfaces (landing, pricing, signup/login, checkout, deck viewing; editor
stays desktop-only).

## ⚡ Latest session (2026-06-16) - prod DB moved to Supabase Pro + DB hardening (READ FIRST)

**Prod app DB migrated: server-local Postgres 16 -> Supabase Pro Postgres**
(AWS eu-central-1, ~4ms from the Nuremberg box). Why: on-box-only `pg_dump`
backups were a DR SPOF, the box is RAM-tight, Supabase is already paid for.
- Connection = **session-mode pooler** (port 5432, IPv4, session-consistent for
  the credit `FOR UPDATE` ledger). `lib/prisma.ts` sets `ssl` on the pg adapter
  for non-local hosts; `DATABASE_URL` carries NO sslmode (a URL sslmode wipes the
  adapter ssl object). Schema via `prisma migrate deploy`; data via `pg_dump
  --data-only` loaded with `SET session_replication_role=replica` (Supabase's
  postgres role can't `DISABLE TRIGGER ALL`). Row-count parity + a live
  `FOR UPDATE` ledger op verified.
- **Security**: Prisma tables in Supabase's `public` schema were exposed via
  PostgREST with the anon key. Fixed: **RLS enabled on every public table**
  (migration `enable_rls_public`) - the app bypasses RLS as table owner,
  PostgREST default-denied (verified anon REST returns []).
- **Cleanup** (migration `drop_vestigial_index_fks`): dropped vestigial
  Account/Session/File (0 rows/0 refs; Account held OAuth tokens); indexed 7
  uncovered FK columns; optimized realtime RLS policies (`(select auth.jwt())`,
  `supabase/realtime-policies.sql`); ANALYZE. Advisors now 0 errors; remaining
  info is intentional ("RLS Enabled No Policy" = lockdown) or cold-DB noise
  ("Unused Index").
- Local Postgres kept STOPPED as rollback standby (`.env.local-backup` = old
  URL). Decommission in a few days for RAM. DB password NOT rotated (user call).

## ⚡ Latest session (2026-06-15, later) - design-system route + auth redesign + Turnstile (READ FIRST)

**PR #72 merged + deployed.** Two pieces.

**1. Design system is now a LIVE route.** Replaced the static
`public/brand-guidelines.html` (hand-copied tokens that drifted) with
`app/[lang]/brand/page.tsx`, served at **/ar/brand + /en/brand**. It imports the
real `app/globals.css`, so every `--tq-*` token + utility class is a byte-exact
replica - 16 sections (tokens/themes, logo, typography, brand+motion+gradients,
surfaces, buttons, icons, inputs, menus/popovers, toasts, uploads, modals,
tooltip/status, plan+tiers, models/presets, email shell). Embeds the real
`ParagraphWriteIcon` + `ThemeToggle`; the old page's aurora copied verbatim;
panel-colored base + landing-style hero chips. CLAUDE.md + architecture.md
repointed; static file deleted. **THIS IS NOW THE CANONICAL DESIGN REFERENCE - the
one design rule is "check /ar/brand before any visual work"** (the old
design-discipline + flat-redesign memories were folded into it).

Also fixed in globals.css: the ok/warn/down **status tokens had no `.light`
overrides**, so status chips + `.status-error`/`.status-success` banners were
near-invisible on white. Added `:root.light` overrides (Tailwind-700 text +
stronger borders) and made `.status-error`/`.status-success` token-backed. App-wide.

**2. Auth redesign.** Reorganised the auth modal like the user's reference:
left-aligned eyebrow + title, OUTLINED Google OAuth (vs the solid blue primary CTA),
OR divider, separators, restored breathing; the wordmark moved OUT of the modal to
the page bottom (full opacity). Confirm-email + forgot success screens now use the
canonical message shape (thin blue `mark_email_unread` icon + muted text) with a
RESEND button + 60s countdown. login/signup/forgot/reset all aligned.
- **Signup is 2-PHASE**: phase 1 = email (+ Google); phase 2 = full name + password
  with a LIVE requirements checklist (8 chars / 1 number / 1 special char / no
  leading-or-trailing whitespace; plain checkmarks, one color), submit gated on all
  met. Special-char regex is `/[^\p{L}\p{N}\s]/u` (CodeRabbit fix - the old
  `/[^A-Za-z0-9]/` wrongly accepted Arabic letters + spaces as "special").
- **Cloudflare Turnstile (Supabase-native captcha)** on signup-step2 / login /
  forgot: new `components/auth/TurnstileWidget.tsx` (explicit render, theme-aware,
  no new dep), token passed via `options.captchaToken`. The client does NOT
  hard-disable the CTA on a missing token - Supabase enforces server-side, so a
  widget hiccup can't dead-end users. Security review: CLEAN.

**Turnstile config - site key DONE in prod, two USER actions remain:**
- ✅ Public site key `0x4AAAAAADlVmCigvw9xshMv` → `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
  in the SERVER .env (2026-06-15) + a `./deploy.sh --rebuild`. NEXT_PUBLIC_* vars
  are inlined at BUILD time, so a plain reload won't pick them up. Widget renders
  in prod now.
- ⏳ USER: Supabase Dashboard → Auth → Settings → Bot & Abuse Protection → enable
  CAPTCHA → Cloudflare Turnstile → paste the SECRET. Until then the widget renders
  but the token is NOT verified (captcha is decorative, not enforcing).
- ⏳ USER: in the Cloudflare Turnstile widget settings add `taqreer.ai` + `localhost`
  to the allowed hostnames, else the widget shows "Unable to connect".

This is the first bot-protection on auth (Phase C item) - real rate limiting still
doesn't exist (the share-invite + auth endpoints are still uncapped).

## ⚡ Latest session (2026-06-15) - billing emails + credit/logo bug hunts

**Billing emails: we OWN them now** (shipped, deployed). Branded bilingual
receipt + payment-failed + subscription-ending on our email shell
(`lib/email/billing.ts` + `lib/billing/receipt-email.ts`), fired from the Stripe
webhook (receipt on `invoice.payment_succeeded` + top-up checkout; payment-failed
on `invoice.payment_failed`; ending on the cancel false->true transition). Resend,
locale from `User.language`, Latin numerals, full-width receipt card. **KEEP
Stripe's native receipts OFF** (Settings -> Customer emails) so users don't get
two. Preview any time: `tsx scripts/preview-billing-emails.ts <email>`.

**Real-card smoke test DONE** (Plus on dev@). It surfaced two issues, both FIXED:
- post-checkout UI didn't update until refresh -> `pollPurchaseSettled()` refetches
  credits + notifications after a confirmed checkout, both surfaces (PR #64).
- no receipt email -> the billing emails above (PR #65).

**Two credit-ledger bugs found + fixed (PR #63), deployed:**
- Bug A: new users got 0 signup credits - the dashboard server component upserts
  the User BEFORE user-sync's `if (!existing)` grant, so it was skipped for every
  signup. Grant now gates on `CreditAccount.signupGrantedAt` (idempotent, self-
  heals on next sign-in), in user-sync + projects.
- Bug B: canceling refilled spent credits - `customer.subscription.updated` called
  `grantSubscriptionCycle` (which SETs the balance) on every event. Now re-grants
  only on an actual plan change.

**Logo fix (PR #63):** flag / multicolour logos vanished or corrupted on slides.
Root cause: a UTF-16-encoded SVG broke `readLogoSvgMarkup`'s `<svg` check -> fell
to the URL/`<img>` path where Claude hand-copied the ~600-char signed URL and
mangled it. Fix: `decodeSvgBytes` (BOM/UTF-16), polychrome detection -> mono logos
inline + recolour per slide (Claude), polychrome injected as a true-colour `<img>`
by code (no URL for the model to corrupt).

**OPEN - verify before real sales:** the Stripe LIVE price for `tier_plus_monthly`
may still be the $1 smoke-test price (the app shows $15 again - cost.ts reverted).
Restore the $15 live price: `tsx scripts/stripe-setup-products.ts --live`.

**`debugflow.md`** (repo root) added - the root-cause-before-fix debugging method.

## ⚡ Latest session (2026-06-14) - Stripe LIVE + infra cleanup

**Stripe is LIVE in production** (was test mode):
- Live Products/Prices created. `scripts/stripe-setup-products.ts` gained a
  `--live` opt-in flag (default still refuses a live key); run it with the live
  secret to (re)sync. Catalog = lib/billing/prices.ts (resolved by lookup_key).
- Live webhook "Taqreer prod" (id we_1TiBeN..., 6 events: checkout.session.completed,
  invoice.payment_succeeded / _failed, customer.subscription.updated / _deleted,
  charge.refunded) → https://taqreer.ai/api/stripe/webhook.
- Server .env holds live pk/sk/whsec. The chat-exposed secret was ROLLED (old key
  set to expire ~2026-06-15). Pre-change .env backup: /root/taqreer/.env.bak.prelive.
- REMAINING for billing go-live: mada + Apple Pay (Stripe dashboard payment
  methods + Apple Pay domain-verify taqreer.ai); a REAL-CARD smoke test (only the
  embedded form RENDER was verified, no payment completed); premium-template
  gating (gate already enforced server-side; the upsell modal is now in-place, PR #62).

**Prod app dir RENAMED** /root/taqreer-app → **/root/taqreer** (the live work-tree).
The bare repo stays /root/taqreer-app.git (deploy.sh's `prod` remote unchanged).
pm2 taqreer-prod cwd + the post-receive hook APP_DIR + backup.sh were re-pointed;
.env + .next-deploy moved with the dir. On-box backups: post-receive.bak,
/root/backup.sh.bak. Tracked deploy.sh/post-receive.sh/docs path-synced to match.

**Coming-soon gate is OFF** (COMING_SOON=0) - site is PUBLICLY accessible. Kept
off because new **registrations are disabled** as the interim guard against budget
abuse (no rate limiting yet). VERIFY the Supabase "Allow new users to sign up"
toggle is OFF. Re-enable the gate: COMING_SOON=1 + `./deploy.sh --rebuild`.

**Prod DB cleaned**: dropped the stray empty `taqreer` database (kept taqreer_prod
+ postgres); deleted stale /root/taqreer (old rsync dir, 1.4G) + its dead pm2
process + nginx-taqreer.bak/.bak2. **ALL users WIPED except dev@taqreer.ai** (now
FREE) - dsignerarts@gmail.com, pixelwolves.co@gmail.com, yazadsfather@gmail.com,
credit-sim-ui@example.com + their decks/credits cascade-deleted. Pre-wipe backup:
/root/backups/pre-userwipe.dump. The deleted accounts still exist in Supabase auth
(separate; remove in the Supabase dashboard if wanted).

**PR #62 OPEN (dev→main, awaiting CodeRabbit)** - in-place upgrade modal for ALL
mid-task payment gates (keep the user's journey undisrupted): the credit-gate
locked notice + the premium-template gate now open the embedded UpgradeModal in
place instead of a redirect / new tab; deliberate /plans + landing stay pages; the
dead ctx=tab checkout path was removed. #1 verified live, tsc + eslint clean. NEXT:
CodeRabbit review → address → merge → deploy. Also this session: VAT = STAY ON
Stripe (no MoR/Paddle), Fable PARKED (disabled upstream), legal review DONE.

## Current state (Phase A — DONE except noted)

DONE:
- taqreer.ai LIVE on Hetzner CPX22 (nginx 443 → pm2 taqreer-prod :3100,
  certbot TLS auto-renew, ufw, 6GB swap, pm2-root boot persistence).
- Coming-soon gate live: COMING_SOON=1 rewrites all pages to
  /{lang}/coming-soon; https://taqreer.ai/preview?key=taqreer2025 sets the
  30-day tq_preview unlock cookie. Launch = remove env var + pm2 reload.
- Local dev data migrated to prod DB (4 users incl. dev@taqreer.ai,
  24 projects, brand kits, templates, credit ledger). Supabase auth+storage
  are the SAME project as dev, so logins and image URLs carried over.
- Nightly 02:00 backups (app tar + pg_dump -Fc, keep 10) — /root/backup.sh.
- First prod generation verified end-to-end (opus-fast, 5 slides; server
  load peaked at 0.02). Found+fixed: model styling by role name without the
  class → withCanvasClass now mirrors data-role into the class list.
- Thumbnails + exports unblocked: Puppeteer's Chrome was missing system libs
  (see deploy.md gotcha log); installed, test deck thumbnails rendered 5/5.
- GitHub reset to mirror local (force-pushed main; dev had no drift).
  Workflow locked in: small fixes deploy directly (deploy.sh auto-pushes
  dev+main); big changes PR dev→main for CodeRabbit BEFORE deploying;
  deploy.sh refuses a dirty tree (--force for emergencies).
- Day-1 live polish shipped: pill swatch borders visible both themes,
  opacity-row spacing, avatar↔pill header gap, instant profile-menu email
  (useUser paints from cached session, getUser verifies after).
- Docs consolidated to 4 files (context / architecture / deploy / this one);
  subscriptionmodel + billing-plan + admin-panel-plan folded into context.md
  (full text recoverable from git history).
- Inngest = self-hosted dev server (pm2 taqreer-inngest, :8288), 12 functions
  connected. Fine for launch at current (zero) volume; move to Inngest Cloud
  only when traffic warrants (user direction 2026-06-14, not a blocker).
- SSH password login disabled; root password that was shared in chat is dead.
- Supabase auth redirect URLs (https://taqreer.ai/**) added by user — Google
  OAuth + email links now return to prod. Verified the callback route works
  (gate-cookie holders only; gate-blocked callback self-resolves at launch).
- Cadence feature shipped (PR #58, deployed): monthly/yearly pill + unified
  PlanUsage plan card on /settings + /billing (+ /plans chip). Migration live.
- nginx 502 fixed: large Supabase auth cookies overflowed the default 8k
  proxy header buffer → bumped proxy_buffer(s) (see deploy.md gotcha log).
- RTL fix: payment-method card expiry now right-aligns in Arabic (was dir=ltr).

- Sentry WIRED + deployed (2026-06-13): the missing instrumentation.ts was
  why server errors weren't captured. v10 layout (instrumentation.ts +
  instrumentation-client.ts, deleted sentry.client.config.ts), new project
  taqreerai-66/taqreer, env-tagged, replay masked. Verified: test error →
  TAQREER-1. SENTRY_AUTH_TOKEN in server .env → source maps upload on deploy
  (verified: 1028 server + 135 client files). Bot-scanner 500s fixed:
  getDictionary now notFound()s on an invalid locale → /xxx.php scans 404
  cleanly (no more Sentry noise). Remaining: (c) sendDefaultPii + Session
  Replay are ON — revisit privacy in Phase B legal. PRODUCTION-ONLY since
  2026-06-14: Sentry.init is skipped off-prod, so local-dev errors never reach
  the project (see the PR #61 entry below).

- Shipped 2026-06-14 (PR #60, dev→main, CodeRabbit-reviewed): a 14-item polish
  batch + an editor-layout rework.
  • Pricing tier copy now matches the actual presets (Free = fast Opus, not
    "Sonnet"; same gpt-image model across all tiers). **Max "processing priority"
    is now REAL**: Inngest `priority.run` = `tier=='max' ? 120 : 0` on
    deck-generate + partial-regen; `tier` is stamped on the event at enqueue from
    the project OWNER's plan (`tierForUser`, lib/inngest-helpers). Effective once
    on Inngest Cloud / under load.
  • Credit graphs unified to REMAINING (avatar ring + profile menu + cards);
    `/plans` now renders the shared `PlanUsage` card (hideAction) like `/billing`.
  • Cookie banner: explicit Accept / Reject persisted in `tq_cookie_consent`
    (1y); the [lang] layout resolves consent on the SERVER + passes
    `initialDecided` (no first-paint flip, no client cookie parsing).
  • Editor: Slides/Layers rails collapsible (auto-collapse <1280px) + fixed to a
    page band (equal height, centered) with bare edge-arrow toggles; canvas
    width-capped at 1280px so it can't balloon into the header. Undo/redo forced
    back-left/forward-right; ⌘Z/⌘⇧Z forward out of the editor iframe to the local
    stack.
  • Project delete invalidates the Router Cache (router.refresh) so a deleted
    deck can't reappear from a stale RSC payload on navigation.
  • Polish: favicon = the email mark, 404 = landing aurora (no swiss lines),
    landing footer full-bleed, decks pill = CTA blue, one-word AR generate CTA,
    "you can downgrade anytime" Max footnote, dropped "links" from the AR hero.

- Shipped 2026-06-14 (PR #61, dev→main, CodeRabbit-clean, deployed):
  • Mimic GPT images (opt-in): a toggle on the reference-design card; with it ON,
    Claude recreates the reference deck's imagery via gpt-image (same
    subject/scene/mood) and fills empty placeholders with slide-relevant images
    (deck-generate MIMIC_IMG_ADDENDUM; isImagesMode now allows mimic, enhance +
    data still excluded). Default OFF keeps the mimic baseline unchanged. VERIFIED
    working end-to-end by the user.
  • Sentry hard-gated to PRODUCTION: skip Sentry.init entirely off-prod (client +
    server + edge configs + instrumentation.register early-return) so local-dev
    HMR transients can't reach the project; `enabled:false` alone had let a
    server-side onRequestError leak. The stray dev "topOffset is not defined"
    issue was resolved.

REMAINING in Phase A:
- Inngest Cloud: DEFERRED (user direction 2026-06-14) - no traffic yet, the
  self-hosted pm2 dev server is fine; revisit when volume warrants. NOT a blocker.
- Uptime ping (BetterStack free) once user creates account.
- Stripe TEST webhook endpoint for https://taqreer.ai/api/stripe/webhook
  (awaiting user go; secret goes into server .env as STRIPE_WEBHOOK_SECRET).
- Prune test users from prod DB before launch (credit-sim-ui@example.com etc).
- DONE 2026-06-16: prod DB migrated to Supabase Pro Postgres (see Latest
  session) - the stray-tables cleanup is moot (clean migrate). Decommission the
  stopped local Postgres in a few days to reclaim box RAM.

## Launch plan (agreed sequence)

Phase A — Foundation: infra, backups, monitoring. (≈done, leftovers above)

Phase B — Money + law (parallel tracks), all BLOCKERS:
- Billing live: ✅ live keys + live products/prices + prod webhook DONE
  (2026-06-14; see Latest session block). REMAINING: mada + Apple Pay (dashboard
  config + Apple Pay domain verification, verify inside the embedded
  ui_mode:elements form), premium-template gating. Real-card smoke test ✅ DONE
  (2026-06-15). Billing emails ✅ we OWN them now (2026-06-15) - branded receipt +
  payment-failed + subscription-ending on our shell; KEEP Stripe's native
  receipts OFF so users don't get two. Fable pricing decision PARKED (2026-06-14): Fable is
  disabled at Anthropic (upstream), so the fable-low preset is non-shippable and
  its pricing question is moot for now. Revisit only if/when Anthropic re-enables
  it. (Implication to handle later: keep fable-low out of the live preset picker
  so a Pro/Max user can't select a model that errors.)
- VAT / tax: DECISION (2026-06-14, revised) - STAY ON STRIPE. DEFER VAT while
  there are no real sales (test mode = zero taxable supplies = zero exposure; a
  ZATCA non-resident VAT application was started then abandoned - premature). When
  real revenue arrives, handle tax ON STRIPE: enable STRIPE TAX (auto calc +
  collect + file; US direct via TaxJar, global via partners) and register where
  required as triggered (non-resident KSA 15% / UAE 5% / EU / US states). We stay
  the registered, liable seller-of-record and keep our own pixel-exact Stripe
  Elements checkout.
    • Background: digital VAT is DESTINATION-based (charged where the customer is,
      not the seller), so a US LLC selling to KSA/UAE CONSUMERS can owe a
      non-resident registration. Stripe Tax computes + collects it; we register +
      remit (or lean on a filing partner).
    • MERCHANT OF RECORD (Paddle / Stripe Managed Payments / Lemon Squeezy) was
      considered (user liked Paddle 2026-06-14) and DROPPED for now: an MoR would
      shift ALL tax liability off us but replaces our checkout with its managed
      component and costs ~5%+ vs ~2.9%. Kept on the shelf as a fallback ONLY if
      direct VAT compliance later proves too burdensome; NOT the plan.
    • Trigger to act: monthly revenue crosses $X, OR the first customer who needs
      a real tax invoice. Keep clean per-country sales records meanwhile. NOT a
      launch blocker; launch on the current Stripe setup.
- ✅ LIVE (2026-06-13, PR #59 merged + deployed): bilingual ToS/Privacy/Refund
  (lib/legal/content.ts) + cookie banner + contact form (Resend department
  routing) + shared SiteFooter + gate-exempt public routes (incl. trailing-slash
  normalize). LEGAL_META filled from the Articles: PIXEL WOLVES LLC, 5830 E 2nd
  St Ste 7000 Casper WY 82609, effectiveDate 2026-06-13. Wyoming/US governing
  law (English controlling), KSA PDPL-aware privacy, standard-SaaS refunds.
  CodeRabbit findings addressed (rate-limit memory bound, cookie hardening,
  danger-color token). Counsel review DONE (2026-06-14): content stands as-is,
  no longer a blocker. Copy can still be revised in place if anything changes.
- ✅ DONE (2026-06-13): Billing UI cadence — monthly/yearly pill + hint on
  /plans, /settings, /billing; PlanUsage is now the shared plan card.
- Email deliverability + unified transactional emails: BUILT + DEPLOYED
  (2026-06-13). DNS audited + in place (Resend DKIM, SPF root=Google/send.=
  amazonses, DMARC p=quarantine, Workspace MX). Resend custom SMTP is ENABLED in
  Supabase (smtp.resend.com:465, no-reply@taqreer.ai). One shared dark shell
  (lib/email/shell.ts): flat #111111 + a SINGLE baked logo-box PNG
  (public/email/icon-box.png — mark+tile+border in one image so the iOS dark-mode
  flip can't vanish it). The CSS/PNG aurora glow was DROPPED after it half-flipped
  in Gmail dark mode (kept it simple). Code-sent emails LIVE through the shell:
  welcome (fires on signup via user-sync, with the 400-credit pill + 3 recent
  template covers), share-invite, contact. Five Supabase auth/security templates
  generated + PASTED into Supabase, locale-aware (Arabic explicit / English
  default Go conditional); source in docs/auth-emails/ + PASTE-INTO-SUPABASE.md.
  The throwaway /email-lab HTML-sender + design lab used to iterate on this are
  removed. REMAINING:
    • USER: Site URL is still http://localhost:3000 -> set to https://taqreer.ai.
    • Bump the auth-email rate limit (currently 30/h) for launch volume.
    • CODE TODO: exempt /callback from the coming-soon gate (proxy.ts
      alwaysPublic) so a fresh signup's confirm link + Google OAuth complete
      pre-launch (today they only work for tq_preview-cookie holders).
    • Gmail smoke-test each flow (signup confirm + welcome, reset, email change).
    • Note: the signup credit grant has alias + IP-velocity farming guards —
      repeat-testing from one inbox/IP grants 0 by design (not a bug).
    • Optional later: point DMARC rua at an inbox we monitor (GoDaddy default).

Phase C — Hardening:
- Rate limiting: NONE exists anywhere. Priority order: share-invite email
  route (spam vector burning Resend domain reputation), auth endpoints,
  export routes (Puppeteer CPU). One middleware + redis counter (server has
  local redis; Upstash if moving to managed). 1-2 days.
- Inngest concurrency caps matched to the Anthropic tier's concurrent
  Opus stream limit — queue, don't fail. Hold-release on failure is tested.
- ✅ Admin/ops console DONE + LIVE (2026-06-17) - see the Latest-session block.
  Shipped a full read+WRITE console (not just read-only): Overview/Templates/Users/
  Broadcast, all real data, credit grants + bans + deletes + bilingual broadcasts +
  live "online now" via PostHog. role-gated (User.role; set-admin.ts). Remaining
  (optional): AdminAuditLog before adding a second admin.
- Final /security-review over the whole diff before launch.

Phase D — Cheap pre-launch polish:
- SEO correctness: robots.ts + sitemap.ts are STALE (2 URLs, no ar/en split,
  no hreflang — deferred Phase 5 of the bilingual migration). hreflang +
  sitemap + OG cards + titles pre-launch; structured data/content post.
- ⏳ NEXT: Mobile audit of FIVE public surfaces only: landing, pricing, signup/login,
  checkout (Apple Pay on mobile Safari matters for GCC), deck VIEWING.
  Editor stays desktop-only with a graceful message — do not attempt.
- ✅ PostHog DONE (2026-06-17) - capture via the d.taqreer.ai managed proxy
  (consent-gated) + Query-API read feeding the admin Overview + the conversion
  funnel ($pageview/$pageleave/$web_vitals + signed_up/deck_created/deck_exported/
  purchase_completed). All 6 PostHog setup checks green. See the Latest-session block.
- support@ mailbox (the footer contact link + /contact form shipped 2026-06-13).

Launch. Then post-launch backlog (deliberately deferred): lifecycle emails +
unified template system, admin actions UI, content SEO + structured data,
mobile editor, onboarding tour, help docs, user data export, load testing,
contrast-guard phase 2 (detect-only logging is live and fine).

## Open user actions (blocked on Osama)

1. ✅ Supabase redirect URLs for taqreer.ai — DONE.
2. ✅ Sentry wired (taqreerai-66/taqreer) + source maps uploading — DONE.
3. ✅ Stripe LIVE keys + products + prod webhook - DONE (2026-06-14).
4. ✅ PostHog account + EU project 204126 + managed reverse proxy (d.taqreer.ai)
   created (2026-06-17) - analytics fully wired. REMAINING: BetterStack uptime.
   (Inngest Cloud deferred 2026-06-14 - not needed until there's traffic.)
5. ✅ Fable pricing decision - PARKED (Fable disabled at Anthropic upstream).
6. ✅ Legal counsel review - DONE (content stands).
7. REMAINING billing go-live: mada + Apple Pay (Stripe dashboard) + a real-card
   smoke test + premium-template gating. Verify Supabase signups are OFF (the
   public-site interim guard while there's no rate limiting).
