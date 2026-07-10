// The PRECISE flattener (context/frame-architecture-2026-07-10.md) - the
// in-page "freeze-in-place" script deck-freeze-bake injects into the clean
// puppeteer render. This is the ONLY flattener frame decks ever meet.
//
// Unlike the legacy editor flatten (lib/editor/flatten.ts), it does NOT hoist
// elements to flat siblings and does NOT re-serialize computed styles - the
// unbounded conversion where that code's bug classes lived (orphaned pseudo
// elements, unmatched descendant selectors, nth-child breaks). Freeze-in-place
// keeps the DOM tree exactly as authored and PINS each well element where the
// browser laid it out: position:absolute + measured parent-relative
// left/top/width/height. The cascade is untouched except geometry, so
// classes, ::before, and descendant selectors keep working by construction.
//
// Input domain (why this is safe): frame decks' wells are FLOW-ONLY by the
// generation contract (no absolute, no transforms), and system layers
// (tq-bg/tq-panel/tq-chrome) are already absolute - only the well pins.
//
// Spike numbers (2026-07-10, scratchpad/frame-gen): worst slide 0.014% pixel
// diff vs the flow render; serialize-reload roundtrip 0.000%.
//
// Kept as a plain JS source STRING (not a module import) because it executes
// inside the rendered page via page.evaluate - no bundler round trip.

export const FREEZE_SCRIPT = `
function __tqFreezeWell(well) {
  // A TEXT BLOCK freezes atomically (its inline content keeps flowing inside
  // the pinned box): any direct non-whitespace text node, or only inline-level
  // non-replaced children, or no children at all (leaf / painted box).
  var isTextBlock = function (el) {
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3 && n.textContent.trim()) return true;
    }
    var kids = Array.prototype.slice.call(el.children);
    if (!kids.length) return true;
    return kids.every(function (k) {
      var t = k.tagName.toLowerCase();
      if (t === "img" || t === "svg" || t === "video" || t === "canvas") return false;
      return getComputedStyle(k).display.indexOf("inline") === 0;
    });
  };

  // Measure EVERYTHING first (one settled layout), mutate once after.
  var jobs = [];
  (function walk(container) {
    var kids = Array.prototype.slice.call(container.children);
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (el.tagName === "STYLE" || el.tagName === "SCRIPT") continue;
      var cs = getComputedStyle(el);
      if (cs.display === "none") continue;
      var r = el.getBoundingClientRect();
      var pr = container.getBoundingClientRect();
      var pcs = getComputedStyle(container);
      var text = isTextBlock(el);
      // height:auto is ONLY for boxes that actually CONTAIN text (so an editor
      // text edit grows them). An empty painted shell (divider bar, dot) or a
      // replaced element (img/svg) classified as an atomic leaf must keep its
      // explicit height - auto collapses a divider to 0 and lets an img revert
      // to its intrinsic ratio (both caught by self-verify on the first e2e
      // bake, 2026-07-10).
      var tagLower = el.tagName.toLowerCase();
      var replaced =
        tagLower === "img" || tagLower === "svg" || tagLower === "video" || tagLower === "canvas";
      var growsWithText =
        text && !replaced && el.textContent.trim().length > 0;
      // TEXT blocks get 2px of width SLACK: a shrink-wrapped span pinned at
      // its EXACT measured width has zero tolerance, and glyph advance
      // widths shift sub-pixel across devicePixelRatio / font hinting - a
      // marginal line then WRAPS in the viewer while both bake renders
      // agree (user report 2026-07-10: "01" + an Arabic word kicker broke
      // onto two lines). The slack grows AWAY from the text's anchored edge
      // so the glyphs themselves never move: right-aligned text extends the
      // box leftward, centered splits it, left-aligned extends rightward.
      // Self-verify compares against these same slacked values.
      var slackShift = 0;
      if (growsWithText) {
        var ta = cs.textAlign;
        var rtl = cs.direction === "rtl";
        var alignRight =
          ta === "right" ||
          ((ta === "start" || ta === "justify") && rtl) ||
          (ta === "end" && !rtl);
        slackShift = alignRight ? 2 : ta === "center" ? 1 : 0;
      }
      jobs.push({
        el: el,
        text: growsWithText,
        left: r.left - pr.left - (parseFloat(pcs.borderLeftWidth) || 0) - slackShift,
        top: r.top - pr.top - (parseFloat(pcs.borderTopWidth) || 0),
        w: r.width + (growsWithText ? 2 : 0),
        h: r.height,
      });
      var tag = el.tagName.toLowerCase();
      if (tag === "img" || tag === "svg" || tag === "video" || tag === "canvas") continue;
      if (!text) walk(el);
    }
  })(well);

  for (var j = 0; j < jobs.length; j++) {
    var job = jobs[j];
    var s = job.el.style;
    s.setProperty("position", "absolute");
    s.setProperty("left", job.left.toFixed(2) + "px");
    s.setProperty("top", job.top.toFixed(2) + "px");
    // right/bottom:auto - a flow element may carry inert inset declarations
    // (right:0, inset-inline-*) that ACTIVATE once it turns absolute; in an
    // over-constrained RTL box the stylesheet right would beat our left.
    s.setProperty("right", "auto");
    s.setProperty("bottom", "auto");
    // grid-area:auto - an abspos child of a GRID container with placement
    // props resolves left/top against its GRID AREA, not the parent padding
    // box, shifting the pin by the area offset (first prod deck 2026-07-10:
    // got.left = 2x want.left on every 12-col .main item). Auto placement
    // restores the padding box as containing block. Harmless off-grid.
    s.setProperty("grid-area", "auto");
    s.setProperty("width", job.w.toFixed(2) + "px");
    // The pin OWNS the width now - a stylesheet max-width smaller than the
    // slacked text width clamps it and fails self-verify (first 32px-margin
    // e2e: P.close-body max-width clamped 822 -> 820). The measured width
    // already respected whatever min/max applied in flow.
    s.setProperty("max-width", "none");
    s.setProperty("min-width", "0");
    // TEXT boxes keep height:auto so an editor text edit grows the box (the
    // editor's resize semantics); the measured height equals auto height at
    // bake time, so the render is identical. Non-text boxes pin exactly.
    if (job.text) s.setProperty("height", "auto");
    else s.setProperty("height", job.h.toFixed(2) + "px");
    s.setProperty("margin", "0");
  }

  // SELF-VERIFY: after mutation, every pinned element must RENDER exactly
  // where it was measured (>1px = a freeze bug, reported to the gate).
  var bad = [];
  for (var v = 0; v < jobs.length; v++) {
    var jb = jobs[v];
    var vr = jb.el.getBoundingClientRect();
    var vpr = jb.el.parentElement.getBoundingClientRect();
    var vpcs = getComputedStyle(jb.el.parentElement);
    var gl = vr.left - vpr.left - (parseFloat(vpcs.borderLeftWidth) || 0);
    var gt = vr.top - vpr.top - (parseFloat(vpcs.borderTopWidth) || 0);
    // Text blocks pin with height:auto ON PURPOSE (editor text-grow), so a
    // flow-stretched box (flex:1 / stretch) legitimately collapses to its
    // content height - comparing height there rejected visually-perfect
    // slides (0.029% pixel diff, 2026-07-10 chrome e2e). The pixel gate
    // backstops any VISIBLE collapse (a stretched box with a background).
    if (
      Math.abs(gl - jb.left) > 1 ||
      Math.abs(gt - jb.top) > 1 ||
      Math.abs(vr.width - jb.w) > 1 ||
      (!jb.text && Math.abs(vr.height - jb.h) > 1)
    ) {
      bad.push({
        tag: jb.el.tagName,
        cls: String(jb.el.className || "").slice(0, 40),
        want: { l: Math.round(jb.left), t: Math.round(jb.top), w: Math.round(jb.w), h: Math.round(jb.h) },
        got: { l: Math.round(gl), t: Math.round(gt), w: Math.round(vr.width), h: Math.round(vr.height) },
      });
    }
  }
  return { pinned: jobs.length, bad: bad.slice(0, 8) };
}
`;
