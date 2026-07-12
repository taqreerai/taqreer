// Deterministic Arabic-leading normalizer — runs in the bake render session
// BEFORE the audit + vision pass (2026-07-11).
//
// WHY: Arabic display headlines authored with tight Latin-style line-height are
// the single most common measured defect on Arabic decks (the "crowding" law:
// wrapping >=40px Arabic text needs line-height >= 1.25). Left to the vision
// pass, "fix the leading" burns a whole revision round AND — because the well
// is height-constrained — raising line-height alone pushes content out of the
// well (the overflow bug this replaces). Handling it deterministically here
// means crowding is pre-fixed, the audit stops flagging it, and the vision
// round is spent on things only eyes can judge (anchoring, hierarchy,
// legibility).
//
// GUARANTEE — never cause overflow. We raise line-height to the target, then:
//   • if the slide still fits: keep the headline at full size (leading added,
//     no shrink) — the "keep size where there's room" case;
//   • if it now overflows: shrink the offending headlines by the largest
//     uniform factor in [MIN_FS_RATIO, 1] that fits (measured against the same
//     well-overflow probe the audit uses);
//   • if even the floor doesn't fit (the slide was already over-packed):
//     REVERT the change entirely, leaving the slide exactly as authored — the
//     normalizer must never make a slide worse than it found it.
//
// The script mutates inline styles on the offending elements in the live DOM;
// the caller captures `section.outerHTML` afterwards (same mechanism the freeze
// uses), so the change persists into the frozen slide. Idempotent: a headline
// already at >= 1.25 is skipped.

export const LEADING_NORMALIZE_SCRIPT = `
function __tqNormalizeLeadingWell(well) {
  var TARGET_LH = 1.3;      // audit minimum is 1.25; 1.3 gives margin + matches the audit's advice copy
  var MIN_FS_RATIO = 0.72;  // never shrink a headline below 72% of its authored size
  var TOL = 12;             // overflow tolerance — identical to the audit's threshold
  var view = well.ownerDocument.defaultView;

  function directText(el) {
    var t = "";
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3) t += n.textContent || "";
    }
    return t.trim();
  }
  function hasArabic(s) {
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 1536 && c <= 1791) return true;
    }
    return false;
  }
  // Effective line-height in px — mirrors the audit's crowding measurement:
  // parseFloat of the computed value, or the used baseline pitch (distinct
  // line-fragment tops) when it computes to the literal string "normal".
  function effectiveLh(el) {
    var lh = parseFloat(view.getComputedStyle(el).lineHeight);
    if (lh) return lh;
    var rng = el.ownerDocument.createRange();
    rng.selectNodeContents(el);
    var frags = rng.getClientRects();
    var tops = [];
    for (var ri = 0; ri < frags.length; ri++) {
      if (frags[ri].height < 2) continue;
      var ft = frags[ri].top, seen = false;
      for (var tj = 0; tj < tops.length; tj++) {
        if (tops[tj] > ft - 2 && tops[tj] < ft + 2) { seen = true; break; }
      }
      if (!seen) tops.push(ft);
    }
    if (tops.length >= 2) {
      tops.sort(function (a, b) { return a - b; });
      return (tops[tops.length - 1] - tops[0]) / (tops.length - 1);
    }
    return 0;
  }
  // Worst inked overflow past ANY well edge — mirrors the audit's overflow probe.
  function wellOverflow() {
    var wr = well.getBoundingClientRect();
    var worst = 0;
    var all = well.querySelectorAll("*");
    for (var j = 0; j < all.length; j++) {
      var e = all[j];
      var etn = e.tagName.toUpperCase();
      if (etn === "STYLE" || etn === "SCRIPT") continue;
      var ecs = view.getComputedStyle(e);
      if (ecs.display === "none" || ecs.visibility === "hidden") continue;
      var ink = false, t2 = e.tagName.toLowerCase();
      if (t2 === "img" || t2 === "svg" || t2 === "video" || t2 === "canvas") ink = true;
      else for (var k = 0; k < e.childNodes.length; k++) {
        var nn = e.childNodes[k];
        if (nn.nodeType === 3 && nn.textContent.trim()) { ink = true; break; }
      }
      if (!ink) continue;
      var r = e.getBoundingClientRect();
      if (r.width < 1 && r.height < 1) continue;
      var out = Math.max(wr.left - r.left, r.right - wr.right, wr.top - r.top, r.bottom - wr.bottom);
      if (out > worst) worst = out;
    }
    return worst;
  }

  // 1. Collect crowding candidates (the audit's crowding law, in reverse).
  var cands = [];
  var els = well.querySelectorAll("*");
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (el.namespaceURI !== "http://www.w3.org/1999/xhtml") continue;
    var tn = el.tagName.toUpperCase();
    if (tn === "STYLE" || tn === "SCRIPT") continue;
    var txt = directText(el);
    if (txt.length < 4 || !hasArabic(txt)) continue;
    var cs = view.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    var fs = parseFloat(cs.fontSize);
    if (!fs || fs < 40) continue;
    var lh = effectiveLh(el);
    if (!lh) continue;
    var rect = el.getBoundingClientRect();
    if (Math.round(rect.height / lh) < 2) continue; // single line can't crowd
    if (lh / fs >= 1.25) continue;                  // already comfortable
    cands.push({ el: el, fs0: fs, origStyle: el.getAttribute("style") });
  }
  if (!cands.length) return { adjusted: 0, shrunk: 0, reverted: 0 };

  // 2. Raise line-height to the target on every candidate.
  for (var c = 0; c < cands.length; c++) cands[c].el.style.lineHeight = String(TARGET_LH);

  // 3. Fits as-is → keep full size (leading added, nothing shrunk).
  if (wellOverflow() <= TOL) return { adjusted: cands.length, shrunk: 0, reverted: 0 };

  // 4. Overflows → largest uniform font-size factor in [MIN_FS_RATIO, 1] that fits.
  var lo = MIN_FS_RATIO, hi = 1.0;
  for (var it = 0; it < 7; it++) {
    var mid = (lo + hi) / 2;
    for (var s = 0; s < cands.length; s++) cands[s].el.style.fontSize = (cands[s].fs0 * mid) + "px";
    if (wellOverflow() > TOL) hi = mid; else lo = mid;
  }
  for (var s2 = 0; s2 < cands.length; s2++) cands[s2].el.style.fontSize = (cands[s2].fs0 * lo) + "px";

  // 5. Even the floor can't fit (slide already over-packed) → revert entirely.
  if (wellOverflow() > TOL) {
    for (var r2 = 0; r2 < cands.length; r2++) {
      var cc = cands[r2];
      if (cc.origStyle === null) cc.el.removeAttribute("style");
      else cc.el.setAttribute("style", cc.origStyle);
    }
    return { adjusted: 0, shrunk: 0, reverted: cands.length };
  }
  return { adjusted: cands.length, shrunk: cands.length, reverted: 0 };
}
`;
