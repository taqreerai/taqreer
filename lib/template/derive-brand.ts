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
  // Min 2 / max 8 — relaxed from 3 (2026-05-25) after observing
  // /enhance-generated decks where Claude declared 6 colors in
  // `theme.palette` but only used 2-3 in the actual slide HTML.
  // Source: enhance reads from PDF/PPTX theme XML which carries
  // Office 2007's full 6-accent palette even when the visual deck
  // only uses 1-2 accents. The palette-intersect logic below
  // (`deriveUsedColors`) strips the ghost entries, sometimes
  // landing on 2 colors. ThemeSchema.palette.min(3) stays at 3
  // for Claude-output validation — this asymmetric relaxation only
  // applies to template storage.
  palette: z.array(HexColor).min(2).max(8),
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

  // ─── Palette intersect (2026-05-25) ────────────────────────────
  // Pre-fix we copied `manifest.theme.palette` verbatim, which on
  // /enhance flows leaked Office 2007's default 6-accent palette
  // (green / mid-blue / red) into templates whose actual slides only
  // used 2-3 brand colors. Now we intersect the declared palette
  // with colors that ACTUALLY appear in slide HTML — keeps Claude's
  // ordering intent, drops ghost entries. Falls back to the declared
  // palette only when the intersect strips below the schema min(2)
  // (defensive — shouldn't happen for a normal deck since the
  // background + at least one accent are always referenced).
  const usedColors = collectColorsFromSlides(manifest);
  // Dedupe by normalized value, keeping first-occurrence order: Claude
  // sometimes declares the same color twice in theme.palette (or as
  // both #FFF and #FFFFFF) - duplicates rendered as repeated swatches
  // and crashed React keying in the preview (2026-06-12).
  const filteredPalette = dedupeHexes(
    manifest.theme.palette.filter((hex) => usedColors.has(normalizeHex(hex))),
  );
  const palette =
    filteredPalette.length >= 2
      ? filteredPalette
      : dedupeHexes(manifest.theme.palette);

  const snapshot: BrandSnapshot = {
    schemaVersion: BRAND_SNAPSHOT_VERSION,
    language,
    direction,
    format,
    palette,
    background: manifest.theme.background,
    text: manifest.theme.text,
    // The deck theme now carries a SINGLE font (2026-06-04 collapse); the
    // BrandSnapshot schema keeps its legacy two-slot shape, so map the one
    // font into both — heading and body are the same family in practice.
    fontHeading: {
      name: manifest.theme.font.name,
      ...(manifest.theme.font.url ? { url: manifest.theme.font.url } : {}),
    },
    fontBody: {
      name: manifest.theme.font.name,
      ...(manifest.theme.font.url ? { url: manifest.theme.font.url } : {}),
    },
  };

  // Final self-check — if our own construction violated the schema
  // (e.g. palette ended up empty after a broken filter), surface as
  // null rather than persisting bad data.
  const verify = BrandSnapshotSchema.safeParse(snapshot);
  return verify.success ? verify.data : null;
}

function isSlideFormat(value: unknown): value is SlideFormat {
  return (
    typeof value === "string" &&
    (SLIDE_FORMATS as readonly string[]).includes(value)
  );
}

// First-occurrence dedupe by normalized hex value - "#FFF" and
// "#FFFFFF" count as the same color; the first spelling wins so
// Claude's ordering intent survives.
function dedupeHexes(hexes: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const hex of hexes) {
    const key = normalizeHex(hex);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hex);
  }
  return out;
}

// Normalize a hex color literal to a canonical lowercase 6-digit form
// so `#FFF`, `#fff`, and `#FFFFFF` all compare equal.
function normalizeHex(hex: string): string {
  const lower = hex.toLowerCase();
  if (lower.length === 4) {
    // #abc → #aabbcc
    return `#${lower[1]}${lower[1]}${lower[2]}${lower[2]}${lower[3]}${lower[3]}`;
  }
  return lower;
}

// Walk every slide's HTML and collect every hex color literal it
// mentions. Returns a Set of normalized lowercase 6-digit hex strings.
// Includes `background` + `text` in the set defensively — slides may
// reference those via CSS vars (which we can't see in the HTML), so
// treating them as "always used" prevents the background or text
// color from being stripped if they happen to appear in `palette`.
function collectColorsFromSlides(manifest: SlideManifest): Set<string> {
  const used = new Set<string>();
  used.add(normalizeHex(manifest.theme.background));
  used.add(normalizeHex(manifest.theme.text));
  // `#abc` (3-digit shorthand) or `#aabbcc` (6-digit full). Skip
  // 4/8-digit alpha hex — vanishingly rare in Claude output and not
  // part of `HexColor`'s validation anyway.
  const hexPattern = /#(?:[0-9a-fA-F]{3}\b|[0-9a-fA-F]{6}\b)/g;
  for (const slide of manifest.slides) {
    if (typeof slide.html !== "string") continue;
    const matches = slide.html.match(hexPattern);
    if (!matches) continue;
    for (const m of matches) {
      used.add(normalizeHex(m));
    }
  }
  return used;
}
