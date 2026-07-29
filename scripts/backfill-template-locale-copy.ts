// One-off backfill: fill the MISSING locale's SEO copy (nameAr/nameEn +
// descriptionAr/descriptionEn) for the public curator templates.
//
// Why: the template detail page falls back to the other language's copy when a
// locale's fields are empty, so /en and /ar served identical titles and Google
// flagged the pairs as duplicates (38 URLs stuck at "Discovered - currently
// not indexed"). The copy below DESCRIBES each template in the missing locale;
// it does not touch the template content itself.
//
// Only NULL fields are written - existing copy is never overwritten, so the
// script is safe to re-run and safe against admin edits made in between.
//
//   npx tsx scripts/backfill-template-locale-copy.ts            # dry-run
//   npx tsx scripts/backfill-template-locale-copy.ts --apply    # write
//
// After applying: unstable_cache("template-detail") re-reads within 300s, the
// force-static detail pages pick the copy up on the next deploy (post-receive
// also purges the Cloudflare edge).

import { config } from "dotenv";
config();
config({ path: ".env.local" });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

type LocaleCopy = {
  nameAr?: string;
  nameEn?: string;
  descriptionAr?: string;
  descriptionEn?: string;
};

// Keyed by Template.slug. EN copy for the 10 Arabic-authored templates, AR
// copy for the 3 English-authored ones (dump of 2026-07-29).
const COPY: Record<string, LocaleCopy> = {
  "seo-2026-ai-discovery-guide": {
    nameEn: "SEO Strategy 2026: AI Discovery Guide",
    descriptionEn:
      "A comprehensive Arabic guide template on making your content visible in search results and AI answers by building topical authority and high discoverability.",
  },
  "ai-presentation-platform-arabic": {
    nameEn: "AI Presentation Platform in Arabic",
    descriptionEn:
      "A product deck template presenting an AI platform that turns ideas, files, and data into professional Arabic and English presentations quickly and easily.",
  },
  "ai-presentation-generation-platform": {
    nameEn: "AI in Presentation Generation",
    descriptionEn:
      "A walkthrough deck template on using AI to speed up presentation creation and raise design quality, with full Arabic and RTL support.",
  },
  "ai-presentation-platform-template": {
    nameEn: "From Ideas to Smart Presentations",
    descriptionEn:
      "A product deck template showing how an AI platform turns raw ideas and files into designed presentations in Arabic and English.",
  },
  "ai-presentation-creation-platform": {
    nameEn: "Smart Presentation Creation Platform",
    descriptionEn:
      "A professional product deck template introducing a smart platform that converts content into organized, clear presentations in Arabic and English.",
  },
  "content-to-presentation-platform": {
    nameEn: "Content to Presentation Platform",
    descriptionEn:
      "A deck template presenting how taqreer.ai turns text and files into organized, clear presentations with speed and high efficiency.",
  },
  "presentation-creation-platform-template": {
    nameEn: "Presentations from Raw Content",
    descriptionEn:
      "A template for turning raw ideas and text into structured presentations with a logical narrative and well-ordered slides.",
  },
  "gaming-esports-market-growth": {
    nameEn: "Gaming and Esports Market Growth",
    descriptionEn:
      "A professional Arabic deck template covering the growth of the gaming and esports industry, focused on economic, cultural, and production opportunities.",
  },
  "us-dollar-market-analysis-2026": {
    nameEn: "US Dollar Market Analysis 2026",
    descriptionEn:
      "A comprehensive Arabic report template covering dollar strength, Federal Reserve rates, inflation, and global reserves with detailed economic indicators.",
  },
  "video-games-industry-future-trends": {
    nameEn: "The Future of the Video Games Industry",
    descriptionEn:
      "An analytical Arabic deck template on global video game market trends covering growth, platforms, AI, cloud gaming, and revenue models.",
  },
  "local-business-growth-template": {
    nameAr: "حل نمو الأعمال المحلية",
    descriptionAr:
      "قالب نظام تسويق وحجوزات متكامل للأعمال المحلية يشمل الهوية والمحتوى والمواقع مع تكامل حجز ذكي على مدار الساعة.",
  },
  "local-business-growth-partner": {
    nameAr: "شريك نمو الأعمال المحلية",
    descriptionAr:
      "قالب حل تسويق وحجوزات احترافي للأعمال الخدمية المحلية يجمع الهوية والمحتوى وتصميم المواقع والإعلانات وأنظمة الحجز الآلي.",
  },
  "local-business-growth-solution": {
    nameAr: "نظام نمو الأعمال المحلية",
    descriptionAr:
      "نظام تسويق وحجوزات متكامل للأعمال الخدمية المحلية يجمع الهوية والمحتوى والمواقع وإدارة المواعيد الآلية.",
  },
};

async function main() {
  const apply = process.argv.includes("--apply");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter });

  let updated = 0;
  for (const [slug, copy] of Object.entries(COPY)) {
    const tpl = await prisma.template.findUnique({
      where: { slug },
      select: {
        id: true,
        isPublic: true,
        nameAr: true,
        nameEn: true,
        descriptionAr: true,
        descriptionEn: true,
      },
    });
    if (!tpl) {
      console.warn(`SKIP ${slug}: no template with this slug`);
      continue;
    }
    if (!tpl.isPublic) {
      console.warn(`SKIP ${slug}: not public`);
      continue;
    }

    // Fill only fields that are currently NULL.
    const data: LocaleCopy = {};
    for (const field of [
      "nameAr",
      "nameEn",
      "descriptionAr",
      "descriptionEn",
    ] as const) {
      if (copy[field] && tpl[field] == null) data[field] = copy[field];
    }
    const fields = Object.keys(data);
    if (fields.length === 0) {
      console.log(`OK   ${slug}: nothing missing`);
      continue;
    }

    console.log(`${apply ? "SET " : "PLAN"} ${slug}: ${fields.join(", ")}`);
    for (const [field, value] of Object.entries(data)) {
      console.log(`       ${field} = ${value}`);
    }
    if (apply) {
      await prisma.template.update({ where: { id: tpl.id }, data });
      updated++;
    }
  }

  console.log(
    apply
      ? `\nDone: ${updated} template(s) updated.`
      : "\nDry-run only. Re-run with --apply to write.",
  );
  await prisma.$disconnect();
}

main();
