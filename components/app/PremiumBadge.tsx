"use client";

// Small "مميز" (premium) pill on premium template tiles, the template
// lightbox header and the public template pages. Gold crown + label on a
// dark glass pill (.badge-premium) so it reads over bright thumbnails and
// matches the gold crown used on every other paid option (2026-10-01; was
// a blue .badge-purple chip with a different glyph).

import { useDict } from "@/components/i18n/LocaleProvider";
import { PremiumCrown } from "@/components/billing/PremiumCrown";

export function PremiumBadge({ className = "" }: { className?: string }) {
  const dict = useDict();
  return (
    <span className={`badge-premium ${className}`}>
      <PremiumCrown size={12} />
      {dict.common.premium}
    </span>
  );
}
