import { defineConfig } from 'prisma/config'
import 'dotenv/config'

// CLI datasource (migrate/studio). When prisma.config.ts exists the CLI
// skips its automatic .env loading, so dotenv/config above restores it
// (on the server, /root/taqreer/.env carries the prod DATABASE_URL -
// without this, migrate deploy silently hit the fallback's database).
// The literal is the local docker fallback (.env.local is dev-server-only).
//
// DIRECT_URL first: prod runtime (DATABASE_URL) rides the Supabase
// TRANSACTION-mode pooler (:6543) since the 2026-07-08 EMAXCONNSESSION
// incident (session mode caps clients at pool_size 15; a deploy's
// build+migrate plus the live app's default 10-conn pg pool breached it).
// Migrations need session-mode features (advisory locks), so the CLI
// targets DIRECT_URL = the session pooler (:5432). Locally there is no
// DIRECT_URL and both fall back to the docker DATABASE_URL.
export default defineConfig({
  datasource: {
    url:
      process.env.DIRECT_URL ??
      process.env.DATABASE_URL ??
      "postgresql://taqreer_user:taqreer2025secure@localhost:5432/taqreer",
  },
})
