import { MetadataRoute } from "next";
import { getPublicTemplateSlugs } from "@/lib/auth/marquee-projects";

// Sitemap = the list of indexable, public URLs we want crawled. Every entry is
// a real 200 URL (the locale-prefixed canonical), with hreflang alternates so
// Google pairs the ar/en versions instead of treating them as duplicates.
//
// Two sources:
//   • Static marketing/legal routes (ROUTES below). Their `lastModified` is a
//     per-route constant — bump it when the page's COPY actually changes.
//     (Stamping build time on every deploy tells Google "everything changed"
//     constantly, which erodes trust in the field.)
//   • Public template detail pages (/presentation-templates/[slug]), read from
//     the DB (fail-soft to none) with the template's real updatedAt.
//
// Excluded on purpose: the bare root "/" (it 307-redirects to a locale), the
// /brand design-system route (noindex), and all app/auth/project routes
// (auth-gated + Disallow-ed in robots.ts).

const SITE_URL = "https://taqreer.ai";
const LOCALES = ["ar", "en"] as const;

// Re-generate periodically so newly slugged templates appear without a deploy
// (revalidateTemplateSurfaces also purges /sitemap.xml from the CDN on writes).
export const revalidate = 3600;

const ROUTES: {
  path: string;
  changeFrequency: "daily" | "weekly" | "monthly" | "yearly";
  priority: number;
  // Last real content change (bump on copy edits, not on deploys).
  lastModified: string;
}[] = [
  { path: "", changeFrequency: "weekly", priority: 1, lastModified: "2026-07-01" },
  { path: "presentation-templates", changeFrequency: "weekly", priority: 0.8, lastModified: "2026-07-06" },
  { path: "free-stock-images", changeFrequency: "daily", priority: 0.7, lastModified: "2026-07-16" },
  { path: "pricing", changeFrequency: "monthly", priority: 0.8, lastModified: "2026-07-01" },
  { path: "ai-presentations", changeFrequency: "weekly", priority: 0.9, lastModified: "2026-07-01" },
  { path: "report-design", changeFrequency: "weekly", priority: 0.9, lastModified: "2026-07-01" },
  { path: "redesign", changeFrequency: "weekly", priority: 0.8, lastModified: "2026-07-01" },
  { path: "presentation-style", changeFrequency: "weekly", priority: 0.8, lastModified: "2026-07-01" },
  { path: "arabic-presentations", changeFrequency: "weekly", priority: 0.9, lastModified: "2026-07-01" },
  { path: "contact", changeFrequency: "monthly", priority: 0.5, lastModified: "2026-06-14" },
  { path: "terms", changeFrequency: "yearly", priority: 0.3, lastModified: "2026-06-14" },
  { path: "privacy", changeFrequency: "yearly", priority: 0.3, lastModified: "2026-06-14" },
  { path: "refund", changeFrequency: "yearly", priority: 0.3, lastModified: "2026-06-14" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const href = (locale: string, path: string) =>
    `${SITE_URL}/${locale}${path ? `/${path}` : ""}`;
  const alternates = (path: string) => ({
    languages: {
      ar: href("ar", path),
      en: href("en", path),
      // x-default → Arabic (the product's default locale).
      "x-default": href("ar", path),
    },
  });

  const staticEntries = ROUTES.flatMap((route) =>
    LOCALES.map((locale) => ({
      url: href(locale, route.path),
      lastModified: new Date(route.lastModified),
      changeFrequency: route.changeFrequency,
      priority: route.priority,
      alternates: alternates(route.path),
    })),
  );

  // Template detail pages. getPublicTemplateSlugs is fail-soft ([]) so a DB
  // hiccup degrades the sitemap to the static routes instead of 500ing.
  const slugs = await getPublicTemplateSlugs();
  const templateEntries = slugs.flatMap(({ slug, updatedAt }) => {
    const path = `presentation-templates/${slug}`;
    return LOCALES.map((locale) => ({
      url: href(locale, path),
      lastModified: updatedAt,
      changeFrequency: "monthly" as const,
      priority: 0.7,
      alternates: alternates(path),
    }));
  });

  return [...staticEntries, ...templateEntries];
}
