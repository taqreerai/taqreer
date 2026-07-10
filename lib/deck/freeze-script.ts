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
// inside the rendered page via page.evaluate, with no bundler round trip.

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

  // ── GROUPING ENGINE (owner spec 2026-07-10: "selecting the point
  // background shape should select the shape alone; the grouping feature
  // should work") ── a PAINTED CONTAINER with block content (a card: bg /
  // border / shadow + number + icon + texts) freezes as an EMPTY SHAPE
  // plus its direct children LIFTED to siblings, all stamped with one
  // data-tq-group. The editor then selects the shape alone on canvas, the
  // Layers panel folds the members into a folder, and folder-select moves
  // the group as a unit - the panel's group machinery already exists, the
  // freeze is what produces the groups. Same-rect math, all under the
  // self-verify + pixel gate.
  var opaqueish = function (c) {
    if (!c) return false;
    if (c.indexOf("rgba") === 0) {
      return parseFloat(c.slice(c.lastIndexOf(",") + 1)) > 0.05;
    }
    return c.indexOf("rgb(") === 0;
  };
  var hasPaint = function (cs) {
    if (cs.backgroundImage !== "none") return true;
    if (opaqueish(cs.backgroundColor)) return true;
    if (cs.boxShadow && cs.boxShadow !== "none") return true;
    var sides = ["Top", "Right", "Bottom", "Left"];
    for (var i = 0; i < sides.length; i++) {
      if (
        parseFloat(cs["border" + sides[i] + "Width"]) >= 1 &&
        cs["border" + sides[i] + "Style"] !== "none" &&
        opaqueish(cs["border" + sides[i] + "Color"])
      ) {
        return true;
      }
    }
    return false;
  };
  // Lift is only safe when nothing composites or clips the subtree as a
  // unit; anything else stays atomic (the historical shape). The pixel
  // gate backstops any miss.
  var liftSafe = function (cs) {
    return (
      cs.overflowX === "visible" &&
      cs.overflowY === "visible" &&
      cs.transform === "none" &&
      (!cs.rotate || cs.rotate === "none") &&
      (!cs.scale || cs.scale === "none") &&
      (!cs.translate || cs.translate === "none") &&
      parseFloat(cs.opacity) >= 0.999 &&
      (!cs.filter || cs.filter === "none") &&
      (!cs.backdropFilter || cs.backdropFilter === "none") &&
      (!cs.clipPath || cs.clipPath === "none") &&
      (!cs.maskImage || cs.maskImage === "none")
    );
  };
  // ── SELECTOR TOPOLOGY GUARD (owner-caught 2026-07-10) ── lifting a
  // child out of its container removes the container from the child's
  // ancestor chain, so any stylesheet selector that routes THROUGH the
  // container stops matching: ".tq-canvas .fcell .fn{font-size:56px}"
  // left stat numerals unstyled on a real deck ("the slides lost the
  // css") - the exact hoist bug class freeze-in-place exists to avoid.
  // Collect every class and tag token that appears in a NON-TERMINAL
  // compound of any selector in the document; a container carrying any
  // of them stays ATOMIC. Char-walk parsing (no regex) per the raw-source
  // harness constraint; anything unparseable degrades to "unsafe".
  var ancestorTokens = (function () {
    var toks = {};
    var isWord = function (ch) {
      return (
        (ch >= "a" && ch <= "z") ||
        (ch >= "A" && ch <= "Z") ||
        (ch >= "0" && ch <= "9") ||
        ch === "-" ||
        ch === "_"
      );
    };
    var collectFrom = function (prefix) {
      var i = 0;
      while (i < prefix.length) {
        var ch = prefix.charAt(i);
        if (ch === "." || ch === "#") {
          var j = i + 1;
          var name = "";
          while (j < prefix.length && isWord(prefix.charAt(j))) {
            name += prefix.charAt(j);
            j++;
          }
          if (name) toks[name.toLowerCase()] = true;
          i = j;
        } else if (isWord(ch) && (i === 0 || !isWord(prefix.charAt(i - 1)))) {
          // bare tag compound (e.g. "div span") - collect the tag too
          var k = i;
          var tag = "";
          while (k < prefix.length && isWord(prefix.charAt(k))) {
            tag += prefix.charAt(k);
            k++;
          }
          if (tag) toks[tag.toLowerCase()] = true;
          i = k;
        } else {
          i++;
        }
      }
    };
    try {
      for (var s = 0; s < document.styleSheets.length; s++) {
        var rules;
        try {
          rules = document.styleSheets[s].cssRules;
        } catch (e) {
          continue;
        }
        for (var r = 0; r < rules.length; r++) {
          var sel = rules[r].selectorText;
          if (!sel) continue;
          var parts = sel.split(",");
          for (var q = 0; q < parts.length; q++) {
            var one = parts[q];
            // The prefix BEFORE the last combinator holds the ancestor
            // compounds; a selector with no combinator has none.
            var last = -1;
            for (var c = 0; c < one.length; c++) {
              var cc = one.charAt(c);
              if (cc === " " || cc === ">" || cc === "+" || cc === "~") last = c;
            }
            if (last >= 0) collectFrom(one.slice(0, last));
          }
        }
      }
    } catch (e) {
      toks.__parse_failed = true;
    }
    return toks;
  })();
  var selectorSafe = function (el) {
    if (ancestorTokens.__parse_failed) return false;
    if (ancestorTokens[el.tagName.toLowerCase()]) return false;
    for (var i = 0; i < el.classList.length; i++) {
      if (ancestorTokens[String(el.classList[i]).toLowerCase()]) return false;
    }
    if (el.id && ancestorTokens[String(el.id).toLowerCase()]) return false;
    return true;
  };
  // ── INHERITANCE GUARD ── lifted children lose whatever inheritable
  // text properties the container set (color, font, line-height, align):
  // lift only when the container's computed values EQUAL its parent's, so
  // re-homing changes nothing the children inherit.
  var INHERITED = [
    "color",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "lineHeight",
    "letterSpacing",
    "textAlign",
    "textTransform",
    "direction",
    "whiteSpace",
  ];
  var inheritanceSafe = function (el, cs) {
    if (!el.parentElement) return false;
    var ps = getComputedStyle(el.parentElement);
    for (var i = 0; i < INHERITED.length; i++) {
      if (cs[INHERITED[i]] !== ps[INHERITED[i]]) return false;
    }
    return true;
  };
  // A lift needs real content structure: at least one visible NON-replaced
  // element child. A painted badge holding a single icon (circle + svg)
  // stays atomic - it is semantically ONE object.
  var hasBlockContent = function (el) {
    var kids = Array.prototype.slice.call(el.children);
    for (var i = 0; i < kids.length; i++) {
      var t = kids[i].tagName.toLowerCase();
      if (t === "style" || t === "script") continue;
      if (t === "img" || t === "svg" || t === "video" || t === "canvas") continue;
      if (getComputedStyle(kids[i]).display !== "none") return true;
    }
    return false;
  };
  var groupSeq = 0;

  // Measure EVERYTHING first (one settled layout), mutate once after.
  // inGroup suppresses NESTED group stamping: a lifted member's subtree may
  // restructure further, but its elements must not join (or start) a group -
  // folder-select with nested targets would double-move them.
  var jobs = [];
  // Build one pin job for el against the given parent rect/style. moveAfter
  // marks a LIFTED child (re-homed after that node in the mutate phase);
  // gid stamps group membership. Returns whether el is a text block (the
  // caller's recursion guard).
  var addJob = function (el, cs, parentRect, parentCs, moveAfter, gid) {
    var r = el.getBoundingClientRect();
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
      left: r.left - parentRect.left - (parseFloat(parentCs.borderLeftWidth) || 0) - slackShift,
      top: r.top - parentRect.top - (parseFloat(parentCs.borderTopWidth) || 0),
      w: r.width + (growsWithText ? 2 : 0),
      h: r.height,
      moveAfter: moveAfter || null,
      gid: gid || null,
    });
    return { text: text, replaced: replaced };
  };
  (function walk(container, inGroup) {
    var kids = Array.prototype.slice.call(container.children);
    var pr = container.getBoundingClientRect();
    var pcs = getComputedStyle(container);
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (el.tagName === "STYLE" || el.tagName === "SCRIPT") continue;
      var cs = getComputedStyle(el);
      if (cs.display === "none") continue;
      // TRANSFORMS (a RE-freeze concern: model flow content never carries
      // them, but editor nudges write inline translate() and a re-bake then
      // measures the moved rect AND keeps the transform - double-counted,
      // the element renders 2x off; caught live 2026-07-10 by the gate).
      // A translate-only matrix BAKES into the pin (measured rect already
      // includes it) and the transform clears. Anything else (rotate /
      // scale) cannot re-pin - the measured rect is a bounding box, not
      // the layout box - so the element keeps its authored geometry
      // untouched; recurse only when it is already absolutely positioned
      // (its children's pins then resolve against it correctly).
      var tf = cs.transform;
      var indivTf =
        (cs.rotate && cs.rotate !== "none") ||
        (cs.scale && cs.scale !== "none") ||
        (cs.translate && cs.translate !== "none");
      var translateOnly = false;
      if (tf && tf !== "none" && !indivTf && tf.indexOf("matrix(") === 0) {
        var mp = tf.slice(7, -1).split(",");
        translateOnly =
          mp.length === 6 &&
          Math.abs(parseFloat(mp[0]) - 1) < 0.001 &&
          Math.abs(parseFloat(mp[1])) < 0.001 &&
          Math.abs(parseFloat(mp[2])) < 0.001 &&
          Math.abs(parseFloat(mp[3]) - 1) < 0.001;
      }
      if ((tf && tf !== "none" && !translateOnly) || indivTf) {
        if (cs.position === "absolute" && !isTextBlock(el)) walk(el, inGroup);
        continue;
      }
      var info = addJob(el, cs, pr, pcs, null, null);
      if (translateOnly) jobs[jobs.length - 1].clearTf = true;
      if (info.replaced) continue;
      if (info.text) continue;
      // Lift decision: a painted container with block content becomes an
      // empty shape; its direct children re-home beside it (pinned against
      // THIS container - the lift target), stamped with one group id at the
      // top level only. selectorSafe + inheritanceSafe keep any container
      // whose css TOPOLOGY the lift would break atomic instead.
      if (
        hasPaint(cs) &&
        liftSafe(cs) &&
        hasBlockContent(el) &&
        selectorSafe(el) &&
        inheritanceSafe(el, cs)
      ) {
        var gid = inGroup
          ? null
          : el.getAttribute("data-tq-group") || "tqg-" + ++groupSeq;
        if (gid) jobs[jobs.length - 1].gid = gid;
        var cc = Array.prototype.slice.call(el.children);
        for (var k = 0; k < cc.length; k++) {
          var c = cc[k];
          if (c.tagName === "STYLE" || c.tagName === "SCRIPT") continue;
          var ccs = getComputedStyle(c);
          if (ccs.display === "none") continue;
          var cinfo = addJob(c, ccs, pr, pcs, el, gid);
          if (cinfo.replaced) continue;
          if (!cinfo.text) walk(c, true);
        }
      } else {
        walk(el, inGroup);
      }
    }
  })(well, false);

  // Lift cursors: children insert AFTER their shape in walk order, so the
  // group stays contiguous and paints above its shape exactly as the
  // descendants did before the lift (later sibling = later paint).
  var cursors = new Map();
  var lifted = 0;
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
    if (job.clearTf) s.setProperty("transform", "none");
    if (job.gid) job.el.setAttribute("data-tq-group", job.gid);
    if (job.moveAfter) {
      lifted++;
      var cur = cursors.get(job.moveAfter) || job.moveAfter;
      cur.parentNode.insertBefore(job.el, cur.nextSibling);
      cursors.set(job.moveAfter, job.el);
    }
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
  return { pinned: jobs.length, lifted: lifted, bad: bad.slice(0, 8) };
}
`;
