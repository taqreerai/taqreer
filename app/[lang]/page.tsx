// Public landing page (/). Swiss-grid layout: the whole page sits in a centered
// max-w-7xl FRAME with left/right vertical hairlines (border-x), but the
// horizontal section separators span the FULL viewport width (laravel.com
// style) via the `.rule-top` / `.rule-y` utilities — so the horizontals cross
// past the inner verticals out to the screen edges. <main> clips horizontal
// overflow so the 100vw rules never add a scrollbar. Single-column section
// headers are centered; only the 2-column BiDi band is right-aligned. The only
// page motion left is the hero's own 3D demo + the trusted-by marquee.
//
// Lives at `app/page.tsx` (NOT inside a route group) because of a Next 16.2.6 +
// Turbopack route-resolution bug with `(marketing)/page.tsx`.

import Image from "next/image";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { Hero } from "@/components/marketing/Hero";
import { FeatureFlowCards } from "@/components/marketing/FeatureFlowCards";
import { BidiSection } from "@/components/marketing/BidiSection";
import { ScrollReveal } from "@/components/marketing/ScrollReveal";
import { MagneticGlow } from "@/components/app/MagneticGlow";
import { LandingTemplatesGrid } from "@/components/marketing/LandingTemplatesGrid";
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

// Full-bleed top hairline (spans the whole viewport, laravel.com style) even
// though the section sits in the centered max-w-7xl frame. `.rule-y` adds a
// matching bottom line — both defined in globals.css.
const RULE = "rule-top";
const PX = "px-4 sm:px-6 lg:px-8";

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

      {/* FRAME — left/right vertical hairlines wrapping the whole page; every
          horizontal rule below spans this width and meets them. */}
      <div className="relative mx-auto max-w-7xl border-x border-[var(--tq-border-hairline)]">
        <Hero projectCount={projectCount} />

        {/* Trusted-by — animated full-width marquee, no edge fade (the frame
            verticals are the boundary). */}
        <section className={`${RULE} py-8`}>
          <div className="relative w-full overflow-hidden" dir="ltr">
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

        {/* Flows — 4-column backbone band. The band's own border-y is the
            section's bottom separator (so the next section adds no border-t). */}
        <section id="features" className={RULE}>
          <ScrollReveal direction="up" className={`${PX} pt-32 pb-12`}>
            <SectionHeader
              eyebrow={dict.landing.sections.features.eyebrow}
              title={dict.landing.sections.features.title}
              subtitle={dict.landing.sections.features.subtitle}
            />
          </ScrollReveal>
          <ScrollReveal direction="up" className="rule-y">
            <FeatureFlowCards />
          </ScrollReveal>
        </section>

        {/* BiDi band — asymmetric, inline-toggle title. NO border-t: the flows
            band's bottom line is the separator above it. */}
        <section className={`${PX} py-32`}>
          <BidiSection />
        </section>

        {/* Templates */}
        <section id="templates" className={`${RULE} ${PX} py-32`}>
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
        <section id="pricing" className={`${RULE} ${PX} py-32`}>
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

        {/* FAQ — header right-aligned, accordion full-width so its row rules
            meet the frame verticals. */}
        <section id="faq" className={`${RULE} pt-32 pb-32`}>
          <ScrollReveal direction="right" className={`${PX} mb-8`}>
            <SectionHeader
              align="right"
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
          <div className="mb-12 grid grid-cols-2 gap-8 md:grid-cols-4 md:gap-0 md:divide-x md:divide-[var(--tq-border-hairline)]">
            {footerGroups.map((group) => (
              <div key={group.title} className="md:px-8 md:first:pe-0">
                <h4 className="mb-6 font-medium text-white">{group.title}</h4>
                <ul className="space-y-3 text-sm text-muted">
                  {group.links.map((link) => (
                    <li key={link.label}>
                      <a
                        className="transition-colors hover:text-white"
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
          <div className="flex flex-col items-center justify-between border-t border-[var(--tq-border-hairline)] pt-8 text-sm text-muted md:flex-row">
            <div className="mb-4 flex items-center gap-2 md:mb-0">
              <Image
                src="/logo-light.svg"
                alt="Taqreer Logo"
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
