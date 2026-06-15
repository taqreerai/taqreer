import { defineConfig } from 'prisma/config'
import 'dotenv/config'

// CLI datasource (migrate/studio). When prisma.config.ts exists the CLI
// skips its automatic .env loading, so dotenv/config above restores it
// (on the server, /root/taqreer/.env carries the prod DATABASE_URL -
// without this, migrate deploy silently hit the fallback's database).
// The literal is the local docker fallback (.env.local is dev-server-only).
export default defineConfig({
  datasource: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://taqreer_user:taqreer2025secure@localhost:5432/taqreer",
  },
})
