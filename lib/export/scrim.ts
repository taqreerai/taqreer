// Image-scrim corrections (FIX-3), shared by sanitize.ts (browser DOM) and
// sanitize-server.ts (JSDOM) — see each twin's rewriteImageScrim wrapper.
//
// A "scrim" is the dark overlay Claude places between a generated image and
// the text on top of it so the text stays legible. Two things go wrong and
// are fixed here, on every FULL-BLEED scrim layer over a generated image
// (Claude sometimes stacks several — a <div> gradient AND an <svg> gradient):
//
//  1. DARK SIDE — Claude often points the dark/opaque end at the EMPTY side
//     while the text is on the other side, so the text sits on the bright
//     photo. We re-orient a horizontal scrim so its dark end is on the TEXT
//     side (RTL → right, LTR → left).
//  2. OPACITY — a fully-opaque dark end hides the photo completely. We cap the
//     layer's opacity at 0.9 so the image stays faintly visible.
//
// Pure inline-style parsing (no layout / no window), so it runs identically
// client- and server-side. Only touches full-bleed overlays over an image —
// partial/split scrims and non-scrim gradients are left alone.

type ScrimEl = {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  tagName: string;
  querySelector(sel: string): ScrimEl | null;
  querySelectorAll(sel: string): ArrayLike<ScrimEl>;
  readonly style: { setProperty(name: string, value: string): void };
};

type Side = "left" | "right" | "top" | "bottom" | null;

function styleStr(el: ScrimEl): string {
  return el.getAttribute("style") ?? "";
}

function styleProp(s: string, name: string): string {
  const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "i").exec(s);
  return m ? m[1].trim() : "";
}

// A 0-to-1 unit from a "0" / "1" / "0%" / "100%" value.
function toUnit(v: string | null, dflt: number): number {
  if (v == null) return dflt;
  const t = v.trim();
  const n = parseFloat(t);
  if (!Number.isFinite(n)) return dflt;
  return t.endsWith("%") ? n / 100 : n;
}

function isFullBleed(el: ScrimEl): boolean {
  const s = styleStr(el);
  const inset = styleProp(s, "inset");
  if (inset === "0" || inset === "0px") return true;
  const zero = (p: string) => {
    const v = styleProp(s, p);
    return v === "0" || v === "0px";
  };
  if (zero("top") && zero("left") && zero("right") && zero("bottom")) return true;
  const full = (p: string) => {
    const v = styleProp(s, p);
    return v === "100%" || v === "1920px" || v === "1080px";
  };
  return full("width") && full("height");
}

// Cap the layer's opacity at 0.9 so the photo stays faintly visible behind
// the dark end. Leaves an already-translucent scrim alone.
function capOpacity(el: ScrimEl): boolean {
  const cur = styleProp(styleStr(el), "opacity");
  const val = cur ? parseFloat(cur) : 1;
  if (Number.isFinite(val) && val > 0.9) {
    el.style.setProperty("opacity", "0.9");
    return true;
  }
  return false;
}

// ─── CSS linear-gradient parsing ─────────────────────────────────────

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function colorOpacity(stop: string): number {
  const m = /^\s*(rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-fA-F]+|[a-zA-Z]+)/.exec(stop);
  if (!m) return 1;
  const c = m[1].toLowerCase();
  if (c === "transparent") return 0;
  const fn = /(?:rgba?|hsla?)\(([^)]*)\)/.exec(c);
  if (fn) {
    const parts = fn[1].split(",").map((x) => x.trim());
    if (parts.length >= 4) {
      const a = parseFloat(parts[3]);
      return Number.isFinite(a) ? a : 1;
    }
    return 1; // rgb()/hsl() with no alpha = opaque
  }
  if (c.startsWith("#")) {
    const hex = c.slice(1);
    if (hex.length === 8) return parseInt(hex.slice(6, 8), 16) / 255;
    if (hex.length === 4) return parseInt(hex[3] + hex[3], 16) / 255;
    return 1;
  }
  return 1; // named colour = opaque
}

// The screen side of the opaque end of a HORIZONTAL css gradient, or null if
// the gradient isn't horizontal (we only re-orient left/right scrims).
function cssGradientDarkSide(grad: string): Side {
  const inner = /linear-gradient\(([\s\S]*)\)\s*$/i.exec(grad)?.[1];
  if (!inner) return null;
  const parts = splitTopLevel(inner);
  if (parts.length < 2) return null;
  const first = parts[0].toLowerCase();
  let toRight: boolean | null = null; // true=right, false=left, null=not horizontal
  let stops = parts;
  if (/^(to\s+|[-\d.]+(deg|grad|rad|turn)$)/.test(first)) {
    stops = parts.slice(1);
    if (first === "to right" || first === "90deg") toRight = true;
    else if (first === "to left" || first === "270deg") toRight = false;
    else return null; // vertical / diagonal — not our case
  } else {
    return null; // no angle = default "to bottom" (vertical)
  }
  if (stops.length < 2) return null;
  const firstOp = colorOpacity(stops[0]);
  const lastOp = colorOpacity(stops[stops.length - 1]);
  const opaqueIsLast = lastOp >= firstOp;
  // toRight: first→left, last→right. toLeft: first→right, last→left.
  if (toRight) return opaqueIsLast ? "right" : "left";
  return opaqueIsLast ? "left" : "right";
}

function flipCssGradientHorizontal(bg: string): string {
  return bg.replace(
    /(linear-gradient\(\s*)(to\s+right|to\s+left|90deg|270deg)/i,
    (_m, head: string, angle: string) => {
      const a = angle.toLowerCase();
      const flipped =
        a === "to right"
          ? "to left"
          : a === "to left"
            ? "to right"
            : a === "90deg"
              ? "270deg"
              : "90deg";
      return head + flipped;
    },
  );
}

// ─── CLASS-RULE scrims (the gradient lives in the deck <style>, not inline) ──
//
// The element-level pass above reads INLINE styles only. But Claude almost
// always factors the scrim into a class rule — `.scrim{background:linear-
// gradient(90deg,var(--brand-5),transparent)}` — so the <div class="scrim">
// carries no inline background and the inline pass can't see it. That leaves the
// most common scrim untouched: in RTL a `90deg` (dark-LEFT) scrim darkens the
// empty side while the text sits on the bright right (user-reported 2026-07-09).
//
// This pass rewrites the STYLESHEET: it flips the horizontal direction of any
// linear-gradient that is a genuine FADE (opaque end -> transparent end — the
// semantic signature of a legibility scrim) so its dark end faces the reading
// side (rtl -> right, ltr -> left). A decorative colour->colour gradient is NOT
// a fade, so it is left alone. Diagonal / vertical scrims are out of scope (the
// existing pass is horizontal-only too).

// The dark side of a horizontal gradient ONLY when it is a real fade (one end
// effectively transparent, the other effectively opaque); null otherwise.
function horizontalFadeDarkSide(grad: string): "left" | "right" | null {
  const side = cssGradientDarkSide(grad);
  if (side !== "left" && side !== "right") return null;
  const inner = /linear-gradient\(([\s\S]*)\)\s*$/i.exec(grad)?.[1];
  if (!inner) return null;
  const parts = splitTopLevel(inner);
  const first = (parts[0] ?? "").toLowerCase();
  const stops = /^(to\s+|[-\d.]+(deg|grad|rad|turn)$)/.test(first)
    ? parts.slice(1)
    : parts;
  if (stops.length < 2) return null;
  let minOp = 1;
  let maxOp = 0;
  for (const s of stops) {
    const o = colorOpacity(s);
    if (o < minOp) minOp = o;
    if (o > maxOp) maxOp = o;
  }
  // A scrim fades from ~opaque to ~transparent; a decorative gradient does not.
  if (!(minOp < 0.3 && maxOp > 0.6)) return null;
  return side;
}

// Every `linear-gradient(...)` expression in the CSS, paren-balanced (so nested
// rgba()/var() don't truncate the match).
function findLinearGradients(
  css: string,
): { start: number; end: number; expr: string }[] {
  const out: { start: number; end: number; expr: string }[] = [];
  const re = /linear-gradient\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < css.length && depth > 0) {
      const ch = css[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      i++;
    }
    out.push({ start: m.index, end: i, expr: css.slice(m.index, i) });
    re.lastIndex = i;
  }
  return out;
}

/**
 * Flip every horizontal FADE gradient in a stylesheet toward the reading side
 * (rtl -> dark on right, ltr -> dark on left). Returns the rewritten CSS and
 * whether anything changed. Only touches opaque->transparent horizontal
 * gradients; decorative and diagonal/vertical gradients are left as authored.
 */
export function rewriteScrimGradientsInCss(
  css: string,
  direction: "rtl" | "ltr",
): { css: string; changed: boolean } {
  const grads = findLinearGradients(css);
  if (grads.length === 0) return { css, changed: false };
  const desired: "left" | "right" = direction === "rtl" ? "right" : "left";
  let out = "";
  let cursor = 0;
  let changed = false;
  for (const g of grads) {
    out += css.slice(cursor, g.start);
    const side = horizontalFadeDarkSide(g.expr);
    if (side && side !== desired) {
      out += flipCssGradientHorizontal(g.expr);
      changed = true;
    } else {
      out += g.expr;
    }
    cursor = g.end;
  }
  out += css.slice(cursor);
  return { css: out, changed };
}

// The background that makes a full-bleed layer a *scrim* (a dark overlay), and
// which CSS property carries it. A transparent layer (e.g. the text-content
// container) returns null and is left untouched.
function scrimBackground(
  el: ScrimEl,
): { prop: string; value: string } | null {
  const s = styleStr(el);
  for (const prop of ["background", "background-image", "background-color"]) {
    const v = styleProp(s, prop);
    if (v && v !== "transparent" && v !== "none") return { prop, value: v };
  }
  return null;
}

function handleDivScrim(el: ScrimEl, desired: "left" | "right"): boolean {
  const bg = scrimBackground(el);
  if (!bg) return false; // transparent layer (content container) — not a scrim
  // Soften EVERY scrim layer (gradient or flat tint) so the photo shows
  // through — the user's "10% reduced opacity" applies to all full-screen
  // layers above the image, not just gradients.
  let changed = capOpacity(el);
  // Re-orient only horizontal gradients; flat tints have no "dark side".
  if (/linear-gradient/i.test(bg.value)) {
    const side = cssGradientDarkSide(bg.value);
    if ((side === "left" || side === "right") && side !== desired) {
      el.style.setProperty(bg.prop, flipCssGradientHorizontal(bg.value));
      changed = true;
    }
  }
  return changed;
}

// ─── SVG <linearGradient> parsing ────────────────────────────────────

function svgLinearDarkSide(lg: ScrimEl): Side {
  const x1 = toUnit(lg.getAttribute("x1"), 0);
  const y1 = toUnit(lg.getAttribute("y1"), 0);
  const x2 = toUnit(lg.getAttribute("x2"), 1);
  const y2 = toUnit(lg.getAttribute("y2"), 0);
  if (Math.abs(y1 - y2) > 0.01 || Math.abs(x1 - x2) < 0.01) return null; // not horizontal
  const stops = Array.from(lg.querySelectorAll("stop"));
  if (stops.length < 2) return null;
  let maxOp = -1;
  let maxOffset = 0;
  for (const st of stops) {
    const op = toUnit(st.getAttribute("stop-opacity"), 1);
    const off = toUnit(st.getAttribute("offset"), 0);
    if (op > maxOp) {
      maxOp = op;
      maxOffset = off;
    }
  }
  const x = x1 + (x2 - x1) * maxOffset;
  return x > 0.5 ? "right" : "left";
}

function handleSvgScrim(el: ScrimEl, desired: "left" | "right"): boolean {
  const lg = el.querySelector("linearGradient");
  if (!lg) return false;
  let changed = capOpacity(el);
  const side = svgLinearDarkSide(lg);
  if ((side === "left" || side === "right") && side !== desired) {
    const x1 = lg.getAttribute("x1");
    const x2 = lg.getAttribute("x2");
    lg.setAttribute("x1", x2 ?? "0");
    lg.setAttribute("x2", x1 ?? "1");
    changed = true;
  }
  return changed;
}

/**
 * Fix every full-bleed scrim layer over a generated image on a slide root.
 * `direction` decides the text side (rtl → right, ltr → left). Returns true if
 * anything changed. No-op when the slide has no generated image.
 */
export function applyScrimFixes(
  slideRootArg: unknown,
  direction: "rtl" | "ltr",
): boolean {
  // Duck-typed: a browser HTMLElement or a JSDOM element, both of which
  // implement the ScrimEl surface. Cast once at the boundary.
  const slideRoot = slideRootArg as ScrimEl;
  // Only act on slides with a FULL-SCREEN generated image. An accent/panel
  // image (slide-3 style) has its own decorative full-bleed gradients that are
  // NOT scrims and must be left alone — so a genimage that isn't itself
  // full-bleed disqualifies the slide.
  const genImages = Array.from(slideRoot.querySelectorAll("[data-genimage]"));
  if (!genImages.some((img) => isFullBleed(img))) return false;
  const desired: "left" | "right" = direction === "rtl" ? "right" : "left";
  let changed = false;
  const candidates: ScrimEl[] = [
    ...Array.from(slideRoot.querySelectorAll("div")),
    ...Array.from(slideRoot.querySelectorAll("svg")),
  ];
  for (const el of candidates) {
    if (!isFullBleed(el)) continue;
    const isSvg = el.tagName.toLowerCase() === "svg";
    if (isSvg ? handleSvgScrim(el, desired) : handleDivScrim(el, desired)) {
      changed = true;
    }
  }
  return changed;
}
