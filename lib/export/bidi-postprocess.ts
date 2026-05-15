// Post-processes the .pptx Blob produced by dom-to-pptx / PptxGenJS to inject
// explicit BiDi metadata that PowerPoint requires but the library doesn't emit.
//
// Why this exists:
//   Keynote renders the unpatched output correctly — proof that the OOXML
//   structure is valid in principle. PowerPoint is stricter: it needs
//   <a:pPr rtl="1"> on each paragraph that contains strong-RTL text,
//   otherwise it treats the paragraph as LTR and reorders runs visually
//   left-to-right (bug: trailing period jumps to the visual right; %
//   migrates off "12" onto "خلال"; bullets land on the visual left).
//
// What it does:
//   Patches PptxGenJS.prototype.write so that whenever the library writes
//   a Blob, we unzip the in-memory PPTX, walk every <a:p> in every
//   ppt/slides/slideN.xml, and:
//     - if the paragraph's text contains a strong-RTL character →
//       ensure <a:pPr rtl="1" algn="r"/> is set (creating pPr if absent)
//     - otherwise leave it untouched (LTR paragraphs are not affected)
//   Then re-zip and return the modified Blob.
//
// dom-to-pptx calls pptx.write({outputType: 'blob'}) twice (once for an
// internal font-detection pass, once for the final download). Patching
// once handles both calls — idempotent because rtl="1" / algn="r" stay
// set on the second pass.

import type JSZipType from "jszip";

const STRONG_RTL =
  /[֐-׿؀-ۿݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/;
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";

export type BiDiPostprocessStats = {
  invocations: number;
  slidesScanned: number;
  slidesFixed: number;
  paragraphsModified: number;
  runsMerged: number;
  txBodiesFlipped: number;
  langsRetagged: number;
};

function injectBiDiMarkers(xml: string, stats: BiDiPostprocessStats): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");

  if (doc.getElementsByTagName("parsererror").length > 0) {
    // Malformed XML — leave it alone rather than risk corrupting the file.
    return xml;
  }

  // PASS 1: walk every <a:txBody>; if any descendant <a:p> has strong-RTL
  // text, flip its <a:bodyPr rtlCol="1">. PptxGenJS emits rtlCol="0" by
  // default; PowerPoint treats that as a hard LTR-column hint that overrides
  // pPr rtl="1" — that's why slide 4 still rendered LTR even after pass 2
  // added rtl="1" to the paragraph.
  const txBodies = doc.getElementsByTagNameNS(NS_A, "txBody");
  for (let i = 0; i < txBodies.length; i++) {
    const txBody = txBodies[i];
    const ps = txBody.getElementsByTagNameNS(NS_A, "p");
    let bodyIsRtl = false;
    for (let j = 0; j < ps.length; j++) {
      const ts = ps[j].getElementsByTagNameNS(NS_A, "t");
      for (let k = 0; k < ts.length; k++) {
        if (STRONG_RTL.test(ts[k].textContent ?? "")) {
          bodyIsRtl = true;
          break;
        }
      }
      if (bodyIsRtl) break;
    }
    if (!bodyIsRtl) continue;

    let bodyPr = txBody.getElementsByTagNameNS(NS_A, "bodyPr")[0];
    if (!bodyPr) {
      bodyPr = doc.createElementNS(NS_A, "a:bodyPr");
      txBody.insertBefore(bodyPr, txBody.firstChild);
    }
    if (bodyPr.getAttribute("rtlCol") !== "1") {
      bodyPr.setAttribute("rtlCol", "1");
      stats.txBodiesFlipped++;
    }
  }

  // PASS 2: walk every <a:p>; if it contains strong-RTL text, set pPr
  // rtl/algn, merge runs, retag run + endParaRPr lang to ar-SA.
  const paragraphs = doc.getElementsByTagNameNS(NS_A, "p");
  let modified = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];

    // Concatenate every <a:t> descendant to detect paragraph direction.
    const texts = p.getElementsByTagNameNS(NS_A, "t");
    let fullText = "";
    for (let j = 0; j < texts.length; j++) {
      fullText += texts[j].textContent ?? "";
    }
    if (!STRONG_RTL.test(fullText)) continue;

    // pPr (paragraph properties) must be the first child of <a:p> per OOXML.
    let pPr: Element | null = null;
    for (let j = 0; j < p.childNodes.length; j++) {
      const node = p.childNodes[j];
      if (node.nodeType === 1 && (node as Element).localName === "pPr") {
        pPr = node as Element;
        break;
      }
    }
    if (!pPr) {
      pPr = doc.createElementNS(NS_A, "a:pPr");
      p.insertBefore(pPr, p.firstChild);
    }

    let touched = false;
    if (pPr.getAttribute("rtl") !== "1") {
      pPr.setAttribute("rtl", "1");
      touched = true;
    }
    const algn = pPr.getAttribute("algn");
    // "l" is dom-to-pptx's hard-coded list bug; flip to "r". Leave "ctr" /
    // "just" alone — those are deliberate centering/justification.
    if (algn === null || algn === "l") {
      pPr.setAttribute("algn", "r");
      touched = true;
    }
    if (touched) modified++;

    // Merge all <a:r> runs in this paragraph into a single run.
    //
    // Why: dom-to-pptx splits mixed-script content into multiple text runs
    // at every script transition. PowerPoint applies BiDi per run, so
    // neutral characters (·, %, .) resolve against the run boundary instead
    // of their logical neighbor — e.g. "12%" becomes "%12" visually because
    // the % is a separate run that PowerPoint can't merge with the digits.
    // A single run + pPr rtl="1" lets PowerPoint apply UAX-9 across the
    // entire paragraph, which correctly glues neutrals to their logical
    // neighbor and produces the right visual ordering.
    //
    // Tradeoff: we inherit the first run's <a:rPr>, so per-run color/bold/
    // font formatting inside an RTL paragraph is collapsed. Acceptable for
    // our content shape today (Claude emits uniform-style paragraphs); will
    // need a smarter "merge by compatible rPr" pass if that changes.
    const runs: Element[] = [];
    for (let j = 0; j < p.childNodes.length; j++) {
      const node = p.childNodes[j];
      if (node.nodeType === 1 && (node as Element).localName === "r") {
        runs.push(node as Element);
      }
    }
    if (runs.length > 1) {
      let mergedText = "";
      for (const r of runs) {
        const ts = r.getElementsByTagNameNS(NS_A, "t");
        for (let k = 0; k < ts.length; k++) {
          mergedText += ts[k].textContent ?? "";
        }
      }
      const firstRun = runs[0];
      // Replace the first run's <a:t> content with the merged text. If the
      // first run has no <a:t> (shouldn't happen for text content), create one.
      let firstT = firstRun.getElementsByTagNameNS(NS_A, "t")[0];
      if (!firstT) {
        firstT = doc.createElementNS(NS_A, "a:t");
        firstRun.appendChild(firstT);
      }
      firstT.textContent = mergedText;
      // Drop the now-merged tail runs.
      for (let j = runs.length - 1; j >= 1; j--) {
        runs[j].parentNode?.removeChild(runs[j]);
      }
      stats.runsMerged += runs.length - 1;
    }

    // Retag every surviving run's lang to ar-SA. PowerPoint uses lang to
    // pick the BiDi resolver for the run's text — lang="en-US" inside an
    // RTL paragraph causes the LTR resolver to run and produces the
    // "%12 خلال.Q1 2026" jumble. Retagging to ar-SA selects the Arabic
    // resolver. We refetch runs because the merge may have removed some.
    const survivingRuns = p.getElementsByTagNameNS(NS_A, "r");
    for (let j = 0; j < survivingRuns.length; j++) {
      const rPr = survivingRuns[j].getElementsByTagNameNS(NS_A, "rPr")[0];
      if (rPr && rPr.getAttribute("lang") !== "ar-SA") {
        rPr.setAttribute("lang", "ar-SA");
        stats.langsRetagged++;
      }
    }
    // <a:endParaRPr> sets the implicit properties of the paragraph terminator
    // (the cursor position after the text). PowerPoint reads this when the
    // user clicks at the end of the paragraph — also influences how
    // PowerPoint normalises the BiDi state for the paragraph as a whole.
    const endParaRPr = p.getElementsByTagNameNS(NS_A, "endParaRPr")[0];
    if (endParaRPr && endParaRPr.getAttribute("lang") !== "ar-SA") {
      endParaRPr.setAttribute("lang", "ar-SA");
      stats.langsRetagged++;
    }
  }

  stats.paragraphsModified += modified;
  return new XMLSerializer().serializeToString(doc);
}

export async function fixBiDiInPptxBlob(
  blob: Blob,
  JSZip: typeof JSZipType,
  stats: BiDiPostprocessStats
): Promise<Blob> {
  stats.invocations++;

  const buf = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);

  const slidePaths = Object.keys(zip.files).filter((p) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(p)
  );

  for (const path of slidePaths) {
    const file = zip.file(path);
    if (!file) continue;
    stats.slidesScanned++;
    const xml = await file.async("text");
    const fixed = injectBiDiMarkers(xml, stats);
    if (fixed !== xml) {
      stats.slidesFixed++;
      zip.file(path, fixed);
    }
  }

  return await zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
}

/**
 * Triggers a browser download for a Blob with the given filename.
 * Mirrors dom-to-pptx's internal download trigger so the UX is identical.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function makeStats(): BiDiPostprocessStats {
  return {
    invocations: 0,
    slidesScanned: 0,
    slidesFixed: 0,
    paragraphsModified: 0,
    runsMerged: 0,
    txBodiesFlipped: 0,
    langsRetagged: 0,
  };
}
