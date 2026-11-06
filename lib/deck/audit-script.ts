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
  // "crowding" = a multi-line Arabic headline with line-height below the
  // script's comfortable minimum (owner-caught twice: the model "fixed" a
  // crowded title to 1.16, still tight for Arabic ascenders/diacritics).
  type:
    | "overflow"
    | "anchor"
    | "underfill"
    | "quality"
    | "collision"
    | "structure"
    | "contrast"
    | "crowding"
    | "spill";
  detail: string;
};

// A text element the CSS contrast walk SKIPPED as ambiguous (photo tq-bg
// ground, background-image ancestor, panel overlap, translucent ground) -
// CSS cannot know those pixels, so the bake samples the slide's EXISTING
// screenshot instead (lib/deck/pixel-contrast.ts). Added 2026-07-15 after a
// real deck shipped an invisible rose-on-rose lead over a photo: the CSS
// path was blind by design and the vision reviewer cannot see text that
// isn't visible - measurement over the rendered pixels closes the hole.
// Rect is relative to the [data-slide-id] HOST box (the exact clip the
// bake's shoot() captures), in CSS px (render runs at deviceScaleFactor 1).
export type PixelContrastCheck = {
  x: number;
  y: number;
  w: number;
  h: number;
  // Opaque computed ink [r, g, b].
  ink: [number, number, number];
  // TAG.firstClass + a short text snippet, for the finding detail.
  tag: string;
  snippet: string;
};

// __tqAuditWell returns this shape (findings + the pixel-check candidates).
// Text the CSS contrast walk measured near-invisible against a SOLID, known
// background. No pixel sampling needed: the bake picks an ink from the deck
// palette against `bg` and applies it deterministically (the vision pass used
// to be the only thing that ever fixed these). Same rect convention as
// PixelContrastCheck.
export type CssInvisibleText = {
  x: number;
  y: number;
  w: number;
  h: number;
  ink: [number, number, number];
  bg: [number, number, number];
};

export type FrameAuditResult = {
  findings: FrameAuditFinding[];
  pixelChecks: PixelContrastCheck[];
  cssInvisible?: CssInvisibleText[];
  // Detect-only layout metric (never a finding): largest empty vertical gap and
  // the share of well rows holding ink, both in percent of the well height.
  deadZone?: { gapPct: number; coverPct: number };
};

export const AUDIT_SCRIPT = `
function __tqAuditWell(well, dir) {
  var findings = [];
  // Text the CSS contrast walk cannot judge (photo/gradient/panel grounds):
  // collected for the bake's pixel-sampling pass instead of silently skipped.
  // Rects are relative to the [data-slide-id] host - the shoot() clip box.
  var pixelChecks = [];
  var cssInvisible = [];
  var wr = well.getBoundingClientRect();
  var view = well.ownerDocument.defaultView;
  var hostEl = well.closest("[data-slide-id]");
  var hostRect = hostEl ? hostEl.getBoundingClientRect() : null;

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
    if (!hasInk(el)) {
      // A PAINTED box (card/panel: fill or border) that holds text has no text
      // node of its own, so it was invisible here: its bottom padding + border
      // (~30px) could be clipped by the well while the text still sat inside
      // the tolerance, and nothing reported it (prod deck 2026-10-12, project
      // cmv5fo3k60004et6du5wbedco: third card cut off, no finding). Bottom edge
      // only: that is the overflow compression can fix, and a deliberate
      // sideways bleed of a decorative band stays quiet.
      var pos = cs.position;
      if (
        pos !== "absolute" && pos !== "fixed" &&
        el.children.length > 0 &&
        !el.hasAttribute("data-tq-lock") &&
        el.textContent && el.textContent.trim() &&
        ((cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent") ||
          (cs.borderBottomStyle !== "none" && parseFloat(cs.borderBottomWidth) > 0))
      ) {
        var pr = el.getBoundingClientRect();
        if (pr.width >= 1 && pr.height >= 1) {
          var pb = pr.bottom - wr.bottom;
          if (pb > worst) {
            worst = pb;
            worstTag = el.tagName + (el.className ? "." + String(el.className).split(" ")[0] : "");
          }
        }
      }
      continue;
    }
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

  // ── collision: body text on or past the footer ──
  // The footer sits inside the well, so the edge check above passes a slide whose
  // text runs through it, and expand-to-fill grew type into it unseen (prod
  // 2026-11-06, cmw55c599002zvi6dfzcn68fk slide 4: type x1.4, last lines on and
  // below the footer). Line boxes are trimmed: Arabic ones are far taller than
  // the ink, and neighbouring lines' boxes touch.
  var footer = [], body = [];
  var colWalker = well.ownerDocument.createTreeWalker(well, 4);
  var colNode;
  while ((colNode = colWalker.nextNode())) {
    var colText = (colNode.textContent || "").trim();
    var colEl = colNode.parentElement;
    if (!colText || !colEl || colEl.tagName === "STYLE" || colEl.tagName === "SCRIPT" || colEl.closest("svg")) continue;
    var colCs = view.getComputedStyle(colEl);
    if (colCs.display === "none" || colCs.visibility === "hidden") continue;
    var isFoot = !!colEl.closest(".foot, .footer, .pg, [data-anchor]") ||
      (colText.length < 40 && parseFloat(colCs.fontSize) <= 22 && colEl.getBoundingClientRect().top >= wr.top + wr.height * 0.85);
    var colRange = well.ownerDocument.createRange();
    colRange.selectNodeContents(colNode);
    var colRects = colRange.getClientRects();
    for (var cr = 0; cr < colRects.length; cr++) {
      var q = colRects[cr];
      if (q.width < 1 || q.height < 1) continue;
      (isFoot ? footer : body).push({ l: q.left, r: q.right, t: q.top + q.height * 0.2, b: q.bottom - q.height * 0.2 });
    }
  }
  var lowFooter = footer.filter(function (f) { return f.t >= wr.top + wr.height * 0.75; });
  if (lowFooter.length) {
    var footTop = wr.bottom, footL = wr.right, footR = wr.left;
    for (var lf = 0; lf < lowFooter.length; lf++) {
      footTop = Math.min(footTop, lowFooter[lf].t);
      footL = Math.min(footL, lowFooter[lf].l);
      footR = Math.max(footR, lowFooter[lf].r);
    }
    var colHits = 0;
    for (var bi = 0; bi < body.length; bi++) {
      var br0 = body[bi];
      if (br0.l < footR && br0.r > footL && br0.b > footTop + 8) colHits++;
    }
    if (colHits > 0) {
      findings.push({
        type: "collision",
        detail: colHits + " line(s) of text run into or below the footer: end the content above the footer by cutting words, reducing spacing or simplifying the layout",
      });
    }
  }

  // ── spill: text escaping its OWN drawn shape (a card, pill, badge or
  // circle). The overflow check above only knows the well edge, so a title
  // wider than the gold circle it sits in passed (prod deck 2026-10-20,
  // cmvgq4j04000l4i6dvwzw5uyu slide 3). Line boxes of each text node are
  // tested against the nearest painted ancestor: its rectangle, or its
  // ellipse when the corners are rounded to a circle / oval.
  var spillWorst = 0;
  var spillText = "";
  var doc = well.ownerDocument;
  var painted = function (el) {
    var c = view.getComputedStyle(el);
    if (el.hasAttribute("data-tq-lock")) return false;
    var bg = c.backgroundColor && c.backgroundColor !== "rgba(0, 0, 0, 0)" && c.backgroundColor !== "transparent";
    var bd = ["Top", "Right", "Bottom", "Left"].some(function (s) {
      return c["border" + s + "Style"] !== "none" && parseFloat(c["border" + s + "Width"]) > 0;
    });
    return bg || bd || (c.backgroundImage && c.backgroundImage !== "none");
  };
  var tw = doc.createTreeWalker(well, 4 /* NodeFilter.SHOW_TEXT */);
  for (var tn2 = tw.nextNode(); tn2; tn2 = tw.nextNode()) {
    if (!tn2.textContent || !tn2.textContent.trim()) continue;
    var host = tn2.parentElement;
    if (!host) continue;
    var hcs = view.getComputedStyle(host);
    if (hcs.display === "none" || hcs.visibility === "hidden") continue;
    var box = host;
    while (box && box !== well && !painted(box)) box = box.parentElement;
    if (!box || box === well) continue;
    var sbcs = view.getComputedStyle(box);
    // The INNER edge: text crossing a thick ring or border is already out.
    var ob = box.getBoundingClientRect();
    var bl = parseFloat(sbcs.borderLeftWidth) || 0;
    var brw = parseFloat(sbcs.borderRightWidth) || 0;
    var bt = parseFloat(sbcs.borderTopWidth) || 0;
    var bb = parseFloat(sbcs.borderBottomWidth) || 0;
    var sbr = { left: ob.left + bl, right: ob.right - brw, top: ob.top + bt, bottom: ob.bottom - bb, width: ob.width - bl - brw, height: ob.height - bt - bb };
    if (sbr.width < 8 || sbr.height < 8) continue;
    var rad = parseFloat(sbcs.borderTopLeftRadius) || 0;
    if (String(sbcs.borderTopLeftRadius).indexOf("%") > -1) rad = (rad / 100) * Math.min(sbr.width, sbr.height);
    var oval = rad >= 0.4 * Math.min(sbr.width, sbr.height);
    var rg = doc.createRange();
    rg.selectNodeContents(tn2);
    var slines = rg.getClientRects();
    for (var li = 0; li < slines.length; li++) {
      var lr = slines[li];
      if (lr.width < 1 || lr.height < 1) continue;
      var o = 0;
      if (oval) {
        var cx = sbr.left + sbr.width / 2;
        var cy = sbr.top + sbr.height / 2;
        var dy = (lr.top + lr.height / 2 - cy) / (sbr.height / 2);
        if (Math.abs(dy) >= 1) o = 0;
        else {
          var half = (sbr.width / 2) * Math.sqrt(1 - dy * dy);
          o = Math.max(cx - half - lr.left, lr.right - (cx + half));
        }
      } else {
        // Sideways only: glyphs of big display text and Arabic marks sit
        // outside a tight line box vertically by design (false positives on
        // every highlight pill); vertical clipping is the well check's job.
        o = Math.max(sbr.left - lr.left, lr.right - sbr.right);
      }
      if (o > spillWorst) {
        spillWorst = o;
        spillText = tn2.textContent.trim().slice(0, 30);
      }
    }
  }
  if (spillWorst > 6) {
    findings.push({
      type: "spill",
      detail: "text spills out of its own shape: '" + spillText + "' extends " + Math.round(spillWorst) + "px past the edge of the card / circle / badge holding it - make the shape bigger or the text smaller (or rewrap it) so every line sits fully inside",
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
    // Pictures are not text, and a page number sits at the far edge on purpose:
    // both fired on nearly every slide (2026-11-06), and the fix pass then moved
    // correct page numbers to the wrong side.
    if (/^(img|svg|video|canvas)$/i.test(b.tagName) || b.closest(".foot, [data-anchor]")) continue;
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

  // ── anchor, digit-block variant (RTL only) ── the prompt allows dir=ltr
  // on digit-only blocks (stops BiDi reordering "01 / 05" -> "05 / 01"),
  // but dir=ltr flips text-align:start to the LEFT - a full-width digit row
  // then renders its numerals on the LEFT edge of an RTL slide (user-caught
  // on the first 10-post deck: step numbers 01..07 all sat left). Exempt
  // when the design aligns it explicitly (right/center) or the block is
  // shrink-wrapped (its POSITION is the designer's choice, not a default).
  if (readingRight) {
    var dCount = 0;
    var dSample = "";
    var dEls = well.querySelectorAll('[dir="ltr"]');
    for (var di = 0; di < dEls.length; di++) {
      var del = dEls[di];
      var dTxt = (del.textContent || "").trim();
      if (dTxt.length < 2) continue;
      // digits + separators only (a Latin URL/email block is legit LTR).
      // Escape-free char test - this file also runs from raw source in
      // harnesses, where string escapes would diverge.
      var okChars = "0123456789+%.,/:-";
      var foreign = 0;
      for (var dc = 0; dc < dTxt.length; dc++) {
        var ch = dTxt.charAt(dc);
        if (okChars.indexOf(ch) === -1 && ch.charCodeAt(0) > 32) foreign++;
      }
      if (foreign > 0) continue;
      var dcs = view.getComputedStyle(del);
      if (dcs.display === "none" || dcs.display.indexOf("inline") === 0) continue;
      var dr = del.getBoundingClientRect();
      var dpr = del.parentElement.getBoundingClientRect();
      if (dr.width < dpr.width * 0.6) continue; // shrink-wrapped = placed deliberately
      var dta = dcs.textAlign;
      // under dir=ltr: start/left/justify all render the digits at the LEFT
      if (dta === "right" || dta === "center" || dta === "end") continue;
      dCount++;
      if (!dSample) dSample = del.tagName + ' "' + dTxt.slice(0, 16) + '"';
    }
    if (dCount > 0) {
      findings.push({
        type: "anchor",
        detail:
          dCount +
          ' full-width dir="ltr" digit block(s) render their numerals on the LEFT edge of this RTL slide (dir=ltr makes text-align:start mean LEFT), e.g. ' +
          dSample +
          " - keep dir=ltr but set text-align:right (or center) explicitly on the block",
      });
    }
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
  // WCAG contrast ratio of two rgb triples.
  var LOW_RATIO = 2;
  var relLum = function (c) {
    var ch = function (v) { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
  };
  var wcagRatio = function (a, b) {
    var la = relLum(a), lb = relLum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
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
    // Queue an ambiguous-ground text element for the pixel-sampling pass.
    // Capped: a pathological slide can't force unbounded sampling work.
    var pushPixelCheck = function (el, ink, txt) {
      if (!hostRect || pixelChecks.length >= 24) return;
      var pr = el.getBoundingClientRect();
      if (pr.width < 8 || pr.height < 8) return;
      pixelChecks.push({
        x: pr.left - hostRect.left,
        y: pr.top - hostRect.top,
        w: pr.width,
        h: pr.height,
        ink: [ink[0], ink[1], ink[2]],
        tag: el.tagName + (el.className ? "." + String(el.className).split(" ")[0] : ""),
        snippet: txt.slice(0, 40),
      });
    };
    var contrastCount = 0;
    var contrastSamples = [];
    var cEls = well.querySelectorAll("*");
    for (var ci = 0; ci < cEls.length; ci++) {
      var cel = cEls[ci];
      // HTML elements only: svg internals (a <style> inside an inline icon
      // carries CSS TEXT and inherits colors) false-positived as invisible
      // text on the first 10-post deck - same svg trap as the phantom
      // overflow, same cure.
      if (cel.namespaceURI !== "http://www.w3.org/1999/xhtml") continue;
      var ctn = cel.tagName.toUpperCase();
      if (ctn === "STYLE" || ctn === "SCRIPT") continue;
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
      if (ambiguous) {
        // background-image between the text and the well: CSS can't know the
        // pixels - hand it to the pixel-sampling pass.
        pushPixelCheck(cel, ink, direct);
        continue;
      }
      if (!bg) {
        // no local fill: the text sits on the slide GROUND - unless it
        // overlaps a photo panel or the ground itself is a photo/translucent,
        // where CSS is blind: queue those for the pixel-sampling pass.
        var cr2 = cel.getBoundingClientRect();
        var onPanel = false;
        for (var pr2 = 0; pr2 < panelRects.length; pr2++) {
          var p2 = panelRects[pr2];
          if (cr2.left < p2.right && cr2.right > p2.left && cr2.top < p2.bottom && cr2.bottom > p2.top) { onPanel = true; break; }
        }
        if (onPanel || groundAmbiguous || !ground || ground[3] < 0.9) {
          pushPixelCheck(cel, ink, direct);
          continue;
        }
        bg = ground;
      }
      var dist =
        Math.abs(ink[0] - bg[0]) + Math.abs(ink[1] - bg[1]) + Math.abs(ink[2] - bg[2]);
      // Hue-different but too light to read (2026-10-21: #F5C400 table headers
      // on white, 1.6:1). Not a finding (the review and expand-to-fill gates
      // stay as they were); the bake's CSS backstop recolours it. Huge type
      // (100px+) is left alone: a faint watermark numeral is deliberate.
      if (dist >= 60 && parseFloat(ccs.fontSize) < 100 && hostRect && cssInvisible.length < 24 && wcagRatio(ink, bg) < LOW_RATIO) {
        var lr = cel.getBoundingClientRect();
        if (lr.width >= 1 && lr.height >= 1) {
          cssInvisible.push({
            x: lr.left - hostRect.left,
            y: lr.top - hostRect.top,
            w: lr.width,
            h: lr.height,
            ink: [ink[0], ink[1], ink[2]],
            bg: [bg[0], bg[1], bg[2]],
          });
        }
      }
      if (dist < 60) {
        contrastCount++;
        if (hostRect && cssInvisible.length < 24) {
          var ir = cel.getBoundingClientRect();
          if (ir.width >= 1 && ir.height >= 1) {
            cssInvisible.push({
              x: ir.left - hostRect.left,
              y: ir.top - hostRect.top,
              w: ir.width,
              h: ir.height,
              ink: [ink[0], ink[1], ink[2]],
              bg: [bg[0], bg[1], bg[2]],
            });
          }
        }
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

  // ── crowding: multi-line Arabic display text below the script's minimum ──
  // Arabic ascenders/teeth/diacritics need more leading than Latin; the
  // owner caught crowded titles twice, and a vision-only "fix" landed at
  // 1.16 - still tight. Measured law: headline-scale (>=40px) Arabic text
  // that WRAPS (2+ lines) must carry line-height >= 1.25.
  {
    var crEls = well.querySelectorAll("*");
    var crCount = 0;
    var crSamples = [];
    for (var cri = 0; cri < crEls.length; cri++) {
      var crel = crEls[cri];
      if (crel.namespaceURI !== "http://www.w3.org/1999/xhtml") continue;
      var crtn = crel.tagName.toUpperCase();
      if (crtn === "STYLE" || crtn === "SCRIPT") continue;
      var crTxt = "";
      for (var crn = 0; crn < crel.childNodes.length; crn++) {
        var crnd = crel.childNodes[crn];
        if (crnd.nodeType === 3) crTxt += crnd.textContent || "";
      }
      crTxt = crTxt.trim();
      if (crTxt.length < 4) continue;
      var hasArabic = false;
      for (var crc = 0; crc < crTxt.length; crc++) {
        var code = crTxt.charCodeAt(crc);
        if (code >= 1536 && code <= 1791) { hasArabic = true; break; }
      }
      if (!hasArabic) continue;
      var crcs = view.getComputedStyle(crel);
      if (crcs.display === "none" || crcs.visibility === "hidden") continue;
      var fs2 = parseFloat(crcs.fontSize);
      if (!fs2 || fs2 < 40) continue;
      var lh = parseFloat(crcs.lineHeight);
      if (!lh) {
        // Chrome computes line-height "normal" as the literal string (CR
        // PR #128) - a default-line-height Arabic heading (normal is a
        // tight ~1.2x) would silently skip the law. Measure the USED
        // baseline pitch instead: distinct line-fragment tops from a
        // Range give first-to-last baseline distance / (lines - 1).
        var rng = crel.ownerDocument.createRange();
        rng.selectNodeContents(crel);
        var frags = rng.getClientRects();
        var tops = [];
        for (var ri = 0; ri < frags.length; ri++) {
          var ft = frags[ri].top;
          if (frags[ri].height < 2) continue;
          var seenTop = false;
          for (var tj = 0; tj < tops.length; tj++) {
            if (tops[tj] > ft - 2 && tops[tj] < ft + 2) { seenTop = true; break; }
          }
          if (!seenTop) tops.push(ft);
        }
        if (tops.length >= 2) {
          tops.sort(function (a, b) { return a - b; });
          lh = (tops[tops.length - 1] - tops[0]) / (tops.length - 1);
        }
      }
      if (!lh) continue; // single-fragment or unmeasurable - cannot crowd
      var crr = crel.getBoundingClientRect();
      var lines = Math.round(crr.height / lh);
      if (lines < 2) continue; // single line cannot crowd itself
      var ratio = lh / fs2;
      if (ratio < 1.25) {
        crCount++;
        if (crSamples.length < 4) {
          crSamples.push(
            crel.tagName + ' "' + crTxt.slice(0, 24) + '" line-height ' +
              (Math.round(ratio * 100) / 100) + " at " + Math.round(fs2) + "px",
          );
        }
      }
    }
    for (var crs = 0; crs < crSamples.length; crs++) {
      findings.push({
        type: "crowding",
        detail:
          "CROWDED ARABIC TEXT: " + crSamples[crs] +
          " - multi-line Arabic needs line-height 1.3 or more; set it explicitly on this element",
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

  // ── dead zone: DETECT-ONLY metric (2026-10-14) ──
  // The underfill check above measures the content EXTENT (topmost to
  // bottommost ink), so a title at the top and a card row pushed to the bottom
  // by margin-top:auto reads as a full slide. This measures the largest empty
  // vertical GAP between ink and the share of well rows that hold ink. It is
  // NOT a finding: it is returned beside them and only logged by the bake
  // (deck_deadzone), so nothing here reaches the vision pass or changes a slide.
  var dzIv = [];
  var dzEls = well.querySelectorAll("*");
  for (var dz = 0; dz < dzEls.length; dz++) {
    var dzEl = dzEls[dz];
    var dzTn = dzEl.tagName.toUpperCase();
    if (dzTn === "STYLE" || dzTn === "SCRIPT") continue;
    if (!hasInk(dzEl)) continue;
    var dzCs = view.getComputedStyle(dzEl);
    if (dzCs.display === "none" || dzCs.visibility === "hidden") continue;
    var dzR = dzEl.getBoundingClientRect();
    if (dzR.height < 2 || dzR.width < 2) continue;
    var dzTop = Math.max(dzR.top, wr.top) - wr.top;
    var dzBot = Math.min(dzR.bottom, wr.bottom) - wr.top;
    if (dzBot > dzTop) dzIv.push([dzTop, dzBot]);
  }
  var deadZone = { gapPct: 0, coverPct: 0 };
  if (dzIv.length > 0 && wr.height > 0) {
    dzIv.sort(function (a, b) { return a[0] - b[0]; });
    var dzS = dzIv[0][0], dzE = dzIv[0][1], dzCover = 0, dzGap = 0;
    for (var dzI = 1; dzI < dzIv.length; dzI++) {
      if (dzIv[dzI][0] <= dzE + 1) {
        if (dzIv[dzI][1] > dzE) dzE = dzIv[dzI][1];
      } else {
        dzCover += dzE - dzS;
        if (dzIv[dzI][0] - dzE > dzGap) dzGap = dzIv[dzI][0] - dzE;
        dzS = dzIv[dzI][0];
        dzE = dzIv[dzI][1];
      }
    }
    dzCover += dzE - dzS;
    deadZone = {
      gapPct: Math.round((dzGap / wr.height) * 100),
      coverPct: Math.round((dzCover / wr.height) * 100),
    };
  }

  return { findings: findings, pixelChecks: pixelChecks, cssInvisible: cssInvisible, deadZone: deadZone };
}

// Deterministic ink BACKSTOP (2026-07-15): applied in the freeze step to any
// text box that STILL measures invisible after the vision pass (the incident
// e2e proved a revision can rebuild the layout yet keep the unreadable class
// ink - the guard's count parity then ships it). Matches each fix back to
// its element by geometry + computed ink (the audit's own pixelCheck rect,
// so the pair can't drift), then sets an explicit inline color the caller
// chose from the sampled ground (lib/deck/pixel-contrast.ts backstopInk).
// Returns the number of elements recolored; unmatched fixes are skipped
// (never guess an element).
function __tqFixInvisibleText(well, fixes) {
  var view = well.ownerDocument.defaultView;
  var hostEl = well.closest("[data-slide-id]");
  if (!hostEl) return 0;
  var hostRect = hostEl.getBoundingClientRect();
  var fixed = 0;
  var els = well.querySelectorAll("*");
  for (var f = 0; f < fixes.length; f++) {
    var fx = fixes[f];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.namespaceURI !== "http://www.w3.org/1999/xhtml") continue;
      var tn = el.tagName.toUpperCase();
      if (tn === "STYLE" || tn === "SCRIPT") continue;
      var r = el.getBoundingClientRect();
      if (
        Math.abs(r.left - hostRect.left - fx.x) > 3 ||
        Math.abs(r.top - hostRect.top - fx.y) > 3 ||
        Math.abs(r.width - fx.w) > 5 ||
        Math.abs(r.height - fx.h) > 5
      ) continue;
      var cs = view.getComputedStyle(el);
      var c = cs.color;
      var k = c.indexOf("(");
      var j = c.indexOf(")");
      if (k < 0 || j < k) continue;
      var parts = c.slice(k + 1, j).split(",").map(function (p) { return parseFloat(p); });
      if (
        Math.abs(parts[0] - fx.ink[0]) > 4 ||
        Math.abs(parts[1] - fx.ink[1]) > 4 ||
        Math.abs(parts[2] - fx.ink[2]) > 4
      ) continue;
      el.style.color = fx.color;
      fixed++;
      break;
    }
  }
  return fixed;
}
`;
