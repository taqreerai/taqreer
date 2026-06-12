# Production deploy — Hetzner (taqreer.ai)

Set up 2026-06-13 (Phase A). Source of truth is the LOCAL folder, not git.

## Box

- Hetzner Cloud CPX22, Ubuntu 24.04, IP 178.105.88.35, alias `ssh taqreer`
  (key `~/.ssh/taqreer_hetzner`; password login disabled; ufw = SSH + nginx).
- macOS gotcha: ssh needs `IPQoS none` in `~/.ssh/config` (the network drops
  DSCP-marked packets; raw TCP works, ssh hangs without it).
- 6GB swapfile (/swapfile) so Next 16 builds fit next to the running app.

## App

- `/root/taqreer-app` — the deployed tree. `.env` (chmod 600) holds ALL
  runtime secrets + prod overrides; never in the repo, never rsynced over
  (deploy.sh protects it).
- pm2: `taqreer-prod` (`next start -p 3100`, serves `.next-deploy` via
  `NEXT_DIST_DIR` in the server .env) + `taqreer-inngest` (inngest-cli dev
  server, interim until Inngest Cloud). `pm2-root` systemd unit resurrects
  both on boot. The old landing pm2 app `taqreer` is stopped, kept as id 0.
- nginx `sites-enabled/taqreer`: 443 → localhost:3100, certbot-managed TLS
  (auto-renew timer), `client_max_body_size 50m`. Pre-cutover copy at
  `/root/nginx-taqreer.bak`.
- DB: server Postgres 16, db `taqreer_prod`, role `taqreer_app` (password
  only in the server .env). Supabase stays auth+storage+realtime.
  (Supabase Pro Postgres migration still on the table - revisit pre-launch.)
- Backups: `/root/backup.sh` nightly at 02:00 (cron) — app tree tar +
  `pg_dump -Fc` of DATABASE_URL, keeps last 10 of each in `/root/backups`.

## Deploying

`./deploy.sh` from the repo root: rsync source → npm ci → prisma generate +
migrate deploy → `next build` into `.next-build` (live app keeps serving the
old build) → atomic swap to `.next-deploy` → pm2 reload. Health-checks
`/ar` at the end (expect 200).

## Coming-soon gate

`COMING_SOON=1` + `COMING_SOON_KEY` in the server .env; logic in proxy.ts.
Every page rewrites to `/{lang}/coming-soon` unless the `tq_preview` cookie
is set; `/preview?key=<key>` sets it (30 days). API routes are never gated.
Launch = remove `COMING_SOON` from the server .env + `pm2 reload taqreer-prod`.

## Not done yet (Phase A leftovers)

- Supabase Auth: add `https://taqreer.ai/**` to redirect URLs (dashboard)
  or Google login / email links won't return to prod.
- Stripe webhook endpoint for `https://taqreer.ai/api/stripe/webhook`
  (test mode) + put its signing secret in the server .env.
- Inngest Cloud (event/signing keys) to replace the dev-server process.
- Sentry/uptime monitoring accounts (user creates with dev@taqreer.ai).
- Mail subdomain DNS (SPF/DKIM/DMARC) on GoDaddy for Resend.
