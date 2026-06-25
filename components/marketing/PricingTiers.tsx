"use client";

// Landing pricing — the monthly/yearly toggle needs client state, so the tiers
// + cards live here (moved out of the server `app/page.tsx`).
//
// Tiers mirror the LOCKED monthly pricing in context/subscriptionmodel.md
// (Free $0 / Plus $15 / Pro $30 / Max $70 - tier names renamed 2026-06-11).
// YEARLY is a ~10%-off placeholder - the model is monthly-only, so confirm
// real annual pricing before launch.

import { useState } from "react";
import Link from "next/link";
import { ScrollReveal } from "@/components/marketing/ScrollReveal";
import { SegmentedToggle } from "@/components/create/controls";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { useIsAuthed } from "@/hooks/useIsAuthed";
import { localizedHref } from "@/lib/i18n/navigation";
import {
  fillPricingTokens,
  tierNumberFor,
  type TierDisplayNumber,
} from "@/lib/credits/pricing-tokens";

type Billing = "monthly" | "yearly";

type Tier = {
  // Non-translatable structure only. Localized text (name, description,
  // features, footnote, cta) comes from dict.landing.pricing.tiers[i] by index.
  // `enabled: false` rows render muted. The features array order here drives the
  // enabled booleans; row 0 maps to dict...tiers[i].credits, rows 1..6 map to
  // dict...tiers[i].features[0..5].
  features: { enabled: boolean }[];
  priceMonthly: string;
  priceYearly: string; // per-month price when billed yearly
  isFree?: boolean; // Free has no cadence / no yearly footnote
  popular?: boolean;
};

const TIERS: Tier[] = [
  {
    features: [
      { enabled: true },
      { enabled: true },
      { enabled: true },
      { enabled: true },
      { enabled: false },
      { enabled: false },
      { enabled: false },
    ],
    priceMonthly: "$0",
    priceYearly: "$0",
    isFree: true,
  },
  {
    features: [
      { enabled: true },
      { enabled: true },
      { enabled: true },
      { enabled: true },
      { enabled: true },
      { enabled: true },
      { enabled: false },
    ],
    priceMonthly: "$15",
    priceYearly: "$13",
  },
  {
    features: [
      { enabled: true },
      { enabled: true },
      { enabled: true },
      { enabled: true },
      { enabled: true },
      { enabled: true },
      { enabled: true },
    ],
    priceMonthly: "$30",
    priceYearly: "$27",
    popular: true,
  },
  {
    features: [
      { enabled: true },
      { enabled: true },
      { enabled: true },
      { enabled: true },
      { enabled: true },
      { enabled: true },
      { enabled: true },
    ],
    priceMonthly: "$70",
    priceYearly: "$63",
  },
];

// Outer tiers fly in from the side; inner tiers rise (4 tiers).
function pricingRevealDirection(idx: number): "right" | "left" | "up" {
  if (idx === 0) return "right";
  if (idx === TIERS.length - 1) return "left";
  return "up";
}

// Tier rows here are positional; map index → plan key for checkout.
const TIER_PLAN_KEYS = ["free", "plus", "pro", "max"] as const;

export function PricingTiers({
  // Live per-tier numbers (free signup grant / paid monthly allotment + slide
  // cap) from the server, filled into the {credits}/{slides} dict tokens so the
  // cards track admin Settings instead of hardcoded literals.
  tierNumbers,
}: {
  tierNumbers: TierDisplayNumber[];
}) {
  const [billing, setBilling] = useState<Billing>("yearly");
  const [busy, setBusy] = useState<string | null>(null);
  const dict = useDict();
  const { dir, locale } = useLocale();
  // Auth resolved client-side (useIsAuthed: cookie-presence check, no Supabase
  // client) so the pages that render this stay static AND light.
  const isAuthed = useIsAuthed();
  const t = dict.landing.pricing;

  // Signed-in pricing CTA → our EMBEDDED checkout page for that tier +
  // cadence (stays on taqreer.ai). Signed-out keeps the /signup link
  // (acquisition). Free tier always routes to signup. Locale-prefixed
  // (CR: bare paths dropped the active language).
  function checkout(planKey: string) {
    if (planKey === "free") {
      window.location.href = localizedHref("/signup", locale);
      return;
    }
    const lookupKey = `tier_${planKey}_${billing}`;
    setBusy(lookupKey);
    window.location.href = `${localizedHref("/checkout", locale)}?price=${lookupKey}`;
  }

  return (
    <>
      {/* Monthly / yearly toggle — the shared white animated SegmentedToggle
          (same control as the dashboard's مشاريعي ⇄ القوالب). The discount lives
          INSIDE the yearly segment's label (user direction). */}
      <div className="mb-12 flex justify-center" dir={dir}>
        <SegmentedToggle<Billing>
          options={[
            { value: "monthly", label: t.monthly },
            {
              value: "yearly",
              label: (
                <>
                  {t.yearly}{" "}
                  {/* Solid blue chip + white text - readable on the
                      active (white) and idle segment in BOTH themes
                      (user direction 2026-06-11). */}
                  <span className="-me-1.5 rounded-full bg-[var(--tq-purple)] px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {t.discount}
                  </span>
                </>
              ),
            },
          ]}
          value={billing}
          onChange={setBilling}
          ariaLabel={t.billingAria}
          size="large"
        />
      </div>

      <div className="mx-auto grid max-w-6xl gap-6 pt-4 md:grid-cols-2 lg:grid-cols-4">
        {TIERS.map((tier, idx) => (
          <ScrollReveal
            key={t.tiers[idx].name}
            direction={pricingRevealDirection(idx)}
            delay={0.1 * (idx + 1)}
            className={`flex ${tier.popular ? "relative" : ""}`}
          >
            <PricingCard
              tier={tier}
              copy={t.tiers[idx]}
              pricing={t}
              billing={billing}
              isAuthed={isAuthed}
              nums={tierNumberFor(tierNumbers, TIER_PLAN_KEYS[idx])}
              busy={busy === `tier_${TIER_PLAN_KEYS[idx]}_${billing}`}
              onCheckout={() => checkout(TIER_PLAN_KEYS[idx])}
            />
          </ScrollReveal>
        ))}
      </div>
    </>
  );
}

type PricingCopy = ReturnType<typeof useDict>["landing"]["pricing"];
type TierCopy = PricingCopy["tiers"][number];

function PricingCard({
  tier,
  copy,
  pricing,
  billing,
  isAuthed,
  nums,
  busy,
  onCheckout,
}: {
  tier: Tier;
  copy: TierCopy;
  pricing: PricingCopy;
  billing: Billing;
  isAuthed: boolean;
  nums?: TierDisplayNumber;
  busy: boolean;
  onCheckout: () => void;
}) {
  const { locale } = useLocale();
  const price = billing === "yearly" ? tier.priceYearly : tier.priceMonthly;
  const footnote =
    billing === "yearly" && !tier.isFree ? pricing.billedYearly : copy.footnote;

  // Row 0 is the credits line; rows 1..6 are copy.features[0..5]. The enabled
  // booleans live on tier.features (structure), the labels come from copy.
  // Fill {credits}/{slides} with the tier's live numbers. credits = the free
  // signup grant or a paid monthly allotment; slides = the per-tier cap.
  const featureLabels = [
    fillPricingTokens(copy.credits, { credits: nums?.credits }),
    ...copy.features.map((f) => fillPricingTokens(f, { slides: nums?.slides })),
  ];

  return (
    // Standard card border (hairline, same as our other cards). Hover = a gentle
    // zoom + slide-up; the popular badge lives INSIDE so it scales WITH the card.
    // No glow / no lift on the popular card (user direction).
    <div className="surface-card relative flex w-full flex-col rounded-2xl p-8 transition-transform duration-300 hover:-translate-y-1 hover:scale-[1.02]">
      {tier.popular && (
        // Same look as the hero's social-proof pill (.hero-stat-pill): a SOLID
        // opaque accent fill (purple in dark / blue in light) with white text +
        // a white dot. Solid so the card's top border never shows through and
        // the "Popular" label stays high-contrast in both themes.
        <div className="hero-stat-pill absolute -top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-medium">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: "#fff" }}
          />
          {pricing.mostPopular}
        </div>
      )}

      <h3 className="mb-4 text-center text-xl font-medium">{copy.name}</h3>
      <p className="mb-8 h-10 whitespace-pre-line text-center text-sm text-muted">
        {copy.description}
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
            {featureLabels[i]}
          </div>
        ))}
      </div>

      <div className="mt-auto text-center">
        <div className="mb-2 flex items-end justify-center gap-1">
          <span className="text-4xl font-bold">{price}</span>
          {!tier.isFree && <span className="mb-1 text-muted">{pricing.perMonth}</span>}
        </div>
        <div className="mb-6 text-xs text-muted">{footnote}</div>
        {/* Signed-in: a paid tier checks out via Stripe; Free + all
            signed-out CTAs go to signup (acquisition). */}
        {isAuthed && !tier.isFree ? (
          <button
            type="button"
            onClick={onCheckout}
            disabled={busy}
            className="btn-gradient block w-full py-3 text-sm disabled:opacity-70"
          >
            {busy ? "…" : copy.cta}
          </button>
        ) : (
          <Link
            href={localizedHref("/signup", locale)}
            className="btn-gradient block w-full py-3 text-sm"
          >
            {copy.cta}
          </Link>
        )}
      </div>
    </div>
  );
}
