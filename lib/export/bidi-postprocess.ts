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
const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";

/**
 * 7% width slack added to single-line text shapes in PASS 3.
 * Compensates for PowerPoint's slightly-wider glyph metrics versus the
 * browser's. Without this, single-line text that fits in preview wraps to
 * two lines in PPT (the shape's measured cx was browser-measured at
 * exactly the text width).
 */
const SHAPE_WIDTH_SLACK = 0.07;
const MAX_SINGLE_LINE_CHARS = 80;

/**
 * Canonical signature of an <a:rPr> for grouping adjacent runs.
 *
 * Compatibility rule: same signature → same visual formatting → safe to
 * concatenate text into a single run. Different signature → inline style
 * boundary the user authored → keep separate so per-run formatting is
 * preserved.
 *
 * lang is excluded from the signature because we override it to "ar-SA"
 * on every surviving run in RTL paragraphs anyway. dom-to-pptx emits
 * different langs across script-segmented runs that otherwise share the
 * same color/font/size — those SHOULD merge, the lang difference is
 * incidental.
 */
function rPrSignature(rPr: Element | null): string {
  if (!rPr) return "";
  const attrs: Array<[string, string]> = [];
  for (let i = 0; i < rPr.attributes.length; i++) {
    const a = rPr.attributes[i];
    if (a.name === "lang") continue;
    attrs.push([a.name, a.value]);
  }
  attrs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const attrStr = attrs.map(([k, v]) => `${k}=${v}`).join("|");
  const childStrs: string[] = [];
  for (let i = 0; i < rPr.children.length; i++) {
    childStrs.push(rPr.children[i].outerHTML);
  }
  return `${attrStr}#${childStrs.join("|")}`;
}

export type BiDiPostprocessStats = {
  invocations: number;
  slidesScanned: number;
  slidesFixed: number;
  paragraphsModified: number;
  runsMerged: number;
  txBodiesFlipped: number;
  langsRetagged: number;
  ltrParagraphsForced: number;
  shapesWidened: number;
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

  // PASS 2: walk every <a:p> inside the txBodies we flipped in PASS 1.
  // For each paragraph:
  //   - strong-RTL text → set pPr rtl=1/algn=r, smart-merge runs, retag lang
  //   - LTR text in an RTL txBody → set pPr rtl=0 EXPLICITLY (so the
  //     paragraph doesn't inherit RTL from the txBody's rtlCol). Without
  //     this, English-only paragraphs inside an Arabic slide render
  //     visibly reversed.
  const paragraphs = doc.getElementsByTagNameNS(NS_A, "p");
  let modified = 0;

  // Build a set of <a:txBody> elements we marked rtlCol=1 in PASS 1, so we
  // know which paragraphs need the LTR override and which can be left alone.
  const rtlTxBodies = new Set<Element>();
  for (let i = 0; i < txBodies.length; i++) {
    if (txBodies[i].getElementsByTagNameNS(NS_A, "bodyPr")[0]?.getAttribute("rtlCol") === "1") {
      rtlTxBodies.add(txBodies[i]);
    }
  }

  function nearestTxBody(p: Element): Element | null {
    let node: Node | null = p.parentNode;
    while (node) {
      if (node.nodeType === 1 && (node as Element).localName === "txBody") {
        return node as Element;
      }
      node = node.parentNode;
    }
    return null;
  }

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];

    // Concatenate every <a:t> descendant to detect paragraph direction.
    const texts = p.getElementsByTagNameNS(NS_A, "t");
    let fullText = "";
    for (let j = 0; j < texts.length; j++) {
      fullText += texts[j].textContent ?? "";
    }
    const hasStrongRtl = STRONG_RTL.test(fullText);
    const hasText = fullText.trim().length > 0;

    if (!hasStrongRtl) {
      // LTR-by-content paragraph. If it lives inside an RTL txBody, force
      // rtl=0 explicitly so PowerPoint doesn't inherit RTL from the body
      // — AND default algn="r" so an English title in an Arabic deck stays
      // right-aligned (matching slide direction) while still reading LTR
      // within itself. If Claude set an explicit alignment in his HTML
      // (text-align: left/center/justify), dom-to-pptx already wrote it to
      // OOXML and we preserve it.
      if (hasText) {
        const tb = nearestTxBody(p);
        if (tb && rtlTxBodies.has(tb)) {
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
          if (pPr.getAttribute("rtl") !== "0") {
            pPr.setAttribute("rtl", "0");
            stats.ltrParagraphsForced++;
          }
          // Default alignment to "r" when none was emitted by dom-to-pptx.
          // dom-to-pptx writes algn for elements with an explicit
          // text-align CSS; a missing algn means "no explicit alignment"
          // and the slide-direction default is what the user wants.
          if (pPr.getAttribute("algn") === null) {
            pPr.setAttribute("algn", "r");
          }
        }
      }
      continue;
    }

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
    // Bullet detection: a paragraph is a "list item" if its pPr carries
    // an explicit bullet marker (<a:buChar> or <a:buAutoNum>). <a:buNone/>
    // or no bullet element → it's regular prose (headline / body /
    // caption).
    //
    // dom-to-pptx maps CSS text-align:start → algn=l UNCONDITIONALLY
    // (its src/index.js:1084 has no direction awareness). That means
    // every Arabic headline / body that didn't explicitly set
    // text-align:right comes out with algn=l in OOXML, and PowerPoint
    // renders it left-aligned in an RTL deck — visibly wrong.
    //
    // For LISTS, the same algn=l output may be Claude's deliberate
    // left-aligned bullet design — we have to respect it, because the
    // OOXML is identical to the bug case and we can't tell them apart.
    //
    // So the override is split by paragraph type:
    //   - prose (no bullet, or <a:buNone/>): force algn=r when missing
    //     OR when explicitly "l" (fixes the dom-to-pptx start→l bug)
    //   - list item (<a:buChar>/<a:buAutoNum>): only fill algn=r when
    //     missing; respect explicit "l" as Claude's design intent
    let hasBullet = false;
    for (let j = 0; j < pPr.children.length; j++) {
      const c = pPr.children[j];
      if (
        c.namespaceURI === NS_A &&
        (c.localName === "buChar" || c.localName === "buAutoNum")
      ) {
        hasBullet = true;
        break;
      }
    }
    const algn = pPr.getAttribute("algn");
    const shouldForceR = hasBullet ? algn === null : algn === null || algn === "l";
    if (shouldForceR) {
      pPr.setAttribute("algn", "r");
      touched = true;
    }
    if (touched) modified++;

    // Smart-merge <a:r> runs in this paragraph: group adjacent runs by
    // rPr signature (excluding lang), merge each group into one run.
    //
    // Why: dom-to-pptx splits mixed-script content into multiple text runs
    // at every script transition. PowerPoint applies BiDi per run, so
    // neutral characters (·, %, .) resolve against the run boundary instead
    // of their logical neighbor — e.g. "12%" becomes "%12" visually. The
    // script-split runs share the same color/font/size — only lang differs.
    // Merging them lets PowerPoint apply UAX-9 across the merged span and
    // produces the right visual ordering.
    //
    // But: when Claude authors inline-coloured spans for emphasis
    // (e.g. <span style="color:var(--accent)">5 minutes</span>), those
    // produce runs with DIFFERENT solidFill children — same lang, different
    // colour. Those must stay separate so the emphasis colour survives. The
    // signature comparison captures this: same colour/font → merge,
    // different colour → keep separate.
    const allRuns: Element[] = [];
    for (let j = 0; j < p.childNodes.length; j++) {
      const node = p.childNodes[j];
      if (node.nodeType === 1 && (node as Element).localName === "r") {
        allRuns.push(node as Element);
      }
    }
    let cursor = 0;
    while (cursor < allRuns.length) {
      const first = allRuns[cursor];
      const sig = rPrSignature(
        first.getElementsByTagNameNS(NS_A, "rPr")[0] ?? null
      );
      let groupEnd = cursor + 1;
      while (groupEnd < allRuns.length) {
        const nextSig = rPrSignature(
          allRuns[groupEnd].getElementsByTagNameNS(NS_A, "rPr")[0] ?? null
        );
        if (nextSig !== sig) break;
        groupEnd++;
      }
      if (groupEnd - cursor > 1) {
        let mergedText = "";
        for (let k = cursor; k < groupEnd; k++) {
          const ts = allRuns[k].getElementsByTagNameNS(NS_A, "t");
          for (let m = 0; m < ts.length; m++) {
            mergedText += ts[m].textContent ?? "";
          }
        }
        let firstT = first.getElementsByTagNameNS(NS_A, "t")[0];
        if (!firstT) {
          firstT = doc.createElementNS(NS_A, "a:t");
          first.appendChild(firstT);
        }
        firstT.textContent = mergedText;
        for (let k = groupEnd - 1; k > cursor; k--) {
          allRuns[k].parentNode?.removeChild(allRuns[k]);
        }
        stats.runsMerged += groupEnd - cursor - 1;
      }
      cursor = groupEnd;
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

  // PASS 3: widen every single-line text shape by SHAPE_WIDTH_SLACK to
  // absorb PowerPoint's slightly-wider glyph metrics. Without this,
  // single-line text that fits in browser preview wraps to two lines
  // in PPT because dom-to-pptx measured the shape's cx at exactly the
  // browser's text width.
  //
  // "Single-line" heuristic: no <a:br> in any run, and the total <a:t>
  // text length across the shape is below MAX_SINGLE_LINE_CHARS. Body
  // paragraphs above that length are left alone — their height already
  // budgets for multi-line.
  //
  // Growth is centred on the shape's current bounding rect (off.x shifts
  // left by half the slack, cx grows by the slack). This minimises the
  // visual shift for both LTR (algn=l, text anchored to left edge) and
  // RTL (algn=r, text anchored to right edge) — each anchor moves by
  // ≈3.5%, which is below the threshold of design-noticeable.
  const spShapes = doc.getElementsByTagNameNS(NS_P, "sp");
  for (let i = 0; i < spShapes.length; i++) {
    const sp = spShapes[i];

    let spPr: Element | null = null;
    let txBody: Element | null = null;
    for (let j = 0; j < sp.children.length; j++) {
      const c = sp.children[j];
      if (c.namespaceURI === NS_P && c.localName === "spPr") spPr = c;
      else if (c.namespaceURI === NS_P && c.localName === "txBody") txBody = c;
    }
    if (!spPr || !txBody) continue;

    // Single-line test: zero <a:br> AND short total text length.
    if (txBody.getElementsByTagNameNS(NS_A, "br").length > 0) continue;
    const tNodes = txBody.getElementsByTagNameNS(NS_A, "t");
    let totalChars = 0;
    for (let j = 0; j < tNodes.length; j++) {
      totalChars += (tNodes[j].textContent ?? "").length;
    }
    if (totalChars === 0 || totalChars > MAX_SINGLE_LINE_CHARS) continue;

    // Find <a:xfrm><a:ext cx=.../></a:xfrm> directly inside spPr.
    let xfrm: Element | null = null;
    for (let j = 0; j < spPr.children.length; j++) {
      const c = spPr.children[j];
      if (c.namespaceURI === NS_A && c.localName === "xfrm") {
        xfrm = c;
        break;
      }
    }
    if (!xfrm) continue;

    let off: Element | null = null;
    let ext: Element | null = null;
    for (let j = 0; j < xfrm.children.length; j++) {
      const c = xfrm.children[j];
      if (c.namespaceURI === NS_A && c.localName === "off") off = c;
      else if (c.namespaceURI === NS_A && c.localName === "ext") ext = c;
    }
    if (!ext) continue;

    const oldCx = parseInt(ext.getAttribute("cx") ?? "0", 10);
    if (!Number.isFinite(oldCx) || oldCx <= 0) continue;

    const newCx = Math.round(oldCx * (1 + SHAPE_WIDTH_SLACK));
    const slack = newCx - oldCx;
    ext.setAttribute("cx", String(newCx));
    if (off) {
      const oldX = parseInt(off.getAttribute("x") ?? "0", 10);
      if (Number.isFinite(oldX)) {
        off.setAttribute("x", String(oldX - Math.round(slack / 2)));
      }
    }
    stats.shapesWidened++;
  }

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
    ltrParagraphsForced: 0,
    shapesWidened: 0,
  };
}
