# Launch progress + continuation guide

Updated 2026-06-13. Read this + context/deploy.md to resume launch work in a
fresh session. The launch plan's full reasoning lives in the conversation
that produced it; this file is the operational state.

## How work flows (IMPORTANT for any new session)

- ALL file edits happen LOCALLY in /Users/osama/taqreer. Never edit on the
  server. The local folder is the single source of truth (user direction:
  git had drifted; GitHub was force-reset to match local on 2026-06-13).
- `./deploy.sh` ships local → server: rsync, npm ci, prisma migrate deploy,
  next build into .next-build, atomic swap to .next-deploy, pm2 reload,
  health check (expect 200).
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
  connected. INTERIM — replace with Inngest Cloud keys before launch.
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
  TAQREER-1. Follow-ups: (a) SENTRY_AUTH_TOKEN for readable source maps
  (currently minified); (b) bot scanners hitting /xxx.php reach the [lang]
  layout → "Unsupported locale" 500s that now noise Sentry — should 404
  cleanly; (c) sendDefaultPii + Session Replay on — revisit in Phase B legal.

REMAINING in Phase A:
- Inngest Cloud account (dev@taqreer.ai) → event+signing keys into server
  .env, retire the pm2 dev-server process. Free tier suffices.
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
- Billing live: Stripe live keys, Stripe Tax (KSA 15% / UAE 5%), mada +
  Apple Pay (dashboard config + domain verification, verify inside the
  embedded ui_mode:elements form), prod webhook, real-card smoke test.
  Toggle Stripe's own receipts + payment-failed emails ON (don't own these).
  Fable pricing decision (600+80 vs keep 500+28) before live billing.
- Legal pages: ToS/Privacy/Refund, bilingual, + minimal cookie banner.
  None exist in the repo. LLM draft + user review.
- ✅ DONE (2026-06-13): Billing UI cadence — monthly/yearly pill + hint on
  /plans, /settings, /billing; PlanUsage is now the shared plan card.
- Email deliverability: SPF/DKIM/DMARC on the sending domain (GoDaddy DNS)
  — true blocker, auth emails land in spam without it. Branded bilingual
  Supabase auth templates (signup confirm / email change / password reset).
  Current inventory: Resend sends ONE email (share invite, Arabic-only);
  Supabase auth emails are default English templates.

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
- support@ mailbox + footer contact link.

Launch. Then post-launch backlog (deliberately deferred): lifecycle emails +
unified template system, admin actions UI, content SEO + structured data,
mobile editor, onboarding tour, help docs, user data export, load testing,
contrast-guard phase 2 (detect-only logging is live and fine).

## Open user actions (blocked on Osama)

1. ✅ Supabase redirect URLs for taqreer.ai — DONE.
2. ✅ Sentry wired (taqreerai-66/taqreer) — DONE. Optional: create a
   SENTRY_AUTH_TOKEN (Sentry → Settings → Auth Tokens) → server .env for
   readable source-mapped stack traces.
3. Go-ahead for Stripe test webhook creation (then live one in Phase B).
4. Accounts under dev@taqreer.ai: Inngest Cloud, BetterStack uptime,
   PostHog (when Phase D).
5. Fable pricing decision.
6. Stripe live keys when Phase B starts.
