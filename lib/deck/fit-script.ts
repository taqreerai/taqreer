// DETERMINISTIC OVERFLOW BACKSTOP (2026-08-11) - the in-page "compress to
// fit" script deck-freeze-bake injects into the clean render, AFTER the
// vision revision round and BEFORE the freeze measurement. Same philosophy
// as the leading normalizer, latinizeDigits, and the contrast backstop:
// deterministic enforcement when the model doesn't deliver.
//
// Why it exists (prod deck 2026-08-11, project cmsodi3bz003ct36dh9we1ccu):
// the vision pass DETECTED a 13-row table overflowing the well ("SLIDE 2:
// REVISING - table overflows well vertically") but its revision only shaved
// marginal spacing - the revision contract forbids a <style> block and
// inline styles on <table> don't cascade to td padding, so the model could
// not express the per-cell compression the fix needed. The regression guard
// only vetoes revisions that measure WORSE, so the partial fix (194px ->
// 96px overflow) froze with the last table row clipped mid-row and the
// footer entirely hidden. This backstop closes that hole: nothing freezes
// with measured vertical overflow while deterministic compression can fix it.
//
// Mechanism - two phases, both writing inline px values that the frozen
// html then keeps (the freeze pins geometry but leaves padding / font-size
// inline styles untouched, and margins it later zeroes still counted here
// because compression happens before the freeze measures):
//
//   1. whitespace (floor WS_FLOOR): proportionally shrink vertical paddings,
//      vertical margins, and flex/grid row gaps across the well subtree.
//      This is the per-cell table fix the vision model could not express.
//   2. type (floor FONT_FLOOR), only if whitespace alone cannot fit:
//      scale font-size and resolved px line-heights uniformly.
//
// Each phase binary-searches for the LARGEST factor (least compression)
// that fits, against values captured ONCE up front (factors always apply to
// the originals, never compound). Shrinking is monotonic in a flow-only
// well, which is what makes the search sound. If both floors are hit and
// overflow remains (e.g. a fixed-height image is the driver), the caller
// logs the residual instead of shipping silently.
//
// Vertical only by design: the compressor declines horizontal overflow
// (returns changed:false) - shrinking vertical whitespace cannot fix it and
// blind font shrink for a wide box trades one defect for another.
//
// Input domain: frame wells are FLOW-ONLY by the generation contract, so
// pulling content upward can never create overlap - later flow content
// simply follows. Kept as a plain JS source STRING (not a module import)
// because it executes inside the rendered page via page.evaluate, with no
// bundler round trip.

// __tqCompressOverflow returns this shape.
export type FitCompressResult = {
  // false = nothing to do (no vertical overflow) or overflow is not
  // vertically compressible (horizontal). No DOM mutation happened.
  changed: boolean;
  beforePx: number;
  afterPx: number;
  wsFactor: number;
  fontFactor: number;
};

export const FIT_SCRIPT = `
function __tqCompressOverflow(well) {
  var WS_FLOOR = 0.6;
  var FONT_FLOOR = 0.75;
  var view = well.ownerDocument.defaultView;
  var wr = well.getBoundingClientRect();

  // Same ink test as the audit: only content that would VISIBLY clip
  // counts (replaced elements + direct text); an invisible flex spacer
  // past the edge is not worth compressing the slide for.
  var hasInk = function (el) {
    var t = el.tagName.toLowerCase();
    if (t === "img" || t === "svg" || t === "video" || t === "canvas") return true;
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3 && n.textContent.trim()) return true;
    }
    return false;
  };

  // Worst inked-content extension past the well BOTTOM (the axis this
  // compressor can fix). Mirrors the audit's overflow walk.
  var overflowBottomPx = function () {
    var worst = 0;
    var els = well.querySelectorAll("*");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var tn = el.tagName.toUpperCase();
      if (tn === "STYLE" || tn === "SCRIPT") continue;
      var cs = view.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      if (!hasInk(el)) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 1 && r.height < 1) continue;
      var out = r.bottom - wr.bottom;
      if (out > worst) worst = out;
    }
    return worst;
  };

  var before = overflowBottomPx();
  if (before <= 1) {
    return { changed: false, beforePx: Math.round(before), afterPx: Math.round(before), wsFactor: 1, fontFactor: 1 };
  }

  // Capture originals ONCE (factors always scale these, never the current
  // inline values). Includes the well's own flow child - its padding is
  // often the single largest vertical budget on the slide.
  var targets = [];
  var all = well.querySelectorAll("*");
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var tn = el.tagName.toUpperCase();
    if (tn === "STYLE" || tn === "SCRIPT") continue;
    var cs = view.getComputedStyle(el);
    if (cs.display === "none") continue;
    // parseFloat degrades "normal" (row-gap on non-flex) to NaN -> 0.
    targets.push({
      el: el,
      pt: parseFloat(cs.paddingTop) || 0,
      pb: parseFloat(cs.paddingBottom) || 0,
      mt: parseFloat(cs.marginTop) || 0,
      mb: parseFloat(cs.marginBottom) || 0,
      rg: parseFloat(cs.rowGap) || 0,
      fs: parseFloat(cs.fontSize) || 0,
      lh: cs.lineHeight === "normal" ? 0 : parseFloat(cs.lineHeight) || 0,
    });
  }

  var applyWs = function (f) {
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      var s = t.el.style;
      if (t.pt) s.setProperty("padding-top", (t.pt * f).toFixed(2) + "px");
      if (t.pb) s.setProperty("padding-bottom", (t.pb * f).toFixed(2) + "px");
      if (t.mt) s.setProperty("margin-top", (t.mt * f).toFixed(2) + "px");
      if (t.mb) s.setProperty("margin-bottom", (t.mb * f).toFixed(2) + "px");
      if (t.rg) s.setProperty("row-gap", (t.rg * f).toFixed(2) + "px");
    }
  };
  // font-size and line-height scale together per element (every element
  // gets its own inline pair from its own computed originals), so relative
  // leading survives the shrink and no cascade surprises apply.
  var applyFont = function (f) {
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      var s = t.el.style;
      if (t.fs) s.setProperty("font-size", (t.fs * f).toFixed(2) + "px");
      if (t.lh) s.setProperty("line-height", (t.lh * f).toFixed(2) + "px");
    }
  };

  // Largest factor in [floor, 1] whose layout fits; shrink is monotonic in
  // a flow-only well so binary search is sound. Leaves the winning factor
  // APPLIED. fit:false means even the floor cannot fit (floor stays
  // applied - partial recovery still beats clipping).
  var search = function (apply, floor) {
    apply(floor);
    if (overflowBottomPx() > 1) return { f: floor, fit: false };
    var lo = floor;
    var hi = 1;
    for (var it = 0; it < 5; it++) {
      var mid = (lo + hi) / 2;
      apply(mid);
      if (overflowBottomPx() > 1) hi = mid;
      else lo = mid;
    }
    apply(lo);
    return { f: lo, fit: true };
  };

  var ws = search(applyWs, WS_FLOOR);
  var font = { f: 1, fit: ws.fit };
  if (!ws.fit) font = search(applyFont, FONT_FLOOR);
  var after = overflowBottomPx();
  return {
    changed: true,
    beforePx: Math.round(before),
    afterPx: Math.round(after),
    wsFactor: Math.round(ws.f * 1000) / 1000,
    fontFactor: Math.round(font.f * 1000) / 1000,
  };
}
`;
