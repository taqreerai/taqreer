// Deterministic expand-to-fill - runs in the bake render session right after the
// leading normalizer and BEFORE the audit + vision pass (2026-10-15).
//
// WHY: the most common reason a Sonnet slide goes to the Opus review is low ink
// coverage: tiny text sitting in the top of tall cards, or a block of content in
// the upper half of the well. The audit's coverage metric counts the rows held by
// text and images, so the cheapest honest fix is to grow the type until the slide
// fills its well, which is what a designer would do. Doing it here means fewer
// slides are flagged, and the ones that remain are real design problems.
//
// GUARANTEE - never make a slide worse. Only a slide with NO audit finding and
// coverage under COVER_BELOW is touched. We try one uniform font-size factor at a
// time (largest first) over every text-bearing element and keep the first that
// leaves the audit with zero findings, does not widen the dead-zone gap past the
// flag threshold, and raises coverage by at least MIN_GAIN points. No factor
// passes: every inline style is restored and the slide is exactly as authored.
//
// Uniform scaling keeps the type hierarchy intact. The script mutates inline styles
// in the live DOM; the caller captures `section.outerHTML` (same mechanism as the
// leading normalizer). Idempotent enough: a second run on an already-filled slide
// is skipped by the coverage gate.
//
// Needs `__tqAuditWell` (AUDIT_SCRIPT) evaluated in the same page first.

export const EXPAND_TO_FILL_SCRIPT = `
function __tqExpandToFillWell(well, dir, opts) {
  var COVER_BELOW = opts.coverBelow;   // act only under this ink coverage (% of well rows)
  var GAP_MAX = opts.gapMax;           // never leave a dead gap wider than this (% of well)
  var MIN_GAIN = 3;                    // coverage points a factor must add to be worth keeping
  var FACTORS = [1.4, 1.3, 1.2, 1.12];
  var MAX_FS = 240;                    // never grow a single run past this
  var view = well.ownerDocument.defaultView;

  var base = __tqAuditWell(well, dir);
  var dz0 = base.deadZone || { gapPct: 0, coverPct: 100 };
  if (base.findings.length > 0 || dz0.coverPct >= COVER_BELOW) {
    return { applied: 0, factor: 1, cover0: dz0.coverPct, cover1: dz0.coverPct, gap0: dz0.gapPct, gap1: dz0.gapPct };
  }

  var cands = [];
  var els = well.querySelectorAll("*");
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var tn = el.tagName.toUpperCase();
    if (tn === "STYLE" || tn === "SCRIPT" || tn === "SVG" || tn === "IMG") continue;
    if (el.closest("svg")) continue;
    var own = "";
    for (var c = 0; c < el.childNodes.length; c++) {
      if (el.childNodes[c].nodeType === 3) own += el.childNodes[c].textContent || "";
    }
    if (!own.trim()) continue;
    var cs = view.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    var fs = parseFloat(cs.fontSize);
    if (!fs) continue;
    var lh = parseFloat(cs.lineHeight);
    cands.push({ el: el, fs: fs, lh: lh || 0, orig: el.getAttribute("style") });
  }
  if (!cands.length) {
    return { applied: 0, factor: 1, cover0: dz0.coverPct, cover1: dz0.coverPct, gap0: dz0.gapPct, gap1: dz0.gapPct };
  }

  function apply(k) {
    for (var s = 0; s < cands.length; s++) {
      var cd = cands[s];
      cd.el.style.fontSize = Math.min(cd.fs * k, Math.max(cd.fs, MAX_FS)) + "px";
      if (cd.lh) cd.el.style.lineHeight = Math.min(cd.lh * k, Math.max(cd.lh, MAX_FS * 1.5)) + "px";
    }
  }
  function revert() {
    for (var r = 0; r < cands.length; r++) {
      if (cands[r].orig === null) cands[r].el.removeAttribute("style");
      else cands[r].el.setAttribute("style", cands[r].orig);
    }
  }

  var gapCap = Math.max(GAP_MAX, dz0.gapPct);
  for (var f = 0; f < FACTORS.length; f++) {
    apply(FACTORS[f]);
    var res = __tqAuditWell(well, dir);
    var dz = res.deadZone || { gapPct: 0, coverPct: 0 };
    if (res.findings.length === 0 && dz.gapPct <= gapCap && dz.coverPct >= dz0.coverPct + MIN_GAIN) {
      return { applied: cands.length, factor: FACTORS[f], cover0: dz0.coverPct, cover1: dz.coverPct, gap0: dz0.gapPct, gap1: dz.gapPct };
    }
    revert();
  }
  return { applied: 0, factor: 1, cover0: dz0.coverPct, cover1: dz0.coverPct, gap0: dz0.gapPct, gap1: dz0.gapPct };
}
`;
