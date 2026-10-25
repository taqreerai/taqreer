// Detect the dominant language of a PPTX file by sampling slide text.
//
// Used by the extract pipeline so the generated brief can carry
// `language: "ar" | "en"` from the start, instead of defaulting to
// `"ar"` and letting DeckView's SlideNavSidebar render right-to-left
// Arabic UI during the entire generation phase even when the source
// deck is English. Without detection, the sidebar flipped LTR
// mid-stream (the moment Claude emitted the manifest's `language`
// field), which was jarring.
//
// ─── Detection strategy ───────────────────────────────────────────
// 1. Open the .pptx zip via JSZip (no extraction to disk).
// 2. Walk the first 3 `ppt/slides/slideN.xml` files in numeric order.
// 3. Pull text from `<a:t>...</a:t>` runs (PPTX text-run XML).
// 4. Count Arabic chars (U+0600–06FF) vs Latin chars (A–Z, a–z).
// 5. If total chars < 10, return null (too little signal).
// 6. Otherwise return whichever family dominates (>50%).
//
// Why first 3 slides only: a long deck's cover + first two content
// slides are enough to lock the language; sampling all slides costs
// more time + memory. If the deck mixes languages, the dominant one
// in the cover wins, which matches what the user will see in the
// preview UI.
//
// PDF inputs aren't covered here — we don't have a zip to walk and
// PDF text extraction would need a separate dep. Returns null on
// any thrown error so the extract pipeline falls through to its
// default (typically "ar").

import JSZip from "jszip";
import { detectLanguage, toLegacyLanguage } from "@/lib/language/detect";

const SAMPLE_SLIDE_LIMIT = 3;

export async function detectPptxLanguage(
  buffer: Buffer,
): Promise<"ar" | "en" | null> {
  try {
    const zip = await JSZip.loadAsync(buffer);

    let sampled = "";

    // Slides are at `ppt/slides/slide1.xml` etc. Numeric-suffix sort
    // so slide1 < slide2 < slide10 — JS string sort would put
    // "slide10" before "slide2" otherwise.
    const slideFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => {
        const numA = Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? "0");
        const numB = Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? "0");
        return numA - numB;
      })
      .slice(0, SAMPLE_SLIDE_LIMIT);

    for (const slideFile of slideFiles) {
      const entry = zip.files[slideFile];
      if (!entry) continue;
      const xml = await entry.async("string");
      // Pull every `<a:t ...>text</a:t>` text-run body. PPTX text
      // can include attributes on <a:t> (e.g. `lang`, `xml:space`)
      // so the open tag matcher is permissive.
      const matches = xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g);
      for (const m of matches) {
        sampled += m[1] + " ";
      }
    }

    return toLegacyLanguage(detectLanguage(sampled));
  } catch {
    return null;
  }
}
