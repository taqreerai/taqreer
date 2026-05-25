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

// Canonical Google Fonts CSS URL for a family. The deck renderer +
// dom-to-pptx exporter both fetch this URL to bring the font into
// scope. Wght@400;700 matches the SYSTEM_PROMPT typography rule
// ("ONLY two font weights across the deck: 400 and 700").
export function googleFontUrl(family: string): string {
  const encoded = family.replace(/ /g, "+");
  return `https://fonts.googleapis.com/css2?family=${encoded}:wght@400;700&display=swap`;
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
