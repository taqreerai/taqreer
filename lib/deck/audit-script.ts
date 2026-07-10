// RENDER AUDIT for FRAME decks (context/frame-architecture-2026-07-10.md) —
// the "catch, don't guess" layer. Runs in the clean render deck-freeze-bake
// already owns, BEFORE the freeze, and measures the flaw classes the frame
// cannot prevent structurally (they live inside Claude's well):
//
//   overflow   — content extends past the clipped well (invisible = lost).
//   anchor     — the 2026-07-10 slide-2 finding: text aligned toward the
//                reading side while its shrink-wrapped BLOCK anchors to the
//                opposite edge (Claude's LTR mental model writes flex-end
//                meaning "right"; under RTL flex-end = left). The signature is
//                self-inconsistent, which is what makes it detectable with
//                near-zero false positives: a designer who wants off-side
//                anchoring aligns the text the same way.
//   underfill  — content occupies a small fraction of the well (sparse slide).
//                Report-only: composition taste, not a defect.
//
// Findings are DATA for the one-round self-fix pass (the model corrects its
// own slides); nothing here rewrites anything.

export type FrameAuditFinding = {
  type: "overflow" | "anchor" | "underfill";
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
    if (el.tagName === "STYLE" || el.tagName === "SCRIPT") continue;
    var cs = view.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    if (!hasInk(el)) continue;
    var r = el.getBoundingClientRect();
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
    var ta = bcs.textAlign;
    var alignedToReading = readingRight
      ? ta === "right" || ta === "start"
      : ta === "left" || ta === "start";
    if (!alignedToReading) continue;
    var br = b.getBoundingClientRect();
    var pr = b.parentElement.getBoundingClientRect();
    if (br.width >= pr.width * 0.9) continue; // fills its parent — no anchor side
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
        " — under " + (readingRight ? "RTL align-items:flex-end anchors LEFT; use flex-start" : "LTR align-items:flex-end anchors RIGHT; use flex-start"),
    });
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
        detail: "content spans only " + Math.round(fill * 100) + "% of the well height — consider a fuller composition",
      });
    }
  }

  return findings;
}
`;
