import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required before initializing Prisma.");
}

// Supabase (and any non-local host) requires TLS. node-postgres takes SSL on
// the Pool config object, NOT via a `sslmode` URL param (a URL sslmode would
// silently discard this object), so it is set here. Gated on a non-local host
// so local dev and a rollback to the server-local Postgres still connect
// without SSL. rejectUnauthorized:false encrypts without verifying Supabase's
// CA chain (server-to-server inside eu-central-1); swap to a CA file for strict
// verification later if wanted.
const isLocalDb = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
const adapter = new PrismaPg({
  connectionString,
  ...(isLocalDb ? {} : { ssl: { rejectUnauthorized: false } }),
});

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
