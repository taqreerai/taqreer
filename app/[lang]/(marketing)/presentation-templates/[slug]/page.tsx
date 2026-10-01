/* eslint-disable @next/next/no-img-element -- slide thumbnails are generated storage URLs proxied via /tpl; next/image's host allowlist + optimization don't apply */

// Public SEO detail page for a single curated template
// (/[lang]/presentation-templates/[slug]). One indexable URL per public
// curator template with an admin-assigned slug; slugless templates have no
// detail page (the hub keeps its lightbox for those).
//
// Same static + tag-revalidated pattern as the hub: force-static HTML, data
// via the "template-detail" unstable_cache tag, busted (server + Cloudflare
// edge) by revalidateTemplateSurfaces() on every admin curation write.
// Heading hierarchy: one <h1> (template name) → <h2> sections → <h3> cards.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { localizedHref } from "@/lib/i18n/navigation";
import {
  getPublicTemplateBySlug,
  getPublicTemplateSlugs,
  getTemplatesPageList,
  templateLocales,
  type TemplateDetail,
} from "@/lib/auth/marquee-projects";
import { UseTemplateCta } from "@/components/marketing/UseTemplateCta";
import { PremiumBadge } from "@/components/app/PremiumBadge";
import { ScrollReveal } from "@/components/marketing/ScrollReveal";
import { SectionHeader } from "@/components/marketing/SectionHeader";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema, creativeWorkSchema } from "@/lib/seo/schema";
import { localeAlternates } from "@/lib/seo/alternates";

export const dynamic = "force-static";

function resolve(lang: string): "ar" | "en" {
  return (isLocale(lang) ? lang : defaultLocale) as "ar" | "en";
}

// Locale-picked template name/description with cross-language fallback (a
// curator may fill one language first) and a dictionary fallback for neither.
function pickCopy(tpl: TemplateDetail, locale: "ar" | "en") {
  const name =
    (locale === "ar" ? tpl.nameAr ?? tpl.nameEn : tpl.nameEn ?? tpl.nameAr) ??
    null;
  const description =
    (locale === "ar"
      ? tpl.descriptionAr ?? tpl.descriptionEn
      : tpl.descriptionEn ?? tpl.descriptionAr) ?? null;
  return { name, description };
}

// Prerender the known public slugs at build; new slugs published after the
// build still render on first request (dynamicParams default) once the purge
// clears the edge. Fail-soft: a DB hiccup at build time just skips prerender.
export async function generateStaticParams() {
  const slugs = await getPublicTemplateSlugs();
  return slugs.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata(props: {
  params: Promise<{ lang: string; slug: string }>;
}): Promise<Metadata> {
  const { lang, slug } = await props.params;
  const locale = resolve(lang);
  const [dict, tpl] = await Promise.all([
    getDictionary(locale),
    getPublicTemplateBySlug(slug),
  ]);
  if (!tpl) return { robots: { index: false, follow: false } };
  const t = dict.templates.detail;
  const { name, description } = pickCopy(tpl, locale);
  const title = `${name ?? t.fallbackName} | taqreer.ai`;
  const desc = description ?? t.fallbackDescription;
  const cover = tpl.slides[0];
  return {
    title,
    description: desc,
    // Only locales with real copy are advertised; a copyless locale's page
    // stays reachable but canonicalizes to the real version (templateLocales).
    alternates: localeAlternates(
      locale,
      `presentation-templates/${slug}`,
      templateLocales(tpl),
    ),
    openGraph: {
      title,
      description: desc,
      url: `/${locale}/presentation-templates/${slug}`,
      siteName: "taqreer.ai",
      // The template's own cover (edge-proxied /tpl path, resolved absolute
      // against metadataBase) — a real preview beats the generic og-image.
      images: [cover ?? "/og-image.png"],
      type: "website",
      locale: locale === "en" ? "en_US" : "ar_SA",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: desc,
      images: [cover ?? "/og-image.png"],
    },
  };
}

export default async function TemplateDetailPage(props: {
  params: Promise<{ lang: string; slug: string }>;
}) {
  const { lang, slug } = await props.params;
  const locale = resolve(lang);
  const [dict, tpl, all] = await Promise.all([
    getDictionary(locale),
    getPublicTemplateBySlug(slug),
    getTemplatesPageList(),
  ]);
  if (!tpl) notFound();

  const t = dict.templates.detail;
  const { name, description } = pickCopy(tpl, locale);
  const displayName = name ?? t.fallbackName;
  const displayDescription = description ?? t.fallbackDescription;
  const cover = tpl.slides[0];
  // Cap the strip at 6 slides so the grid stays symmetric (3x2 on desktop,
  // 2x3 on mobile) instead of leaving an orphan row.
  const restSlides = tpl.slides.slice(1, 7);
  const isPortrait = tpl.format === "9:16";
  const related = all
    .filter((other) => other.slug && other.slug !== slug)
    .slice(0, 4);
  const hubHref = localizedHref("/presentation-templates", locale);
  const relatedName = (other: (typeof related)[number]) =>
    (locale === "ar"
      ? other.nameAr ?? other.nameEn
      : other.nameEn ?? other.nameAr) ?? t.fallbackName;

  // Primary CTA row: in the hero, then repeated after the slide strip, the
  // how-to steps and the related templates (CTAs throughout, 2026-10-01).
  const ctaRow = (
          <div className="flex flex-wrap items-center justify-center gap-4">
            <UseTemplateCta
              templateId={tpl.id}
              label={t.useCta}
              busyLabel={t.useBusy}
            />
            <a
              href={hubHref}
              className="text-sm font-medium text-muted transition-colors hover:text-[var(--tq-fg)]"
            >
              {t.browseAll}
            </a>
          </div>
  );

  return (
    <div className="pb-8">
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: locale === "ar" ? "الرئيسية" : "Home", url: `/${locale}` },
            {
              name: dict.templates.breadcrumb,
              url: `/${locale}/presentation-templates`,
            },
            {
              name: displayName,
              url: `/${locale}/presentation-templates/${slug}`,
            },
          ]),
          creativeWorkSchema({
            name: displayName,
            description: displayDescription,
            path: `/${locale}/presentation-templates/${slug}`,
            image: cover ?? "/og-image.png",
            locale,
            inLanguage: tpl.language === "ar" ? "ar" : "en",
          }),
        ]}
      />

      {/* Hero — the page's single h1 + primary CTA. */}
      <section className="pb-12 text-center">
        <ScrollReveal direction="up">
          <div className="mx-auto max-w-3xl">
            <span className="mb-3 block text-sm font-semibold text-[var(--tq-violet)]">
              {dict.templates.hero.eyebrow}
            </span>
            <h1 className="mb-5 text-balance text-4xl font-medium leading-tight md:text-5xl">
              {displayName}
            </h1>
            <p className="mx-auto mb-8 max-w-2xl text-lg leading-relaxed text-muted">
              {displayDescription}
            </p>
            {ctaRow}
          </div>
        </ScrollReveal>
      </section>

      {/* Cover + facts. */}
      <section className="pb-16">
        <ScrollReveal direction="up">
          <div
            className={`tq-thumbnail relative overflow-hidden rounded-[14px] ${
              isPortrait
                ? "mx-auto aspect-[9/16] max-w-sm"
                : "mx-auto aspect-video max-w-4xl"
            }`}
          >
            {cover ? (
              <img
                alt={displayName}
                src={cover}
                className="h-full w-full object-cover"
                decoding="async"
                draggable={false}
              />
            ) : null}
            {tpl.isPremium ? (
              <PremiumBadge className="pointer-events-none absolute top-3 start-3 z-10" />
            ) : null}
          </div>
        </ScrollReveal>
        <ScrollReveal direction="up">
          <dl className="mx-auto mt-6 flex max-w-4xl flex-wrap items-center justify-center gap-3 text-sm">
            <div className="surface-card flex items-center gap-2 rounded-full px-4 py-2">
              <dt className="text-muted">{t.facts.slides}</dt>
              <dd className="font-medium" dir="ltr">
                {tpl.slideCount}
              </dd>
            </div>
            <div className="surface-card flex items-center gap-2 rounded-full px-4 py-2">
              <dt className="text-muted">{t.facts.language}</dt>
              <dd className="font-medium">
                {tpl.language === "ar" ? t.facts.languageAr : t.facts.languageEn}
              </dd>
            </div>
            <div className="surface-card flex items-center gap-2 rounded-full px-4 py-2">
              <dt className="text-muted">{t.facts.format}</dt>
              <dd className="font-medium" dir="ltr">
                {tpl.format}
              </dd>
            </div>
          </dl>
        </ScrollReveal>
      </section>

      {/* Slide strip — the rest of the deck. */}
      {restSlides.length > 0 ? (
        <section className="pb-16">
          <ScrollReveal direction="up" className="pb-10">
            <SectionHeader title={t.slidesTitle} />
          </ScrollReveal>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {restSlides.map((slideUrl, i) => (
              <ScrollReveal key={slideUrl} direction="up" delay={i * 0.04}>
                <div
                  className={`tq-thumbnail overflow-hidden rounded-[14px] ${
                    isPortrait ? "aspect-[9/16]" : "aspect-video"
                  }`}
                >
                  <img
                    alt={`${displayName} ${i + 2}`}
                    src={slideUrl}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                  />
                </div>
              </ScrollReveal>
            ))}
          </div>
        <div className="pt-10">{ctaRow}</div>
        </section>
      ) : null}

      {/* How to use — 3 steps of real text (SEO body content). */}
      <section className="pb-16">
        <ScrollReveal direction="up" className="pb-10">
          <SectionHeader title={t.howTitle} />
        </ScrollReveal>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {t.howSteps.map((step, i) => (
            <ScrollReveal key={i} direction="up" delay={i * 0.06}>
              <div className="surface-card h-full rounded-[14px] p-6">
                <span
                  className="mb-4 block text-2xl font-semibold text-[var(--tq-violet)]"
                  dir="ltr"
                >
                  {i + 1}
                </span>
                <h3 className="mb-2 text-base font-medium">{step.title}</h3>
                <p className="text-sm leading-relaxed text-muted">{step.body}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
        <div className="pt-10">{ctaRow}</div>
      </section>

      {/* Related templates — crawlable cross-links between detail pages. */}
      {related.length > 0 ? (
        <section className="pb-8">
          <ScrollReveal direction="up" className="pb-10">
            <SectionHeader title={t.relatedTitle} />
          </ScrollReveal>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {related.map((other, i) => (
              <ScrollReveal key={other.id} direction="up" delay={i * 0.05}>
                <a
                  href={localizedHref(
                    `/presentation-templates/${other.slug}`,
                    locale,
                  )}
                  className="group block"
                >
                  <span className="tq-thumbnail relative block aspect-video overflow-hidden rounded-[14px]">
                    <img
                      alt={relatedName(other)}
                      src={other.slides[0]}
                      className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.06]"
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                    />
                    {other.isPremium ? (
                      <PremiumBadge className="pointer-events-none absolute top-2 start-2 z-10" />
                    ) : null}
                  </span>
                  <span className="mt-2 block truncate text-sm font-medium">
                    {relatedName(other)}
                  </span>
                </a>
              </ScrollReveal>
            ))}
          </div>
        <div className="pt-10">{ctaRow}</div>
        </section>
      ) : null}
    </div>
  );
}
