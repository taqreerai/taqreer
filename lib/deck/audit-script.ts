// RENDER AUDIT for FRAME decks (context/frame-architecture-2026-07-10.md) -
// the "catch, don't guess" layer. Runs in the clean render deck-freeze-bake
// already owns, BEFORE the freeze, and measures the flaw classes the frame
// cannot prevent structurally (they live inside Claude's well):
//
//   overflow   - content extends past the clipped well (invisible = lost).
//   anchor     - the 2026-07-10 slide-2 finding: text aligned toward the
//                reading side while its shrink-wrapped BLOCK anchors to the
//                opposite edge (Claude's LTR mental model writes flex-end
//                meaning "right"; under RTL flex-end = left). The signature is
//                self-inconsistent, which is what makes it detectable with
//                near-zero false positives: a designer who wants off-side
//                anchoring aligns the text the same way.
//   underfill  - content occupies a small fraction of the well (sparse slide).
//                Report-only: composition taste, not a defect.
//
// Findings are DATA for the one-round self-fix pass (the model corrects its
// own slides); nothing here rewrites anything.

export type FrameAuditFinding = {
  // "structure" is emitted by the bake's DOM-shape check (not this script):
  // a malformed slide (e.g. an unterminated attribute quote in model output
  // swallowing the well/chrome boundary at parse time) loses its system
  // layers - fix-worthy, the vision pass re-emits the slide cleanly.
  // "contrast" = text measured near-invisible against its effective
  // background (the 2026-07-10 cream-on-cream deck: a deck-wide light ink
  // on slides that declared light data-bg-css grounds; the vision pass SAW
  // it but had no measured fact to anchor a real fix).
  type: "overflow" | "anchor" | "underfill" | "structure" | "contrast";
  detail: string;
};

export const AUDIT_SCRIPT = `
function __tqAuditWell(well, dir) {
  var findings = [];
  var wr = well.getBoundingClientRect();
  var view = well.ownerDocument.defaultView;

  var hasInk = function (el) {
    var t = el.tagName.toLowerCase();
    if (t === "img" || t === "svg" || t === "video" || t === "canvas") return true;
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3 && n.textContent.trim()) return true;
    }
    return false;
  };

  // ── overflow: inked content clipped by the well box ──
  var worst = 0;
  var worstTag = "";
  var els = well.querySelectorAll("*");
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    // toUpperCase: svg-namespaced tag names are LOWERCASE, so a <style>
    // inside an inline <svg> icon dodged the guard; its zero rect at the
    // page origin read as phantom overflow growing 1080px per slide
    // (first prod deck 2026-07-10).
    var tn = el.tagName.toUpperCase();
    if (tn === "STYLE" || tn === "SCRIPT") continue;
    var cs = view.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    if (!hasInk(el)) continue;
    var r = el.getBoundingClientRect();
    // a box with no rendered size cannot be clipped visible content
    if (r.width < 1 && r.height < 1) continue;
    var out = Math.max(
      wr.left - r.left,
      r.right - wr.right,
      wr.top - r.top,
      r.bottom - wr.bottom,
    );
    if (out > worst) {
      worst = out;
      worstTag = el.tagName + (el.className ? "." + String(el.className).split(" ")[0] : "");
    }
  }
  if (worst > 12) {
    findings.push({
      type: "overflow",
      detail: "content clipped by the well: " + worstTag + " extends " + Math.round(worst) + "px past the well edge",
    });
  }

  // ── anchor: reading-side-aligned text in an off-side-anchored block ──
  // Direct + second-level well blocks only (the composition level where the
  // flex-end drift lives); deeper nesting is layout detail, too noisy.
  var readingRight = dir === "rtl";
  var anchorCount = 0;
  var anchorSample = "";
  var level = [];
  var kids = well.querySelectorAll(":scope > *, :scope > * > *, :scope > * > * > *");
  for (var k = 0; k < kids.length; k++) level.push(kids[k]);
  for (var j = 0; j < level.length; j++) {
    var b = level[j];
    if (b.tagName === "STYLE" || b.tagName === "SCRIPT") continue;
    var bcs = view.getComputedStyle(b);
    if (bcs.display === "none" || bcs.display.indexOf("inline") === 0) continue;
    if (!hasInk(b)) continue;
    // space-between/around/evenly rows PLACE items at the far edge on
    // purpose - the far item of every header/footer bar matched the drift
    // signature (SPAN.idx x2 on all 6 first-prod-deck slides). Distributed
    // justification is intent, not an anchoring mistake.
    var pj = view.getComputedStyle(b.parentElement);
    if (
      (pj.display.indexOf("flex") !== -1 || pj.display.indexOf("grid") !== -1) &&
      pj.justifyContent.indexOf("space-") === 0
    ) continue;
    var ta = bcs.textAlign;
    var alignedToReading = readingRight
      ? ta === "right" || ta === "start"
      : ta === "left" || ta === "start";
    if (!alignedToReading) continue;
    var br = b.getBoundingClientRect();
    var pr = b.parentElement.getBoundingClientRect();
    if (br.width >= pr.width * 0.9) continue; // fills its parent - no anchor side
    var readGap = readingRight ? pr.right - br.right : br.left - pr.left;
    var farGap = readingRight ? br.left - pr.left : pr.right - br.right;
    // Anchored to the WRONG side: big gap on the reading side, hugging the far
    // side. Thresholds tuned on the 2026-07-10 e2e decks.
    if (readGap > Math.max(96, pr.width * 0.18) && farGap < 32) {
      anchorCount++;
      if (!anchorSample) {
        anchorSample =
          b.tagName +
          (b.className ? "." + String(b.className).split(" ")[0] : "") +
          " (" + Math.round(readGap) + "px reading-side gap)";
      }
    }
  }
  if (anchorCount > 0) {
    findings.push({
      type: "anchor",
      detail:
        anchorCount +
        " text block(s) aligned toward the reading side but ANCHORED to the opposite edge, e.g. " +
        anchorSample +
        " - under " + (readingRight ? "RTL align-items:flex-end anchors LEFT; use flex-start" : "LTR align-items:flex-end anchors RIGHT; use flex-start"),
    });
  }

  // ── contrast: text near-invisible against its effective background ──
  // FRAME-AWARE adaptation of lib/deck/contrast-check.ts (detect-only in
  // thumbnail-render since 2026-06-12; the frame moved backgrounds to
  // SIBLING layers - tq-bg ground, tq-panel photos - so the plain ancestor
  // walk would measure against the transparent canvas instead of the real
  // ground and misfire both ways). Same conservative rules: solid opaque
  // colors only, Manhattan RGB distance < 60, tiny text ignored.
  var sec = well.closest("section");
  // Escape-free parser (no regex literals: this file ships as a raw source
  // string and escape sequences would differ between the compiled template
  // and raw-source extraction in harnesses).
  var parseC = function (c) {
    if (!c || c.slice(0, 3) !== "rgb") return null;
    var i = c.indexOf("(");
    var j = c.indexOf(")");
    if (i < 0 || j < i) return null;
    var parts = c.slice(i + 1, j).split(",").map(function (p) { return parseFloat(p); });
    if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) return null;
    return [parts[0], parts[1], parts[2], parts.length > 3 && !isNaN(parts[3]) ? parts[3] : 1];
  };
  if (sec) {
    // The slide's GROUND: the tq-bg layer's solid color (photo/gradient
    // grounds are ambiguous - the scrim owns legibility there), falling
    // back to the canvas background.
    var groundAmbiguous = false;
    var ground = null;
    var bgEl = sec.querySelector(":scope > .tq-bg");
    if (bgEl) {
      if (bgEl.querySelector("img")) groundAmbiguous = true;
      else {
        var bcs2 = view.getComputedStyle(bgEl);
        if (bcs2.backgroundImage && bcs2.backgroundImage !== "none") groundAmbiguous = true;
        else ground = parseC(bcs2.backgroundColor);
      }
    }
    if (!ground && !groundAmbiguous) ground = parseC(view.getComputedStyle(sec).backgroundColor);
    var panelRects = [];
    var panels = sec.querySelectorAll(":scope > .tq-panel");
    for (var pp = 0; pp < panels.length; pp++) panelRects.push(panels[pp].getBoundingClientRect());
    var contrastCount = 0;
    var contrastSamples = [];
    var cEls = well.querySelectorAll("*");
    for (var ci = 0; ci < cEls.length; ci++) {
      var cel = cEls[ci];
      var direct = "";
      for (var cn = 0; cn < cel.childNodes.length; cn++) {
        var nd = cel.childNodes[cn];
        if (nd.nodeType === 3) direct += (nd.textContent || "").trim();
      }
      if (direct.length < 2) continue;
      var ccs = view.getComputedStyle(cel);
      if (ccs.display === "none" || ccs.visibility === "hidden") continue;
      var ink = parseC(ccs.color);
      if (!ink || ink[3] < 0.9) continue;
      // nearest solid background BETWEEN the text and the well
      var bg = null;
      var ambiguous = false;
      var walkN = cel;
      while (walkN && walkN !== well.parentElement) {
        var wcs = view.getComputedStyle(walkN);
        if (wcs.backgroundImage && wcs.backgroundImage !== "none") { ambiguous = true; break; }
        var wbg = parseC(wcs.backgroundColor);
        if (wbg && wbg[3] >= 0.9) { bg = wbg; break; }
        if (walkN === well) break;
        walkN = walkN.parentElement;
      }
      if (ambiguous) continue;
      if (!bg) {
        // no local fill: the text sits on the slide GROUND - unless it
        // overlaps a photo panel (scrim territory, skip).
        var cr2 = cel.getBoundingClientRect();
        var onPanel = false;
        for (var pr2 = 0; pr2 < panelRects.length; pr2++) {
          var p2 = panelRects[pr2];
          if (cr2.left < p2.right && cr2.right > p2.left && cr2.top < p2.bottom && cr2.bottom > p2.top) { onPanel = true; break; }
        }
        if (onPanel || groundAmbiguous || !ground || ground[3] < 0.9) continue;
        bg = ground;
      }
      var dist =
        Math.abs(ink[0] - bg[0]) + Math.abs(ink[1] - bg[1]) + Math.abs(ink[2] - bg[2]);
      if (dist < 60) {
        contrastCount++;
        if (contrastSamples.length < 6) {
          contrastSamples.push(
            cel.tagName +
              (cel.className ? "." + String(cel.className).split(" ")[0] : "") +
              ' "' + direct.slice(0, 40) + '" color ' + ccs.color +
              " on background rgb(" + bg[0] + "," + bg[1] + "," + bg[2] + ")",
          );
        }
      }
    }
    // ONE finding PER invisible block (capped): the vision model fixes only
    // what it is told about (a single-example finding got a partial fix on
    // the first live case - headline restored, sub-labels still invisible),
    // and the regression guard counts findings, so per-block findings make
    // a partial fix measurably better and a full fix measurably clean.
    for (var cs2 = 0; cs2 < contrastSamples.length; cs2++) {
      findings.push({
        type: "contrast",
        detail:
          "INVISIBLE TEXT" +
          (cs2 === contrastSamples.length - 1 && contrastCount > contrastSamples.length
            ? " (+" + (contrastCount - contrastSamples.length) + " more)"
            : "") +
          ": " + contrastSamples[cs2] +
          " - set a strongly contrasting color explicitly on this element (do not rely on the deck-wide inherited ink)",
      });
    }
  }

  // ── underfill: sparse well (report-only) ──
  var top = Infinity, bottom = -Infinity;
  for (var c = 0; c < well.children.length; c++) {
    var ch = well.children[c];
    if (ch.tagName === "STYLE") continue;
    var chr = ch.getBoundingClientRect();
    if (chr.height < 2) continue;
    // measure the CONTENT extent, not container boxes that span the well
    var inner = ch.querySelectorAll("*");
    var any = false;
    for (var q = 0; q < inner.length; q++) {
      if (!hasInk(inner[q])) continue;
      var qr = inner[q].getBoundingClientRect();
      if (qr.height < 2) continue;
      any = true;
      if (qr.top < top) top = qr.top;
      if (qr.bottom > bottom) bottom = qr.bottom;
    }
    if (!any && hasInk(ch)) {
      if (chr.top < top) top = chr.top;
      if (chr.bottom > bottom) bottom = chr.bottom;
    }
  }
  if (bottom > top && wr.height > 0) {
    var fill = (bottom - top) / wr.height;
    if (fill < 0.42) {
      findings.push({
        type: "underfill",
        detail: "content spans only " + Math.round(fill * 100) + "% of the well height - consider a fuller composition",
      });
    }
  }

  return findings;
}
`;
