// One-off: grant or revoke the admin role by email. The admin console
// (app/[lang]/(app)/admin) gates on User.role === "admin".
//
//   tsx scripts/set-admin.ts dev@taqreer.ai            # grant
//   tsx scripts/set-admin.ts dev@taqreer.ai --revoke   # revoke (back to "user")
//
// Runs against the current DATABASE_URL (local docker in dev).

import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

async function main() {
  const email = process.argv[2];
  const revoke = process.argv.includes("--revoke");
  if (!email) {
    console.error("usage: tsx scripts/set-admin.ts <email> [--revoke]");
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter });

  const role = revoke ? "user" : "admin";
  // updateMany (not update) so this works whether or not email carries a unique
  // constraint, and returns a count instead of throwing on no-match.
  const res = await prisma.user.updateMany({ where: { email }, data: { role } });
  if (res.count === 0) {
    console.error(`No user found with email ${email}`);
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`Set ${res.count} user(s) (${email}) -> role="${role}"`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
