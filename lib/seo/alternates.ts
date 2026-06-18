import type { Metadata } from "next";

// Per-page canonical + hreflang (ar / en / x-default), as relative hrefs that
// resolve against `metadataBase` (set in the root layout).
//
// This lives PER PAGE rather than in the root layout because the layout can only
// see `params.lang`, not the sub-path — it previously read the path from
// `headers()` (x-pathname), which forced every route into dynamic rendering. By
// moving canonical/hreflang into each page's generateMetadata (where the path is
// statically known), the layout no longer needs `headers()`, so the marketing
// pages can prerender statically.
//
// `subpath` is the locale-stripped path WITHOUT a leading slash:
//   ""            → the landing (/ar, /en)
//   "pricing"     → /ar/pricing, /en/pricing
//   "arabic-presentations" → etc.
export function localeAlternates(
  locale: "ar" | "en",
  subpath: string,
): Metadata["alternates"] {
  const seg = subpath ? `/${subpath}` : "";
  const href = (l: string) => `/${l}${seg}`;
  return {
    canonical: href(locale),
    languages: {
      ar: href("ar"),
      en: href("en"),
      // x-default → Arabic (the product's default locale).
      "x-default": href("ar"),
    },
  };
}
