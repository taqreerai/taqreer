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
// Short labels (under 24 characters, small or on their own painted box: chips,
// pills, badges, page counters) are left out of the growth. Uniform scaling of the rest keeps the type hierarchy intact. The script mutates inline styles
// in the live DOM; the caller captures `section.outerHTML` (same mechanism as the
// leading normalizer). Idempotent enough: a second run on an already-filled slide
// is skipped by the coverage gate.
//
// TYPE FLOOR (same step, 2026-10-15): text under FLOOR_PX (chips, captions, small
// card copy) is raised to FLOOR_PX, kept only when the audit gets no worse. Haiku
// and the free-plan decks have no model review to catch a 16px chip, so this
// enforces the 20px minimum the layout checklist asks for.
//
// Needs `__tqAuditWell` (AUDIT_SCRIPT) evaluated in the same page first.

export const EXPAND_TO_FILL_SCRIPT = `
function __tqExpandToFillWell(well, dir, opts) {
  var COVER_BELOW = opts.coverBelow;   // grow type only under this ink coverage (% of well rows)
  var FLOOR_PX = opts.floorPx || 0;    // raise any text smaller than this (0 = off)
  var GAP_MAX = opts.gapMax;           // never leave a dead gap wider than this (% of well)
  var MIN_GAIN = 3;                    // coverage points a factor must add to be worth keeping
  var FACTORS = [1.4, 1.3, 1.2, 1.12];
  var MAX_FS = 240;                    // never grow a single run past this
  var view = well.ownerDocument.defaultView;
  var out = { applied: 0, factor: 1, floored: 0, cover0: 0, cover1: 0, gap0: 0, gap1: 0 };

  var base = __tqAuditWell(well, dir);
  var dz0 = base.deadZone || { gapPct: 0, coverPct: 100 };
  out.cover0 = out.cover1 = dz0.coverPct;
  out.gap0 = out.gap1 = dz0.gapPct;

  // Every visible text-bearing element, with its authored inline style for revert.
  function collect() {
    var list = [];
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
      var bg = cs.backgroundColor;
      var painted = (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") || (cs.backgroundImage && cs.backgroundImage !== "none");
      list.push({ el: el, fs: fs, painted: !!painted, len: own.trim().length, lh: parseFloat(cs.lineHeight) || 0, orig: el.getAttribute("style") });
    }
    return list;
  }
  function revert(list) {
    for (var r = 0; r < list.length; r++) {
      if (list[r].orig === null) list[r].el.removeAttribute("style");
      else list[r].el.setAttribute("style", list[r].orig);
    }
  }

  // Phase 0: tables (2026-11-07, owner report: a paid enhance deck's tables sat
  // tiny in the top half of four slides). Phase 1 skips short text as chrome,
  // and a table is nearly all short cells ("$5", "01"), so a table never grew.
  // Here each table on a sparse, finding-free slide grows its cell type and row
  // padding together (largest factor first, cell type capped at TABLE_MAX_FS),
  // with an enhance table's fixed-height box released to fit. Every try is kept only when
  // the audit stays clean, exactly like Phase 1; else the table is restored.
  var TABLE_FACTORS = [2.2, 1.9, 1.6, 1.4, 1.2];
  var TABLE_MAX_FS = 44;
  var tables = well.querySelectorAll("table");
  if (tables.length && base.findings.length === 0 && dz0.coverPct < COVER_BELOW) {
    for (var t = 0; t < tables.length; t++) {
      var table = tables[t];
      if (table.closest("svg")) continue;
      var box = table.closest("[data-table]");
      var touched = [table];
      if (box && well.contains(box)) touched.push(box);
      var cells = table.querySelectorAll("th, td");
      var texts = [];
      var tEls = table.querySelectorAll("*");
      for (var e = 0; e < tEls.length; e++) {
        var own = "";
        for (var n = 0; n < tEls[e].childNodes.length; n++) {
          if (tEls[e].childNodes[n].nodeType === 3) own += tEls[e].childNodes[n].textContent || "";
        }
        if (own.trim()) texts.push(tEls[e]);
      }
      var all = touched.concat(Array.prototype.slice.call(cells), texts);
      var saved = [];
      for (var a = 0; a < all.length; a++) saved.push({ el: all[a], orig: all[a].getAttribute("style") });
      var measured = [];
      for (var m = 0; m < texts.length; m++) {
        var tcs = view.getComputedStyle(texts[m]);
        measured.push({ el: texts[m], fs: parseFloat(tcs.fontSize) || 0, lh: parseFloat(tcs.lineHeight) || 0 });
      }
      var pads = [];
      for (var p = 0; p < cells.length; p++) {
        var pcs = view.getComputedStyle(cells[p]);
        pads.push({ el: cells[p], top: parseFloat(pcs.paddingTop) || 0, bottom: parseFloat(pcs.paddingBottom) || 0 });
      }
      var restore = function () {
        for (var r2 = 0; r2 < saved.length; r2++) {
          if (saved[r2].orig === null) saved[r2].el.removeAttribute("style");
          else saved[r2].el.setAttribute("style", saved[r2].orig);
        }
      };
      var tryTable = function (f, typeToo) {
        if (box) { box.style.height = "auto"; box.style.minHeight = "0"; }
        table.style.height = "auto";
        if (typeToo) {
          for (var q2 = 0; q2 < measured.length; q2++) {
            var mm = measured[q2];
            if (!mm.fs) continue;
            var nfs = Math.min(mm.fs * f, Math.max(mm.fs, TABLE_MAX_FS));
            mm.el.style.fontSize = nfs + "px";
            if (mm.lh) mm.el.style.lineHeight = (mm.lh * nfs / mm.fs) + "px";
          }
        }
        for (var q3 = 0; q3 < pads.length; q3++) {
          pads[q3].el.style.paddingTop = (pads[q3].top * f) + "px";
          pads[q3].el.style.paddingBottom = (pads[q3].bottom * f) + "px";
        }
        var res0 = __tqAuditWell(well, dir);
        var dzt = res0.deadZone || { gapPct: 0, coverPct: 0 };
        return res0.findings.length === 0 && dzt.gapPct <= Math.max(GAP_MAX, dz0.gapPct) && dzt.coverPct >= dz0.coverPct + MIN_GAIN;
      };
      // Type and padding grow together. Padding alone was tried and dropped: on
      // a table too wide for bigger type it only spaced the rows, a marginal
      // coverage gain that read worse than the original.
      var grown = false;
      for (var tf = 0; tf < TABLE_FACTORS.length; tf++) {
        if (tryTable(TABLE_FACTORS[tf], true)) { grown = true; out.applied += 1; out.factor = TABLE_FACTORS[tf]; break; }
        restore();
      }
      if (grown) {
        // Later tables and Phase 1 measure from the grown slide.
        base = __tqAuditWell(well, dir);
        dz0 = base.deadZone || { gapPct: 0, coverPct: 100 };
        out.cover1 = dz0.coverPct; out.gap1 = dz0.gapPct;
      }
    }
  }

  // Phase 1: grow the type of a sparse, finding-free slide.
  if (base.findings.length === 0 && dz0.coverPct < COVER_BELOW) {
    // Short text that is small (eyebrows, page counters) or sits on its own painted
    // box (chips, pills, number badges) is chrome, not content: growing it only
    // makes it collide with the headline or wrap.
    // Table text belongs to Phase 0 (never grown twice).
    var cands = collect().filter(function (x) { return !(x.len < 24 && (x.fs < 26 || x.painted)) && !x.el.closest("table"); });
    var gapCap = Math.max(GAP_MAX, dz0.gapPct);
    for (var f = 0; cands.length && f < FACTORS.length; f++) {
      for (var s = 0; s < cands.length; s++) {
        var cd = cands[s];
        cd.el.style.fontSize = Math.min(cd.fs * FACTORS[f], Math.max(cd.fs, MAX_FS)) + "px";
        if (cd.lh) cd.el.style.lineHeight = Math.min(cd.lh * FACTORS[f], Math.max(cd.lh, MAX_FS * 1.5)) + "px";
      }
      var res = __tqAuditWell(well, dir);
      var dz = res.deadZone || { gapPct: 0, coverPct: 0 };
      if (res.findings.length === 0 && dz.gapPct <= gapCap && dz.coverPct >= dz0.coverPct + MIN_GAIN) {
        out.applied = cands.length; out.factor = FACTORS[f];
        out.cover1 = dz.coverPct; out.gap1 = dz.gapPct;
        break;
      }
      revert(cands);
    }
  }

  // Phase 2: type floor. Raise anything under FLOOR_PX to FLOOR_PX (line-height
  // scaled with it) and keep it only if the audit finds no more problems than before.
  if (FLOOR_PX > 0) {
    var small = collect().filter(function (x) { return x.fs < FLOOR_PX - 0.5; });
    if (small.length) {
      var before = __tqAuditWell(well, dir).findings.length;
      for (var q = 0; q < small.length; q++) {
        var sm = small[q];
        sm.el.style.fontSize = FLOOR_PX + "px";
        if (sm.lh) sm.el.style.lineHeight = (sm.lh * FLOOR_PX / sm.fs) + "px";
      }
      var after = __tqAuditWell(well, dir);
      if (after.findings.length <= before) {
        out.floored = small.length;
        if (after.deadZone) { out.cover1 = after.deadZone.coverPct; out.gap1 = after.deadZone.gapPct; }
      } else {
        revert(small);
      }
    }
  }
  return out;
}
`;
