// Public /presentation-style spoke (SEO Phase 2). Targets the Mimic flow
// ("تصميم عرض بنفس النمط", "محاكاة تصميم عرض"). Inlines the real Mimic flow
// statically (FlowPreview view="mimic", reused from the hero demo). (marketing)
// chrome + SectionHeader + FaqAccordion; tokens only, tashkeel-free.
// Slug is /presentation-style because /mimic is the in-app flow route.

import type { Metadata } from "next";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { localizedHref } from "@/lib/i18n/navigation";
import { FlowPreview } from "@/components/marketing/FlowPreview";
import { FaqAccordion } from "@/components/marketing/FaqAccordion";
import { SectionHeader } from "@/components/marketing/SectionHeader";
import { ExploreMoreSection } from "@/components/marketing/ExploreMoreSection";
import { ScrollReveal } from "@/components/marketing/ScrollReveal";
import { FeatureArticleSection } from "@/components/marketing/FeatureSpokePage";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema, faqPageSchema } from "@/lib/seo/schema";
import { localeAlternates } from "@/lib/seo/alternates";
import { RepeatCta } from "@/components/marketing/RepeatCta";

export const dynamic = "force-static";

function resolve(lang: string): "ar" | "en" {
  return (isLocale(lang) ? lang : defaultLocale) as "ar" | "en";
}

// Material Symbols icon per "why" point (presentation-only + locale-agnostic).
// Order matches dict.presentationStyle.why.points.
const WHY_ICONS = ["palette", "edit_note", "format_textdirection_r_to_l", "download"];

export async function generateMetadata(props: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await props.params;
  const locale = resolve(lang);
  const dict = await getDictionary(locale);
  const t = dict.presentationStyle;
  return {
    title: t.meta.title,
    description: t.meta.description,
    alternates: localeAlternates(locale, "presentation-style"),
    openGraph: {
      title: t.meta.title,
      description: t.meta.description,
      url: `/${locale}/presentation-style`,
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

export default async function PresentationStylePage(props: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await props.params;
  const locale = resolve(lang);
  const dict = await getDictionary(locale);
  const t = dict.presentationStyle;
  // Free CTA: /mimic is open to visitors (2026-10-06); they sign up at its
  // Create button.
  const ctaHref = localizedHref("/mimic", locale);

  return (
    <div className="pb-8">
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: locale === "ar" ? "الرئيسية" : "Home", url: `/${locale}` },
            { name: t.breadcrumb, url: `/${locale}/presentation-style` },
          ]),
          faqPageSchema(t.faq),
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
            <a
              href={ctaHref}
              className="btn-gradient-anim inline-block rounded-full px-8 py-3 text-sm font-medium"
            >
              {t.hero.cta}
            </a>
          </div>
        </ScrollReveal>
      </section>

      {/* The real Mimic flow, inlined statically (reused from the hero demo). */}
      <section className="py-12">
        <ScrollReveal direction="up" className="pb-10">
          <SectionHeader title={t.preview.title} subtitle={t.preview.subtitle} />
        </ScrollReveal>
        <ScrollReveal direction="up">
          <FlowPreview view="mimic" />
        </ScrollReveal>
      </section>

      <RepeatCta href={ctaHref} label={t.hero.cta} />

      {/* Why — 4 points. */}
      <section className="py-16">
        <ScrollReveal direction="up" className="pb-10">
          <SectionHeader title={t.why.title} subtitle={t.why.subtitle} />
        </ScrollReveal>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {t.why.points.map((point, i) => (
            <ScrollReveal key={i} direction="up" delay={i * 0.06}>
              <div className="surface-card h-full rounded-[14px] p-6">
                <span
                  className="material-symbols-outlined mb-4 block text-[32px] leading-none text-[var(--tq-violet)]"
                  aria-hidden
                >
                  {WHY_ICONS[i]}
                </span>
                <h3 className="mb-2 text-base font-medium">{point.title}</h3>
                <p className="text-sm leading-relaxed text-muted">{point.body}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>

      <RepeatCta href={ctaHref} label={t.hero.cta} />

      {/* Long-form SEO article (2026-10-01). */}
      <FeatureArticleSection locale={locale} article={t.article} />

      {/* FAQ. */}
      <section className="py-16">
        <ScrollReveal direction="up" className="pb-8">
          <SectionHeader title={dict.landing.sections.faq.title} />
        </ScrollReveal>
        <ScrollReveal direction="up">
          <FaqAccordion items={t.faq} />
        </ScrollReveal>
      </section>

      <RepeatCta href={ctaHref} label={t.hero.cta} />

      {/* Cross-links to the sibling marketing pages (crawl path between spokes). */}
      <ExploreMoreSection locale={locale} current="presentationStyle" dict={dict} />
    </div>
  );
}
