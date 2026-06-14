# Production deploy — Hetzner (taqreer.ai)

Set up 2026-06-13 (Phase A). Deploy = git push-to-deploy (since 2026-06-14);
the `main` SHA checked out on the box is exactly what production runs.

## Box

- Hetzner Cloud CPX22, Ubuntu 24.04, IP 178.105.88.35, alias `ssh taqreer`
  (key `~/.ssh/taqreer_hetzner`; password login disabled; ufw = SSH + nginx).
- macOS gotcha: ssh needs `IPQoS none` in `~/.ssh/config` (the network drops
  DSCP-marked packets; raw TCP works, ssh hangs without it).
- 6GB swapfile (/swapfile) so Next 16 builds fit next to the running app.
- Host binaries the flows shell out to (apt — NOT installed by the git deploy,
  re-install on any box rebuild). Installed 2026-06-14:
  `apt-get install -y libreoffice-impress poppler-utils fontforge`
  - `libreoffice-impress` (+ pulls `libreoffice-core`) → PPTX upload → PDF,
    headless `soffice`/`libreoffice` (`lib/extract/pptx-to-pdf.ts`).
  - `poppler-utils` → `pdftoppm`/`pdftocairo`, PDF → per-page PNG
    (`lib/extract/pdf-to-png.ts`).
  - `fontforge` → OTF → TTF for Arabic font embedding in PPTX export
    (`lib/export/otf-to-ttf.ts`).
  - Puppeteer's Chrome is bundled under `/root/.cache/puppeteer` (thumbnails +
    PDF/PNG export) — `npm ci` restores it.
  Java is NOT required for PPTX→PDF; add `default-jre-headless` only if a complex
  deck ever fails to convert. (`/usr/bin` is in the pm2 process PATH, so the app
  finds all of these without a restart.)

## App

- `/root/taqreer` — the deployed work-tree (a `git checkout -f main` from
  the bare repo `/root/taqreer-app.git`). **RENAMED 2026-06-14 from
  `/root/taqreer-app`**; the bare repo KEPT its `-app.git` name, so deploy.sh's
  `prod` remote is unchanged (only the hook's `APP_DIR` + pm2 cwd + `backup.sh`
  were re-pointed). `.env` (chmod 600) holds ALL runtime secrets + prod overrides
  (incl. LIVE Stripe keys + `COMING_SOON=0`); gitignored + untracked, so
  `git checkout` never touches it. On-box pre-change backups:
  `/root/taqreer-app.git/hooks/post-receive.bak`, `/root/backup.sh.bak`,
  `/root/taqreer/.env.bak.prelive`.
- pm2: `taqreer-prod` (`next start -p 3100` from cwd /root/taqreer, serves
  `.next-deploy` via `NEXT_DIST_DIR` in the server .env) + `taqreer-inngest`
  (inngest-cli dev server, interim until Inngest Cloud). `pm2-root` systemd unit
  resurrects both on boot. (2026-06-14: the dead pm2 `taqreer` id 0 + the stale
  1.4G old `/root/taqreer` rsync dir were deleted just before the rename.)
- nginx `sites-enabled/taqreer`: 443 → localhost:3100, certbot-managed TLS
  (auto-renew timer), `client_max_body_size 50m`. (The `/root/nginx-taqreer.bak*`
  copies were removed 2026-06-14; the live config lives in /etc/nginx.)
- DB: server Postgres 16, db `taqreer_prod`, role `taqreer_app` (password
  only in the server .env). Supabase stays auth+storage+realtime. 2026-06-14: the
  stray empty `taqreer` db was DROPPED; `taqreer_prod` was WIPED to a single user
  (`dev@taqreer.ai`, free) - pre-wipe dump at `/root/backups/pre-userwipe.dump`.
  (Supabase Pro Postgres migration still on the table - revisit pre-launch.)
- Backups: `/root/backup.sh` nightly at 02:00 (cron) — app tree tar +
  `pg_dump -Fc` of DATABASE_URL, keeps last 10 of each in `/root/backups`.

## Deploying

GIT PUSH-TO-DEPLOY (replaced rsync 2026-06-14). `./deploy.sh` from the repo
root: pushes dev+main to GitHub, then `git push prod dev:main` to the box's bare
repo (`taqreer:/root/taqreer-app.git`). The tracked post-receive hook
(`scripts/post-receive.sh`, installed at `.../hooks/post-receive`) checks main
out into `/root/taqreer` → npm ci → prisma generate + migrate deploy →
`next build` into `.next-build` (live app keeps serving the old build) → atomic
swap to `.next-deploy` → pm2 reload → health-check `/ar` (expect 200). The push
streams the build output. `--rebuild` re-runs the hook on current main with no
new commit (after an .env change); `--force` skips the clean-tree guard.

Re-provision the bare repo + hook: `ssh taqreer 'git init --bare
/root/taqreer-app.git'`, pipe `scripts/post-receive.sh` to
`.../hooks/post-receive` (chmod +x), then `git remote add prod
taqreer:/root/taqreer-app.git` locally.

## Coming-soon gate

`COMING_SOON` + `COMING_SOON_KEY` in the server .env; logic in proxy.ts. With
`COMING_SOON=1` every page rewrites to `/{lang}/coming-soon` unless the
`tq_preview` cookie is set; `/preview?key=<key>` sets it (30 days). API routes
are never gated. **CURRENTLY OFF (`COMING_SOON=0`, 2026-06-14)** - the site is
public, new registrations disabled as the interim guard (verify the Supabase
signups toggle). Re-enable: set `COMING_SOON=1` in the server .env +
`./deploy.sh --rebuild`.

## Remaining (was "Phase A leftovers")

- ✅ Supabase Auth redirect URLs (`https://taqreer.ai/**`) - DONE.
- ✅ Stripe LIVE webhook "Taqreer prod" → `/api/stripe/webhook` + signing secret
  in the server .env - DONE (2026-06-14). Remaining billing go-live: mada +
  Apple Pay, a real-card smoke test, premium-template gating.
- ✅ Sentry wired + source maps. ✅ Mail DNS (SPF/DKIM/DMARC) in place for Resend.
- Inngest Cloud (event/signing keys) - DEFERRED (no traffic; self-hosted fine).
- Uptime monitoring (BetterStack) - pending, user creates with dev@taqreer.ai.

## Gotcha log

- 2026-06-13: thumbnails/exports silently stuck - Puppeteer's Chrome needs
  system libs Ubuntu doesn't ship (libnspr4, libnss3, libatk, libgbm,
  libasound2t64, ...). Installed via apt; if the server is ever rebuilt run:
  `apt-get install -y libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3
  libxrandr2 libgbm1 libasound2t64 libpango-1.0-0 libcairo2 fonts-liberation`

- 2026-06-13: intermittent 502 Bad Gateway for LOGGED-IN users only. nginx
  log = "upstream sent too big header" → "no live upstreams". Cause: large
  Supabase auth cookies make the app emit Set-Cookie response headers bigger
  than nginx's default 8k proxy buffer; nginx then marks the upstream dead and
  502s everyone for a few seconds. Fix (in sites-enabled/taqreer `location /`):
  `proxy_buffer_size 32k; proxy_buffers 8 32k; proxy_busy_buffers_size 64k;`
  (+ `proxy_read_timeout 300s` for long generation streams). Reload nginx.

- 2026-06-14 (Stripe products are mode-scoped): live + test mode have SEPARATE
  Products/Prices. Code resolves a Price by stable `lookup_key`, so going live
  required running `scripts/stripe-setup-products.ts --live` (the `--live` flag
  is the explicit opt-in past the live-key guard) to create the live catalog,
  else every checkout 404s on the lookup_key.

- 2026-06-14 (Stripe test→live customer ids): `getOrCreateStripeCustomer`
  (lib/billing/customer.ts) returns a user's stored `stripeCustomerId` WITHOUT
  checking it's a live-mode id. A user carrying a TEST-mode `cus_...` (e.g.
  migrated from dev) breaks LIVE checkout ("no such customer"). Taking an existing
  user test→live: null out their Subscription `stripeCustomerId` /
  `stripeSubscriptionId` / `stripePriceId` so checkout mints a fresh live
  customer. (Moot now - prod was wiped to dev@taqreer.ai, reset clean.)
