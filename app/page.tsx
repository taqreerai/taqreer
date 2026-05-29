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
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { Hero } from "@/components/marketing/Hero";
import { ScrollReveal } from "@/components/marketing/ScrollReveal";
import { FeatureFlowCards } from "@/components/marketing/FeatureFlowCards";
import { LandingTemplatesGrid } from "@/components/marketing/LandingTemplatesGrid";
import {
  getMarqueeColumns,
  getLandingTemplates,
} from "@/lib/auth/marquee-projects";
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

type Tier = {
  name: string;
  description: string;
  // `enabled: false` rows render muted — the "this plan doesn't
  // include X" affordance.
  features: { label: string; enabled: boolean }[];
  price: string;
  cadence?: string;
  priceFootnote: string;
  cta: string;
  popular?: boolean;
};

const TIERS: Tier[] = [
  {
    name: "مجاني",
    description: "للتجربة وإنشاء عروض\nبسيطة بسرعة.",
    features: [
      { label: "إنشاء عروض بالذكاء الاصطناعي", enabled: true },
      { label: "إنشاء عروض بالذكاء الاصطناعي", enabled: true },
      { label: "إنشاء عروض بالذكاء الاصطناعي", enabled: true },
      { label: "إنشاء عروض بالذكاء الاصطناعي", enabled: false },
      { label: "إنشاء عروض بالذكاء الاصطناعي", enabled: false },
      { label: "إنشاء عروض بالذكاء الاصطناعي", enabled: false },
    ],
    price: "$0",
    priceFootnote: "يمكنك الترقية في أي وقت",
    cta: "ابدأ مجانًا",
  },
  {
    name: "احترافي",
    description: "للمستخدمين الذين ينشئون\nعروضًا وتقارير بشكل مستمر.",
    features: [
      { label: "إنشاء عروض بالذكاء الاصطناعي", enabled: true },
      { label: "إنشاء عروض بالذكاء الاصطناعي", enabled: true },
      { label: "إنشاء عروض بالذكاء الاصطناعي", enabled: true },
      { label: "إنشاء عروض بالذكاء الاصطناعي", enabled: true },
      { label: "إنشاء عروض بالذكاء الاصطناعي", enabled: true },
      { label: "إنشاء عروض بالذكاء الاصطناعي", enabled: false },
    ],
    price: "$196",
    cadence: "/ شهرياً",
    priceFootnote: "يمكنك ترقية أو تخفيض خطتك في أي وقت",
    cta: "ابدأ مجانًا",
    popular: true,
  },
  {
    name: "شركة",
    description: "للفرق والشركات التي تحتاج إلى تعاون،\nهوية موحدة، ومشاريع أكبر.",
    features: [
      { label: "إنشاء عروض بالذكاء الاصطناعي", enabled: true },
      { label: "إنشاء عروض بالذكاء الاصطناعي", enabled: true },
      { label: "إنشاء عروض بالذكاء الاصطناعي", enabled: true },
      { label: "إنشاء عروض بالذكاء الاصطناعي", enabled: true },
      { label: "إنشاء عروض بالذكاء الاصطناعي", enabled: true },
      { label: "إنشاء عروض بالذكاء الاصطناعي", enabled: true },
    ],
    price: "$499",
    cadence: "/ شهرياً",
    priceFootnote: "تواصل معنا للأسعار المخصصة",
    cta: "تواصل مع المبيعات",
  },
];

// Text-mark logos. Duplicated 6× in the JSX for a seamless marquee loop.
const TRUSTED_LOGOS = ["TED", "Lattice", "NCR", "PACIFIC FUNDS", "Rakuten", "zendesk", "DELL"];

const FOOTER_GROUPS: { title: string; links: string[] }[] = [
  { title: "تواصل", links: ["البريد الإلكتروني", "الدعم الفني", "نموذج التواصل"] },
  { title: "روابط", links: ["المميزات", "الأسعار", "الأسئلة الشائعة"] },
  { title: "التواصل الاجتماعي", links: ["Twitter", "LinkedIn", "Instagram"] },
  { title: "قانوني", links: ["سياسة الخصوصية", "الشروط والأحكام"] },
];

export default async function LandingPage() {
  const supabase = await createClient();
  // `getUser()` round-trips to Supabase for a verified check;
  // `getSession()` reads the cookie only and can be spoofed.
  const [
    { data: { user } },
    projectCount,
    marqueeColumns,
    landingTemplates,
  ] = await Promise.all([
    supabase.auth.getUser(),
    getProjectCount(),
    getMarqueeColumns(),
    getLandingTemplates(),
  ]);

  return (
    <SmoothScrollProvider>
    <main>
      <nav className="header-bg backdrop-blur-glass backdrop-saturate-(--glass-saturation) fixed top-0 left-0 right-0 z-50 border-b border-[var(--tq-border-glass)]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="relative flex h-20 items-center justify-between">
            <a className="flex flex-shrink-0 items-center gap-2" href="#">
              <Image
                src="/logo-light.svg"
                alt="Taqreer Logo"
                width={140}
                height={32}
                className="h-8 w-auto object-contain"
              />
            </a>

            <div className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-8 md:flex">
              <a className="cursor-pointer text-sm text-muted transition-colors hover:text-white" href="#">
                الرئيسية
              </a>
              <a className="cursor-pointer text-sm text-muted transition-colors hover:text-white" href="#features">
                المميزات
              </a>
              <a className="cursor-pointer text-sm text-muted transition-colors hover:text-white" href="#pricing">
                الأسعار
              </a>
              <a className="cursor-pointer text-sm text-muted transition-colors hover:text-white" href="#templates">
                القوالب
              </a>
            </div>

            <div className="hidden items-center gap-3 md:flex">
              {user ? (
                <Link href="/dashboard" className="btn-gradient px-5 py-2 text-xs">
                  لوحة التحكم
                </Link>
              ) : (
                <>
                  <Link href="/login" className="btn-pill px-4 py-2 text-xs">
                    تسجيل الدخول
                  </Link>
                  <Link href="/signup" className="btn-gradient px-5 py-2 text-xs">
                    إنشاء حساب
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

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
              <h2 className="mb-8 text-3xl font-medium md:text-4xl">
                كل ما تحتاجه لإنشاء عرض <br /> تقديمي احترافي
              </h2>
              <p className="mb-8 text-lg text-muted">
                ابدأ من محتوى خام، طوّر عرضًا موجودًا، أو استخدم قالبًا جاهزًا.
                <br />
                تقرير يساعدك في كل مرحلة من مراحل إنشاء العرض.
              </p>
            </div>
          </ScrollReveal>

          {/* Four animated flow cards (2 × 2) + the wide templates
              card, all sharing the same glass chrome (content LEFT,
              visual RIGHT). The templates card's marquee is fed the
              real curator-gated recent-template thumbnails. */}
          <ScrollReveal direction="up" delay={0.1}>
            <FeatureFlowCards thumbnails={marqueeColumns.flat()} />
          </ScrollReveal>

          {/* Templates grid — full-wrapper-width 2 × 4 of public
              template covers, no heading, each scrubbing its slides on
              hover like the dashboard's Recent Projects; a click opens
              the shared TemplateLightbox (user direction 2026-05-29).
              `id="templates"` is the nav "القوالب" anchor; scroll-mt
              clears the fixed h-20 nav bar. */}
          <ScrollReveal direction="up" delay={0.15} className="mt-6">
            <div id="templates" className="scroll-mt-24">
              <LandingTemplatesGrid
                templates={landingTemplates}
                isAuthed={!!user}
              />
            </div>
          </ScrollReveal>
        </div>
      </section>

      <section id="pricing" className="relative py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <ScrollReveal direction="up">
            <div className="mb-16 text-center">
              <h2 className="mb-8 text-3xl font-medium md:text-4xl">
                خطط بسيطة حسب <br /> احتياجك
              </h2>
              <p className="mb-8 text-lg text-muted">
                ابدأ مجانًا، أو اختر خطة شهرية تناسب حجم عروضك وعدد الشرائح التي تحتاجها.
              </p>
            </div>
          </ScrollReveal>

          <div className="mx-auto grid max-w-5xl gap-6 pt-4 md:grid-cols-3">
            {TIERS.map((tier, idx) => (
              <ScrollReveal
                key={tier.name}
                direction={pricingRevealDirection(idx)}
                delay={0.1 * (idx + 1)}
                className={`flex ${tier.popular ? "relative pt-3" : ""}`}
              >
                <PricingCard tier={tier} />
              </ScrollReveal>
            ))}
          </div>
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
                      <a className="transition-colors hover:text-white" href="#">
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

// ─── Local helpers ──────────────────────────────────────────────

// Outer tiers fly in from the side; the middle (popular) tier rises.
// Load-bearing for the pricing-row animation choreography.
function pricingRevealDirection(idx: number): "right" | "left" | "up" {
  switch (idx) {
    case 0:
      return "right";
    case 2:
      return "left";
    default:
      return "up";
  }
}

// Pricing tier card. The popular tier gets a violet glow + the
// .badge-purple "الأكثر شعبية" chip; every tier's CTA stays on
// .btn-gradient.
function PricingCard({ tier }: { tier: Tier }) {
  return (
    <>
      {tier.popular && (
        <div className="badge-purple absolute -top-3 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold">
          الأكثر شعبية
        </div>
      )}
      <div
        className={`plan-banner feature-card-glow relative flex w-full flex-col p-8 transition-colors ${
          tier.popular ? "md:-translate-y-4" : ""
        }`}
        style={
          tier.popular
            ? { boxShadow: "0 0 40px rgba(var(--tq-violet-rgb), 0.20)" }
            : undefined
        }
      >
        <h3 className="mb-4 text-center text-xl font-medium">{tier.name}</h3>
        <p className="mb-8 h-10 whitespace-pre-line text-center text-sm text-muted">
          {tier.description}
        </p>

        <div className="mb-8 flex-grow space-y-4">
          {tier.features.map((feature, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 text-sm ${
                feature.enabled ? "" : "text-muted opacity-60"
              }`}
            >
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: 18,
                  color: feature.enabled ? "var(--tq-violet)" : undefined,
                  opacity: feature.enabled ? 1 : 0.5,
                }}
                aria-hidden
              >
                check
              </span>
              {feature.label}
            </div>
          ))}
        </div>

        <div className="mt-auto text-center">
          <div className="mb-2 flex items-end justify-center gap-1">
            <span className="text-4xl font-bold">{tier.price}</span>
            {tier.cadence && (
              <span className="mb-1 text-muted">{tier.cadence}</span>
            )}
          </div>
          <div className="mb-6 text-xs text-muted">{tier.priceFootnote}</div>
          <Link href="/signup" className="btn-gradient block w-full py-3 text-sm">
            {tier.cta}
          </Link>
        </div>
      </div>
    </>
  );
}
