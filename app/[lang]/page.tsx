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
import { ThemeLogo } from "@/components/brand/ThemeLogo";
import { PricingTiers } from "@/components/marketing/PricingTiers";
import { FaqAccordion } from "@/components/marketing/FaqAccordion";
import { LandingNav } from "@/components/marketing/LandingNav";
import { getLandingTemplates } from "@/lib/auth/marquee-projects";
import { SmoothScrollProvider } from "@/components/providers";
import { getDictionary } from "@/lib/i18n/dictionaries";

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
  { revalidate: 300, tags: ["landing-project-count"] }
);

const TRUSTED_LOGOS = ["TED", "Lattice", "NCR", "PACIFIC FUNDS", "Rakuten", "zendesk", "DELL"];

// In-section anchor hrefs for the footer "links" group, keyed by the stable
// dict key (NOT the localized label) so the mapping survives translation.
const FOOTER_LINK_HREFS: Record<string, string> = {
  features: "#features",
  pricing: "#pricing",
  faq: "#faq",
};

// Centered (single-column) section header.
function SectionHeader({
  eyebrow,
  title,
  subtitle,
  align = "center",
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  align?: "center" | "right";
}) {
  const isCenter = align === "center";
  return (
    <div className={isCenter ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <span className="mb-3 block text-sm font-semibold text-[var(--tq-violet)]">
        {eyebrow}
      </span>
      <h2 className="mb-4 text-balance text-3xl font-medium md:text-4xl">{title}</h2>
      <p className="text-lg leading-relaxed text-muted">{subtitle}</p>
    </div>
  );
}

// Section separators removed (no swiss grid) — sections lean on their own
// vertical padding now. `RULE` kept as an empty string so the section className
// templates below don't each need editing.
const RULE = "";
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

  // Footer: build the column array from dict.landing.footer.groups so titles
  // + link labels are localized. Hrefs for the in-page "links" group come from
  // the stable dict keys (FOOTER_LINK_HREFS); other groups have no nav target.
  const footer = dict.landing.footer.groups;
  const footerGroups: { title: string; links: { label: string; href: string }[] }[] =
    [footer.contact, footer.links, footer.social, footer.legal].map((group) => ({
      title: group.title,
      links: Object.entries(group.links).map(([key, label]) => ({
        label: label as string,
        href: FOOTER_LINK_HREFS[key] ?? "#",
      })),
    }));

  return (
    <SmoothScrollProvider>
    <main className="relative overflow-x-clip">
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
            <div className="animate-marquee-rtl pause-on-hover flex w-max opacity-50 grayscale">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-16 px-8">
                  {TRUSTED_LOGOS.map((logo) => (
                    <span key={logo} className="text-xl font-bold tracking-wide">
                      {logo}
                    </span>
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
            <PricingTiers />
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

        {/* Footer — line separators, no background block. */}
        <footer className={`${RULE} ${PX} pt-20 pb-8`}>
          <div className="mb-12 grid grid-cols-2 gap-8 md:grid-cols-4">
            {footerGroups.map((group) => (
              <div key={group.title} className="md:px-8 md:first:pe-0">
                <h4 className="mb-6 font-medium text-foreground">{group.title}</h4>
                <ul className="space-y-3 text-sm text-muted">
                  {group.links.map((link) => (
                    <li key={link.label}>
                      <a
                        className="transition-colors hover:text-foreground"
                        href={link.href}
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="flex flex-col items-center justify-between pt-8 text-sm text-muted md:flex-row">
            <div className="mb-4 flex items-center gap-2 md:mb-0">
              <ThemeLogo
                width={120}
                height={28}
                className="h-7 w-auto object-contain opacity-80"
              />
            </div>
            <p>
              {dict.landing.footer.copyright.replace(
                "{year}",
                String(new Date().getFullYear()),
              )}
            </p>
          </div>
        </footer>
      </div>
    </main>
    </SmoothScrollProvider>
  );
}
