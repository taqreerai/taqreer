// Project + manifest → brand snapshot stored on Template.brand.
//
// This is the single source of truth for "what is a template's brand."
// Every downstream consumer (showcase HTML builder, modal preview, future
// "use this template" deck-generate seed) reads BrandSnapshot — never
// the raw manifest or Project columns directly. That keeps Template
// decoupled from Project's schema evolution: if Project.format becomes
// a richer object next quarter, Template.brand keeps the v1 shape it
// was frozen with and old templates keep rendering.
//
// CONTENT-FREE BY CONSTRUCTION. We pull only what's needed to recreate
// the brand's visual identity (palette / fonts / format / direction).
// We deliberately DO NOT carry:
//   • project title / aiPrompt → may contain client names ("Q4 Pitch
//     for Client X") that the template user never authorised to share
//   • logo URL → owned by the user's brand kit, not the project; sharing
//     it via a public template would leak someone else's mark
//   • slide HTML → that's the deck's content, not its brand. The
//     showcase builder generates fresh demo slides from the brand.
//
// schemaVersion is bumped if the shape changes incompatibly so old
// Template rows can be migrated lazily (read → bump → re-write) rather
// than forcing a full SQL migration on a JSON column.

import { z } from "zod";
import {
  SlideManifestSchema,
  SLIDE_FORMATS,
  type SlideFormat,
  type SlideManifest,
} from "@/lib/schema/slide";

export const BRAND_SNAPSHOT_VERSION = 1 as const;

// Mirror of the manifest's FontDefinition but without the strict URL
// refinement — we trust the manifest was validated upstream and store
// the value verbatim. Re-validating here would reject legitimate
// system-font entries (no URL) that the manifest schema allows.
const BrandFont = z.object({
  name: z.string().min(1),
  url: z.string().url().optional(),
});

// Hex color (3 or 6 nybble). Constrains brand color fields to a real
// color format before persistence so arbitrary CSS tokens can't leak
// into Template.brand and later get interpolated into the showcase
// HTML/CSS (renderer-side injection vector). Matches the
// `HexColor` schema in lib/schema/slide.ts.
const HexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);

export const BrandSnapshotSchema = z.object({
  schemaVersion: z.literal(BRAND_SNAPSHOT_VERSION),
  language: z.enum(["ar", "en"]),
  direction: z.enum(["rtl", "ltr"]),
  format: z.enum(SLIDE_FORMATS),
  // Min 3 / max 8 mirrors ThemeSchema.palette — keeps Template.brand
  // a valid input to the renderer if we ever round-trip it back into
  // a manifest seed (Phase D "use this template" flow).
  palette: z.array(HexColor).min(3).max(8),
  background: HexColor,
  text: HexColor,
  fontHeading: BrandFont,
  fontBody: BrandFont,
});

export type BrandSnapshot = z.infer<typeof BrandSnapshotSchema>;

type DeriveInput = {
  // Just the columns we actually read. Caller can pass a fuller Project
  // and the extra fields are ignored — by design, to dissuade dragging
  // private content (title / aiPrompt) into derivation logic later.
  project: {
    language: string;
    format: string;
  };
  // SlideManifest, but accepted as `unknown` so callers don't need
  // to pre-validate. We re-validate here so derive-brand is robust to
  // legacy / partial manifests in the DB.
  manifest: unknown;
};

/**
 * Build a BrandSnapshot from a Project + its latest completed manifest.
 * Returns null when the manifest is invalid or missing required theme
 * fields — caller falls back gracefully (skip save / show error).
 */
export function deriveBrandSnapshot(input: DeriveInput): BrandSnapshot | null {
  const parsed = SlideManifestSchema.safeParse(input.manifest);
  if (!parsed.success) return null;
  const manifest: SlideManifest = parsed.data;

  // language: project column is authoritative because it was set at
  // create time before any manifest existed. Falls back to manifest if
  // the project column is somehow missing (shouldn't happen — it has
  // a default — but defensive).
  const language: "ar" | "en" = input.project.language === "en" ? "en" : "ar";

  // direction: prefer manifest's recorded direction (per-deck decision
  // by Claude or user), fall back to language convention. RTL for ar,
  // LTR for en.
  const direction: "rtl" | "ltr" =
    manifest.direction === "ltr" || manifest.direction === "rtl"
      ? manifest.direction
      : language === "en"
        ? "ltr"
        : "rtl";

  // format: project column wins (set at create time and not changed by
  // regen), fall back to manifest, fall back to 16:9.
  const format: SlideFormat = isSlideFormat(input.project.format)
    ? input.project.format
    : isSlideFormat(manifest.format)
      ? manifest.format
      : "16:9";

  const snapshot: BrandSnapshot = {
    schemaVersion: BRAND_SNAPSHOT_VERSION,
    language,
    direction,
    format,
    palette: [...manifest.theme.palette],
    background: manifest.theme.background,
    text: manifest.theme.text,
    fontHeading: {
      name: manifest.theme.fontHeading.name,
      ...(manifest.theme.fontHeading.url
        ? { url: manifest.theme.fontHeading.url }
        : {}),
    },
    fontBody: {
      name: manifest.theme.fontBody.name,
      ...(manifest.theme.fontBody.url
        ? { url: manifest.theme.fontBody.url }
        : {}),
    },
  };

  // Final self-check — if our own construction violated the schema
  // (e.g. palette had 2 items because the manifest somehow slipped past
  // its own min(3)), surface as null rather than persisting bad data.
  const verify = BrandSnapshotSchema.safeParse(snapshot);
  return verify.success ? verify.data : null;
}

function isSlideFormat(value: unknown): value is SlideFormat {
  return (
    typeof value === "string" &&
    (SLIDE_FORMATS as readonly string[]).includes(value)
  );
}
