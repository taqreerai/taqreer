// JSON-LD schema builders (schema.org). Pure functions returning plain objects;
// the <JsonLd> component serializes them. Localized per UI locale so /ar carries
// Arabic entity copy and /en carries English. Keep this the single source of the
// structured-data shape so the layout (site-wide entities) and the landing page
// (FAQPage) stay consistent.
//
// SEO notes baked in here:
//   • Brand name is always "taqreer.ai" in both languages (never تقرير) — the
//     alternateName list is the brand spellings users type, NOT the Arabic word.
//   • No SearchAction on WebSite: there is no public site-search endpoint, and a
//     non-functional target is invalid per Google's sitelinks-searchbox spec.
//   • No aggregateRating: we have no real review corpus, and fabricating one
//     violates the structured-data + spam policies.

import type { Locale } from "@/lib/i18n/config";

const SITE_URL = "https://taqreer.ai";
// Current brand mark (white mark on the brand-dark rounded box, same as the
// favicon). Boxed rather than the transparent white mark so it stays visible on
// Google's light brand panel. Was /icon-colored.svg (retired colored mark).
const LOGO_URL = `${SITE_URL}/icon.svg`;

// Public brand profiles (mirrors components/marketing/SiteFooter.tsx). These are
// the `sameAs` signals that tie the social presence to the brand entity.
const SAME_AS = [
  "https://x.com/taqreerai",
  "https://instagram.com/taqreerai",
  "https://linkedin.com/company/taqreerai",
];

// Localized entity copy. Kept here (not in the UI dictionaries) because it is
// search-metadata, not on-screen copy — and it targets the exact keywords.
const ENTITY = {
  ar: {
    orgDescription:
      "taqreer.ai منصة ذكاء اصطناعي لتصميم العروض التقديمية والتقارير بالعربية والإنجليزية.",
    appName: "taqreer.ai · تصميم عروض تقديمية بالذكاء الاصطناعي",
    appDescription:
      "صمم عروضا تقديمية وتقارير احترافية بالذكاء الاصطناعي بالعربية والإنجليزية. اكتب فكرتك أو ارفع ملفا، واحصل على عرض مصمم بالكامل قابل للتعديل والتصدير إلى باوربوينت.",
    features: [
      "تصميم عروض تقديمية بالذكاء الاصطناعي",
      "دعم كامل للعربية واتجاه النص من اليمين إلى اليسار",
      "تحويل الملفات والتقارير إلى عروض مصممة",
      "محرر شرائح مباشر في المتصفح",
      "تصدير إلى باوربوينت و PDF مع الحفاظ على التنسيق العربي",
      "تطبيق الهوية البصرية: الشعار والألوان والخطوط",
    ],
  },
  en: {
    orgDescription:
      "taqreer.ai is an AI platform for designing presentations and reports in Arabic and English.",
    appName: "taqreer.ai · AI Presentation Maker",
    appDescription:
      "Design professional AI presentations and reports in Arabic and English. Write a brief or upload a file and get a fully designed, editable deck you can export to PowerPoint.",
    features: [
      "AI presentation design",
      "Full Arabic and right-to-left support",
      "Turn files and reports into designed decks",
      "Live in-browser slide editor",
      "Export to PowerPoint and PDF with Arabic formatting preserved",
      "Apply your brand: logo, colors, and fonts",
    ],
  },
} as const;

// Organization: the brand entity. Powers the knowledge-panel / brand SERP for
// the term "taqreer".
export function organizationSchema(locale: Locale) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "taqreer.ai",
    alternateName: ["taqreer", "Taqreer"],
    url: SITE_URL,
    logo: LOGO_URL,
    description: ENTITY[locale].orgDescription,
    sameAs: SAME_AS,
  };
}

// WebSite: the site entity (distinct from the Organization). No potentialAction
// — see file header.
export function webSiteSchema(locale: Locale) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "taqreer.ai",
    alternateName: ["taqreer", "Taqreer"],
    url: SITE_URL,
    inLanguage: locale === "ar" ? "ar" : "en",
    publisher: { "@type": "Organization", name: "taqreer.ai", url: SITE_URL },
  };
}

// SoftwareApplication: describes the product itself to Search + AI features.
// The AggregateOffer is DERIVED from the live tier prices (the layout passes
// getDisplayPrices(), which itself falls back to the billing catalog), so a
// repricing never leaves stale structured data. Omitted entirely only when
// no price list is provided at all.
export function softwareApplicationSchema(
  locale: Locale,
  tierPrices?: readonly { plan: string; monthly: number }[],
) {
  const e = ENTITY[locale];
  const monthly = (tierPrices ?? []).map((t) => t.monthly);
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: e.appName,
    applicationCategory: "DesignApplication",
    operatingSystem: "Web",
    url: SITE_URL,
    description: e.appDescription,
    inLanguage: ["ar", "en"],
    featureList: e.features,
    ...(monthly.length > 0
      ? {
          offers: {
            "@type": "AggregateOffer",
            priceCurrency: "USD",
            lowPrice: String(Math.min(...monthly)),
            highPrice: String(Math.max(...monthly)),
            offerCount: String(monthly.length),
          },
        }
      : {}),
    publisher: { "@type": "Organization", name: "taqreer.ai", url: SITE_URL },
  };
}

// FAQPage: built from a localized [{q,a}] list (the landing FAQ, or a per-page
// FAQ). Eligible for FAQ rich results + a strong source for AI answer extraction.
export function faqPageSchema(items: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

// BreadcrumbList: the path from home to the current page. Helps Google render
// breadcrumbs in the result + understand site structure.
export function breadcrumbSchema(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url.startsWith("http") ? it.url : `${SITE_URL}${it.url}`,
    })),
  };
}

// CollectionPage: marks a page that presents a curated set (e.g. /templates).
// `items` (optional) itemizes the set as an ItemList of the members' detail
// pages, tying the hub to the per-template pages in the structured-data graph.
export function collectionPageSchema(opts: {
  name: string;
  description: string;
  path: string;
  locale: Locale;
  items?: { name: string; url: string }[];
}) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: opts.name,
    description: opts.description,
    url: `${SITE_URL}${opts.path}`,
    inLanguage: opts.locale === "ar" ? "ar" : "en",
    isPartOf: { "@type": "WebSite", name: "taqreer.ai", url: SITE_URL },
    ...(opts.items && opts.items.length > 0
      ? {
          mainEntity: {
            "@type": "ItemList",
            itemListElement: opts.items.map((it, i) => ({
              "@type": "ListItem",
              position: i + 1,
              name: it.name,
              url: it.url.startsWith("http") ? it.url : `${SITE_URL}${it.url}`,
            })),
          },
        }
      : {}),
  };
}

// CreativeWork: a single template's detail page (/presentation-templates/[slug]).
// Deliberately CreativeWork rather than Product (no offers/reviews to back a
// Product) or ImageObject (the page is the work, not just its cover).
export function creativeWorkSchema(opts: {
  name: string;
  description: string;
  path: string;
  image: string;
  locale: Locale;
  // BCP-47 of the template CONTENT (a template can be Arabic on the /en page).
  inLanguage: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: opts.name,
    description: opts.description,
    url: `${SITE_URL}${opts.path}`,
    image: opts.image.startsWith("http")
      ? opts.image
      : `${SITE_URL}${opts.image}`,
    inLanguage: opts.inLanguage,
    isPartOf: {
      "@type": "CollectionPage",
      url: `${SITE_URL}/${opts.locale}/presentation-templates`,
    },
    publisher: { "@type": "Organization", name: "taqreer.ai", url: SITE_URL },
  };
}
