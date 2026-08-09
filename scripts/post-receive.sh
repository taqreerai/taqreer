#!/bin/bash
# Git push-to-deploy hook for the Hetzner box. Installed at
# /root/taqreer-app.git/hooks/post-receive. Deploy = `git push prod main` from
# the dev machine (over the existing ssh alias); this checks out main into the
# live work-tree and runs the same install/migrate/build/atomic-swap/reload as
# the old rsync deploy.sh. Build lands in .next-build and only swaps into
# .next-deploy on success, so a failed build leaves the running app untouched.
#
# Secrets stay in /root/taqreer/.env (gitignored + untracked, so checkout
# never touches them). Git hooks don't inherit the login PATH — set it here.
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

APP_DIR=/root/taqreer
GIT_DIR=/root/taqreer-app.git
PORT=3100

# Drain the ref list first (so build commands never eat the hook's stdin), and
# only act when main moved.
DEPLOY=0
while read -r _old _new ref; do
  [ "$ref" = "refs/heads/main" ] && DEPLOY=1
done
if [ "$DEPLOY" != "1" ]; then
  echo "post-receive: no main update, skipping deploy"
  exit 0
fi

echo "==> Checking out main into $APP_DIR"
git --git-dir="$GIT_DIR" --work-tree="$APP_DIR" checkout -f main
cd "$APP_DIR"

echo "==> install / generate / migrate"
npm ci --no-audit --no-fund
npx prisma generate
npx prisma migrate deploy

echo "==> build (.next-build) then atomic swap"
rm -rf .next-build
NEXT_DIST_DIR=.next-build npx next build
rm -rf .next-deploy
mv .next-build .next-deploy

echo "==> pm2 reload"
if pm2 describe taqreer-prod >/dev/null 2>&1; then
  pm2 reload taqreer-prod --update-env
else
  # -H 127.0.0.1: nginx is the only legitimate caller; never expose the
  # Node port on all interfaces (UFW blocks it, but belt + suspenders).
  pm2 start npm --name taqreer-prod -- start -- -p "$PORT" -H 127.0.0.1
fi
# Inngest runs on Inngest Cloud (INNGEST_DEV=0 + signing/event keys in .env), so
# there is NO local inngest-cli dev worker to start here. After a deploy that
# adds or changes functions, re-sync the app from the Inngest Cloud dashboard.
pm2 save

echo "==> Deployed. Health check:"
sleep 5
curl -s -o /dev/null -w 'HTTP %{http_code}\n' "http://localhost:$PORT/ar"

# Purge the Cloudflare edge cache: this build changed every hashed JS/CSS chunk,
# so any HTML still cached at the edge points at chunks that now 404 -> the page
# loads without hydration. dotenv/config loads .env (CLOUDFLARE_ZONE_ID +
# CLOUDFLARE_PURGE_TOKEN); no-ops + logs if unset. Non-fatal: a CDN hiccup must
# not fail an otherwise-healthy deploy.
echo "==> Purge Cloudflare edge cache"
npx tsx -r dotenv/config scripts/purge-cf.ts || echo "(cf purge failed - non-fatal)"

# Notify IndexNow (Bing / Yandex + the AI crawlers that consume that feed) of
# the live URL set, read from the just-deployed sitemap. Google does NOT use
# IndexNow (it has the sitemap + GSC). No secrets — the key is public
# (public/<key>.txt, now live behind the atomic swap above). Non-fatal.
echo "==> Notify IndexNow"
npx tsx scripts/indexnow.ts || echo "(indexnow submit failed - non-fatal)"
