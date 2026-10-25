// Detect the dominant language of a plain-text string.
//
// Sister helper to `lib/extract/language-pptx.ts` — same heuristic
// (Arabic vs Latin character dominance with a minimum-chars floor
// and a 50% threshold), different input. This one operates on raw
// strings, so it has no JSZip / Node dependency and is safe to
// import from client components.
//
// Why a separate file: importing language-pptx.ts pulls JSZip into
// the client bundle (the module imports it statically at the top).
// Keeping the pure helper here means /mimic's content textarea can
// detect "ar" vs "en" from user input without dragging the PPTX
// extractor into the page chunk.
//
// ─── Use sites ─────────────────────────────────────────────────────
//  • app/mimic/content/page.tsx — when the user provides typed
//    content (no upload), we run the typed string through this on
//    submit so the brief carries `language: "ar"|"en"` and the
//    SlideNavSidebar renders the correct direction from the first
//    frame. Mirrors what extract-source.ts does for the file path
//    via detectPptxLanguage / detectPdfLanguage.
//
// Returns `null` when the signal is too weak. Callers fall back to "ar" — matches the
// default applied elsewhere when extraction is silent on language.
//
// 2026-10-25: delegates to lib/language/detect.ts (script + Latin-language
// ranking). "en" still means "any left-to-right language" here; callers that
// want the real language (French, Turkish ...) use detectLanguage directly.

import { detectLanguage, toLegacyLanguage } from "@/lib/language/detect";

export function detectStringLanguage(text: string): "ar" | "en" | null {
  return toLegacyLanguage(detectLanguage(text));
}
