"use client";

// Landing pricing — the monthly/yearly toggle needs client state, so the tiers
// + cards live here (moved out of the server `app/page.tsx`).
//
// Tiers mirror the LOCKED monthly pricing in context/subscriptionmodel.md
// (Free $0 / Starter $15 / Plus $30 / Pro $70). YEARLY is a ~10%-off placeholder
// — the model is monthly-only, so confirm real annual pricing before launch.

import { useState } from "react";
import Link from "next/link";
import { ScrollReveal } from "@/components/marketing/ScrollReveal";
import { SegmentedToggle } from "@/components/create/controls";

type Billing = "monthly" | "yearly";

type Tier = {
  name: string;
  description: string;
  // `enabled: false` rows render muted.
  features: { label: string; enabled: boolean }[];
  priceMonthly: string;
  priceYearly: string; // per-month price when billed yearly
  isFree?: boolean; // Free has no cadence / no yearly footnote
  priceFootnote: string;
  cta: string;
  popular?: boolean;
};

const TIERS: Tier[] = [
  {
    name: "مجاني",
    description: "للتجربة وإنشاء عروض\nبسيطة بسرعة.",
    features: [
      { label: "400 رصيد (هدية تسجيل)", enabled: true },
      { label: "نموذج Sonnet", enabled: true },
      { label: "حتى 10 شرائح لكل عرض", enabled: true },
      { label: "صور بأسرع نموذج", enabled: true },
      { label: "تحسين · محاكاة · بيانات", enabled: false },
      { label: "نماذج Opus", enabled: false },
      { label: "القوالب المميزة", enabled: false },
    ],
    priceMonthly: "$0",
    priceYearly: "$0",
    isFree: true,
    priceFootnote: "يمكنك الترقية في أي وقت",
    cta: "ابدأ مجانًا",
  },
  {
    name: "Starter",
    description: "لإنشاء العروض بانتظام\nمع كل طرق الإنشاء.",
    features: [
      { label: "2,000 رصيد شهريًا", enabled: true },
      { label: "كل طرق الإنشاء", enabled: true },
      { label: "نموذج Opus سريع", enabled: true },
      { label: "صور بأحدث نماذج GPT", enabled: true },
      { label: "حتى 30 شريحة لكل عرض", enabled: true },
      { label: "هوية بصرية مخصصة", enabled: true },
      { label: "القوالب المميزة", enabled: false },
    ],
    priceMonthly: "$15",
    priceYearly: "$13",
    priceFootnote: "يمكنك الترقية أو التخفيض في أي وقت",
    cta: "ابدأ الآن",
  },
  {
    name: "Plus",
    description: "للمحترفين الذين يريدون\nأعلى جودة وقوالب مميزة.",
    features: [
      { label: "5,000 رصيد شهريًا", enabled: true },
      { label: "نموذج Opus تفكير", enabled: true },
      { label: "صور بأحدث نماذج GPT", enabled: true },
      { label: "القوالب المميزة", enabled: true },
      { label: "حتى 60 شريحة لكل عرض", enabled: true },
      { label: "هوية بصرية مخصصة", enabled: true },
      { label: "كل طرق الإنشاء", enabled: true },
    ],
    priceMonthly: "$30",
    priceYearly: "$27",
    priceFootnote: "يمكنك الترقية أو التخفيض في أي وقت",
    cta: "ابدأ الآن",
    popular: true,
  },
  {
    name: "Pro",
    description: "للاستخدام المكثّف\nبأقصى سعة وأولوية.",
    features: [
      { label: "12,000 رصيد شهريًا", enabled: true },
      { label: "كل النماذج وكل الطرق", enabled: true },
      { label: "صور بأحدث نماذج GPT", enabled: true },
      { label: "حتى 75 شريحة لكل عرض", enabled: true },
      { label: "القوالب المميزة", enabled: true },
      { label: "هوية بصرية مخصصة", enabled: true },
      { label: "أولوية في المعالجة", enabled: true },
    ],
    priceMonthly: "$70",
    priceYearly: "$63",
    priceFootnote: "تواصل معنا لخطط الفرق المخصصة",
    cta: "ابدأ الآن",
  },
];

// Outer tiers fly in from the side; inner tiers rise (4 tiers).
function pricingRevealDirection(idx: number): "right" | "left" | "up" {
  if (idx === 0) return "right";
  if (idx === TIERS.length - 1) return "left";
  return "up";
}

export function PricingTiers() {
  const [billing, setBilling] = useState<Billing>("monthly");

  return (
    <>
      {/* Monthly / yearly toggle — the shared white animated SegmentedToggle
          (same control as the dashboard's مشاريعي ⇄ القوالب). The discount lives
          INSIDE the yearly segment's label (user direction). */}
      <div className="mb-12 flex justify-center" dir="rtl">
        <SegmentedToggle<Billing>
          options={[
            { value: "monthly", label: "شهري" },
            {
              value: "yearly",
              label: (
                <>
                  سنوي{" "}
                  <span className="text-xs font-normal text-[var(--tq-violet)]">
                    وفّر 10%
                  </span>
                </>
              ),
            },
          ]}
          value={billing}
          onChange={setBilling}
          ariaLabel="دورة الفوترة"
          size="large"
        />
      </div>

      <div className="mx-auto grid max-w-6xl gap-6 pt-4 md:grid-cols-2 lg:grid-cols-4">
        {TIERS.map((tier, idx) => (
          <ScrollReveal
            key={tier.name}
            direction={pricingRevealDirection(idx)}
            delay={0.1 * (idx + 1)}
            className={`flex ${tier.popular ? "relative" : ""}`}
          >
            <PricingCard tier={tier} billing={billing} />
          </ScrollReveal>
        ))}
      </div>
    </>
  );
}

function PricingCard({ tier, billing }: { tier: Tier; billing: Billing }) {
  const price = billing === "yearly" ? tier.priceYearly : tier.priceMonthly;
  const footnote =
    billing === "yearly" && !tier.isFree ? "يُدفع سنويًا" : tier.priceFootnote;

  return (
    // Standard card border (hairline, same as our other cards). Hover = a gentle
    // zoom + slide-up; the popular badge lives INSIDE so it scales WITH the card.
    // No glow / no lift on the popular card (user direction).
    <div className="surface-card relative flex w-full flex-col rounded-2xl p-8 transition-transform duration-300 hover:-translate-y-1 hover:scale-[1.02]">
      {tier.popular && (
        // Same look as the hero's social-proof pill (.hero-stat-pill + dot), but
        // an OPAQUE pre-composited violet-over-bg fill so the card's top border
        // line never shows through it (user direction).
        <div
          className="hero-stat-pill absolute -top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-medium"
          style={{
            backgroundColor: "color-mix(in oklab, var(--tq-violet) 16%, var(--tq-bg))",
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--tq-violet)" }}
          />
          الأكثر شعبية
        </div>
      )}

      <h3 className="mb-4 text-center text-xl font-medium">{tier.name}</h3>
      <p className="mb-8 h-10 whitespace-pre-line text-center text-sm text-muted">
        {tier.description}
      </p>

      <div className="mb-8 flex-grow space-y-4">
        {tier.features.map((feature, i) => (
          <div
            key={i}
            className={`flex items-center gap-2.5 whitespace-nowrap text-[13px] ${
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
          <span className="text-4xl font-bold">{price}</span>
          {!tier.isFree && <span className="mb-1 text-muted">/ شهريًا</span>}
        </div>
        <div className="mb-6 text-xs text-muted">{footnote}</div>
        <Link href="/signup" className="btn-gradient block w-full py-3 text-sm">
          {tier.cta}
        </Link>
      </div>
    </div>
  );
}
