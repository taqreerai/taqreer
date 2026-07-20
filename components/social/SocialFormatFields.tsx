"use client";

// Platform + ratio picker for /social. Pick a platform -> its 2026 ratios list
// (label + px). Mirrors OutputCards' SizeChoice tile visual so it reads like the
// deck slide-size picker. Selecting a platform resets the ratio to its default.

import { useDict } from "@/components/i18n/LocaleProvider";
import { type SlideFormat, SLIDE_DIMENSIONS } from "@/lib/schema/slide";
import {
  SOCIAL_PLATFORMS,
  PLATFORM_LABEL,
  ratiosForPlatform,
  defaultRatioFor,
  type SocialPlatform,
} from "@/lib/social/platforms";

// The px shown per ratio IS the actual export size (SLIDE_DIMENSIONS), so the
// label never promises a size the engine doesn't produce.
function pxLabel(format: SlideFormat): string {
  const d = SLIDE_DIMENSIONS[format];
  return `${d.width} x ${d.height}`;
}

const ASPECT_CSS: Record<SlideFormat, string> = {
  "16:9": "16 / 9",
  "9:16": "9 / 16",
  "3:4": "3 / 4",
  "1:1": "1 / 1",
  "4:5": "4 / 5",
};

export function SocialFormatFields({
  platform,
  onPlatform,
  format,
  onFormat,
}: {
  platform: SocialPlatform;
  onPlatform: (p: SocialPlatform) => void;
  format: SlideFormat;
  onFormat: (f: SlideFormat) => void;
}) {
  const dict = useDict();
  const ratios = ratiosForPlatform(platform);

  const pickPlatform = (p: SocialPlatform) => {
    onPlatform(p);
    onFormat(defaultRatioFor(p).format);
  };

  return (
    <div className="space-y-3">
      {/* Platform pills */}
      <div className="space-y-1.5">
        <span className="block text-xs font-semibold text-foreground/70">
          {dict.flows.social.platform}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {SOCIAL_PLATFORMS.map((p) => {
            const active = p === platform;
            return (
              <button
                key={p}
                type="button"
                onClick={() => pickPlatform(p)}
                aria-pressed={active}
                className={`h-7 rounded-md border px-2.5 text-[11px] font-medium transition-colors ${
                  active
                    ? "border-[var(--tq-blue)] text-[var(--tq-blue)]"
                    : "border-foreground/20 text-foreground/60 hover:border-foreground/40 hover:text-foreground"
                }`}
              >
                {PLATFORM_LABEL[p]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Ratio tiles for the selected platform */}
      <div className="space-y-1.5">
        <span className="block text-xs font-semibold text-foreground/70">
          {dict.flows.social.ratio}
        </span>
        <div className="grid grid-cols-1 gap-2">
          {ratios.map((r) => {
            const active = r.format === format;
            return (
              <button
                key={r.format}
                type="button"
                onClick={() => onFormat(r.format)}
                aria-pressed={active}
                className="flex h-11 items-center justify-between gap-3 rounded-lg border px-3 transition-colors"
                style={{
                  background: "var(--tq-overlay-soft)",
                  borderColor: active
                    ? "var(--tq-blue)"
                    : "var(--tq-border-hairline)",
                }}
              >
                <span className="flex flex-col items-start leading-tight">
                  <span
                    className={`text-xs font-semibold ${active ? "text-[var(--tq-blue)]" : "text-foreground/70"}`}
                  >
                    {dict.flows.social.ratios[r.nameKey]}
                  </span>
                  <span
                    dir="ltr"
                    className={`text-[10px] tabular-nums ${active ? "text-foreground/70" : "text-foreground/40"}`}
                  >
                    {pxLabel(r.format)} · {r.format}
                  </span>
                </span>
                <span
                  className="rounded-xs border border-foreground/30 bg-foreground/10"
                  style={{ height: 22, aspectRatio: ASPECT_CSS[r.format] }}
                />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
