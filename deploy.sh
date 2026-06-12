#!/bin/bash
# Deploy the LOCAL working tree to the Hetzner box (178.105.88.35, ssh alias
# "taqreer"). Deliberately git-free: rsyncs the files on disk (user direction
# 2026-06-12 - git may have drifted; the local folder is the source of truth).
#
# Shape: rsync source, then build ON the server (a 6GB swapfile covers the
# 4GB RAM; cross-shipping a Mac build broke on Turbopack's content-hashed
# Prisma externals). The build lands in .next-build and is swapped into
# .next-deploy atomically, so the running app serves the old build until the
# new one is complete. Runtime secrets live ONLY in /root/taqreer-app/.env on
# the server - this script never writes or prints them.
#
# First-time cutover (nginx proxy_pass 3000 -> 3100, retiring the old landing
# pm2 app) is manual - see context/deploy.md.

set -euo pipefail
cd "$(dirname "$0")"

REMOTE=taqreer
APP_DIR=/root/taqreer-app
PORT=3100

# ── Guard ── never ship half-finished work: the tree must be committed.
# (Review policy is by SIZE - small fixes deploy straight from dev; big
# changes go through a dev->main PR for CodeRabbit first. User direction
# 2026-06-13.) `--force` skips for emergencies.
if [[ "${1:-}" != "--force" && -n "$(git status --porcelain)" ]]; then
  echo "✗ Working tree has uncommitted changes - commit (or stash) first."
  echo "  Urgent? ./deploy.sh --force"
  exit 1
fi
# Keep GitHub's dev mirroring what production runs.
git push -q origin dev || echo "(push to origin/dev failed - deploying anyway)"

echo "==> Syncing source to $REMOTE:$APP_DIR"
rsync -az --delete \
  --exclude .git \
  --exclude node_modules \
  --exclude '.next*' \
  --exclude .env.local \
  --exclude .claude \
  --exclude scratch \
  --exclude context \
  --filter 'protect .env' \
  --filter 'protect node_modules' \
  --filter 'protect .next-deploy' \
  --filter 'protect .next-build' \
  ./ "$REMOTE:$APP_DIR/"

echo "==> Server: install, migrate, build, swap, reload"
ssh "$REMOTE" bash -s <<REMOTE_SCRIPT
set -euo pipefail
cd $APP_DIR
npm ci --no-audit --no-fund
npx prisma generate
npx prisma migrate deploy
# Build into .next-build while the live app keeps serving .next-deploy
# (NEXT_PUBLIC_* values bake from the server .env), then swap atomically.
rm -rf .next-build
NEXT_DIST_DIR=.next-build npx next build
rm -rf .next-deploy
mv .next-build .next-deploy
if pm2 describe taqreer-prod >/dev/null 2>&1; then
  pm2 reload taqreer-prod --update-env
else
  # NEXT_DIST_DIR=.next-deploy comes from the server .env (Next loads it
  # before evaluating next.config.ts), so plain \`next start\` finds the build.
  pm2 start npm --name taqreer-prod -- start -- -p $PORT
fi
if ! pm2 describe taqreer-inngest >/dev/null 2>&1; then
  pm2 start npx --name taqreer-inngest -- inngest-cli dev -u http://localhost:$PORT/api/inngest --no-discovery
fi
pm2 save
REMOTE_SCRIPT

echo "==> Deployed. Health check:"
sleep 5
ssh "$REMOTE" "curl -s -o /dev/null -w '%{http_code}\n' http://localhost:$PORT/ar"
