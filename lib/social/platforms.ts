// Social-media platform -> ratios config (2026 sizes). CLIENT-SAFE (no server
// imports) so the /social picker and any server code share one source of truth.
// Picking a platform lists ITS ratios (with the recommended px shown as a
// label); each ratio maps to a SlideFormat -> SLIDE_DIMENSIONS canonical px the
// deck actually authors + exports at (1080-based). `nameKey` -> dict label.

import type { SlideFormat } from "@/lib/schema/slide";

export const SOCIAL_PLATFORMS = [
  "instagram",
  "facebook",
  "x",
  "linkedin",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

// Human names are Latin brand names in both locales (never localized).
export const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
  linkedin: "LinkedIn",
};

// Material Symbol / icon hint for the platform pill.
export const PLATFORM_ICON: Record<SocialPlatform, string> = {
  instagram: "photo_camera",
  facebook: "thumb_up",
  x: "close",
  linkedin: "work",
};

export type PlatformRatio = {
  // The SlideFormat the deck is generated + exported at. The px shown in the UI
  // is DERIVED from SLIDE_DIMENSIONS[format] (see SocialFormatFields), so the
  // label always matches the actual export size instead of an aspirational
  // platform-recommended size the engine never produces.
  format: SlideFormat;
  // dict key under flows.social.ratios (square|portrait|story|landscape).
  nameKey: "square" | "portrait" | "story" | "landscape";
};

// Per platform, its supported ratios in display order (FIRST = default).
export const PLATFORM_RATIOS: Record<SocialPlatform, PlatformRatio[]> = {
  instagram: [
    { format: "4:5", nameKey: "portrait" },
    { format: "1:1", nameKey: "square" },
    { format: "9:16", nameKey: "story" },
  ],
  facebook: [
    { format: "4:5", nameKey: "portrait" },
    { format: "1:1", nameKey: "square" },
    { format: "9:16", nameKey: "story" },
  ],
  x: [
    { format: "16:9", nameKey: "landscape" },
    { format: "1:1", nameKey: "square" },
    { format: "4:5", nameKey: "portrait" },
  ],
  linkedin: [
    { format: "1:1", nameKey: "square" },
    { format: "4:5", nameKey: "portrait" },
    { format: "16:9", nameKey: "landscape" },
  ],
};

export function ratiosForPlatform(platform: SocialPlatform): PlatformRatio[] {
  return PLATFORM_RATIOS[platform];
}
export function defaultRatioFor(platform: SocialPlatform): PlatformRatio {
  return PLATFORM_RATIOS[platform][0];
}

// Instagram-portrait carousel is the most common default entry point.
export const DEFAULT_PLATFORM: SocialPlatform = "instagram";
