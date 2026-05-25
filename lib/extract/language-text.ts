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
// Returns `null` when the signal is too weak (under 10 letters total,
// or no >50% dominance). Callers fall back to "ar" — matches the
// default applied elsewhere when extraction is silent on language.

const ARABIC_RANGE = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
// Basic Latin only — digits and punctuation aren't a language signal
// (a number-heavy paragraph isn't English just because the digits are
// Western). Includes both cases.
const LATIN_RANGE = /[A-Za-z]/;

const MIN_CHARS_FOR_DECISION = 10;
const DOMINANCE_THRESHOLD = 0.5;

export function detectStringLanguage(text: string): "ar" | "en" | null {
  if (!text) return null;
  let arabicCount = 0;
  let latinCount = 0;
  for (const ch of text) {
    if (ARABIC_RANGE.test(ch)) arabicCount++;
    else if (LATIN_RANGE.test(ch)) latinCount++;
  }
  const total = arabicCount + latinCount;
  if (total < MIN_CHARS_FOR_DECISION) return null;
  if (arabicCount / total > DOMINANCE_THRESHOLD) return "ar";
  if (latinCount / total > DOMINANCE_THRESHOLD) return "en";
  return null;
}
