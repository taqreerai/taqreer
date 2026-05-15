# Mac Migration Checklist

Switching the dev environment from Windows to Mac. Walk top-to-bottom on a
fresh macOS install; you should be running `npm run dev` against the same
backend in ~30 min.

The repo on `dev` is current as of `<commit-sha-when-this-was-written>` (see
`git log -1` after cloning) — pull, install, populate `.env.local`, and go.

---

## 1. System prerequisites

### Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the post-install instructions to add `brew` to your `PATH`
(usually a line into `~/.zprofile`).

### Git

Ships with the Xcode Command Line Tools; install if missing:

```bash
xcode-select --install
```

### Node 20 via `fnm` (recommended) or `nvm`

`nvm-windows` does not exist on Mac. Use `fnm` (faster, single binary) or
`nvm`. The project uses Node 20 — `fnm` reads `.nvmrc`/`engines` from the
project if you set it, otherwise pin explicitly.

```bash
brew install fnm
# in ~/.zshrc, append:
eval "$(fnm env --use-on-cd --shell zsh)"

# Then, from the repo root:
fnm install 20
fnm use 20
node --version  # → v20.x
```

### GitHub CLI

```bash
brew install gh
gh auth login    # GitHub.com → HTTPS → browser → done
gh auth status   # confirm Logged in to github.com account taqreerai
```

`gh` is required for the CodeRabbit autofix workflow (see §4) and for
opening PRs from the terminal.

### `jq` (used by the CodeRabbit autofix skill)

```bash
brew install jq
```

---

## 2. Clone + install

```bash
cd ~/code   # or wherever you keep projects
git clone https://github.com/taqreerai/taqreer.git
cd taqreer
git checkout dev
npm install
```

A few of our dependencies are native and will build on first install:

- **`sharp`** — image processing; ships prebuilt binaries for arm64 + x64
  Macs, usually no action needed.
- **`puppeteer`** — downloads a Chromium build (~150 MB). On Apple Silicon
  this is the arm64 build automatically.
- **`@prisma/client`** — generates client into `node_modules/.prisma`; run
  `npx prisma generate` once after install.

```bash
npx prisma generate
```

---

## 3. `.env.local`

Copy the values from the Windows machine's `.env.local` (`D:\taqreer\.env.local`)
into the new Mac repo at `./.env.local`. The file is `.gitignore`d — it
will never be in the repo. Required keys:

```bash
# Anthropic (Claude API)
ANTHROPIC_API_KEY=sk-ant-...

# Supabase project
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...    # server-only; never expose

# Postgres connection string (Supabase pooler or direct)
DATABASE_URL=postgres://postgres:<password>@<host>:5432/postgres?sslmode=require

# Optional — Sentry (production only; can be left blank in dev)
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_DSN=
SENTRY_AUTH_TOKEN=
```

**Don't email or paste the file's contents anywhere.** Easiest transfer:
AirDrop the file directly, or copy via a password manager's secure note.

> **Windows-only quirk that's gone on Mac:** the PowerShell harness exported
> `ANTHROPIC_API_KEY=""` at process boot, shadowing `.env.local`. That's why
> `npm run dev` routes through `scripts/dev.mjs` (which `delete`s the var if
> it's empty). The wrapper is a no-op on Mac but safe to keep — it only
> deletes when the var is *blank or whitespace*.

---

## 4. Claude Code + CodeRabbit plugin

Claude Code itself: install via the official installer (look up the current
Mac instructions). Once installed, register the plugin marketplace + the
CodeRabbit plugin:

```bash
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin install coderabbit@claude-plugins-official
```

This gives you the `coderabbit:autofix`, `coderabbit:code-review`, and
`coderabbit:coderabbit-review` skills. The autofix flow needs `gh` (above)
and access to the repo's PRs.

CodeRabbit itself runs on the GitHub side — it's already configured against
this repo via `.coderabbit.yaml`:

- Auto-reviews PRs into `main` only.
- Workflow: `git push origin dev` → open PR `dev → main` → CodeRabbit
  reviews in ~5 min → run the autofix skill to walk findings.

---

## 5. Optional Mac niceties

- **Editor**: VS Code or Cursor. `brew install --cask visual-studio-code` /
  `--cask cursor`. Recommended extensions:
  - ESLint
  - Tailwind CSS IntelliSense
  - Prisma
  - One TypeScript-aware Arabic-readable font (e.g. `Cascadia Code`,
    `Geist Mono`, or `Berkeley Mono`).
- **iTerm2** if you prefer a real terminal over macOS Terminal.app.
- **Dash** or **Zeal** for offline docs.
- **Raycast** or **Alfred** for quick app/file launching.

---

## 6. Run the stack

### Local services first (Postgres + Redis via Docker)

The repo ships a `docker-compose.yml` with Postgres 16 (the Prisma target)
and Redis 7. `.env.local`'s `DATABASE_URL` points at `localhost:5432` —
nothing in the app works until that container is up.

Install **Docker Desktop** (`brew install --cask docker`, then launch it
once so the daemon is running), then:

```bash
# from the repo root, after .env.local is in place
docker compose up -d                # starts postgres + redis detached
docker ps                           # confirm both containers are Up

# first run only — apply the Prisma migrations to the empty DB
# preflight: refuse to migrate against anything other than localhost,
# in case .env.local was copied from another machine and DATABASE_URL
# still points at a remote / shared DB. Accepts: localhost, 127.0.0.1,
# IPv6 loopback [::1], and Docker Desktop's host.docker.internal alias.
# Trailing slash before the DB name is optional.
grep -E '^DATABASE_URL=' .env.local \
  | grep -qE '@(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal):5432(/|$)' \
  || { echo "Refusing migration: DATABASE_URL host must be localhost, 127.0.0.1, [::1], or host.docker.internal on port 5432"; exit 1; }
npx prisma migrate deploy
```

This creates 15 PascalCase tables (`User`, `Project`, `Presentation`, …)
in `public`. The volume `taqreer_postgres` persists data across restarts;
`docker compose down -v` wipes it.

### Two long-running dev processes

```bash
# Tab 1 — Next.js dev server
npm run dev

# Tab 2 — Inngest dev server (queues, function triggers, retries)
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

Then open:

- App: <http://localhost:3000>
- Inngest dashboard: <http://localhost:8288> (queue status, function logs,
  manual triggers)

> On Mac the standard `npm run dev` script works fine. No need for the
> `Remove-Item env:ANTHROPIC_API_KEY` PowerShell incantation from the
> Windows setup. The dev wrapper still does its safety-strip, just silently.

---

## 7. Cloud services already provisioned (no install needed)

| Service     | What it does                                    | Where to find keys                                                |
| ----------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| Anthropic   | Claude Opus 4.7 — deck generation               | <https://console.anthropic.com> → Settings → API Keys             |
| Supabase    | Postgres + Auth + Storage (brand-assets bucket) | <https://app.supabase.com> → Project → Settings → API             |
| Inngest     | Background job runner (deck generate, export)   | Cloud dashboard for prod; local CLI for dev (no key needed)       |
| Sentry      | Error tracking (production only)                | <https://sentry.io>                                               |
| GitHub      | Source of truth + CodeRabbit reviews            | `gh auth login` covers this                                       |
| CodeRabbit  | AI code review on PRs into `main`               | Configured in `.coderabbit.yaml`; no local install                |

Not yet wired:

- **Stripe** — Phase 4 (billing); env vars and webhook handler not yet
  implemented in the code.
- **Resend** — present in `dependencies` but not yet used; planned for
  transactional email.

---

## 8. Repo state at handoff (verify after clone)

```bash
git log --oneline -10            # confirm you see the recent commits
git status                       # should be clean
npx tsc --noEmit                 # passes
npm run lint                     # 9 pre-existing warnings, 0 errors
```

**Known pre-existing build issue, unrelated to the pivot:**

```bash
npm run build
# fails on /auth/login: useSearchParams() needs a Suspense wrap.
# Logged as a separate task; doesn't block dev or PRs.
```

---

## 9. What to do first on Mac

Per `context/context.html` §18 (the dom-to-pptx pivot), the next concrete
piece of work is the **BiDi spike** — a ~30-min experiment with one static
HTML file containing the exact problem strings, exported via `dom-to-pptx`,
opened in Keynote/PowerPoint. The spike decides whether the pivot is viable.

Do that before any further code on the current pipeline.

---

## 10. Things you can safely delete from the Windows machine after migrating

Once `gh auth status` + a fresh `npm run dev` + a successful deck-generate
both work on Mac:

- The Windows `nvm4w` installation
- The Windows `GitHub CLI` install
- The Windows project directory at `D:\taqreer`
- The PowerShell aliases / dotfiles specific to the Windows harness

The memory file at `~/.claude/projects/D--taqreer/memory/env_shadowing.md`
becomes irrelevant on Mac (the wrapper handles it) — keep it for reference
or prune it when you do a `consolidate-memory` pass.
