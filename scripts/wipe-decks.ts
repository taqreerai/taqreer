import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// Use the Storage REST API directly. The full @supabase/supabase-js client
// initializes Realtime, which needs a WebSocket implementation Node 20 doesn't
// ship natively. Storage REST only needs fetch + the service-role key.
async function emptyBucket(url: string, key: string, bucket: string): Promise<void> {
  let removed = 0;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
    apikey: key,
  };

  const listAndRemove = async (prefix: string) => {
    const listRes = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
    });
    if (!listRes.ok) {
      console.warn(`  [${bucket}] list "${prefix || "/"}" failed: ${listRes.status} ${await listRes.text()}`);
      return;
    }
    const items = (await listRes.json()) as Array<{ name: string; id: string | null }>;
    const files = items.filter((item) => item.id !== null);
    const folders = items.filter((item) => item.id === null);
    if (files.length > 0) {
      const paths = files.map((f) => (prefix ? `${prefix}/${f.name}` : f.name));
      const delRes = await fetch(`${url}/storage/v1/object/${bucket}`, {
        method: "DELETE",
        headers,
        body: JSON.stringify({ prefixes: paths }),
      });
      if (!delRes.ok) {
        console.warn(`  [${bucket}] delete failed: ${delRes.status} ${await delRes.text()}`);
      } else {
        removed += paths.length;
      }
    }
    for (const folder of folders) {
      await listAndRemove(prefix ? `${prefix}/${folder.name}` : folder.name);
    }
  };
  await listAndRemove("");
  console.log(`  [${bucket}] removed ${removed} object${removed === 1 ? "" : "s"}`);
}

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const counts = async () => ({
    Project: await prisma.project.count(),
    Presentation: await prisma.presentation.count(),
    PresentationVersion: await prisma.presentationVersion.count(),
    Comment: await prisma.comment.count(),
    File: await prisma.file.count(),
    Job: await prisma.job.count(),
    BrandKit: await prisma.brandKit.count(),
    Template: await prisma.template.count(),
    Folder: await prisma.folder.count(),
    UsageEvent: await prisma.usageEvent.count(),
    Subscription: await prisma.subscription.count(),
    User: await prisma.user.count(),
  });

  console.log("Before wipe:");
  console.table(await counts());

  // Children → parents. Many of these cascade via FK constraints, but we go
  // explicit so a missing cascade doesn't leave orphans.
  await prisma.comment.deleteMany();
  await prisma.presentationVersion.deleteMany();
  await prisma.presentation.deleteMany();
  await prisma.file.deleteMany();
  await prisma.job.deleteMany();
  await prisma.project.deleteMany();
  await prisma.brandKit.deleteMany();
  await prisma.template.deleteMany();
  await prisma.folder.deleteMany();
  await prisma.usageEvent.deleteMany();
  await prisma.subscription.deleteMany();

  console.log("\nAfter wipe:");
  console.table(await counts());

  console.log("\nClearing Supabase Storage buckets...");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.warn("  SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL missing — skipping storage cleanup");
  } else {
    await emptyBucket(url, serviceKey, "brand-assets");
    await emptyBucket(url, serviceKey, "generated-presentations");
  }

  await prisma.$disconnect();
  console.log("\nDone. Users + source code untouched.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
