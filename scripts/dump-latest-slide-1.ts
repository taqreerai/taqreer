import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });
  try {
    const version = await prisma.presentationVersion.findFirst({
      where: { status: "completed" },
      orderBy: { createdAt: "desc" },
      include: { presentation: { include: { project: true } } },
    });
    if (!version) {
      console.log("no completed versions");
      return;
    }
    console.log("project:", version.presentation.project.id, version.presentation.project.title);
    console.log("version:", version.id, "v" + version.versionNumber);
    const json = version.slideJson as { slides?: unknown[] };
    console.log("slide count:", json?.slides?.length ?? 0);
    if (Array.isArray(json?.slides) && json.slides[0]) {
      console.log("\n--- slide 1 ---");
      console.log(JSON.stringify(json.slides[0], null, 2));
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
