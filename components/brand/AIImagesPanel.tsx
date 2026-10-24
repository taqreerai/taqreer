"use client";

// AIImagesPanel — the "Generate images" toggle (create: lives inside the
// content card; social/mimic: in their output/reference cards). An image icon
// in a brand-violet tile on the reading edge, title + one-line subtitle, and
// the Toggle on the far edge. The violet wash + border make it read as a
// feature, not a row of fine print.
//
// Open to every plan since 2026-10-04 (free accounts pay 0 credits per image
// and see a "free on your trial" pill). The gate lives IN this component so all three
// flows inherit it with zero per-flow wiring: a locked user sees a gold crown
// and their enable click opens the UpgradeModal instead of flipping the
// toggle — the Toggle stays controlled by the parent value, so nothing
// flickers. Only ENABLES are gated: a stale-true value (mid-session
// downgrade) can always be turned off. Server backstop: preflightGenerate's
// `images_locked` 402 catches direct POSTs.

import { useState } from "react";
import { Toggle } from "@/components/create/controls";
import { useDict } from "@/components/i18n/LocaleProvider";
import { useCreditBalance } from "@/lib/credits/store";
import { isImagesLocked } from "@/lib/images/images-gating";
import { imagesGateContext } from "@/components/billing/gate-context";
import { UpgradeModal } from "@/components/billing/UpgradeModal";
import { PremiumCrown } from "@/components/billing/PremiumCrown";

export function AIImagesPanel({
  value,
  onChange,
  disabled = false,
  hint = false,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  // The brief asks for pictures: while the switch is off, say what that means.
  hint?: boolean;
}) {
  const dict = useDict();
  const credits = useCreditBalance();
  // Locked only for region-limited free accounts (lib/images/images-gating.ts).
  const locked = isImagesLocked({
    regionLimited: !!credits?.regionPreset,
    isAdmin: credits?.isAdmin ?? false,
  });
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const handleChange = (next: boolean) => {
    if (locked && next) {
      setUpgradeOpen(true);
      return;
    }
    onChange(next);
  };

  return (
    // Row layout (2026-10-04 redesign): matches the settings card's other
    // rows (label on the reading edge, Toggle on the far edge, hairline
    // separators owned by the parent) instead of a tinted feature box.
    <div className="flex items-center gap-3">
      {/* Square icon tile, exactly as tall as the two text lines (2 x 16px
          line + 4px gap = 36px), so title and description sit level with it. */}
      <span
        className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
          value
            ? "bg-[var(--tq-violet)]/15 text-[var(--tq-violet)]"
            : "bg-[var(--tq-overlay-soft)] text-foreground/55"
        }`}
        aria-hidden
      >
        <span className="material-symbols-outlined leading-none" style={{ fontSize: 22 }}>
          image
        </span>
        {/* AI sparkle on the tile's corner: these photos are generated. */}
        <span
          className="material-symbols-outlined absolute -end-1 -top-1 rounded-full bg-[var(--tq-surface)] leading-none text-[var(--tq-violet)]"
          style={{ fontSize: 13, padding: 1 }}
        >
          auto_awesome
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5 text-xs font-semibold leading-4 text-foreground/70">
          {dict.flows.brand.aiImagesTitle}
          {locked ? (
            // Gold crown = paid feature (ExportMenu's affordance).
            <PremiumCrown size={13} />
          ) : null}
        </span>
        <span className="mt-1 block text-[11px] leading-4 text-foreground/50">
          {dict.flows.brand.aiImagesDesc}
        </span>
        {hint && !value && !locked ? (
          <span role="status" className="mt-1 block text-[11px] font-semibold leading-4 text-[var(--tq-violet)]">
            {dict.flows.brand.aiImagesHint}
          </span>
        ) : null}
      </div>
      <div className="shrink-0">
        <Toggle
          ariaLabel={dict.flows.brand.aiImagesTitle}
          value={value}
          onChange={handleChange}
          disabled={disabled}
        />
      </div>
      <UpgradeModal
        open={upgradeOpen}
        gateContext={imagesGateContext(dict)}
        onClose={() => setUpgradeOpen(false)}
      />
    </div>
  );
}
