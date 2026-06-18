"use client";

// ─── Landing feature-flow columns ─────────────────────────────────
//
// The four flows (Create / Enhance / Mimic / Datasheet) as 4 gapped cards that
// match the dashboard's QuickActions — each uses the shared `.qa-card` (rounded
// surface + idle hairline ring + animated mesh ring on hover). RTL: content
// right-aligned, cards flow right→left. Hover plays the AnimatedIcon + tints the
// title violet (the qa-card supplies the ring + slow zoom).
//
// All four cards link to a dedicated SEO spoke (hub→spoke).

import { useRef } from "react";
import Link from "next/link";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";
import { AnimatedIcon } from "@/components/icons/AnimatedIcon";
import type { AnimatedIconHandle } from "@/components/icons/types";

// Icons + spoke hrefs are presentational/routing chrome (not localized copy) —
// kept in source order matching the dictionary's `landing.flowCards`
// (create / enhance / mimic / datasheet).
const FLOW_ICONS = ["add_circle", "auto_fix_high", "content_copy", "dataset"];
const FLOW_HREFS: (string | null)[] = [
  "/ai-presentations", // create
  "/redesign", // enhance
  "/presentation-style", // mimic
  "/report-design", // datasheet
];

export function FeatureFlowCards() {
  const dict = useDict();
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {dict.landing.flowCards.map((card, i) => (
        <FlowColumn
          key={i}
          icon={FLOW_ICONS[i]}
          href={FLOW_HREFS[i]}
          title={card.title}
          description={card.description}
        />
      ))}
    </div>
  );
}

function FlowColumn({
  icon,
  href,
  title,
  description,
}: {
  icon: string;
  href: string | null;
  title: string;
  description: string;
}) {
  const iconRef = useRef<AnimatedIconHandle>(null);
  const { locale } = useLocale();
  const cls = "qa-card group flex flex-col gap-5 p-8";
  const handlers = {
    onMouseEnter: () => iconRef.current?.startAnimation(),
    onMouseLeave: () => iconRef.current?.stopAnimation(),
  };
  const inner = (
    <>
      <div className="w-fit text-[var(--tq-text-muted)] transition-colors group-hover:text-foreground">
        <AnimatedIcon ref={iconRef} name={icon} size={40} strokeWidth={1.5} />
      </div>
      <div>
        <h3 className="mb-2 text-lg font-medium text-foreground transition-colors group-hover:text-[var(--tq-violet)]">
          {title}
        </h3>
        <p className="text-sm leading-relaxed text-muted">{description}</p>
      </div>
    </>
  );
  // Cards with a spoke are links (hub→spoke); a null href would stay a div.
  if (href) {
    return (
      <Link href={localizedHref(href, locale)} className={cls} {...handlers}>
        {inner}
      </Link>
    );
  }
  return (
    <div className={cls} {...handlers}>
      {inner}
    </div>
  );
}
