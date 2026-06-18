// Public landing page (/). Simple stacked layout: a centered max-w-7xl column
// on the panel background with the bottom aurora glow (MagneticGlow, dots off).
// No swiss-grid frame: the vertical border-x + the full-bleed `.rule-*`
// separators were removed (2026-06-11) in favour of plain section spacing, so
// the page reads like the app rather than a marketing grid. Single-column
// section headers are centered; only the 2-column BiDi band is right-aligned.
// The only page motion left is the hero's own 3D demo + the trusted-by marquee.
//
// Lives at `app/page.tsx` (NOT inside a route group) because of a Next 16.2.6 +
// Turbopack route-resolution bug with `(marketing)/page.tsx`.

import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { Hero } from "@/components/marketing/Hero";
import { FeatureFlowCards } from "@/components/marketing/FeatureFlowCards";
import { BidiSection } from "@/components/marketing/BidiSection";
import { ScrollReveal } from "@/components/marketing/ScrollReveal";
import { MagneticGlow } from "@/components/app/MagneticGlow";
import { LandingTemplatesGrid } from "@/components/marketing/LandingTemplatesGrid";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { PricingTiers } from "@/components/marketing/PricingTiers";
import { FaqAccordion } from "@/components/marketing/FaqAccordion";
import { LandingNav } from "@/components/marketing/LandingNav";
import { SectionHeader } from "@/components/marketing/SectionHeader";
import { localizedHref } from "@/lib/i18n/navigation";
import { getLandingTemplates } from "@/lib/auth/marquee-projects";
import { SmoothScrollProvider } from "@/components/providers";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { JsonLd } from "@/components/seo/JsonLd";
import { faqPageSchema } from "@/lib/seo/schema";

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

// "Trusted by" logos. Each renders as a `currentColor` SVG mask (see
// `.trusted-logo` in globals.css) so they're monochrome + theme-adaptive on
// both light and dark. `w`/`h` = the logo's CONTENT box (the public/logos SVG
// viewBox is pre-cropped to it) and drive the per-logo aspect-ratio. `px` is the
// per-logo display HEIGHT, hand-tuned for OPTICAL balance: a uniform pixel
// height makes all-caps wordmarks (EMAAR) read heavier than lowercase ones
// (mbc) or mark+wordmarks, so caps shrink and lowercase/marks grow.
const TRUSTED_LOGOS: { file: string; w: number; h: number; px: number; label: string }[] = [
  { file: "uber", w: 606, h: 210, px: 20, label: "Uber" },
  { file: "shahid", w: 719, h: 204, px: 23, label: "Shahid" },
  { file: "etisalat", w: 250, h: 57, px: 22, label: "Etisalat" },
  { file: "mbc", w: 636, h: 270, px: 26, label: "MBC Group" },
  { file: "emaar", w: 1617, h: 321, px: 18, label: "Emaar" },
  { file: "claude", w: 512, h: 110, px: 20, label: "Claude" },
  { file: "openai", w: 512, h: 126, px: 20, label: "OpenAI" },
];

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

export default async function LandingPage({
  params,
}: {
  params: Promise<{ lang: "ar" | "en" }>;
}) {
  const { lang } = await params;
  const supabase = await createClient();
  const [
    { data: { user } },
    projectCount,
    landingTemplates,
    dict,
  ] = await Promise.all([
    supabase.auth.getUser(),
    getProjectCount(),
    getLandingTemplates(),
    getDictionary(lang),
  ]);

  return (
    <SmoothScrollProvider>
    <main className="relative overflow-x-clip">
      {/* FAQPage structured data, mirrored from the rendered FAQ accordion
          (dict.landing.faq). Eligible for FAQ rich results + a strong source
          for AI answer extraction. */}
      <JsonLd data={faqPageSchema(dict.landing.faq)} />
      {/* Panel-coloured base + the aurora glow, pinned behind everything. */}
      <div aria-hidden className="fixed inset-0 -z-[2] bg-[var(--tq-panel)]" />
      <MagneticGlow fixed glowYOffset={0.2} dots={false} />
      <LandingNav isAuthed={!!user} />

      {/* Hero sits OUTSIDE the max-w-7xl column: its dashboard preview
          grows with viewport height on tall screens (.hero-preview-frame,
          globals.css "Hero fold composition") and a 7xl cap would clamp
          it back to laptop size on 4K. The hero centers its own copy. */}
      <Hero projectCount={projectCount} />

      {/* Centered content column (no frame hairlines — sections stack on the
          dotted + aurora backdrop, matching the dashboard). */}
      <div className="relative mx-auto max-w-7xl">

        {/* Trusted-by — animated full-width marquee with edge-fade mask
            (`.mask-edges`) so the logos dissolve at both ends. */}
        <section className="py-24">
          <div className="mask-edges relative w-full overflow-hidden" dir="ltr">
            <div className="animate-marquee-rtl pause-on-hover flex w-max items-center text-foreground opacity-50">
              {/* gap = 2x the group padding so the loop seam keeps the same
                  rhythm. Wide on desktop (~5 logos in view), tighter on a phone
                  so it isn't too sparse. */}
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-24 px-12 lg:gap-44 lg:px-22">
                  {TRUSTED_LOGOS.map((logo) => (
                    <span
                      key={logo.file}
                      role="img"
                      aria-label={logo.label}
                      className="trusted-logo shrink-0"
                      style={{
                        height: logo.px,
                        aspectRatio: `${logo.w} / ${logo.h}`,
                        WebkitMaskImage: `url(/logos/${logo.file}.svg)`,
                        maskImage: `url(/logos/${logo.file}.svg)`,
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
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

        {/* BiDi band — asymmetric, inline-toggle title. */}
        <section className={`${SECTION} ${PX}`}>
          <BidiSection />
        </section>

        {/* Templates */}
        <section id="templates" className={`${SECTION} ${PX}`}>
          <ScrollReveal direction="up">
            <SectionHeader
              eyebrow={dict.landing.sections.templates.eyebrow}
              title={dict.landing.sections.templates.title}
              subtitle={dict.landing.sections.templates.subtitle}
            />
          </ScrollReveal>
          <div className="mt-12">
            <LandingTemplatesGrid templates={landingTemplates} isAuthed={!!user} />
            <div className="mt-10 text-center">
              <a
                href={localizedHref("/presentation-templates", lang)}
                className="btn-pill inline-flex px-5 py-2 text-sm"
              >
                {dict.landing.sections.templates.viewAll}
              </a>
            </div>
          </div>
        </section>

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
            <PricingTiers isAuthed={!!user} />
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
          <ScrollReveal direction="up">
            <FaqAccordion />
          </ScrollReveal>
        </section>

        {/* Footer - shared with the legal pages (components/marketing/SiteFooter).
            Full-bleed here so it spans the column like the FAQ rows above. */}
        <SiteFooter locale={lang} fullBleed />
      </div>
    </main>
    </SmoothScrollProvider>
  );
}
