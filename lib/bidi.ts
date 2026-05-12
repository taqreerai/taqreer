// Shared BiDi run-segmenter. Used by both the PPTX export (PptxGenJS array
// text with per-run `rtl` flag) and the web SlideRenderer (HTML <bdi> per
// run). Splitting at every Arabic ↔ non-Arabic transition keeps each script
// segment in its own isolated direction, so the Unicode BiDi algorithm can't
// reorder neutrals (.,:·) or numbers in unexpected ways within a mixed line.
//
//   "السياق • المشكلة" → [
//     { text: "السياق ", rtl: true },
//     { text: "• ",       rtl: false },  // bullet/whitespace clings LTR
//     { text: "المشكلة",  rtl: true },
//   ]
//
// Whitespace clings to whichever run it follows. Pure single-script content
// stays as a single run — no churn for the common case.

const ARABIC_CHAR =
  /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const WHITESPACE_CHAR = /\s/;

export type DirRun = { text: string; rtl: boolean };

export function segmentRuns(content: string): DirRun[] {
  const runs: DirRun[] = [];
  let current = "";
  let currentRtl: boolean | null = null;

  for (const char of content) {
    if (WHITESPACE_CHAR.test(char)) {
      current += char;
      continue;
    }
    const charRtl = ARABIC_CHAR.test(char);
    if (currentRtl === null) {
      currentRtl = charRtl;
      current = char;
      continue;
    }
    if (charRtl === currentRtl) {
      current += char;
    } else {
      runs.push({ text: current, rtl: currentRtl });
      current = char;
      currentRtl = charRtl;
    }
  }
  if (current.length > 0) {
    runs.push({ text: current, rtl: currentRtl ?? true });
  }
  return runs;
}
