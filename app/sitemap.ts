import { MetadataRoute } from "next";

// Sitemap = the list of indexable, public URLs we want crawled. Every entry is
// a real 200 URL (the locale-prefixed canonical), with hreflang alternates so
// Google pairs the ar/en versions instead of treating them as duplicates.
//
// Excluded on purpose: the bare root "/" (it 307-redirects to a locale), the
// /brand design-system route (noindex), and all app/auth/project routes
// (auth-gated + Disallow-ed in robots.ts). Expand ROUTES when phase-2 marketing
// pages (e.g. /templates, /pricing) ship.

const SITE_URL = "https://taqreer.ai";
const LOCALES = ["ar", "en"] as const;

const ROUTES: {
  path: string;
  changeFrequency: "weekly" | "monthly" | "yearly";
  priority: number;
}[] = [
  { path: "", changeFrequency: "weekly", priority: 1 },
  { path: "presentation-templates", changeFrequency: "weekly", priority: 0.8 },
  { path: "pricing", changeFrequency: "monthly", priority: 0.8 },
  { path: "ai-presentations", changeFrequency: "weekly", priority: 0.9 },
  { path: "report-design", changeFrequency: "weekly", priority: 0.9 },
  { path: "redesign", changeFrequency: "weekly", priority: 0.8 },
  { path: "arabic-presentations", changeFrequency: "weekly", priority: 0.9 },
  { path: "contact", changeFrequency: "monthly", priority: 0.5 },
  { path: "terms", changeFrequency: "yearly", priority: 0.3 },
  { path: "privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "refund", changeFrequency: "yearly", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const href = (locale: string, path: string) =>
    `${SITE_URL}/${locale}${path ? `/${path}` : ""}`;

  return ROUTES.flatMap((route) =>
    LOCALES.map((locale) => ({
      url: href(locale, route.path),
      lastModified: now,
      changeFrequency: route.changeFrequency,
      priority: route.priority,
      // Per-URL hreflang. x-default → Arabic (the product's default locale).
      alternates: {
        languages: {
          ar: href("ar", route.path),
          en: href("en", route.path),
          "x-default": href("ar", route.path),
        },
      },
    }))
  );
}
