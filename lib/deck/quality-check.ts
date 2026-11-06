// The measured check behind the Haiku fix pass (2026-11-06). Haiku decks have no
// Opus review, and prompt rules alone proved uneven: the same rules gave one
// strong deck and three with 15px text and half-empty slides. So the bake
// measures each slide and sends only the weak ones back to Haiku, once.
//
// It measures the glyphs, not the boxes: a card stretched to the bottom of the
// well counts as covered in the audit's dead-zone metric, which is how slides
// with empty cards passed it.

import type { Page } from "puppeteer";

const BODY_MIN_PX = 22;
const BODY_TARGET_PX = 26;
const REACH_MIN_PCT = 70;
const REACH_TARGET_PCT = 80;
const WORDS_MAX = 100;
const WORDS_TARGET = 80;
// A revision that keeps less than this share of the words lost content, unless
// the slide was over the word limit.
const WORDS_KEPT_MIN = 0.6;

export type SlideQuality = {
  // Smallest font of a real sentence (short labels and chart text excluded).
  bodyMinPx: number | null;
  // How far down the well the lowest text or picture reaches, in percent.
  reachPct: number;
  // Painted boxes with text that fill under 45% of their own height.
  emptyBoxes: number;
  words: number;
  pictures: number;
};

export const QUALITY_SCRIPT = `
function __tqQualityWell(well) {
  var view = well.ownerDocument.defaultView;
  var doc = well.ownerDocument;
  var wr = well.getBoundingClientRect();
  var LABEL_CHARS = 24, BOX_MIN_H = 0.18, BOX_MIN_W = 0.15, BOX_MIN_FILL = 0.45;
  var FOOT_CHARS = 50, FOOT_MAX_PX = 27, FOOT_TOP = 0.85;
  var ink = [];
  var words = 0, bodyMin = null, pictures = 0;

  var walker = doc.createTreeWalker(well, NodeFilter.SHOW_TEXT);
  var node;
  while ((node = walker.nextNode())) {
    var text = (node.textContent || "").trim();
    var el = node.parentElement;
    if (!text || !el) continue;
    var tag = el.tagName.toUpperCase();
    if (tag === "STYLE" || tag === "SCRIPT") continue;
    var cs = view.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    // Footers and page numbers sit inside the well: counted as content, every
    // slide read as filled to the bottom. Class names vary, so a short small
    // line at the very bottom counts as a footer too.
    var size = parseFloat(cs.fontSize);
    if (el.closest(".foot, .footer, .pg, [data-anchor]")) continue;
    if (text.length < FOOT_CHARS && size <= FOOT_MAX_PX && el.getBoundingClientRect().top >= wr.top + wr.height * FOOT_TOP) continue;
    var range = doc.createRange();
    range.selectNodeContents(node);
    var rects = range.getClientRects();
    for (var i = 0; i < rects.length; i++) {
      if (rects[i].width >= 1 && rects[i].height >= 1) ink.push({ top: rects[i].top, bottom: rects[i].bottom, left: rects[i].left, right: rects[i].right });
    }
    if (el.closest("svg")) continue;
    words += text.split(/\\s+/).length;
    if (size && text.length >= LABEL_CHARS && (bodyMin === null || size < bodyMin)) bodyMin = size;
  }

  var media = well.querySelectorAll("img, svg, video, canvas, [data-genimage]");
  for (var m = 0; m < media.length; m++) {
    var mr = media[m].getBoundingClientRect();
    if (mr.width < 2 || mr.height < 2) continue;
    if (media[m].parentElement && media[m].parentElement.closest("svg")) continue;
    ink.push({ top: mr.top, bottom: mr.bottom, left: mr.left, right: mr.right });
    var mt = media[m].tagName.toUpperCase();
    if (mt === "IMG" || media[m].hasAttribute("data-genimage")) pictures += 1;
  }

  var reach = 0;
  for (var k = 0; k < ink.length; k++) {
    var b = Math.min(ink[k].bottom, wr.bottom) - wr.top;
    if (b > reach) reach = b;
  }

  var emptyBoxes = 0;
  var boxes = well.querySelectorAll("*");
  for (var n = 0; n < boxes.length; n++) {
    var box = boxes[n];
    if (box.closest("svg")) continue;
    var br = box.getBoundingClientRect();
    if (br.height < wr.height * BOX_MIN_H || br.width < wr.width * BOX_MIN_W) continue;
    var bs = view.getComputedStyle(box);
    var bg = bs.backgroundColor;
    var painted = (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") || parseFloat(bs.borderTopWidth) >= 1 || parseFloat(bs.borderBottomWidth) >= 1;
    if (!painted) continue;
    var rows = [];
    for (var q = 0; q < ink.length; q++) {
      var cx = (ink[q].left + ink[q].right) / 2, cy = (ink[q].top + ink[q].bottom) / 2;
      if (cx >= br.left && cx <= br.right && cy >= br.top && cy <= br.bottom) rows.push([ink[q].top, ink[q].bottom]);
    }
    if (!rows.length) continue;
    rows.sort(function (x, y) { return x[0] - y[0]; });
    var covered = 0, s = rows[0][0], e = rows[0][1];
    for (var r = 1; r < rows.length; r++) {
      if (rows[r][0] <= e) { if (rows[r][1] > e) e = rows[r][1]; }
      else { covered += e - s; s = rows[r][0]; e = rows[r][1]; }
    }
    covered += e - s;
    if (covered / br.height < BOX_MIN_FILL) emptyBoxes += 1;
  }

  return {
    bodyMinPx: bodyMin === null ? null : Math.round(bodyMin * 10) / 10,
    reachPct: wr.height > 0 ? Math.round((reach / wr.height) * 100) : 0,
    emptyBoxes: emptyBoxes,
    words: words,
    pictures: pictures
  };
}
`;

export async function measureQuality(
  page: Page,
  slideIds: string[],
): Promise<Record<string, SlideQuality>> {
  await page.evaluate(`${QUALITY_SCRIPT}; window.__tqQuality = __tqQualityWell;`);
  return (await page.evaluate((ids) => {
    const out: Record<string, unknown> = {};
    for (const sid of ids) {
      const escaped = sid.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
      const well = document
        .querySelector(`[data-slide-id="${escaped}"]`)
        ?.querySelector("section > .tq-well");
      if (well) {
        out[sid] = (window as unknown as { __tqQuality: (w: Element) => unknown }).__tqQuality(well);
      }
    }
    return out;
  }, slideIds)) as Record<string, SlideQuality>;
}

// What is wrong with a slide, as measured findings for the fix call. A cover is
// meant to be sparse, so only its text size counts.
// `words` off for the Opus review: a paying user's own long text is theirs.
export function qualityIssues(q: SlideQuality, isCover: boolean, opts?: { words?: boolean }): string[] {
  const issues: string[] = [];
  if (q.bodyMinPx !== null && q.bodyMinPx < BODY_MIN_PX) {
    issues.push(`the smallest sentence is ${q.bodyMinPx}px: all body and card text must be at least ${BODY_TARGET_PX}px, so cut words or simplify the layout to make room`);
  }
  if (isCover) return issues;
  if (q.reachPct < REACH_MIN_PCT) {
    issues.push(`the content stops ${q.reachPct}% of the way down the slide: enlarge the text and pictures or rearrange the layout so it reaches at least ${REACH_TARGET_PCT}%, and do not add invented content`);
  }
  if (q.emptyBoxes > 0) {
    issues.push(`${q.emptyBoxes} box(es) are mostly empty: enlarge their text, or make the boxes only as tall as their content`);
  }
  if (opts?.words !== false && q.words > WORDS_MAX) {
    issues.push(`the slide has ${q.words} words: cut it to about ${WORDS_TARGET} words by shortening sentences, keeping every idea`);
  }
  return issues;
}

// Distance from a passing slide, lower is better. A revision has to lower it.
export function qualityShortfall(q: SlideQuality, isCover: boolean): number {
  const small = q.bodyMinPx !== null ? Math.max(0, BODY_MIN_PX - q.bodyMinPx) * 3 : 0;
  if (isCover) return small;
  return (
    small +
    Math.max(0, REACH_MIN_PCT - q.reachPct) +
    q.emptyBoxes * 10 +
    Math.max(0, q.words - WORDS_MAX) / 4
  );
}

// Keep a revision only if it lost neither pictures nor text and either fixed an
// audit defect (clipped or invisible content matters more than these measures)
// or measures better.
export function fixImproved(before: SlideQuality, after: SlideQuality, isCover: boolean, auditFixed: boolean): boolean {
  if (after.pictures < before.pictures) return false;
  if (before.words <= WORDS_MAX && after.words < before.words * WORDS_KEPT_MIN) return false;
  if (auditFixed) return true;
  const now = qualityShortfall(after, isCover);
  return now === 0 || now < qualityShortfall(before, isCover);
}
