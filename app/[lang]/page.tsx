// Public landing page (/). Swiss-grid layout: the whole page sits in a centered
// max-w-7xl FRAME with left/right vertical hairlines (border-x); every section
// rule (border-t) and the flows band span that frame width, so all lines meet
// the verticals. Single-column section headers are centered; only the 2-column
// BiDi band is right-aligned. The only page motion left is the hero's own 3D
// demo + the trusted-by marquee.
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

const FOOTER_GROUPS: { title: string; links: string[] }[] = [
  { title: "تواصل", links: ["البريد الإلكتروني", "الدعم الفني", "نموذج التواصل"] },
  { title: "روابط", links: ["المميزات", "الأسعار", "الأسئلة الشائعة"] },
  { title: "التواصل الاجتماعي", links: ["Twitter", "LinkedIn", "Instagram"] },
  { title: "قانوني", links: ["سياسة الخصوصية", "الشروط والأحكام"] },
];

const FOOTER_LINK_HREFS: Record<string, string> = {
  المميزات: "#features",
  الأسعار: "#pricing",
  القوالب: "#templates",
  "الأسئلة الشائعة": "#faq",
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

const RULE = "border-t border-[var(--tq-border-hairline)]";
const PX = "px-4 sm:px-6 lg:px-8";

export default async function LandingPage() {
  const supabase = await createClient();
  const [
    { data: { user } },
    projectCount,
    landingTemplates,
  ] = await Promise.all([
    supabase.auth.getUser(),
    getProjectCount(),
    getLandingTemplates(),
  ]);

  return (
    <SmoothScrollProvider>
    <main>
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
              eyebrow="المميزات"
              title="كل ما تحتاجه لإنشاء عرض تقديمي احترافي"
              subtitle="ابدأ من محتوى خام، طوّر عرضًا موجودًا، حاكِ أسلوب عرضٍ مرجعي، أو حوّل بياناتك — تقرير يساعدك في كل مرحلة."
            />
          </ScrollReveal>
          <ScrollReveal direction="up" className="border-y border-[var(--tq-border-hairline)]">
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
              eyebrow="القوالب"
              title="ابدأ من قالب، ما تراه هو ما تحصل عليه"
              subtitle="استكشف قوالبنا الجاهزة المناسبة لمشروعك دون الاعتماد على توجيه التصميم من الذكاء الاصطناعي."
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
              eyebrow="الأسعار"
              title="خطط بسيطة حسب احتياجك"
              subtitle="ابدأ مجانًا، أو اختر خطة شهرية تناسب حجم عروضك وعدد الشرائح التي تحتاجها."
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
              eyebrow="مساعدة"
              title="الأسئلة الشائعة"
              subtitle="كل ما تريد معرفته عن تقرير قبل أن تبدأ."
            />
          </ScrollReveal>
          <ScrollReveal direction="up">
            <FaqAccordion />
          </ScrollReveal>
        </section>

        {/* Footer — line separators, no background block. */}
        <footer className={`${RULE} ${PX} pt-20 pb-8`}>
          <div className="mb-12 grid grid-cols-2 gap-8 md:grid-cols-4 md:gap-0 md:divide-x md:divide-[var(--tq-border-hairline)]">
            {FOOTER_GROUPS.map((group) => (
              <div key={group.title} className="md:px-8 md:first:pr-0">
                <h4 className="mb-6 font-medium text-white">{group.title}</h4>
                <ul className="space-y-3 text-sm text-muted">
                  {group.links.map((link) => (
                    <li key={link}>
                      <a
                        className="transition-colors hover:text-white"
                        href={FOOTER_LINK_HREFS[link] ?? "#"}
                      >
                        {link}
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
            <p>© {new Date().getFullYear()} taqreer.ai جميع الحقوق محفوظة.</p>
          </div>
        </footer>
      </div>
    </main>
    </SmoothScrollProvider>
  );
}
