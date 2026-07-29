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
//
// `available` (default: both) restricts which locales actually have real
// content — template detail pages pass templateLocales(tpl). A locale outside
// `available` renders fallback copy in the other language, so its page
// canonicalizes to the real version and is dropped from hreflang: advertising
// it as a translation makes Google see an ar/en duplicate pair.
export function localeAlternates(
  locale: "ar" | "en",
  subpath: string,
  available: ("ar" | "en")[] = ["ar", "en"],
): Metadata["alternates"] {
  const seg = subpath ? `/${subpath}` : "";
  const href = (l: string) => `/${l}${seg}`;
  const canonical = available.includes(locale) ? locale : available[0];
  return {
    canonical: href(canonical),
    languages: Object.fromEntries([
      ...available.map((l) => [l, href(l)]),
      // x-default → Arabic (the product's default locale) when it exists,
      // else the only real locale.
      ["x-default", href(available.includes("ar") ? "ar" : available[0])],
    ]),
  };
}
