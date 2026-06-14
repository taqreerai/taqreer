# Launch progress + continuation guide

Updated 2026-06-13. Read this + context/deploy.md to resume launch work in a
fresh session. The launch plan's full reasoning lives in the conversation
that produced it; this file is the operational state.

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
- Runtime secrets: ONLY in /root/taqreer-app/.env on the server (chmod 600).
  Includes prod DATABASE_URL, COMING_SOON=1, COMING_SOON_KEY, NEXT_DIST_DIR.
- Prod DB: server-local Postgres 16, db `taqreer_prod`, role `taqreer_app`.
  psql access: `ssh taqreer` then use DATABASE_URL from the app .env.
- Deck HTML lives in TWO places (PresentationVersion.slideJson = what the
  viewer reads; SlideVersion.slideJson = per-slide history). Manual repairs
  must patch BOTH.

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
- Consider: clean ~24 stray empty tables out of the OLD `taqreer` db on the
  server (a mis-targeted migrate before prisma.config.ts loaded .env).
- Prune test users from prod DB before launch (credit-sim-ui@example.com etc).
- Decision deferred: move prod DB to Supabase Pro Postgres (managed
  backups/PITR) vs keep server-local + current backup script.

## Launch plan (agreed sequence)

Phase A — Foundation: infra, backups, monitoring. (≈done, leftovers above)

Phase B — Money + law (parallel tracks), all BLOCKERS:
- Billing live: Stripe live keys, mada + Apple Pay (dashboard config + domain
  verification, verify inside the embedded ui_mode:elements form), prod webhook,
  real-card smoke test. Toggle Stripe's own receipts + payment-failed emails ON
  (don't own these). Fable pricing decision (600+80 vs keep 500+28) before live.
- GCC VAT (tax-advisor question, NOT seller-location based): digital-services
  VAT is DESTINATION-based, so selling to KSA/UAE CONSUMERS can trigger a
  non-resident VAT registration (KSA 15% / UAE 5%) even for the US LLC. But it
  hinges on B2C-vs-B2B (B2B reverse-charges to the buyer), thresholds, and actual
  GCC sales - confirm whether/when registration is required with a tax pro before
  turning anything on. Stripe Tax only handles COLLECTION once registered; it
  does not decide the obligation. Not a code blocker.
- ✅ LIVE (2026-06-13, PR #59 merged + deployed): bilingual ToS/Privacy/Refund
  (lib/legal/content.ts) + cookie banner + contact form (Resend department
  routing) + shared SiteFooter + gate-exempt public routes (incl. trailing-slash
  normalize). LEGAL_META filled from the Articles: PIXEL WOLVES LLC, 5830 E 2nd
  St Ste 7000 Casper WY 82609, effectiveDate 2026-06-13. Wyoming/US governing
  law (English controlling), KSA PDPL-aware privacy, standard-SaaS refunds.
  CodeRabbit findings addressed (rate-limit memory bound, cookie hardening,
  danger-color token). STILL BLOCKED on counsel review before relying on these
  as final (content is a DRAFT); copy can be revised in place post-review.
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
- Admin panel v1 READ-ONLY (users, subscriptions, revenue, generations +
  failures, signups), role-gated server-side (User.role exists). Actions
  (credits/refunds/tier) stay psql + Stripe dashboard for the first weeks.
  Spec folded into context.md §Admin panel. No "online now" (no presence infra).
- Final /security-review over the whole diff before launch.

Phase D — Cheap pre-launch polish:
- SEO correctness: robots.ts + sitemap.ts are STALE (2 URLs, no ar/en split,
  no hreflang — deferred Phase 5 of the bilingual migration). hreflang +
  sitemap + OG cards + titles pre-launch; structured data/content post.
- Mobile audit of FIVE public surfaces only: landing, pricing, signup/login,
  checkout (Apple Pay on mobile Safari matters for GCC), deck VIEWING.
  Editor stays desktop-only with a graceful message — do not attempt.
- PostHog: planned, not wired. Pageviews + key events (signup, first
  generation, export, checkout opened, paid).
- support@ mailbox (the footer contact link + /contact form shipped 2026-06-13).

Launch. Then post-launch backlog (deliberately deferred): lifecycle emails +
unified template system, admin actions UI, content SEO + structured data,
mobile editor, onboarding tour, help docs, user data export, load testing,
contrast-guard phase 2 (detect-only logging is live and fine).

## Open user actions (blocked on Osama)

1. ✅ Supabase redirect URLs for taqreer.ai — DONE.
2. ✅ Sentry wired (taqreerai-66/taqreer) + source maps uploading — DONE.
3. Go-ahead for Stripe test webhook creation (then live one in Phase B).
4. Accounts under dev@taqreer.ai: BetterStack uptime, PostHog (when Phase D).
   (Inngest Cloud deferred 2026-06-14 - not needed until there's traffic.)
5. Fable pricing decision.
6. Stripe live keys when Phase B starts.
