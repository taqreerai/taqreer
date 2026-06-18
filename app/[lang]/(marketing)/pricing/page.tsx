// Public /pricing spoke (SEO Phase 2). Targets "اسعار taqreer" + the brand
// pricing sitelink. Reuses the (marketing) chrome + the landing PricingTiers
// (monthly/yearly toggle + checkout) + FAQ accordion + SectionHeader; tokens
// only, no hardcoded visuals.
//
// Heading hierarchy: one <h1> (hero) -> <h2> (credits + FAQ) -> <h3> (tier names
// inside PricingTiers, credit cards). Canonical + hreflang come from the root
// [lang]/layout generateMetadata; this page only sets title/description/OG.

import type { Metadata } from "next";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { createClient } from "@/lib/supabase/server";
import { PricingTiers } from "@/components/marketing/PricingTiers";
import { FaqAccordion } from "@/components/marketing/FaqAccordion";
import { SectionHeader } from "@/components/marketing/SectionHeader";
import { ScrollReveal } from "@/components/marketing/ScrollReveal";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema, faqPageSchema } from "@/lib/seo/schema";

function resolve(lang: string): "ar" | "en" {
  return (isLocale(lang) ? lang : defaultLocale) as "ar" | "en";
}

// Material Symbols icon per "how credits work" point (presentation-only +
// locale-agnostic). Order matches dict.pricing.credits.points:
// monthly credits / usage-based / free signup credits / top-up packs.
const CREDIT_ICONS = ["calendar_month", "toll", "card_giftcard", "add_circle"];

export async function generateMetadata(props: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await props.params;
  const locale = resolve(lang);
  const dict = await getDictionary(locale);
  const t = dict.pricing;
  return {
    title: t.meta.title,
    description: t.meta.description,
    openGraph: {
      title: t.meta.title,
      description: t.meta.description,
      url: `/${locale}/pricing`,
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

export default async function PricingPage(props: {
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
  ] = await Promise.all([supabase.auth.getUser(), getDictionary(locale)]);
  const t = dict.pricing;
  const isAuthed = !!user;

  return (
    <div className="pb-8">
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: locale === "ar" ? "الرئيسية" : "Home", url: `/${locale}` },
            { name: t.breadcrumb, url: `/${locale}/pricing` },
          ]),
          faqPageSchema(t.faq),
        ]}
      />

      {/* Hero — the page's single h1; the tiers below carry the CTAs. */}
      <section className="pb-12 text-center">
        <ScrollReveal direction="up">
          <div className="mx-auto max-w-3xl">
            <span className="mb-3 block text-sm font-semibold text-[var(--tq-violet)]">
              {t.hero.eyebrow}
            </span>
            <h1 className="mb-5 text-balance text-4xl font-medium leading-tight md:text-5xl">
              {t.hero.title}
            </h1>
            <p className="mx-auto max-w-2xl text-lg leading-relaxed text-muted">
              {t.hero.subtitle}
            </p>
          </div>
        </ScrollReveal>
      </section>

      {/* Plans — reuses the landing pricing component (toggle + checkout). */}
      <section className="py-8">
        <PricingTiers isAuthed={isAuthed} />
      </section>

      {/* How credits work — 4 points. */}
      <section className="py-16">
        <ScrollReveal direction="up" className="pb-10">
          <SectionHeader title={t.credits.title} subtitle={t.credits.subtitle} />
        </ScrollReveal>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {t.credits.points.map((point, i) => (
            <ScrollReveal key={i} direction="up" delay={i * 0.06}>
              <div className="surface-card h-full rounded-[14px] p-6">
                <span
                  className="material-symbols-outlined mb-4 block text-[32px] leading-none text-[var(--tq-violet)]"
                  aria-hidden
                >
                  {CREDIT_ICONS[i]}
                </span>
                <h3 className="mb-2 text-base font-medium">{point.title}</h3>
                <p className="text-sm leading-relaxed text-muted">{point.body}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* FAQ — reuses the landing accordion with pricing-specific items. */}
      <section className="py-16">
        <ScrollReveal direction="up" className="pb-8">
          <SectionHeader title={dict.landing.sections.faq.title} />
        </ScrollReveal>
        <ScrollReveal direction="up">
          <FaqAccordion items={t.faq} />
        </ScrollReveal>
      </section>
    </div>
  );
}
