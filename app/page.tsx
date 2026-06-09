// Public landing page (/). Hero + trust marquee + features + pricing
// + footer. All surfaces use the dashboard's canonical primitives
// (.glass-card, .plan-banner, .btn-gradient, .btn-pill, .text-muted)
// and reference --tq-violet / --tq-border-glass tokens — see
// globals.css for the design-system vocabulary.
//
// Lives at `app/page.tsx` (NOT inside a route group) because Next.js
// 16.2.6 + Turbopack had a route-resolution bug where
// `(marketing)/page.tsx` would not register as `/`, even after
// fresh cache + restart. Sub-routes of the same group worked fine
// — only the root-of-group page was invisible. Moving the file
// out of the group is the working fix; `SmoothScrollProvider` is
// imported directly here instead of inheriting from the group's
// layout (the old `(marketing)/layout.tsx` only existed to provide
// it).

import Image from "next/image";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { Hero } from "@/components/marketing/Hero";
import { ScrollReveal } from "@/components/marketing/ScrollReveal";
import { BidiExtractionDemo } from "@/components/marketing/BidiExtractionDemo";
import { LandingTemplatesGrid } from "@/components/marketing/LandingTemplatesGrid";
import { MagneticGlow } from "@/components/app/MagneticGlow";
import { PricingTiers } from "@/components/marketing/PricingTiers";
import { FaqAccordion } from "@/components/marketing/FaqAccordion";
import { LandingNav } from "@/components/marketing/LandingNav";
import { getLandingTemplates } from "@/lib/auth/marquee-projects";
import { SmoothScrollProvider } from "@/components/providers";

// Platform-wide "decks created" counter shown in the Hero status chip.
// Cached for 5 min so the landing page doesn't hit Postgres on every
// request — the chip's purpose is social proof, not a live ticker, so
// staleness in the low-single-digits range is fine. Wrapped in
// try/catch so a transient DB error renders 0 instead of crashing the
// whole landing page.
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

// Text-mark logos. Duplicated 6× in the JSX for a seamless marquee loop.
const TRUSTED_LOGOS = ["TED", "Lattice", "NCR", "PACIFIC FUNDS", "Rakuten", "zendesk", "DELL"];

const FOOTER_GROUPS: { title: string; links: string[] }[] = [
  { title: "تواصل", links: ["البريد الإلكتروني", "الدعم الفني", "نموذج التواصل"] },
  { title: "روابط", links: ["المميزات", "الأسعار", "الأسئلة الشائعة"] },
  { title: "التواصل الاجتماعي", links: ["Twitter", "LinkedIn", "Instagram"] },
  { title: "قانوني", links: ["سياسة الخصوصية", "الشروط والأحكام"] },
];

// In-page anchors for the footer link labels that map to a section; anything
// not listed stays a placeholder "#".
const FOOTER_LINK_HREFS: Record<string, string> = {
  المميزات: "#features",
  الأسعار: "#pricing",
  القوالب: "#templates",
  "الأسئلة الشائعة": "#faq",
};

export default async function LandingPage() {
  const supabase = await createClient();
  // `getUser()` round-trips to Supabase for a verified check;
  // `getSession()` reads the cookie only and can be spoofed.
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
      {/* §24: the dashboard's interactive dot field + animated aurora, pinned to
          the viewport (fixed) so it stays as a backdrop while the page scrolls. */}
      <MagneticGlow fixed glowYOffset={0.2} dots={false} />
      <LandingNav isAuthed={!!user} />

      <Hero projectCount={projectCount} />

      <section className="py-32">
        <ScrollReveal direction="up">
          <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
            <h2 className="mb-12 text-3xl font-medium md:text-4xl">موثوق بنا من قبل</h2>
            <div className="mask-edges relative w-full overflow-hidden" dir="ltr">
              <div className="animate-marquee-rtl pause-on-hover flex w-max opacity-60 grayscale transition-all duration-500 hover:grayscale-0">
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
          </div>
        </ScrollReveal>
      </section>

      <section id="features" className="relative py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <ScrollReveal direction="up">
            <div className="mb-16 text-center">
              <span className="mb-3 block text-sm font-semibold text-[var(--tq-violet)]">
                المميزات
              </span>
              <h2 className="mx-auto mb-5 max-w-2xl text-balance text-3xl font-medium md:text-4xl">
                كل ما تحتاجه لإنشاء عرض تقديمي احترافي
              </h2>
              <p className="mx-auto max-w-2xl text-lg text-muted">
                ابدأ من محتوى خام، طوّر عرضًا موجودًا، أو استخدم قالبًا جاهزًا. تقرير يساعدك في كل مرحلة من مراحل إنشاء العرض.
              </p>
            </div>
          </ScrollReveal>

          {/* Interactive BiDi extraction demo (replaces the old 4 flow cards) —
              a slide whose broken Arabic/Latin/number bidi reorders into correct
              RTL when Taqreer's extraction tech is toggled on. Owns its own
              scroll-reveal (no ScrollReveal wrapper). */}
          <BidiExtractionDemo />
        </div>
      </section>

      {/* Templates section — its own band (the spacer the 4-card
          feature grid needed) with a heading + subhead, then the
          full-wrapper-width 2 × 4 grid of public template covers. Tiles
          stay title-less + scrub their slides on hover like the
          dashboard's Recent Projects; a click opens the shared
          TemplateLightbox. `id="templates"` is the nav "القوالب"
          anchor (py-32 top clears the fixed h-20 nav). */}
      <section id="templates" className="relative py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <ScrollReveal direction="up">
            <div className="mb-16 text-center">
              <span className="mb-3 block text-sm font-semibold text-[var(--tq-violet)]">
                القوالب
              </span>
              <h2 className="mx-auto mb-5 max-w-2xl text-balance text-3xl font-medium md:text-4xl">
                ابدأ من قالب، ما تراه هو ما تحصل عليه.
              </h2>
              <p className="mx-auto max-w-2xl text-lg text-muted">
                استكشف قوالبنا الجاهزة المناسبة لمشروعك دون الاعتماد على توجيه التصميم من الذكاء الاصطناعي.
              </p>
            </div>
          </ScrollReveal>

          {/* Full-wrapper-width 2 × 4 grid of public template covers —
              title-less tiles that scrub their slides on hover; a click
              opens the shared TemplateLightbox. The grid owns its own
              per-tile scattered fade-in, so no wrapping ScrollReveal
              here (that would reveal the whole block at once). */}
          <div className="mt-6">
            <LandingTemplatesGrid
              templates={landingTemplates}
              isAuthed={!!user}
            />
          </div>
        </div>
      </section>

      <section id="pricing" className="relative py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <ScrollReveal direction="up">
            <div className="mb-16 text-center">
              <span className="mb-3 block text-sm font-semibold text-[var(--tq-violet)]">
                الأسعار
              </span>
              <h2 className="mx-auto mb-5 max-w-2xl text-balance text-3xl font-medium md:text-4xl">
                خطط بسيطة حسب احتياجك
              </h2>
              <p className="mx-auto max-w-2xl text-lg text-muted">
                ابدأ مجانًا، أو اختر خطة شهرية تناسب حجم عروضك وعدد الشرائح التي تحتاجها.
              </p>
            </div>
          </ScrollReveal>

          {/* Monthly/yearly toggle + the 4 tier cards (client — needs the
              billing-period state). */}
          <PricingTiers />
        </div>
      </section>

      <section id="faq" className="relative py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <ScrollReveal direction="up">
            <div className="mb-16 text-center">
              <span className="mb-3 block text-sm font-semibold text-[var(--tq-violet)]">
                مساعدة
              </span>
              <h2 className="mx-auto mb-5 max-w-2xl text-balance text-3xl font-medium md:text-4xl">
                الأسئلة الشائعة
              </h2>
              <p className="mx-auto max-w-2xl text-lg text-muted">
                كل ما تريد معرفته عن تقرير قبل أن تبدأ.
              </p>
            </div>
          </ScrollReveal>
          <FaqAccordion />
        </div>
      </section>

      <footer className="border-t border-[var(--tq-border-glass)] bg-black/50 pt-20 pb-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-12 grid grid-cols-2 gap-8 md:grid-cols-4">
            {FOOTER_GROUPS.map((group) => (
              <div key={group.title}>
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
          <div className="flex flex-col items-center justify-between border-t border-[var(--tq-border-glass)] pt-8 text-sm text-muted md:flex-row">
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
        </div>
      </footer>
    </main>
    </SmoothScrollProvider>
  );
}
