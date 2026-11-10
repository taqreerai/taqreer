"use client";

// Live slide build (owner, 2026-11-10): while a slide is still streaming, the
// studio shows it being built, shape by shape and letter by letter, so a long
// generation never looks frozen.
//
// The model's HTML arrives in bursts. Painting each burst as it lands looks
// stuttery, so this is a PLAYER, not a painter: `push()` hands it the slide's
// text so far, and a frame loop plays it back a little behind live at a pace
// that follows how much is buffered (more waiting = a bit faster, nearly empty
// = slower), so the motion never stops dead and never leaps a paragraph.
//
// Playback walks the HTML token by token and builds the slide's DOM itself:
//   - an element appears when its opening tag is reached, fading up into
//     place; its text then types in, one letter at a time;
//   - an <svg>, <table> or <style> waits until it is complete and lands whole
//     (half an SVG or table is not drawable);
//   - when a new element pushes its neighbours, they slide to their new place
//     (FLIP on the `translate` property, which composes with the slide's own
//     transforms instead of replacing them);
//   - a half-written tag is never shown: playback waits at the last full tag.
// Every element passes DOMPurify (same config as finished slides) before it
// touches the page. When the slide is complete, `finish()` swaps in the fully
// sanitised slide (with the RTL rewrites the per-element pass cannot run) under
// a short cross-fade, so the result is exactly what the studio shows after.

import { DOMPURIFY_CONFIG, getClientDOMPurify, sanitizeSlideHtml } from "@/lib/export/sanitize";

// Land whole: drawing these partially is broken or meaningless.
const ATOMIC = new Set(["svg", "table", "style", "math", "video", "audio", "select", "textarea", "script"]);
const VOID = new Set(["img", "br", "hr", "input", "source", "wbr", "meta", "link", "col", "area", "embed", "track"]);
// Typed along with their text, no fade of their own.
const INLINE = new Set(["span", "strong", "em", "b", "i", "u", "a", "small", "sup", "sub", "mark", "bdi", "bdo", "code", "s"]);

// Playback pace in "units": one per visible letter, a few per element (a
// beat while it fades in), extra after sentence punctuation.
const UNIT_ELEMENT = 4;
const UNIT_PUNCT = 5;
const MIN_RATE = 14; // units/s while the buffer is nearly empty
const MAX_RATE = 900;
const TARGET_LAG_S = 1.6; // how far behind live playback aims to sit
const FINISH_WITHIN_S = 2.4; // once the slide is complete, catch up this fast
const RATE_SMOOTHING_S = 0.5;

const ENTER_MS = 420;
const FLIP_MS = 340;
const EASE_OUT = "cubic-bezier(.2,.75,.25,1)";

type Opts = {
  /** The positioned, scaled host the slide is drawn into (cleared on start). */
  host: HTMLElement;
  /** Current visual scale of the host (screen px per slide px), for FLIP. */
  scale: () => number;
  reducedMotion?: boolean;
  /**
   * Phones and slow devices: no blur and no sliding of pushed neighbours,
   * only a short fade-up. Also switched on by itself when frames run slow.
   */
  lite?: boolean;
  /** Called every frame with the caret's place (host px), or null when hidden. */
  onCaret?: (caret: { x: number; y: number; h: number; idle: boolean } | null) => void;
  /** Called once playback has caught up with a complete slide. */
  onComplete?: () => void;
};

export class LiveSlideBuild {
  private source = "";
  private complete = false;
  private pos = 0;
  private stack: Element[] = [];
  private text: Text | null = null;
  private budget = 0;
  private rate = MIN_RATE;
  private raf = 0;
  private last = 0;
  private idleSince = 0;
  private done = false;
  private lite: boolean;
  private slowFrames = 0;
  private aheadCache = 0;
  private aheadAt = -1;
  private aheadLen = -1;
  private caretDir: { node: Text; rtl: boolean } | null = null;
  private readonly dp = getClientDOMPurify();

  constructor(private readonly o: Opts) {
    this.lite = Boolean(o.lite || o.reducedMotion);
    o.host.replaceChildren();
  }

  /** True once playback has caught up with a complete slide. */
  get finished(): boolean {
    return this.done;
  }

  /** The slide's text so far (each call passes the whole, growing string). */
  push(text: string, complete = false): void {
    if (text.length >= this.source.length) this.source = text;
    if (complete) this.complete = true;
    if (!this.raf && !this.done) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  /** Has any text arrived for this slide. */
  get hasContent(): boolean {
    return this.source.length > 0;
  }

  /** The slide's end was missed (a gap between updates): play out what we have. */
  finishNow(): void {
    this.push(this.source, true);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.o.onCaret?.(null);
  }

  // ── frame loop ────────────────────────────────────────────────────────
  private frame = (now: number) => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    // A device that cannot keep up drops to the light effects for good.
    if (!this.lite) {
      this.slowFrames = dt > 0.034 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 1);
      if (this.slowFrames > 20) this.lite = true;
    }

    const ahead = this.unitsAhead();
    let want = Math.max(MIN_RATE, ahead / TARGET_LAG_S);
    if (this.complete) want = Math.max(want, ahead / FINISH_WITHIN_S);
    want = Math.min(MAX_RATE, want);
    // Ease the rate toward the target so bursts do not jolt the typing.
    this.rate += (want - this.rate) * Math.min(1, dt / RATE_SMOOTHING_S);
    this.budget += this.rate * dt;

    let starved = false;
    while (this.budget > 0) {
      const cost = this.step();
      if (cost < 0) {
        starved = true;
        this.budget = 0;
        break;
      }
      this.budget -= cost;
    }

    if (starved && !this.idleSince) this.idleSince = now;
    if (!starved) this.idleSince = 0;
    this.reportCaret(starved && now - this.idleSince > 250);

    if (this.complete && this.pos >= this.source.length) {
      this.done = true;
      this.raf = 0;
      this.o.onCaret?.(null);
      this.o.onComplete?.();
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  // Rough count of playback units still buffered (letters + elements).
  private unitsAhead(): number {
    // Rescanning every frame is wasted work: only when the text grew or
    // playback moved on by a fair step.
    if (this.aheadLen === this.source.length && this.pos - this.aheadAt < 200) {
      return Math.max(0, this.aheadCache - (this.pos - this.aheadAt));
    }
    this.aheadLen = this.source.length;
    this.aheadAt = this.pos;
    this.aheadCache = this.countAhead();
    return this.aheadCache;
  }

  private countAhead(): number {
    const s = this.source;
    let units = 0;
    let inTag = false;
    for (let i = this.pos; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 60 /* < */) {
        inTag = true;
        units += 1;
      } else if (c === 62 /* > */) inTag = false;
      else if (!inTag && c > 32) units += 1;
    }
    return units;
  }

  /**
   * Plays one token. Returns its cost in units, 0 for free work (closing
   * tags, whitespace), or -1 when the buffer ends mid-token (wait for more).
   */
  private step(): number {
    const s = this.source;
    if (this.pos >= s.length) return -1;
    if (s[this.pos] === "<") return this.tag();
    if (s[this.pos] === "&") {
      const semi = s.indexOf(";", this.pos);
      if (semi < 0 || semi - this.pos > 12) {
        if (semi < 0 && !this.complete) return -1;
        return this.type("&", 1);
      }
      const decoded = decodeEntity(s.slice(this.pos, semi + 1));
      return this.type(decoded, semi + 1 - this.pos);
    }
    // Whitespace runs cost nothing; one letter at a time otherwise.
    const ch = s[this.pos];
    if (/\s/.test(ch)) {
      let end = this.pos;
      while (end < s.length && /\s/.test(s[end])) end++;
      this.appendText(" ", end - this.pos, true);
      return 0;
    }
    // Keep a surrogate pair together (emoji, rare scripts).
    const cp = s.codePointAt(this.pos) ?? 0;
    const len = cp > 0xffff ? 2 : 1;
    return this.type(s.slice(this.pos, this.pos + len), len);
  }

  private type(chars: string, consumed: number): number {
    this.appendText(chars, consumed, false);
    return /[.!?؟،,:;]/.test(chars) ? UNIT_PUNCT : 1;
  }

  private appendText(chars: string, consumed: number, whitespace: boolean): void {
    this.pos += consumed;
    const parent = this.stack[this.stack.length - 1];
    if (!parent) return; // text before the slide root: ignore
    if (whitespace && !this.text) {
      parent.appendChild(document.createTextNode(" "));
      return;
    }
    if (!this.text || this.text.parentNode !== parent) {
      this.text = document.createTextNode("");
      parent.appendChild(this.text);
    }
    this.text.data += chars;
  }

  private tag(): number {
    const s = this.source;
    if (s.startsWith("<!--", this.pos)) {
      const end = s.indexOf("-->", this.pos);
      if (end < 0) return -1;
      this.pos = end + 3;
      return 0;
    }
    const end = tagEnd(s, this.pos);
    if (end < 0) return -1;
    const raw = s.slice(this.pos, end + 1);
    const close = /^<\/\s*([a-zA-Z][\w-]*)/.exec(raw);
    if (close) {
      this.pos = end + 1;
      this.closeTo(close[1].toLowerCase());
      return 0;
    }
    const open = /^<([a-zA-Z][\w-]*)/.exec(raw);
    if (!open) {
      // A stray "<" in text.
      return this.type("<", 1);
    }
    const name = open[1].toLowerCase();
    if (ATOMIC.has(name)) {
      const whole = wholeElement(s, this.pos, name);
      if (whole < 0) return -1;
      const html = s.slice(this.pos, whole);
      this.pos = whole;
      if (name === "script") return 0;
      this.insert(html, name, false);
      return name === "style" ? 0 : UNIT_ELEMENT * 3;
    }
    this.pos = end + 1;
    const selfClosing = VOID.has(name) || /\/\s*>$/.test(raw);
    const el = this.insert(selfClosing ? raw : `${raw}</${name}>`, name, !selfClosing);
    return el && !INLINE.has(name) ? UNIT_ELEMENT : 0;
  }

  private closeTo(name: string): void {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i].localName === name) {
        this.stack.length = i;
        this.text = null;
        return;
      }
    }
  }

  /** Sanitises one element (shallow, or whole for atomic ones) and places it. */
  private insert(html: string, name: string, opens: boolean): Element | null {
    // Wrapped in a div: a leading <style> on its own is hoisted to <head> and
    // dropped by DOMPurify's parse (see buildSlideHtml).
    const clean = this.dp.sanitize(`<div>${html}</div>`, DOMPURIFY_CONFIG);
    const tpl = document.createElement("template");
    tpl.innerHTML = clean;
    const el = tpl.content.firstElementChild?.firstElementChild ?? null;
    if (!el || el.localName !== name) return null;

    const parent = this.stack[this.stack.length - 1] ?? this.o.host;
    const isRoot = this.stack.length === 0;
    const animate = !isRoot && name !== "style" && !INLINE.has(name);
    const before = animate && !this.lite ? this.measure() : null;

    parent.appendChild(el);
    this.text = null;
    if (opens) this.stack.push(el);

    if (isRoot) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-out" });
    } else if (animate) {
      this.enter(el as HTMLElement | SVGElement);
      if (before) this.flip(before);
    }
    if (el instanceof HTMLImageElement) this.fadeOnLoad(el);
    el.querySelectorAll?.("img").forEach((img) => this.fadeOnLoad(img));
    return el;
  }

  private enter(el: Element): void {
    const frames = this.o.reducedMotion
      ? [{ opacity: 0 }, { opacity: 1 }]
      : this.lite
        ? [
            { opacity: 0, translate: "0 8px" },
            { opacity: 1, translate: "0 0" },
          ]
        : [
            { opacity: 0, translate: "0 14px", filter: "blur(2px)" },
            { opacity: 1, translate: "0 0", filter: "blur(0)" },
          ];
    el.animate(frames, { duration: this.o.reducedMotion ? 200 : this.lite ? 300 : ENTER_MS, easing: EASE_OUT });
  }

  private fadeOnLoad(img: HTMLImageElement): void {
    if (img.complete && img.naturalWidth > 0) return;
    img.style.setProperty("opacity", "0");
    const show = () => {
      img.style.removeProperty("opacity");
      img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, easing: "ease-out" });
    };
    img.addEventListener("load", show, { once: true });
    img.addEventListener("error", () => img.style.removeProperty("opacity"), { once: true });
  }

  // FLIP: where every element in the slide sits before the insert...
  private measure(): Map<Element, DOMRect> {
    const root = this.stack[0];
    const out = new Map<Element, DOMRect>();
    if (!root) return out;
    // Boxes only: text-level elements ride along with their block.
    for (const el of root.querySelectorAll("*")) {
      if (out.size >= 250) break;
      if (el.localName === "style" || INLINE.has(el.localName)) continue;
      out.set(el, el.getBoundingClientRect());
    }
    return out;
  }

  // ...and sliding the ones that moved from there to their new place.
  private flip(before: Map<Element, DOMRect>): void {
    const k = this.o.scale() || 1;
    before.forEach((was, el) => {
      if (!el.isConnected) return;
      const now = el.getBoundingClientRect();
      const dx = (was.left - now.left) / k;
      const dy = (was.top - now.top) / k;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      // Skip an element whose parent moved too: the parent's slide carries it.
      const p = el.parentElement;
      const pw = p ? before.get(p) : undefined;
      if (p && pw) {
        const pn = p.getBoundingClientRect();
        if (Math.abs(pw.left - pn.left - dx * k) < 0.5 && Math.abs(pw.top - pn.top - dy * k) < 0.5) return;
      }
      el.getAnimations().forEach((a) => {
        if ((a as Animation & { id: string }).id === "tq-flip") a.cancel();
      });
      const anim = el.animate([{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], {
        duration: FLIP_MS,
        easing: EASE_OUT,
        composite: "add",
      });
      anim.id = "tq-flip";
    });
  }

  private reportCaret(idle: boolean): void {
    const cb = this.o.onCaret;
    if (!cb) return;
    const t = this.text;
    if (!t || !t.isConnected || t.data.length === 0) {
      cb(null);
      return;
    }
    const r = document.createRange();
    r.setStart(t, Math.max(0, t.data.length - 1));
    r.setEnd(t, t.data.length);
    const rects = r.getClientRects();
    const box = rects[rects.length - 1];
    if (!box) {
      cb(null);
      return;
    }
    const host = this.o.host.getBoundingClientRect();
    if (this.caretDir?.node !== t) {
      this.caretDir = { node: t, rtl: getComputedStyle(t.parentElement ?? this.o.host).direction === "rtl" };
    }
    const rtl = this.caretDir.rtl;
    cb({ x: (rtl ? box.left : box.right) - host.left, y: box.top - host.top, h: box.height, idle });
  }

  /** The finished slide, fully sanitised, cross-faded over the live build. */
  static finalHtml(html: string): string {
    return sanitizeSlideHtml(html);
  }
}

// End of the tag opening at `from` (index of its ">"), honouring quotes, or -1.
function tagEnd(s: string, from: number): number {
  let q = "";
  for (let i = from + 1; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = "";
    } else if (c === '"' || c === "'") q = c;
    else if (c === ">") return i;
  }
  return -1;
}

// Index just past the element opening at `from` (same-name nesting counted),
// or -1 while it is still incomplete.
function wholeElement(s: string, from: number, name: string): number {
  const re = new RegExp(`<(/?)${name}\\b[^>]*?(/?)>`, "gi");
  re.lastIndex = from;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m[1]) depth--;
    else if (!m[2]) depth++;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

let decoder: HTMLTextAreaElement | null = null;
function decodeEntity(entity: string): string {
  decoder ??= document.createElement("textarea");
  decoder.innerHTML = entity;
  return decoder.value;
}
