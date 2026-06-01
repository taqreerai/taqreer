// Brand font primitives — shared between /create/brand and /enhance.
//
// Centralizes the Google-Fonts catalog, slot-state shape, sample-text
// constants, and a couple of small utilities. Both flows render the
// same FontUploadSlot + GoogleFontSlot components against this data,
// so there's exactly one place to add a new family or change the
// previewable copy.
//
// Extracted from /create/brand/page.tsx (2026-05-25) when /enhance
// grew its own logo + font cards. Per the "reuse > extend > fork >
// build new" rule.

// ─── Google-Fonts catalog ─────────────────────────────────────────
//
// `arabic` flags whether the family actually carries Arabic glyphs.
// Latin-only families paired with the Arabic sample text produce
// tofu (.notdef) glyphs in the preview, so the slot components swap
// to a Latin sample when this flag is false.
//
// Curated, not exhaustive — Cairo/Tajawal/etc. are the only
// production-ready Arabic webfonts. Latin entries are the ones we
// recommend pairing with them.
export const GOOGLE_FONTS: { family: string; arabic: boolean }[] = [
  { family: "Cairo", arabic: true },
  { family: "Tajawal", arabic: true },
  { family: "Almarai", arabic: true },
  { family: "Noto Sans Arabic", arabic: true },
  { family: "Amiri", arabic: true },
  { family: "Reem Kufi", arabic: true },
  { family: "Markazi Text", arabic: true },
  { family: "IBM Plex Sans Arabic", arabic: true },
  { family: "Inter", arabic: false },
  { family: "Poppins", arabic: false },
  { family: "Roboto", arabic: false },
  { family: "Open Sans", arabic: false },
  { family: "Lato", arabic: false },
  { family: "Montserrat", arabic: false },
  { family: "Space Grotesk", arabic: false },
  { family: "DM Sans", arabic: false },
];

// The full static weight ladder we request for EVERY family. Google's css2
// endpoint silently drops weights a family doesn't carry (Almarai → 300/400/
// 700/800, Amiri → 400/700) and only 400s when ZERO requested weights are
// valid — which never happens for a real font — so one ladder is safe for all
// families with no per-font catalog. The embed parser reads the ACTUAL weight
// off each returned @font-face, so the deck embeds exactly the weights the
// font ships. Tops out at 900 to match WEIGHT_SUFFIX (Cairo's 1000 snaps to
// "Cairo Black" / 900 anyway).
export const FULL_WEIGHT_LADDER = "100;200;300;400;500;600;700;800;900";

// Canonical Google Fonts CSS URL for a family. The deck renderer +
// dom-to-pptx exporter both fetch this URL to bring the font into scope.
// Requests the full weight ladder so any weight Claude reaches for renders
// (preview) and embeds (export); the browser still only downloads the woff2
// for weights actually used on the page.
export function googleFontUrl(family: string): string {
  const encoded = family.replace(/ /g, "+");
  return `https://fonts.googleapis.com/css2?family=${encoded}:wght@${FULL_WEIGHT_LADDER}&display=swap`;
}

// Rewrite a Google css2 URL's simple `:wght@…` axis to the full ladder, so a
// URL that requested only 400;700 (an older brand kit, or Claude's emitted
// URL) still brings in every weight. No-op for non-css2 URLs and for tuple
// `:ital,wght@…` axes (we never emit those). Applied at the manifest source
// so every downstream consumer — preview <link>, export embed, showcase,
// html-doc — inherits the full set with no per-call change.
export function expandWeightAxis<T extends string | null | undefined>(url: T): T {
  if (!url || !url.includes("fonts.googleapis.com/css2")) return url;
  return url.replace(/:wght@[0-9;]+/i, `:wght@${FULL_WEIGHT_LADDER}`) as T;
}

// True for families flagged `arabic: false` in the catalog above.
// Used by the font slot components to pick the right sample text.
export function isLatinOnlyGoogleFont(family: string | null | undefined): boolean {
  if (!family) return false;
  const entry = GOOGLE_FONTS.find((f) => f.family === family);
  return entry !== undefined && entry.arabic === false;
}

// ─── Sample text ──────────────────────────────────────────────────
// Latin-only Google families can't render Arabic — Cairo etc. handle
// both, so default to the Arabic samples and only swap on the Latin
// branch. Uploaded fonts default to Arabic samples (we don't know
// their coverage; brand identity is Arabic-first).
export const HEADING_SAMPLE_AR = "أبجد هوز";
export const HEADING_SAMPLE_LATIN = "Aa Bb Cc";
export const BODY_SAMPLE_AR = "النص الأساسي يُستخدم في فقرات المحتوى.";
export const BODY_SAMPLE_LATIN = "The quick brown fox jumps over the lazy dog.";

// ─── FontSlot state shape ─────────────────────────────────────────
// A single slot can be in either mode at a time. The OTHER mode's
// fields stay populated so a user toggling between modes doesn't
// lose their work — `setFontMode` in /create/brand uses this
// property to flip without wiping state.

export type FontMode = "upload" | "google";

export type FontSlotState = {
  mode: FontMode;
  // Upload mode
  uploadFile: File | null;
  uploadName: string | null;
  uploadStorageUrl: string | null;
  // CSS class name used to scope an @font-face block to this slot's
  // sample preview. The /create/brand page generates these at upload
  // time + injects a <style> tag with the matching @font-face.
  // /enhance currently leaves this empty (no live preview); the
  // family is still applied via fontFamily in the final deck.
  uploadFamily: string;
  // Google Fonts mode
  googleFamily: string | null;
};

// File-extension whitelist used by FontUploadSlot's drag-drop guard.
// Native `<input accept>` filters the OS picker but drag-drop bypasses
// it, so the component re-checks the extension here.
export const FONT_ACCEPT_EXTS = [".woff2", ".woff", ".ttf", ".otf"] as const;

// Initial empty state for a slot. Both flows use this when there's
// no saved data to hydrate from.
export function emptyFontSlot(): FontSlotState {
  return {
    mode: "upload",
    uploadFile: null,
    uploadName: null,
    uploadStorageUrl: null,
    uploadFamily: "",
    googleFamily: null,
  };
}

// ─── Redesigned single brand-font model (flow-card redesign) ──────────
//
// Replaces the old heading + body two-slot model. The brand now carries
// ONE font choice in one of two modes:
//   • google → ONE family; Claude varies weights across the deck (the
//     named-weight embed supports this) and uses it for both headings +
//     body, so there's no second selector.
//   • upload → up to MAX_UPLOADED_FONTS family files dropped at once;
//     Claude decides the pairings. (Real render/embed of uploaded fonts
//     is a separate follow-up; for now the families reach Claude as
//     names + are stored.)

export const MAX_UPLOADED_FONTS = 5;

// One uploaded font family. `file` is the freshly-picked File (client
// only); `storageUrl` is set when hydrated from a saved brand kit (the
// bytes already live in storage). `name` is the display name derived
// from the filename (sans extension).
export type UploadedFontFamily = {
  name: string;
  file: File | null;
  storageUrl: string | null;
};

export type BrandFontMode = "google" | "upload";

export type BrandFontState = {
  mode: BrandFontMode;
  // Google mode — one family name (null = none picked → Claude defaults).
  googleFamily: string | null;
  // Upload mode — ≤ MAX_UPLOADED_FONTS families.
  uploaded: UploadedFontFamily[];
};

export function emptyBrandFont(): BrandFontState {
  return { mode: "google", googleFamily: null, uploaded: [] };
}

// Derive a clean display name from a font filename: strip the extension
// and any trailing weight/style words so "MyBrand-Bold.woff2" reads as
// "MyBrand". Best-effort — the actual family name comes from the file's
// name table at embed time (the follow-up phase).
export function fontFamilyNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.(woff2?|ttf|otf)$/i, "");
  // Drop a trailing "-Bold" / "_Italic" / " Regular" style suffix.
  const cleaned = base
    .replace(
      /[-_ ]+(thin|extralight|light|regular|medium|semibold|bold|extrabold|black|italic|oblique)$/i,
      "",
    )
    .replace(/[-_]+/g, " ")
    .trim();
  return cleaned || base;
}
