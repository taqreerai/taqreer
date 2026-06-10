"use client";

// Small "مميز" (premium) pill — crown glyph + label on the shared
// .badge-purple token (the same violet chip used for the "احترافي"/Pro
// plan elsewhere). Used on premium template tiles + the template
// lightbox header. `` keeps it legible when it sits
// over a bright thumbnail.

import { useDict } from "@/components/i18n/LocaleProvider";

export function PremiumBadge({ className = "" }: { className?: string }) {
  const dict = useDict();
  return (
    <span
      className={`badge-purple inline-flex items-center gap-1 ${className}`}
    >
      <span
        className="material-symbols-outlined"
        style={{ fontSize: 12 }}
        aria-hidden
      >
        workspace_premium
      </span>
      {dict.common.premium}
    </span>
  );
}
