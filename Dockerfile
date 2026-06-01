# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# Taqreer production image (Fly.io / any Docker host).
#
# Native tools the app shells out to at runtime (must be in the FINAL image):
#   • libreoffice    — PPTX → PDF             (lib/extract/pptx-to-pdf.ts, /enhance)
#   • poppler-utils  — PDF → PNG via pdftoppm (lib/extract/pdf-to-png.ts)
#   • fontforge      — OTF/CFF → TrueType so uploaded .otf brand fonts EMBED in the
#                      exported PPTX (lib/export/otf-to-ttf.ts). PowerPoint only
#                      renders embedded TrueType (glyf) outlines — not CFF/.otf.
#   • chromium       — Puppeteer: thumbnails, PNG/PDF export, template render
#                      (inngest/functions/{thumbnail,template}-render.ts,
#                       lib/export/render-deck-pdf.ts)
#
# Build (NEXT_PUBLIC_* are inlined into the client bundle at BUILD time, so they
# must be passed as build args or auth/Supabase break in the browser):
#   docker build -t taqreer \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co \
#     --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ... \
#     .
# Runtime secrets (DATABASE_URL, SUPABASE service key, ANTHROPIC_API_KEY, …) are
# injected by the host (fly secrets / `docker run -e`), NOT baked into the image.
# ─────────────────────────────────────────────────────────────────────────────

FROM node:20-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
# Puppeteer: skip its bundled Chromium download and use the apt `chromium` below
# (smaller image; apt pulls every native lib it needs). The app calls
# puppeteer.launch() with no executablePath, so this env points it at that binary.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# ── deps — install node_modules (postinstall runs patch-package) ──────────────
FROM base AS deps
WORKDIR /app
# patch-package needs the patches/ dir present at install time (dom-to-pptx patch).
COPY package.json package-lock.json ./
COPY patches ./patches
RUN npm ci

# ── builder — prisma generate + next build ────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
# Optional: pass SENTRY_AUTH_TOKEN as a build arg to upload sourcemaps; without
# it withSentryConfig just skips the upload (silent unless CI).
ARG SENTRY_AUTH_TOKEN
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN
# Prisma client must be generated before Next compiles the server bundle.
RUN npx prisma generate
RUN npm run build

# ── runner — native tools + the built app ─────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# `--no-install-recommends` keeps the image lean. The fonts give LibreOffice +
# Chromium a sane fallback set (Noto core covers Arabic) when a brand webfont
# isn't reachable. Swap `libreoffice` → `libreoffice-impress` if you want to trim
# ~hundreds of MB and only need PPTX→PDF.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice \
      poppler-utils \
      fontforge \
      chromium \
      fonts-liberation \
      fonts-noto-core \
      fonts-noto-cjk \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Run as the unprivileged `node` user the base image already ships. soffice +
# fontforge write scratch files under $HOME/tmp — both are writable for `node`.
ENV HOME=/home/node
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/next.config.ts ./next.config.ts
USER node

EXPOSE 3000
# `next start` (package.json "start") — serves the build from .next.
CMD ["npm", "run", "start"]
