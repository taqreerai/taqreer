"use client";

// ─── Landing feature-flow columns ─────────────────────────────────
//
// The four flows (Create / Enhance / Mimic / Datasheet) as 4 gapped cards that
// match the dashboard's QuickActions — each uses the shared `.qa-card` (rounded
// surface + idle hairline ring + animated mesh ring on hover). RTL: content
// right-aligned, cards flow right→left. Hover plays the AnimatedIcon + tints the
// title violet (the qa-card supplies the ring + slow zoom).

import { useRef } from "react";
import { useDict } from "@/components/i18n/LocaleProvider";
import { AnimatedIcon } from "@/components/icons/AnimatedIcon";
import type { AnimatedIconHandle } from "@/components/icons/types";

// Icons are presentational chrome (not localized copy) — kept in source order
// matching the dictionary's `landing.flowCards` (create / enhance / mimic /
// datasheet). Titles + descriptions come from the active locale's dictionary.
const FLOW_ICONS = ["add_circle", "auto_fix_high", "content_copy", "dataset"];

export function FeatureFlowCards() {
  const dict = useDict();
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {dict.landing.flowCards.map((card, i) => (
        <FlowColumn
          key={i}
          icon={FLOW_ICONS[i]}
          title={card.title}
          description={card.description}
        />
      ))}
    </div>
  );
}

function FlowColumn({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  const iconRef = useRef<AnimatedIconHandle>(null);
  return (
    <div
      className="qa-card group flex flex-col gap-5 p-8"
      onMouseEnter={() => iconRef.current?.startAnimation()}
      onMouseLeave={() => iconRef.current?.stopAnimation()}
    >
      <div className="w-fit text-[var(--tq-text-muted)] transition-colors group-hover:text-white">
        <AnimatedIcon ref={iconRef} name={icon} size={40} strokeWidth={1.5} />
      </div>
      <div>
        <h3 className="mb-2 text-lg font-medium text-white transition-colors group-hover:text-[var(--tq-violet)]">
          {title}
        </h3>
        <p className="text-sm leading-relaxed text-muted">{description}</p>
      </div>
    </div>
  );
}
