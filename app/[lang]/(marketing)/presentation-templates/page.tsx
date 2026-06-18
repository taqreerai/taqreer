// Public /templates spoke (SEO Phase 2). A crawlable, content-rich page that
// targets "قوالب عروض تقديمية" + ranks on its own while linking back to the
// landing hub. Reuses the (marketing) chrome + the landing template grid +
// FAQ accordion + SectionHeader; tokens only, no hardcoded visuals.
//
// Heading hierarchy: one <h1> (hero) → <h2> (sections) → <h3> (cards).
// Canonical + hreflang come from the root [lang]/layout generateMetadata
// (computed from x-pathname); this page only sets title/description/OG.

import type { Metadata } from "next";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { localizedHref } from "@/lib/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTemplatesPageList } from "@/lib/auth/marquee-projects";
import { LandingTemplatesGrid } from "@/components/marketing/LandingTemplatesGrid";
import { FaqAccordion } from "@/components/marketing/FaqAccordion";
import { SectionHeader } from "@/components/marketing/SectionHeader";
import { ScrollReveal } from "@/components/marketing/ScrollReveal";
import { JsonLd } from "@/components/seo/JsonLd";
import {
  breadcrumbSchema,
  collectionPageSchema,
  faqPageSchema,
} from "@/lib/seo/schema";

function resolve(lang: string): "ar" | "en" {
  return (isLocale(lang) ? lang : defaultLocale) as "ar" | "en";
}

// Material Symbols icon per how-to-use step (presentation-only + locale-agnostic,
// so kept out of the dictionary). Order matches dict.templates.how.steps:
// pick a template → customize with AI → export & present.
const STEP_ICONS = ["grid_view", "auto_awesome", "slideshow"];

export async function generateMetadata(props: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await props.params;
  const locale = resolve(lang);
  const dict = await getDictionary(locale);
  const t = dict.templates;
  return {
    title: t.meta.title,
    description: t.meta.description,
    openGraph: {
      title: t.meta.title,
      description: t.meta.description,
      url: `/${locale}/presentation-templates`,
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

export default async function TemplatesPage(props: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await props.params;
  const locale = resolve(lang);
  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    dict,
    templates,
  ] = await Promise.all([
    supabase.auth.getUser(),
    getDictionary(locale),
    getTemplatesPageList(),
  ]);
  const t = dict.templates;
  const isAuthed = !!user;

  return (
    <div className="pb-8">
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: locale === "ar" ? "الرئيسية" : "Home", url: `/${locale}` },
            { name: t.breadcrumb, url: `/${locale}/presentation-templates` },
          ]),
          collectionPageSchema({
            name: t.meta.title,
            description: t.meta.description,
            path: `/${locale}/presentation-templates`,
            locale,
          }),
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
              href={localizedHref("/signup", locale)}
              className="btn-gradient-anim inline-block rounded-full px-8 py-3 text-sm font-medium"
            >
              {t.hero.cta}
            </a>
          </div>
        </ScrollReveal>
      </section>

      {/* Template gallery — reuses the landing grid (lightbox + premium badge +
          signup/use flow). Hidden when there are no published templates. */}
      {templates.length > 0 ? (
        <section className="py-16">
          <ScrollReveal direction="up" className="pb-10">
            <SectionHeader title={t.gallery.title} subtitle={t.gallery.subtitle} />
          </ScrollReveal>
          <ScrollReveal direction="up">
            <LandingTemplatesGrid templates={templates} isAuthed={isAuthed} />
          </ScrollReveal>
        </section>
      ) : null}

      {/* How it works — 3 steps. */}
      <section className="py-16">
        <ScrollReveal direction="up" className="pb-10">
          <SectionHeader title={t.how.title} subtitle={t.how.subtitle} />
        </ScrollReveal>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {t.how.steps.map((step, i) => (
            <ScrollReveal key={i} direction="up" delay={i * 0.08}>
              <div className="surface-card h-full rounded-[14px] p-6">
                <span
                  className="material-symbols-outlined mb-4 block text-[32px] leading-none text-[var(--tq-violet)]"
                  aria-hidden
                >
                  {STEP_ICONS[i]}
                </span>
                <h3 className="mb-2 text-lg font-medium">{step.title}</h3>
                <p className="text-sm leading-relaxed text-muted">{step.body}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* Why taqreer templates — 4 points. */}
      <section className="py-16">
        <ScrollReveal direction="up" className="pb-10">
          <SectionHeader title={t.why.title} subtitle={t.why.subtitle} />
        </ScrollReveal>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {t.why.points.map((point, i) => (
            <ScrollReveal key={i} direction="up" delay={i * 0.06}>
              <div className="surface-card h-full rounded-[14px] p-6">
                <h3 className="mb-2 text-base font-medium">{point.title}</h3>
                <p className="text-sm leading-relaxed text-muted">{point.body}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* FAQ — reuses the landing accordion with templates-specific items. */}
      <section className="py-16">
        <ScrollReveal direction="up" className="pb-8">
          <SectionHeader title={dict.landing.sections.faq.title} />
        </ScrollReveal>
        <ScrollReveal direction="up">
          <FaqAccordion items={t.faq} />
        </ScrollReveal>
      </section>

      {/* Final CTA. */}
      <section className="py-16">
        <ScrollReveal direction="up">
          <div className="surface-card mx-auto max-w-3xl rounded-[14px] p-10 text-center">
            <h2 className="mb-3 text-2xl font-medium md:text-3xl">
              {t.finalCta.title}
            </h2>
            <p className="mx-auto mb-7 max-w-xl text-muted">{t.finalCta.subtitle}</p>
            <a
              href={localizedHref("/signup", locale)}
              className="btn-gradient-anim inline-block rounded-full px-8 py-3 text-sm font-medium"
            >
              {t.finalCta.cta}
            </a>
          </div>
        </ScrollReveal>
      </section>
    </div>
  );
}
