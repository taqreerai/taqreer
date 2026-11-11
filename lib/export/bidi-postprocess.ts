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
import type { GradientIntents } from "./gradient-text";

const STRONG_RTL =
  /[֐-׿؀-ۿݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/;
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";

/**
 * Shape extension applied in PASS 3 to absorb PowerPoint's slightly
 * wider glyph metrics (vs. browser). The extension is direction-aware:
 * it grows the shape on the side OPPOSITE the text anchor, so the
 * anchored side never moves and Claude's slide margins are preserved.
 *
 * Latin glyph drift is ~10 % wider in PowerPoint than the browser; Arabic
 * (especially Cairo / Tajawal) is closer to ~15 %. We keep two slacks so
 * Latin shapes don't get over-extended.
 */
// Latin slack now matches Arabic at 14 % — the original 10 % under-extended
// Latin/numeric runs that happen to be set in an Arabic-targeted font (Cairo,
// Tajawal, etc.). Real example: a "2025" pill set in Cairo wrapped to "202"
// + "5" because Cairo's digit metrics are wider than the browser measured,
// and 10 % growth wasn't enough to keep all four digits on one line. The
// font determines the drift, not the script — so the right value is the
// font-aware one. We use 14 % across the board until we add proper
// font-aware detection.
const SHAPE_WIDTH_SLACK_LATIN = 0.14;
const SHAPE_WIDTH_SLACK_ARABIC = 0.14;
// Absolute minimum growth applied to any short single-line shape. Percentage
// slack alone is useless for tiny pills — a 600 k EMU pill at 14 % grows by
// ~6 px, which doesn't cover the cumulative per-glyph drift across 3-4 chars.
// 100 k EMU ≈ 10.5 px ≈ 1.5 char widths at typical pill sizes — enough to
// keep "الحل" (3 chars) and "2025" (4 chars) on one line. Larger shapes
// already exceed this floor via the percentage so behaviour there is
// unchanged.
const SHAPE_WIDTH_SLACK_MIN_EMU = 100000;
const MAX_SINGLE_LINE_CHARS = 80;
// Slide width in EMU per format. dom-to-pptx defines the PPT layout with
// these exact dimensions (10″ × 5.625″ for 16:9; 5.625″ × 10″ for 9:16),
// so the post-processor's bounds checks must match.
const SLIDE_WIDTH_EMU_BY_FORMAT = {
  "16:9": 9144000,
  "9:16": 5143500,
} as const;
const DEFAULT_SLIDE_WIDTH_EMU = SLIDE_WIDTH_EMU_BY_FORMAT["16:9"];
type PostprocessFormat = keyof typeof SLIDE_WIDTH_EMU_BY_FORMAT;
/**
 * Cap on which shapes get PASS 3 extension. Originally set to 3 M EMU
 * (~33 % slide width) on the assumption only badges / breadcrumbs / chips
 * needed the bump and "wide" shapes were body containers that handle
 * wrapping. That left full-width Arabic headlines (50–70 % slide width)
 * unhelped — they wrap to a second line in PowerPoint because the glyph
 * drift adds up across a long line. Bumped to 7 M EMU (~76 % slide width)
 * to cover headlines too. Anything wider than 76 % is genuinely full-bleed
 * (e.g. a hero quote spanning the slide); no extension needed and the
 * per-side clamp to slide bounds prevents overrun anyway.
 */
const PASS3_MAX_CX = 7000000;



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
  gradientFillsApplied: number;
};

/**
 * Build an <a:gradFill> XML string from a GradientSpec.
 *
 * Common parts:
 *   - Stops are sorted by position. PowerPoint tolerates unordered gsLst,
 *     Keynote does not.
 *   - `rotWithShape="1"` so the gradient rotates with the parent shape.
 *
 * Linear gradients add <a:lin ang="..." scaled="1"/>, where `scaled="1"`
 * means the angle scales with the shape's aspect ratio (45° still reads
 * as 45° regardless of how narrow the word is).
 *
 * Radial gradients add <a:path path="circle"><a:fillToRect ...></a:path>.
 * fillToRect is the focus rectangle in 1000ths of a percent: collapsing
 * it to a single center point (l=t=r=b=50000) gives a center-radiating
 * gradient.
 */
function buildGradFillXml(spec: {
  kind: "linear" | "radial";
  angle?: number;
  stops: Array<{ pos: number; hex: string }>;
}): string {
  const stops = [...spec.stops].sort((a, b) => a.pos - b.pos);
  const gsLst = stops
    .map(
      (s) =>
        `<a:gs pos="${s.pos}"><a:srgbClr val="${s.hex}"/></a:gs>`
    )
    .join("");
  const shadeXml =
    spec.kind === "radial"
      ? `<a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path>`
      : `<a:lin ang="${spec.angle ?? 0}" scaled="1"/>`;
  return (
    `<a:gradFill rotWithShape="1">` +
    `<a:gsLst>${gsLst}</a:gsLst>` +
    shadeXml +
    `</a:gradFill>`
  );
}

// Exported for unit tests (scripts/test-bidi-pills.ts). Per-slide string
// transform; the public entry point is `fixBiDiInPptxBlob`.
export function injectBiDiMarkers(
  xml: string,
  stats: BiDiPostprocessStats,
  gradientIntents?: GradientIntents,
  slideWidthEmu: number = DEFAULT_SLIDE_WIDTH_EMU,
): string {
  const SLIDE_WIDTH_EMU = slideWidthEmu;
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

  // The enclosing <p:sp> (shape) of a paragraph, and whether that shape
  // carries its OWN fill (solidFill / gradFill directly under <p:spPr>) — i.e.
  // it's a styled BOX with text written inside it (a pill / chip), not a plain
  // transparent text frame. dom-to-pptx routes a styled box that has an
  // ASYMMETRIC border (e.g. slide-3's `border-right:5px` green accent) through
  // a composite path that writes the text into the shape and CENTRES it, even
  // though the RTL default is right. Plain text frames (no fill) are emitted
  // as separate right-aligned paragraphs and must be left alone.
  function nearestShape(p: Element): Element | null {
    let node: Node | null = p.parentNode;
    while (node) {
      if (node.nodeType === 1 && (node as Element).localName === "sp") {
        return node as Element;
      }
      node = node.parentNode;
    }
    return null;
  }
  function shapeHasOwnFill(sp: Element): boolean {
    for (let i = 0; i < sp.childNodes.length; i++) {
      const c = sp.childNodes[i];
      if (c.nodeType !== 1 || (c as Element).localName !== "spPr") continue;
      const spPr = c as Element;
      for (let j = 0; j < spPr.childNodes.length; j++) {
        const f = spPr.childNodes[j];
        if (
          f.nodeType === 1 &&
          ((f as Element).localName === "solidFill" ||
            (f as Element).localName === "gradFill")
        ) {
          return true;
        }
      }
      return false; // found the spPr; no fill child
    }
    return false;
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
    // Alignment is now handled UPSTREAM by our patches/dom-to-pptx+1.1.8.patch.
    // The library reads `style.direction` when mapping CSS `text-align: start`
    // and unset values, so RTL paragraphs get algn=r by default and Claude's
    // explicit text-align:left lands as algn=l. The post-processor no longer
    // touches algn — only fills it in when the OOXML emits no value at all
    // (defensive; should not happen with the patched library).
    if (pPr.getAttribute("algn") === null) {
      pPr.setAttribute("algn", "r");
      touched = true;
    }
    // dom-to-pptx composite-border artifact: a styled FILLED shape that has an
    // asymmetric border (e.g. slide-3's white problem-pills with a green
    // `border-right`) has its text written INTO the shape and CENTRED, even
    // though RTL text defaults to right. Plain text frames have no fill and
    // are emitted as separate right-aligned paragraphs (untouched). So: an RTL
    // paragraph centred inside a filled shape is the artifact — force right.
    if (pPr.getAttribute("algn") === "ctr") {
      const sp = nearestShape(p);
      if (sp && shapeHasOwnFill(sp)) {
        pPr.setAttribute("algn", "r");
        touched = true;
      }
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

  // PASS 3: direction-aware shape extension. Grow each short single-line
  // text shape on the side OPPOSITE the text anchor by SHAPE_WIDTH_SLACK_LATIN
  // or SHAPE_WIDTH_SLACK_ARABIC depending on whether the shape's text
  // contains strong-RTL characters (Arabic glyph drift is wider).
  // The anchored side stays fixed (preserving the visual edge Claude
  // designed against the slide margin); the free side extends toward
  // the slide interior, giving the text more room to fit on one line
  // when PowerPoint's glyph metrics measure wider than the browser's.
  //
  // Anchor mapping:
  //   algn="r"  → text anchored right → grow LEFT (off.x decreases, cx grows by same amount)
  //   algn="l"  / "start" / null → anchored left → grow RIGHT (cx grows, off.x stays)
  //   algn="ctr" / "just" → grow BOTH sides equally
  //
  // All growth is clamped to slide bounds: shape will never extend past
  // x=0 (slide left edge) or x=SLIDE_WIDTH_EMU (right edge). For shapes
  // close to a slide edge the growth becomes partial — better than no
  // growth at all, and the visible alignment never shifts.
  //
  // Earlier attempts:
  //   - symmetric 7 % slack: text fit on one line but shape positions
  //     shifted ~3.5 % of width visibly, nudging content past Claude's
  //     margins.
  //   - wrap="none" on shapes with ≤80 char text: shape stayed put but
  //     text overflowed past the shape boundary (and the slide edge for
  //     RTL anchored content).
  // This direction-aware version inherits the room-to-grow benefit
  // without moving the anchored edge.
  //
  // CONTAINMENT GUARD: dom-to-pptx emits a bordered/backgrounded <div>
  // with text inside as a separate outer rect + inner text shape. The
  // inner text shape's cx is the card's INTERIOR width — already wider
  // than the text actually needs. Growing it by 14 % pushes it past the
  // card's visible boundary. So we pre-collect all "container" shapes
  // (visible bg or border, rect / roundRect, reasonable card size) and
  // skip PASS 3 on any text shape strictly enclosed by one. Nested text
  // doesn't need the slack because its container already provides the
  // padding budget; growing it would overflow the card.
  type ContainerBox = { x: number; y: number; cx: number; cy: number };
  const containers: ContainerBox[] = [];
  const spShapes = doc.getElementsByTagNameNS(NS_P, "sp");
  for (let i = 0; i < spShapes.length; i++) {
    const sp = spShapes[i];
    let spPrEl: Element | null = null;
    for (let j = 0; j < sp.children.length; j++) {
      if (sp.children[j].namespaceURI === NS_P && sp.children[j].localName === "spPr") {
        spPrEl = sp.children[j];
        break;
      }
    }
    if (!spPrEl) continue;
    let xfrm: Element | null = null;
    let prstGeom: Element | null = null;
    let solidFillEl: Element | null = null;
    let lnEl: Element | null = null;
    for (let j = 0; j < spPrEl.children.length; j++) {
      const c = spPrEl.children[j];
      if (c.namespaceURI !== NS_A) continue;
      if (c.localName === "xfrm") xfrm = c;
      else if (c.localName === "prstGeom") prstGeom = c;
      else if (c.localName === "solidFill") solidFillEl = c;
      else if (c.localName === "ln") lnEl = c;
    }
    if (!xfrm) continue;
    let offEl: Element | null = null;
    let extEl: Element | null = null;
    for (let j = 0; j < xfrm.children.length; j++) {
      const c = xfrm.children[j];
      if (c.namespaceURI !== NS_A) continue;
      if (c.localName === "off") offEl = c;
      else if (c.localName === "ext") extEl = c;
    }
    if (!extEl) continue;
    const x = offEl ? parseInt(offEl.getAttribute("x") ?? "0", 10) : 0;
    const y = offEl ? parseInt(offEl.getAttribute("y") ?? "0", 10) : 0;
    const cx = parseInt(extEl.getAttribute("cx") ?? "0", 10);
    const cy = parseInt(extEl.getAttribute("cy") ?? "0", 10);
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || cx <= 0 || cy <= 0) continue;
    const prst = prstGeom?.getAttribute("prst") ?? "";
    const hasFill = !!solidFillEl;
    const hasBorder = !!lnEl && (lnEl.getAttribute("w") ?? "0") !== "0";
    const isRectish = prst === "rect" || prst === "roundRect";
    // Card-like size: not full-bleed (excludes slide background panel) and
    // big enough to plausibly contain other shapes. The original cx cap
    // of 0.85 × SLIDE_WIDTH_EMU was tuned for 16:9 — on 9:16 the canvas
    // is narrower (1080px vs 1920px), and full-content-width cards
    // routinely span ~90% of the slide, which would EXCEED 0.85 and
    // disqualify them as containers. We now exclude only TRUE full-bleed
    // shapes: those that ALSO occupy most of the slide height (the
    // canonical slide background panel). A wide-but-short shape (a
    // header strip, a featured horizontal card) stays in the container
    // set.
    const NEAR_FULL_BLEED = 0.95;
    const isFullBleed =
      cx >= Math.round(SLIDE_WIDTH_EMU * NEAR_FULL_BLEED) &&
      cy >= 6_000_000; // ≈ 60 % of the 16:9 slide height, ≈ 65 % of 9:16
    const isCardSize =
      cx > 500000 &&
      cy > 200000 &&
      cy <= 5_500_000 &&
      !isFullBleed;
    if (isRectish && (hasFill || hasBorder) && isCardSize) {
      containers.push({ x, y, cx, cy });
    }
  }

  // Find the smallest container (by area) that strictly encloses the
  // given text-shape bounds. Returns null when no container is found
  // (i.e. the text shape sits directly on the slide). A small edge
  // tolerance absorbs tiny rounding differences in shape positioning.
  const NEST_TOLERANCE = 10000; // ~1 px slack
  function findSmallestEnclosingContainer(
    x: number,
    y: number,
    cx: number,
    cy: number
  ): ContainerBox | null {
    let best: ContainerBox | null = null;
    let bestArea = Infinity;
    for (const c of containers) {
      // Skip the shape that IS this exact container (same bounds).
      if (c.x === x && c.y === y && c.cx === cx && c.cy === cy) continue;
      if (
        c.x - NEST_TOLERANCE <= x &&
        c.x + c.cx + NEST_TOLERANCE >= x + cx &&
        c.y - NEST_TOLERANCE <= y &&
        c.y + c.cy + NEST_TOLERANCE >= y + cy
      ) {
        const area = c.cx * c.cy;
        if (area < bestArea) {
          bestArea = area;
          best = c;
        }
      }
    }
    return best;
  }

  // Width-uniformity map for PASS 3: how many STYLED boxes (own fill/border)
  // share each exact `${x}:${cx}` — i.e. sit in a same-x, same-width vertical
  // stack. A pill that belongs to such a stack (slide-3's problem rows) must
  // keep its authored width: widening only the one whose text happens to be
  // tight shoves it wider than its siblings and breaks the column alignment.
  // Keyed on x AND cx, so a HORIZONTAL row of equal-width chips (same width,
  // different x) is NOT matched and still gets the per-pill widen below.
  const styledStackFreq = new Map<string, number>();
  for (let i = 0; i < spShapes.length; i++) {
    const sp = spShapes[i];
    let spPrEl: Element | null = null;
    for (let j = 0; j < sp.children.length; j++) {
      const c = sp.children[j];
      if (c.namespaceURI === NS_P && c.localName === "spPr") {
        spPrEl = c;
        break;
      }
    }
    if (!spPrEl) continue;
    let styled = false;
    let xfrmEl: Element | null = null;
    for (let j = 0; j < spPrEl.children.length; j++) {
      const c = spPrEl.children[j];
      if (c.namespaceURI !== NS_A) continue;
      if (c.localName === "xfrm") xfrmEl = c;
      else if (c.localName === "solidFill" || c.localName === "gradFill")
        styled = true;
      else if (c.localName === "ln" && (c.getAttribute("w") ?? "0") !== "0")
        styled = true;
    }
    if (!styled || !xfrmEl) continue;
    let sx = 0;
    let scx = 0;
    for (let j = 0; j < xfrmEl.children.length; j++) {
      const c = xfrmEl.children[j];
      if (c.namespaceURI !== NS_A) continue;
      if (c.localName === "off") sx = parseInt(c.getAttribute("x") ?? "0", 10);
      else if (c.localName === "ext")
        scx = parseInt(c.getAttribute("cx") ?? "0", 10);
    }
    if (scx > 0) {
      const k = `${sx}:${scx}`;
      styledStackFreq.set(k, (styledStackFreq.get(k) ?? 0) + 1);
    }
  }

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

    // Own fill or non-zero border → a STYLED box (pill / badge / card).
    // Consumed by the paragraph guard just below AND the slack guard further
    // down (reused there as `isStyledBox`). Computed once.
    let styledBox = false;
    for (let j = 0; j < spPr.children.length; j++) {
      const c = spPr.children[j];
      if (c.namespaceURI !== NS_A) continue;
      if (c.localName === "solidFill" || c.localName === "gradFill") {
        styledBox = true;
        break;
      }
      if (c.localName === "ln" && (c.getAttribute("w") ?? "0") !== "0") {
        styledBox = true;
        break;
      }
    }

    // Paragraph guard. PowerPoint represents line breaks two ways:
    //   (a) <a:br/> inside one <a:p>  — soft break, single paragraph
    //   (b) multiple non-empty <a:p>  — separate paragraphs.
    // A <br/> (a) is skipped entirely. For (b): 3+ paragraphs are never
    // widened, and a 2-paragraph STYLED box (a two-line badge) is skipped too
    // — widening it would push its fill/border off-margin. But a 2-paragraph
    // NON-styled block (a heading + its muted sub-line, slide-2) DOES get the
    // widen, so the heading line doesn't wrap under PowerPoint's wider Cairo
    // rendering. The MAX_SINGLE_LINE_CHARS cap below still excludes body prose.
    if (txBody.getElementsByTagNameNS(NS_A, "br").length > 0) continue;
    const pNodes = txBody.getElementsByTagNameNS(NS_A, "p");
    let nonEmptyParagraphs = 0;
    for (let j = 0; j < pNodes.length; j++) {
      if ((pNodes[j].textContent ?? "").trim().length > 0) {
        nonEmptyParagraphs++;
        if (nonEmptyParagraphs > 2) break;
      }
    }
    if (nonEmptyParagraphs > 2) continue;
    if (nonEmptyParagraphs > 1 && styledBox) continue;
    const tNodes = txBody.getElementsByTagNameNS(NS_A, "t");
    let totalChars = 0;
    let shapeText = "";
    for (let j = 0; j < tNodes.length; j++) {
      const txt = tNodes[j].textContent ?? "";
      totalChars += txt.length;
      shapeText += txt;
    }
    if (totalChars === 0 || totalChars > MAX_SINGLE_LINE_CHARS) continue;
    // Per-shape slack — Arabic glyph drift is wider than Latin, so
    // Arabic-bearing single-line shapes need ~15% extension instead of ~10%.
    const slack = STRONG_RTL.test(shapeText)
      ? SHAPE_WIDTH_SLACK_ARABIC
      : SHAPE_WIDTH_SLACK_LATIN;

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
    // Skip wide shapes — headline / body / paragraph containers. Their
    // text already wraps inside the container as designed; the 10 %
    // extension would push the left edge (RTL) or right edge (LTR) over
    // neighbouring cards and cause visible overlap. See PASS3_MAX_CX.
    if (oldCx > PASS3_MAX_CX) continue;

    // FULL-WIDTH-PILL guard: a STYLED BOX (own fill or border) whose text
    // doesn't come close to filling it has ample slack and needs neither the
    // widen nor the force-centre below — slide-3's full-width problem rows,
    // already right-aligned by PASS 2; leave them. A SHRINK-TO-FIT pill (text
    // fills it — small "Branding"/"Content" chips, filled OR outline) still
    // gets both, or the text wraps in PowerPoint. The discriminator is SLACK,
    // not fill: estimate text width from char-count × font size (deliberately
    // OVER-estimating the glyph advance so shrink-to-fit pills never clear the
    // bar) and bail only when the box interior is much wider than the text.
    const isStyledBox = styledBox; // computed once near the paragraph guard
    if (isStyledBox) {
      // UNIFORM-STACK guard: this pill sits in a same-x, same-width column of
      // styled pills (slide-3's problem rows). Keep every member at the
      // authored width — widening just this one (because its text is tight)
      // would make it wider than its siblings and break the alignment.
      const oldXForStack = off
        ? parseInt(off.getAttribute("x") ?? "0", 10)
        : 0;
      if ((styledStackFreq.get(`${oldXForStack}:${oldCx}`) ?? 0) >= 2) continue;
      const firstRPr = txBody.getElementsByTagNameNS(NS_A, "rPr")[0];
      const sz = firstRPr
        ? parseInt(firstRPr.getAttribute("sz") ?? "1800", 10)
        : 1800;
      const fontEmu = (sz / 100) * 12700; // hundredths-of-pt → EMU
      // ~0.62 em average advance — an OVER-estimate (real Arabic/Latin run
      // ~0.55), so a shrink-to-fit pill (interior ≈ real text width) stays
      // BELOW the 1.6× bar and is never skipped; only a genuinely roomy box
      // (text << interior, e.g. a full-width row) clears it.
      const estTextWidthEmu = totalChars * 0.62 * fontEmu;
      const bodyPr = txBody.getElementsByTagNameNS(NS_A, "bodyPr")[0];
      const lIns = bodyPr
        ? parseInt(bodyPr.getAttribute("lIns") ?? "91440", 10)
        : 91440;
      const rIns = bodyPr
        ? parseInt(bodyPr.getAttribute("rIns") ?? "91440", 10)
        : 91440;
      const interior = oldCx - lIns - rIns;
      if (interior > estTextWidthEmu * 1.6) continue;
    }
    const oldX = off ? parseInt(off.getAttribute("x") ?? "0", 10) : 0;
    const oldY = off ? parseInt(off.getAttribute("y") ?? "0", 10) : 0;
    const oldCy = parseInt(ext.getAttribute("cy") ?? "0", 10);

    // Containment-aware clamp: if this text shape is enclosed by a
    // container (card with visible bg/border), the growth on each side
    // is capped at the gap between the text shape's edge and the
    // container's interior edge — i.e. the CSS padding of the card on
    // that side. Reaching that limit means the shape grew right up to
    // the visible border without overshooting it. Without this, PASS 3
    // would widen a text shape that already fills a card's interior past
    // the card's bounds (the "Create a 10-slide investor deck..." case).
    // For top-level text (no container), the limit collapses to the
    // slide bounds — preserving the original behaviour.
    const enclosing = findSmallestEnclosingContainer(oldX, oldY, oldCx, oldCy);

    // ASPECT-RATIO GUARD: near-square shapes are numbered badges /
    // avatars / icon containers / single-glyph chips. They have full
    // border-radius and render as visual circles. PASS 3 only grows
    // cx (never cy), so applying slack here turns the circle into an
    // oval. Skip them entirely — drift on 1-2 character content is
    // tiny in absolute terms and these shapes are already sized
    // comfortably for what they hold. The 0.85..1.18 window covers
    // natural circle shapes with a small tolerance for rounding noise
    // out of dom-to-pptx.
    //
    // GATE: only apply on TOP-LEVEL text (no container around it).
    // Text enclosed by a card / panel is body content like "01" / "02"
    // numbered headings — looks square because of line-height:1 + few
    // characters, but it's NOT a chip / badge / circle. Skipping
    // extension on these caused the "card numbers wrap to 2 lines in
    // PowerPoint" bug because Cairo Bold digits drift wider than the
    // browser-measured shape width. When enclosed, the interior slack
    // we computed above is what protects us from overgrowing.
    if (!enclosing && oldCy > 0) {
      const aspectRatio = oldCx / oldCy;
      if (aspectRatio > 0.85 && aspectRatio < 1.18) continue;
    }
    const leftLimit = enclosing ? enclosing.x : 0;
    const rightLimit = enclosing ? enclosing.x + enclosing.cx : SLIDE_WIDTH_EMU;
    const availableLeft = Math.max(0, oldX - leftLimit);
    const availableRight = Math.max(0, rightLimit - (oldX + oldCx));

    // Detect alignment from the first paragraph in the shape.
    const firstP = txBody.getElementsByTagNameNS(NS_A, "p")[0];
    const firstPPr = firstP
      ? firstP.getElementsByTagNameNS(NS_A, "pPr")[0] ?? null
      : null;
    let algn = firstPPr ? firstPPr.getAttribute("algn") : null;

    // STYLED-BOX (pill) HORIZONTAL CENTER: a browser shrink-to-fits
    // an inline-block pill to exactly text_width + padding so the
    // text APPEARS centered. dom-to-pptx writes `algn="l"` for LTR
    // pills and `algn="r"` for RTL pills (both inherited from the
    // slide direction when `text-align` wasn't set on the element).
    // PASS 3 then grows the shape by ~14 % slack to absorb glyph
    // drift, but the text stays anchored to its original edge:
    //   • LTR pill: shape grows right → text flush-left → empty room
    //     on the right of the text.
    //   • RTL pill: shape grows left  → text flush-right → empty
    //     room on the left of the text.
    // Either way the pill no longer reads as centered.
    //
    // Fix: for shapes that paint their own fill or border on the
    // SAME element as the text (i.e. pills, not nested text inside
    // a card with parent-only chrome), force `algn="ctr"` before the
    // slack growth runs. The discriminator naturally excludes cards
    // (their bg/border lives on the parent container; the inner text
    // shape has no own fill/border).
    //
    // `algn="just"` is preserved (designer intent — though it's a
    // no-op on single-line text anyway).
    let _hasOwnFill = false;
    let _hasOwnBorder = false;
    for (let j = 0; j < spPr.children.length; j++) {
      const c = spPr.children[j];
      if (c.namespaceURI !== NS_A) continue;
      if (c.localName === "solidFill" || c.localName === "gradFill") {
        _hasOwnFill = true;
      } else if (c.localName === "ln") {
        const w = c.getAttribute("w") ?? "0";
        if (w !== "0") _hasOwnBorder = true;
      }
    }
    if (
      (_hasOwnFill || _hasOwnBorder) &&
      algn !== "ctr" &&
      algn !== "just" &&
      firstP
    ) {
      let pPrEl = firstP.getElementsByTagNameNS(NS_A, "pPr")[0] ?? null;
      if (!pPrEl) {
        pPrEl = doc.createElementNS(NS_A, "a:pPr");
        firstP.insertBefore(pPrEl, firstP.firstChild);
      }
      pPrEl.setAttribute("algn", "ctr");
      algn = "ctr";
    }

    const desiredGrowth = Math.max(
      Math.round(oldCx * slack),
      SHAPE_WIDTH_SLACK_MIN_EMU
    );
    let newOffX = oldX;
    let newCx = oldCx;

    if (algn === "r") {
      // Anchored right; grow LEFT toward containing edge (clamped).
      const leftGrowth = Math.min(desiredGrowth, availableLeft);
      newOffX = oldX - leftGrowth;
      newCx = oldCx + leftGrowth;
    } else if (algn === "ctr" || algn === "just") {
      // Centered; grow both sides equally up to each side's room.
      const halfGrowth = Math.round(desiredGrowth / 2);
      const leftGrowth = Math.min(halfGrowth, availableLeft);
      const rightGrowth = Math.min(halfGrowth, availableRight);
      newOffX = oldX - leftGrowth;
      newCx = oldCx + leftGrowth + rightGrowth;
    } else {
      // Anchored left (algn=l, start, or unset); grow RIGHT.
      const rightGrowth = Math.min(desiredGrowth, availableRight);
      newCx = oldCx + rightGrowth;
    }

    if (newCx !== oldCx) {
      ext.setAttribute("cx", String(newCx));
      if (off && newOffX !== oldX) {
        off.setAttribute("x", String(newOffX));
      }
      stats.shapesWidened++;
    }
  }

  // PASS 3.5: pill-row overlap resolution + direction-aware anchor.
  //
  // After PASS 3 widens pills (~14 % each), pills in a flex row may
  // overlap visibly because the CSS gap (typically 16 px) is smaller
  // than the combined growth. PASS 3 already produced the correct
  // widths to fit text on one line — we just need to shift overlapping
  // pills apart so they don't touch.
  //
  // Strategy:
  //   1. Detect rows of pill-like shapes via vertical-overlap clustering.
  //   2. Determine each row's ANCHOR by majority-voting on per-pill algn:
  //      "r" → preserve rightmost pill's right edge (Claude's RTL
  //      design anchor); "l" → preserve leftmost left edge; "ctr"
  //      → preserve original row center.
  //   3. Walk left-to-right and push overlapping pills rightward to
  //      maintain a small visible gap.
  //   4. Shift the entire row so the post-resolve anchor position
  //      matches the pre-resolve anchor position — without this, the
  //      row drifts past Claude's designed slide margin.
  //   5. Final clamp to slide bounds with a small buffer to catch
  //      truly egregious rows.
  // Widths are NEVER changed here — only positions. Solo pills are
  // untouched.
  {
    const PILL_MIN_GAP_EMU = 40000; // ~8 px visible gap after shift
    const SLIDE_EDGE_MARGIN_EMU = 285000; // ~60 px buffer from slide edges
    const PILL_MAX_HEIGHT_EMU = 600000; // exclude cards / heroes (>~126 px)
    // A row's distance from the slide edge (in EMU). If the rightmost
    // pill's right edge is within this many EMU of the slide's right
    // edge, the row is treated as right-anchored (Claude designed it
    // flush with the right margin). Same for left. 1.2 M EMU ≈ 250 px
    // ≈ comfortable headroom past typical 80-120 px slide margins.
    const PILL_ROW_MARGIN_PROXIMITY_EMU = 1200000;

    type RowShape = {
      off: Element | null;
      x: number;
      y: number;
      cx: number;
      cy: number;
    };

    // Collect pill-like shapes. A pill = bordered or filled box with
    // small height and wider-than-tall aspect (excludes circles).
    const pillShapes: RowShape[] = [];
    for (let i = 0; i < spShapes.length; i++) {
      const sp = spShapes[i];
      let spPrEl: Element | null = null;
      let hasTxBody = false;
      for (let j = 0; j < sp.children.length; j++) {
        const c = sp.children[j];
        if (c.namespaceURI === NS_P && c.localName === "spPr") spPrEl = c;
        else if (c.namespaceURI === NS_P && c.localName === "txBody")
          hasTxBody = true;
      }
      if (!spPrEl || !hasTxBody) continue;

      let xfrmEl: Element | null = null;
      let solidFillEl: Element | null = null;
      let lnEl: Element | null = null;
      for (let j = 0; j < spPrEl.children.length; j++) {
        const c = spPrEl.children[j];
        if (c.namespaceURI !== NS_A) continue;
        if (c.localName === "xfrm") xfrmEl = c;
        else if (c.localName === "solidFill") solidFillEl = c;
        else if (c.localName === "ln") lnEl = c;
      }
      if (!xfrmEl) continue;

      let offEl: Element | null = null;
      let extEl: Element | null = null;
      for (let j = 0; j < xfrmEl.children.length; j++) {
        const c = xfrmEl.children[j];
        if (c.namespaceURI !== NS_A) continue;
        if (c.localName === "off") offEl = c;
        else if (c.localName === "ext") extEl = c;
      }
      if (!extEl) continue;

      const xR = offEl ? parseInt(offEl.getAttribute("x") ?? "0", 10) : 0;
      const yR = offEl ? parseInt(offEl.getAttribute("y") ?? "0", 10) : 0;
      const cxR = parseInt(extEl.getAttribute("cx") ?? "0", 10);
      const cyR = parseInt(extEl.getAttribute("cy") ?? "0", 10);
      if (
        !Number.isFinite(cxR) ||
        cxR <= 0 ||
        !Number.isFinite(cyR) ||
        cyR <= 0
      )
        continue;

      // Pill filter: short height, has visible fill OR border, wider
      // than tall (skip circles / numbered badges).
      if (cyR > PILL_MAX_HEIGHT_EMU) continue;
      if (cxR / cyR < 1.15) continue;
      const hasFill = !!solidFillEl;
      const hasBorder = !!lnEl && (lnEl.getAttribute("w") ?? "0") !== "0";
      if (!hasFill && !hasBorder) continue;

      pillShapes.push({ off: offEl, x: xR, y: yR, cx: cxR, cy: cyR });
    }

    // Cluster into rows by vertical overlap (>50 % of the shorter pill).
    // Iterate to a fixed point so a chain of pills connects transitively.
    const visited = new Set<number>();
    const rows: RowShape[][] = [];
    for (let i = 0; i < pillShapes.length; i++) {
      if (visited.has(i)) continue;
      const row: RowShape[] = [pillShapes[i]];
      visited.add(i);
      let grew = true;
      while (grew) {
        grew = false;
        for (let j = 0; j < pillShapes.length; j++) {
          if (visited.has(j)) continue;
          const cand = pillShapes[j];
          let inRow = false;
          for (const member of row) {
            const vOverlap =
              Math.min(member.y + member.cy, cand.y + cand.cy) -
              Math.max(member.y, cand.y);
            const minCy = Math.min(member.cy, cand.cy);
            if (vOverlap >= minCy * 0.5) {
              inRow = true;
              break;
            }
          }
          if (inRow) {
            row.push(cand);
            visited.add(j);
            grew = true;
          }
        }
      }
      if (row.length >= 2) {
        row.sort((a, b) => a.x - b.x);
        rows.push(row);
      }
    }

    // Resolve overlaps, restore the row's design anchor, then clamp to
    // slide bounds.
    //
    // Anchor is determined by the ROW'S PRE-RESOLVE POSITION on the
    // slide, not by per-pill text-align. If the row sits near the right
    // edge, Claude designed it flush against the right margin — we
    // preserve the rightmost pill's right edge. Mirror for left. If
    // the row is far from BOTH edges (centered or free-floating), we
    // preserve the row's original midpoint.
    for (const row of rows) {
      const preLeft = row[0].x;
      const preRight = row[row.length - 1].x + row[row.length - 1].cx;
      const preCenter = (preLeft + preRight) / 2;

      const distFromLeftEdge = preLeft;
      const distFromRightEdge = SLIDE_WIDTH_EMU - preRight;
      let anchor: "left" | "right" | "center";
      if (
        distFromRightEdge < PILL_ROW_MARGIN_PROXIMITY_EMU &&
        distFromRightEdge <= distFromLeftEdge
      ) {
        anchor = "right";
      } else if (
        distFromLeftEdge < PILL_ROW_MARGIN_PROXIMITY_EMU &&
        distFromLeftEdge < distFromRightEdge
      ) {
        anchor = "left";
      } else {
        anchor = "center";
      }

      // Walk left-to-right: each pill must start at >= prev.right + MIN_GAP.
      for (let k = 1; k < row.length; k++) {
        const prev = row[k - 1];
        const cur = row[k];
        const minLeftX = prev.x + prev.cx + PILL_MIN_GAP_EMU;
        if (cur.x < minLeftX) cur.x = minLeftX;
      }

      // Restore anchor: shift the entire row so the anchored edge
      // (or center) returns to its original position. This is what
      // keeps Claude's designed slide margin intact — the overlap
      // resolver inevitably pushes pills outward, so without the
      // restore the row drifts (typically right, since we walk
      // left-to-right). Mirrored when the row was designed flush
      // left.
      const postLeft = row[0].x;
      const postRight = row[row.length - 1].x + row[row.length - 1].cx;
      const postCenter = (postLeft + postRight) / 2;
      let shift = 0;
      if (anchor === "right") shift = postRight - preRight;
      else if (anchor === "left") shift = postLeft - preLeft;
      else shift = postCenter - preCenter;
      if (shift !== 0) {
        for (const pill of row) pill.x -= shift;
      }

      // Final safety clamp against slide bounds. After the anchor
      // restore, the row should be back near where Claude designed
      // it — this just catches pathological cases (e.g. a row whose
      // original bounds were already overflowing the slide).
      const last = row[row.length - 1];
      const first = row[0];
      const slideRightLimit = SLIDE_WIDTH_EMU - SLIDE_EDGE_MARGIN_EMU;
      const rightOverflow = last.x + last.cx - slideRightLimit;
      if (rightOverflow > 0) {
        const maxLeftShift = Math.max(0, first.x - SLIDE_EDGE_MARGIN_EMU);
        const actualShift = Math.min(rightOverflow, maxLeftShift);
        for (const pill of row) pill.x -= actualShift;
      } else {
        const leftOverflow = SLIDE_EDGE_MARGIN_EMU - first.x;
        if (leftOverflow > 0) {
          const maxRightShift = Math.max(
            0,
            slideRightLimit - (last.x + last.cx),
          );
          const actualShift = Math.min(leftOverflow, maxRightShift);
          for (const pill of row) pill.x += actualShift;
        }
      }

      // Write back x positions.
      for (const pill of row) {
        if (pill.off) {
          pill.off.setAttribute("x", String(Math.round(pill.x)));
        }
      }
    }
  }

  // PASS 4: gradient-text sentinel swap.
  //
  // gradient-text.ts replaced each gradient-text element with a sentinel
  // solid color (#FE00xx range). dom-to-pptx + PptxGenJS emit that as
  //   <a:rPr ...><a:solidFill><a:srgbClr val="FExxxx"/></a:solidFill></a:rPr>
  // (or sometimes with the solidFill omitted and color on rPr via
  // <a:srgbClr> direct child — both shapes occur depending on context).
  //
  // For every rPr whose color matches a known sentinel, we drop the
  // existing fill child(ren) and insert the real <a:gradFill> built from
  // the recipe. We do this AFTER PASS 2's run-merge, so identical
  // sentinels in adjacent runs have already collapsed into one run.
  if (gradientIntents && gradientIntents.size > 0) {
    const rPrs = doc.getElementsByTagNameNS(NS_A, "rPr");
    for (let i = 0; i < rPrs.length; i++) {
      const rPr = rPrs[i];

      // Find the run's color: either inside a <a:solidFill><a:srgbClr/> or
      // a direct <a:srgbClr/> child. We accept both shapes defensively.
      let colorHex: string | null = null;
      let fillToRemove: Element | null = null;
      const solidFills = rPr.getElementsByTagNameNS(NS_A, "solidFill");
      if (solidFills.length > 0) {
        const sf = solidFills[0];
        const srgb = sf.getElementsByTagNameNS(NS_A, "srgbClr")[0];
        if (srgb) {
          colorHex = (srgb.getAttribute("val") || "").toUpperCase();
          fillToRemove = sf;
        }
      } else {
        // Direct srgbClr child of rPr (no solidFill wrapper).
        for (let j = 0; j < rPr.children.length; j++) {
          const child = rPr.children[j];
          if (child.namespaceURI === NS_A && child.localName === "srgbClr") {
            colorHex = (child.getAttribute("val") || "").toUpperCase();
            fillToRemove = child;
            break;
          }
        }
      }

      if (!colorHex || !fillToRemove) continue;
      const spec = gradientIntents.get(colorHex);
      if (!spec) continue;

      // Parse the gradFill XML and insert in the same position as the
      // removed fill. (Inserting raw XML via setAttribute won't parse —
      // we round-trip through a DOMParser to get real nodes.)
      const fillXml = buildGradFillXml(spec);
      const wrapper = new DOMParser().parseFromString(
        `<w xmlns:a="${NS_A}">${fillXml}</w>`,
        "application/xml"
      );
      const gradFillNode = wrapper.getElementsByTagNameNS(NS_A, "gradFill")[0];
      if (!gradFillNode) continue;
      const imported = doc.importNode(gradFillNode, true);
      rPr.insertBefore(imported, fillToRemove);
      rPr.removeChild(fillToRemove);
      stats.gradientFillsApplied++;
    }
  }

  return new XMLSerializer().serializeToString(doc);
}

export async function fixBiDiInPptxBlob(
  blob: Blob,
  JSZip: typeof JSZipType,
  stats: BiDiPostprocessStats,
  gradientIntents?: GradientIntents,
  format: PostprocessFormat = "16:9",
  // An Arabic deck (owner, 2026-11-11): the presentation itself is marked
  // right-to-left (<p:presentation rtl="1">), so PowerPoint lays out its slide
  // sorter and thumbnails right to left. Per-paragraph rtl never did that.
  presentationRtl = false,
): Promise<Blob> {
  stats.invocations++;

  const buf = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);

  if (presentationRtl) {
    const pres = await zip.file("ppt/presentation.xml")?.async("text");
    if (pres) {
      const fixed = pres.replace(/<p:presentation\b([^>]*)>/, (tag, attrs: string) =>
        /\srtl="/.test(attrs) ? tag.replace(/\srtl="[^"]*"/, ' rtl="1"') : `<p:presentation${attrs} rtl="1">`,
      );
      if (fixed !== pres) zip.file("ppt/presentation.xml", fixed);
    }
  }

  const slidePaths = Object.keys(zip.files).filter((p) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(p)
  );

  // Match dom-to-pptx's PPT layout dimensions for this format so all
  // bounds checks (PASS 3 max-cx clamp, PASS 3.5 row position anchor)
  // see the actual slide right edge.
  const slideWidthEmu = SLIDE_WIDTH_EMU_BY_FORMAT[format];

  for (const path of slidePaths) {
    const file = zip.file(path);
    if (!file) continue;
    stats.slidesScanned++;
    const xml = await file.async("text");
    const fixed = injectBiDiMarkers(xml, stats, gradientIntents, slideWidthEmu);
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
    gradientFillsApplied: 0,
  };
}
