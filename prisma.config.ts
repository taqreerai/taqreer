import { defineConfig } from 'prisma/config'

// CLI datasource (migrate/studio). DATABASE_URL wins so the same config
// works on the production server; the literal is the local docker fallback.
export default defineConfig({
  datasource: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://taqreer_user:taqreer2025secure@localhost:5432/taqreer",
  },
})
