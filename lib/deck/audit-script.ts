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
    | "structure"
    | "contrast"
    | "crowding";
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
export type FrameAuditResult = {
  findings: FrameAuditFinding[];
  pixelChecks: PixelContrastCheck[];
};

export const AUDIT_SCRIPT = `
function __tqAuditWell(well, dir) {
  var findings = [];
  // Text the CSS contrast walk cannot judge (photo/gradient/panel grounds):
  // collected for the bake's pixel-sampling pass instead of silently skipped.
  // Rects are relative to the [data-slide-id] host - the shoot() clip box.
  var pixelChecks = [];
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

  return { findings: findings, pixelChecks: pixelChecks };
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
