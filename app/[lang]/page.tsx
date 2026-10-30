// Public landing page (/). Simple stacked layout: a centered max-w-7xl column
// on the panel background over the design system's fixed dot-grid texture
// (.tq-dot-grid; replaced the bottom aura-floor glow, user direction 2026-08-30).
// No swiss-grid frame: the vertical border-x + the full-bleed `.rule-*`
// separators were removed (2026-06-11) in favour of plain section spacing, so
// the page reads like the app rather than a marketing grid. Single-column
// section headers are centered; only the 2-column BiDi band is right-aligned.
// The only page motion left is the hero's own 3D demo + the template-cover rows.
//
// Lives at `app/page.tsx` (NOT inside a route group) because of a Next 16.2.6 +
// Turbopack route-resolution bug with `(marketing)/page.tsx`.

import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Hero } from "@/components/marketing/Hero";
import { FeatureFlowCards } from "@/components/marketing/FeatureFlowCards";
import { BidiSection } from "@/components/marketing/BidiSection";
import { ScrollReveal } from "@/components/marketing/ScrollReveal";
import { LandingStylesTemplates } from "@/components/marketing/LandingStylesTemplates";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { StitchBackdrop } from "@/components/marketing/StitchBackdrop";
import { PricingTiers } from "@/components/marketing/PricingTiers";
import { FaqAccordion } from "@/components/marketing/FaqAccordion";
import { LandingNav } from "@/components/marketing/LandingNav";
import { SectionHeader } from "@/components/marketing/SectionHeader";
import { localizedHref } from "@/lib/i18n/navigation";
import { getLandingCoverRows, getLandingTemplates } from "@/lib/auth/marquee-projects";
import { TemplateCoverRows } from "@/components/marketing/TemplateCoverRows";
import { SmoothScrollProvider } from "@/components/providers";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { JsonLd } from "@/components/seo/JsonLd";
import { faqPageSchema } from "@/lib/seo/schema";
import {
  ensureFresh,
  getFreeCredits,
  pricingDisplayNumbers,
} from "@/lib/config/runtime-config";
import { fillPricingTokens } from "@/lib/credits/pricing-tokens";
import { getDisplayPrices } from "@/lib/billing/display-prices";
import { localeAlternates } from "@/lib/seo/alternates";
import type { Metadata } from "next";
import { RepeatCta } from "@/components/marketing/RepeatCta";

// Fully static: the landing prerenders to HTML at build (auth resolved
// client-side, data calls cached), so there's no per-request render or DB hit —
// TTFB is cache-fast. The 'auto' default would otherwise pick dynamic (the
// proxy.ts middleware matches this route). The vanity count bakes at build and
// refreshes on each deploy; template curation busts its tag.
export const dynamic = "force-static";

// Platform-wide "decks created" counter shown in the Hero status chip. Cached 5
// min; try/catch → 0 on error.
const getProjectCount = unstable_cache(
  async () => {
    try {
      return await prisma.project.count();
    } catch {
      return 0;
    }
  },
  ["landing-project-count"],
  // Long TTL (24h) so the landing stays on the warm cache path instead of paying
  // the cold remote-DB query (~2s) — vanity counter, undercount-safe. The deploy
  // /ar health-check re-warms it each release.
  { revalidate: 86400, tags: ["landing-project-count"] }
);

// SectionHeader moved to components/marketing/SectionHeader.tsx (shared with the
// marketing spoke pages, e.g. /templates).

// Section separators removed (no swiss grid) — sections lean on their own
// vertical padding now. `RULE` kept as an empty string so the section className
// templates below don't each need editing.
const PX = "px-4 sm:px-6 lg:px-8";
// Each content section fills ≥ one viewport with its content vertically
// centered, so scrolling lands on one section at a time (short sections centre;
// taller ones — pricing/templates/faq — grow past the viewport with the py gap).
const SECTION = "flex min-h-screen flex-col justify-center py-24";

// Canonical + hreflang for the landing. The root layout no longer emits these
// (so it can render statically), so the landing owns them here. title /
// description still inherit, but Next REPLACES (does not deep-merge)
// openGraph across routes, so the og:image + siteName are re-declared below,
// otherwise the prime ad-landing share preview renders with no image.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: "ar" | "en" }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const locale = lang === "en" ? "en" : "ar";
  return {
    alternates: localeAlternates(locale, ""),
    openGraph: {
      url: `/${locale}`,
      siteName: "taqreer.ai",
      images: ["/og-image.png"],
      locale: locale === "en" ? "en_US" : "ar_SA",
      type: "website",
    },
  };
}

export default async function LandingPage({
  params,
}: {
  params: Promise<{ lang: "ar" | "en" }>;
}) {
  const { lang } = await params;
  // No auth read here: the nav/pricing/grid resolve auth client-side
  // (useIsAuthed, a cookie check — no Supabase client) and the data calls are
  // cached, so this page renders statically (ISR) and stays light.
  const [projectCount, landingTemplates, coverRows, dict, tierPrices] =
    await Promise.all([
      getProjectCount(),
      getLandingTemplates(),
      getLandingCoverRows(),
      getDictionary(lang),
      getDisplayPrices(),
      ensureFresh(),
    ]);
  // Live config numbers for the pricing cards + the {credits} token in the FAQ
  // (and its JSON-LD), so the advertised free-credit amount tracks admin
  // Settings instead of a hardcoded literal. The Settings write revalidates +
  // CF-purges this page so an edit reaches visitors without a deploy.
  const freeCredits = getFreeCredits();
  const tierNumbers = pricingDisplayNumbers();
  const landingFaq = dict.landing.faq.map((item) => ({
    ...item,
    a: fillPricingTokens(item.a, { credits: freeCredits }),
  }));

  return (
    <SmoothScrollProvider>
    <main className="relative overflow-x-clip">
      {/* FAQPage structured data, mirrored from the rendered FAQ accordion
          (dict.landing.faq). Eligible for FAQ rich results + a strong source
          for AI answer extraction. */}
      <JsonLd data={faqPageSchema(landingFaq)} />
      {/* Pure-black base (Stitch's ground; panel tone on light), pinned
          behind everything. */}
      <div aria-hidden className="tq-stitch-base fixed inset-0 -z-[2]" />
      {/* Stitch-style backdrop (user direction 2026-08-30): JS recreation
          of stitch.withgoogle.com's animated background video in our brand
          blues, plus the restored mouse-reactive dot grid (§23 water-push,
          Stitch metrics). Replaces the bottom aura-floor glow. */}
      <StitchBackdrop />
      <LandingNav />

      {/* Hero sits OUTSIDE the max-w-7xl column: its dashboard preview
          grows with viewport height on tall screens (.hero-preview-frame,
          globals.css "Hero fold composition") and a 7xl cap would clamp
          it back to laptop size on 4K. The hero centers its own copy. */}
      <Hero projectCount={projectCount} />

      {/* Centered content column (no frame hairlines — sections stack on the
          dotted + aurora backdrop, matching the dashboard). */}
      <div className="relative mx-auto max-w-7xl">

        {/* Template covers: Arabic row drifting right to left, the other
            languages underneath drifting left to right (TemplateCoverRows). */}
        <section className="py-24">
          <TemplateCoverRows
            arabic={coverRows.arabic}
            other={coverRows.other}
            locale={lang}
            fallbackAlt={dict.landing.templatesGrid.coverAlt}
          />
        </section>

        {/* Flows — 4 gapped cards (dashboard-style), no backbone dividers. */}
        <section id="features" className={SECTION}>
          <ScrollReveal direction="up" className={`${PX} pb-12`}>
            <SectionHeader
              eyebrow={dict.landing.sections.features.eyebrow}
              title={dict.landing.sections.features.title}
              subtitle={dict.landing.sections.features.subtitle}
            />
          </ScrollReveal>
          <ScrollReveal direction="up" className={PX}>
            <FeatureFlowCards />
          </ScrollReveal>
        </section>

        <RepeatCta href={localizedHref("/signup", lang)} label={dict.landing.hero.cta} />

        {/* BiDi band: asymmetric inline-toggle title; the CTA now lives inside
            the title column under the heading (see BidiSection). */}
        <section className={`${SECTION} ${PX}`}>
          <BidiSection />
        </section>

        {/* Styles & templates: two tabs, Styles first (LandingStylesTemplates). */}
        <section id="templates" className={`${SECTION} ${PX}`}>
          <ScrollReveal direction="up">
            <SectionHeader
              eyebrow={dict.landing.sections.templates.eyebrow}
              title={dict.landing.sections.templates.title}
              subtitle={dict.landing.sections.templates.subtitle}
            />
          </ScrollReveal>
          <div className="mt-12">
            <LandingStylesTemplates templates={landingTemplates} />
          </div>
        </section>

        <RepeatCta href={localizedHref("/signup", lang)} label={dict.landing.hero.cta} />

        {/* Pricing */}
        <section id="pricing" className={`${SECTION} ${PX}`}>
          <ScrollReveal direction="up">
            <SectionHeader
              eyebrow={dict.landing.sections.pricing.eyebrow}
              title={dict.landing.sections.pricing.title}
              subtitle={dict.landing.sections.pricing.subtitle}
            />
          </ScrollReveal>
          <ScrollReveal direction="up" className="mt-12">
            <PricingTiers tierNumbers={tierNumbers} tierPrices={tierPrices} />
          </ScrollReveal>
        </section>

        {/* FAQ — centered header over the full-width accordion. */}
        <section id="faq" className={SECTION}>
          <ScrollReveal direction="up" className={`${PX} mb-8`}>
            <SectionHeader
              eyebrow={dict.landing.sections.faq.eyebrow}
              title={dict.landing.sections.faq.title}
              subtitle={dict.landing.sections.faq.subtitle}
            />
          </ScrollReveal>
          <ScrollReveal direction="up" className={PX}>
            <FaqAccordion items={landingFaq} />
          </ScrollReveal>
        </section>

        <RepeatCta href={localizedHref("/signup", lang)} label={dict.landing.hero.cta} />

        {/* Footer - shared with the legal pages (components/marketing/SiteFooter).
            Full-bleed here so it spans the column like the FAQ rows above. */}
        <SiteFooter locale={lang} fullBleed />
      </div>
    </main>
    </SmoothScrollProvider>
  );
}
