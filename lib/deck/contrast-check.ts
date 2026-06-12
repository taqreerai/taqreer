// Contrast guard, phase 1: DETECT ONLY (user direction 2026-06-12).
//
// Models occasionally author invisible text - the measured case was a
// Fable 5 deck whose closing slide put `color:#fff` text (inherited
// from its own `.page--light` convention) inside a white CTA pill, and
// referenced modifier classes it never defined. The pipeline renders
// faithfully, so the only systematic catch-point is the rendered DOM.
//
// The walk runs INSIDE the already-open Puppeteer page of
// thumbnail-render (one evaluate per deck, ~tens of ms) and reports
// text whose computed color is near-identical to its effective solid
// background. Phase 1 only LOGS (`deck_contrast_violations`) so we can
// measure frequency + false-positive rate before any auto-fix.
//
// Deliberately conservative to avoid false positives:
//   - only SOLID backgrounds count (skip when any ancestor up to the
//     slide root carries a background-image / gradient - ambiguity is
//     the scrim fixer's territory)
//   - only opaque colors (alpha >= 0.9 on both sides)
//   - tiny text nodes (< 2 chars) ignored
//
// Shipped as a SCRIPT STRING, not a function: page.evaluate(fn)
// serializes the compiled function, and both tsx and Next inject
// helpers (`__name`) that don't exist in the page context - the
// string form is transform-proof.

export type ContrastViolation = {
  slideId: string;
  tag: string;
  className: string;
  text: string;
  color: string;
  background: string;
};

export const CONTRAST_CHECK_SCRIPT = `(() => {
  const out = [];
  const parse = (c) => {
    const m = c && c.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  };
  for (const root of document.querySelectorAll("[data-slide-id]")) {
    const slideId = root.getAttribute("data-slide-id") || "?";
    const rootBg = getComputedStyle(root).backgroundColor;
    for (const el of root.querySelectorAll("*")) {
      const direct = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => (n.textContent || "").trim())
        .join("");
      if (direct.length < 2) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      const color = parse(cs.color);
      if (!color || color[3] < 0.9) continue;
      let bg = null;
      let ambiguous = false;
      let node = el;
      while (node) {
        const ncs = getComputedStyle(node);
        if (ncs.backgroundImage && ncs.backgroundImage !== "none") {
          ambiguous = true;
          break;
        }
        const nbg = parse(ncs.backgroundColor);
        if (nbg && nbg[3] >= 0.9) {
          bg = nbg;
          break;
        }
        if (node === root) break;
        node = node.parentElement;
      }
      if (ambiguous) continue;
      if (!bg) bg = parse(rootBg);
      if (!bg || bg[3] < 0.9) continue;
      const dist =
        Math.abs(color[0] - bg[0]) +
        Math.abs(color[1] - bg[1]) +
        Math.abs(color[2] - bg[2]);
      if (dist < 60) {
        out.push({
          slideId,
          tag: el.tagName.toLowerCase(),
          className: String(el.className).slice(0, 60),
          text: direct.slice(0, 60),
          color: cs.color,
          background: "rgb(" + bg[0] + ", " + bg[1] + ", " + bg[2] + ")",
        });
        if (out.length >= 30) return out;
      }
    }
  }
  return out;
})()`;
