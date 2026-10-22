// Rework or Preserve (owner, 2026-10-22): a fixed rule, computed when the file
// is read, that says whether a source deck may be redesigned freely (keep the
// essence, merge thin slides, swap clip-art) or must keep its exact content
// with only the design improved. Content first, good design last: anything the
// rule cannot place stays "preserve", which is how Enhance always worked.
//
// The Enhance page preselects the result and shows the reason; the user can
// flip it. No model call: the same file always gets the same answer.

export type ReworkMode = "rework" | "preserve";

export type ReworkReason =
  | "document" // a DOCX, or a portrait PDF: a document, not a deck
  | "data" // tables / charts carry the content
  | "dense" // long text per slide: the words are the product
  | "scanned" // the slides are screenshots: the words exist only in pictures
  | "decor" // most pictures are template art and decoration
  | "default";

export type ReworkSignals = {
  sourceKind: "pptx" | "pdf" | "docx";
  portrait: boolean;
  slideCount: number;
  // Letters on each slide (text layer only).
  lettersPerSlide: number[];
  // Tables / charts that carry content (a header table repeated on most
  // slides is template chrome and is not counted by the caller).
  tablesAndCharts: number;
  // Slides pasted in as one screenshot each (classifyPptxPictures "capture").
  captureSlides: number;
  // PPTX only: pictures dropped as template art / decoration vs every picture.
  decorPictures: number;
  allPictures: number;
};

export type ReworkDecision = {
  mode: ReworkMode;
  reason: ReworkReason;
  // The measured numbers, for the logs and for tuning.
  stats: { tablesPerSlide: number; lettersPerSlide: number; decorShare: number };
};

const DATA_TABLES_PER_SLIDE = 0.4;
const DENSE_LETTERS_PER_SLIDE = 500;
const DECOR_SHARE = 0.4;
const CAPTURE_SHARE = 0.5;
// Too few pictures to call a deck "mostly decoration".
const DECOR_MIN_PICTURES = 10;

export function decideRework(s: ReworkSignals): ReworkDecision {
  const slides = Math.max(1, s.slideCount);
  const tablesPerSlide = s.tablesAndCharts / slides;
  const letters = s.lettersPerSlide.reduce((a, b) => a + b, 0) / slides;
  const decorShare = s.allPictures > 0 ? s.decorPictures / s.allPictures : 0;
  const stats = {
    tablesPerSlide: Math.round(tablesPerSlide * 100) / 100,
    lettersPerSlide: Math.round(letters),
    decorShare: Math.round(decorShare * 100) / 100,
  };
  const keep = (reason: ReworkReason): ReworkDecision => ({ mode: "preserve", reason, stats });
  if (s.sourceKind === "docx" || s.portrait) return keep("document");
  if (s.captureSlides >= slides * CAPTURE_SHARE) return keep("scanned");
  if (tablesPerSlide >= DATA_TABLES_PER_SLIDE) return keep("data");
  if (letters >= DENSE_LETTERS_PER_SLIDE) return keep("dense");
  if (s.sourceKind === "pptx" && s.allPictures >= DECOR_MIN_PICTURES && decorShare >= DECOR_SHARE) {
    return { mode: "rework", reason: "decor", stats };
  }
  return keep("default");
}
