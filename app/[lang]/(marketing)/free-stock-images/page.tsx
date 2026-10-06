// Public /free-stock-images spoke (SEO). A crawlable, Unsplash-style
// library of the AI-generated images users' decks produced, targeting
// "free stock images" search intent while cross-linking the other spokes.
//
// The images (and their prompt alt text) are server-rendered into the
// HTML via the client island seeded with the first page, so crawlers see
// real <img alt> tags. Search / filter / infinite-scroll run client-side
// against /api/stock-images.
//
// Dynamic (force-dynamic) rather than static: the image corpus grows
// continuously (Inngest), so every render reflects the newest images
// (same choice as the per-user /library). alt/title = the image PROMPT,
// never the deck title.

import type { Metadata } from "next";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import {
  getStockImagesPage,
  randomShuffleCohort,
} from "@/lib/stock-images/query";
import { StockImagesClient } from "./StockImagesClient";
import { ExploreMoreSection } from "@/components/marketing/ExploreMoreSection";
import { ScrollReveal } from "@/components/marketing/ScrollReveal";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema, imageGallerySchema } from "@/lib/seo/schema";
import { localeAlternates } from "@/lib/seo/alternates";
import { RepeatCta } from "@/components/marketing/RepeatCta";
import { localizedHref } from "@/lib/i18n/navigation";

export const dynamic = "force-dynamic";

function resolve(lang: string): "ar" | "en" {
  return (isLocale(lang) ? lang : defaultLocale) as "ar" | "en";
}

export async function generateMetadata(props: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await props.params;
  const locale = resolve(lang);
  const dict = await getDictionary(locale);
  const t = dict.stockImages;
  return {
    title: t.meta.title,
    description: t.meta.description,
    alternates: localeAlternates(locale, "free-stock-images"),
    openGraph: {
      title: t.meta.title,
      description: t.meta.description,
      url: `/${locale}/free-stock-images`,
      siteName: "taqreer.ai",
      images: ["/og-image.png"],
      type: "website",
      locale: locale === "en" ? "en_US" : "ar_SA",
    },
    twitter: {
      card: "summary_large_image",
      title: t.meta.title,
      description: t.meta.description,
      images: ["/og-image.png"],
    },
  };
}

export default async function StockImagesPage(props: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await props.params;
  const locale = resolve(lang);
  // A shuffle cohort per request, so the gallery isn't frozen on the same first
  // page for every visitor/visit. Handed to the client island so every
  // paging/filter call reuses it — the order must stay stable WITHIN a visit or
  // page 2 would repeat or skip page 1. A bounded cohort (not a unique-per-visit
  // seed) keeps the API's CDN keyspace shareable. (The route is force-dynamic,
  // so this re-rolls per request; crawlers also see a rotating sample, which
  // spreads discovery across the corpus.)
  const seed = randomShuffleCohort();
  const [dict, page] = await Promise.all([
    getDictionary(locale),
    getStockImagesPage({ seed }),
  ]);
  const t = dict.stockImages;

  return (
    <div className="pb-8">
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: locale === "ar" ? "الرئيسية" : "Home", url: `/${locale}` },
            { name: t.breadcrumb, url: `/${locale}/free-stock-images` },
          ]),
          imageGallerySchema({
            name: t.meta.title,
            description: t.meta.description,
            path: `/${locale}/free-stock-images`,
            locale,
            // Itemize the first page (what's in the static HTML); cap so the
            // structured-data blob stays lean.
            images: page.images.slice(0, 24).map((img) => ({
              url: img.url,
              caption: img.prompt,
            })),
          }),
        ]}
      />

      {/* Hero — the page's single h1. */}
      <section className="pb-12 text-center">
        <ScrollReveal direction="up">
          <div className="mx-auto max-w-3xl">
            <span className="mb-3 block text-sm font-semibold text-[var(--tq-violet)]">
              {t.hero.eyebrow}
            </span>
            <h1 className="mb-5 text-balance text-4xl font-medium leading-tight md:text-5xl">
              {t.hero.title}
            </h1>
            <p className="mx-auto mb-8 max-w-2xl text-lg leading-relaxed text-muted">
              {t.hero.subtitle}
            </p>
          </div>
        </ScrollReveal>
      </section>

      <RepeatCta href={localizedHref("/create", locale)} label={t.cta} />

      {/* Searchable, filterable masonry (seeded with the server's first page). */}
      <section className="pb-16">
        <StockImagesClient
          initialImages={page.images}
          initialPageCount={page.pageCount}
          seed={seed}
        />
      </section>

      <RepeatCta href={localizedHref("/create", locale)} label={t.cta} />

      {/* Cross-links to the sibling marketing spokes (crawl path). */}
      <ExploreMoreSection locale={locale} current="stockImages" dict={dict} />
    </div>
  );
}
