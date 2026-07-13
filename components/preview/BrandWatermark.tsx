"use client";

// Free-tier "Designed by taqreer.ai" watermark (user direction
// 2026-07-13). Pins to the canvas fit-rect's bottom end as PARENT-
// DOCUMENT chrome - never inside the editor iframe's <section> - so it
// has no layer row, can't be selected/edited/deleted, is never
// serialized into SlideVersions, and the bake/vision pipeline never
// sees it. Gated on the deck OWNER's plan (load-project
// brandingWatermark); the PNG export route stamps the same badge
// server-side via buildHtmlDocumentServer({ watermark: true }).
//
// Clicking it upsells: the standard UpgradeModal (same one the gated
// export crowns use) with "upgrade and remove all watermarks" context.
// The pill re-enables pointer events on itself only - its host frames
// are pointer-events:none overlays, so editing stays unobstructed.

import { useState } from "react";
import { useDict } from "@/components/i18n/LocaleProvider";
import { UpgradeModal } from "@/components/billing/UpgradeModal";

export function BrandWatermark() {
  const dict = useDict();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setUpgradeOpen(true)}
        // Brand name stays Latin "taqreer.ai" in both locales; the badge
        // copy is a brand mark, not UI copy - deliberately unlocalized
        // (matches the PNG-export badge byte-for-byte).
        className="tq-watermark"
        title={dict.components.creditGate.watermarkTitle}
      >
        Designed by taqreer.ai
      </button>
      <UpgradeModal
        open={upgradeOpen}
        requiredTier="plus"
        gateContext={{
          title: dict.components.creditGate.watermarkTitle,
          body: dict.components.creditGate.watermarkBody,
        }}
        onClose={() => setUpgradeOpen(false)}
      />
    </>
  );
}
