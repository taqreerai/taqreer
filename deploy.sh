#!/bin/bash
# Deploy to the Hetzner box via GIT PUSH-TO-DEPLOY (replaced the old rsync flow
# 2026-06-14 — recoverable in git history if ever needed).
#
# How it works:
#   - `prod` remote = the box's bare repo (taqreer:/root/taqreer-app.git), pushed
#     over the existing ssh alias (no GitHub deploy key needed).
#   - Pushing main fires /root/taqreer-app.git/hooks/post-receive (tracked at
#     scripts/post-receive.sh): it checks main out into the live work-tree
#     /root/taqreer, runs npm ci + prisma migrate deploy, builds into
#     .next-build, swaps it into .next-deploy ATOMICALLY (the running app serves
#     the old build until the swap), pm2-reloads, and health-checks /ar.
#   - Build runs ON the server (6GB swap). Secrets live ONLY in the server .env
#     (gitignored + untracked, so checkout never touches them). `main` (the SHA
#     pushed here) is exactly what production runs.
#
# Re-provision the box from scratch:
#   ssh taqreer 'git init --bare /root/taqreer-app.git'
#   ssh taqreer 'cat > /root/taqreer-app.git/hooks/post-receive && chmod +x $_' < scripts/post-receive.sh
#   git remote add prod taqreer:/root/taqreer-app.git
#
# Usage:
#   ./deploy.sh            commit-gated deploy (push main -> build + swap)
#   ./deploy.sh --force    skip the clean-tree guard (emergencies)
#   ./deploy.sh --rebuild  rebuild current main on the box WITHOUT a new commit
#                          (e.g. after changing the server .env)

set -euo pipefail
cd "$(dirname "$0")"

# A failed post-receive hook does not fail the push, so check what the box says
# it finished deploying.
verify_deployed() {
  local deployed
  deployed=$(ssh taqreer 'cat /root/taqreer/.deployed-commit 2>/dev/null' || true)
  if [[ "$deployed" != "$1" ]]; then
    echo "✗ Deploy did not finish: the box reports '${deployed:-nothing}', expected $1."
    echo "  Read the hook output above before deploying again."
    exit 1
  fi
  echo "✓ Live on $1"
}

# ── Env-only rebuild: trigger the hook on the current main, no new commit. ──
if [[ "${1:-}" == "--rebuild" ]]; then
  echo "==> Forcing a rebuild of the current main on the box"
  ssh taqreer 'echo "0 0 refs/heads/main" | /root/taqreer-app.git/hooks/post-receive'
  verify_deployed "$(git ls-remote prod refs/heads/main | cut -f1)"
  exit 0
fi

# ── Guard ── never ship half-finished work: the tree must be committed.
# (Review by SIZE — small fixes deploy straight from dev; big changes go through
# a dev->main PR for CodeRabbit first.) `--force` skips for emergencies.
if [[ "${1:-}" != "--force" && -n "$(git status --porcelain)" ]]; then
  echo "✗ Working tree has uncommitted changes — commit (or stash) first."
  echo "  Urgent? ./deploy.sh --force    Env-only rebuild? ./deploy.sh --rebuild"
  exit 1
fi

# Mirror to GitHub (dev AND main follow every deploy), then deploy to the box.
# The prod push streams the post-receive build output (look for 'HTTP 200').
git push -q origin dev dev:main || echo "(github push failed — deploying anyway)"

echo "==> Deploying: git push -> box bare repo (post-receive builds, swaps, health-checks)"
git push prod dev:main
verify_deployed "$(git rev-parse dev)"
