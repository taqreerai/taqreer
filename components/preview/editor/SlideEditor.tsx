"use client";

// In-canvas slide editor (context/plan-editor.md §0.5/§0.6 — the claude.ai/design
// clone). Renders the slide inside a SAME-ORIGIN srcdoc iframe — CSS isolation +
// export-parity-by-construction + a security boundary; no app styles bleed onto the
// slide. Because it's same-origin we script the iframe document directly (no
// postMessage bridge — that's the prod hardening step). Owns: element tagging
// (data-tq-id / data-tq-cc), hover + selection overlays drawn INSIDE the iframe
// (inflated ~2px so borders never touch glyphs), click→select-visual-leaf, and
// hardened dbl-click→contentEditable. Selection is controlled by the parent shell.
//
// Proven in /lab/editor (Phase 0). Content is scaled INSIDE the iframe (#tqe-stage):
// a transform on the iframe ELEMENT clips its paint in Chromium.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SlideType, ThemeType } from "@/lib/schema/slide";
import { sanitizeSlideHtml } from "@/lib/export/sanitize";
import { themeToCssVars } from "@/lib/export/theme-css-vars";
import { isVisualLeaf, isTextEditable, resolveSelectable } from "@/lib/editor/leaves";
import { serializeSlideSection } from "@/lib/editor/serialize";
import { slideRootBackground } from "@/components/slides/SlideRenderer";
import { buildDeckFontHead } from "@/lib/export/font-head";
import { googleFontLinkTags } from "@/lib/editor/font-search";

type Props = {
  slide: SlideType;
  theme: ThemeType;
  direction: "rtl" | "ltr";
  language: "ar" | "en";
  width: number;
  height: number;
  scale: number;
  selected: HTMLElement | null;
  onSelect: (el: HTMLElement | null) => void;
  onDocReady: (doc: Document | null) => void;
  // Fired when a text edit settles (blur) and actually changed the slide — the
  // parent persists it. Carries the slide's id (so a save lands on the right
  // slide even if focus moved) + the serialized section HTML.
  onEdit?: (slideId: string, html: string) => void;
  // Bump to force the iframe to re-render from `slide.html` (restore / undo /
  // peer edit). The iframe is otherwise PINNED to the slide identity so a
  // self-save — which updates `slide.html` — never blows away the live DOM the
  // user is editing. See the bodyHtml effect.
  reloadKey?: number;
  // When true (slide locked / mid-regen) the editor renders IDENTICALLY but is
  // inert — no hover box, no click-to-select, no edit mode, no selection box.
  // Kept mounted (rather than swapped for SlideRenderer) so disabling never
  // swaps renderers, which would flash + nudge the content.
  disabled?: boolean;
};

export function SlideEditor({
  slide, theme, direction, language, width, height, scale,
  selected, onSelect, onDocReady, onEdit, reloadKey = 0, disabled = false,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const selBoxRef = useRef<HTMLElement | null>(null);
  const hoverBoxRef = useRef<HTMLElement | null>(null);
  // Keep the latest onSelect without re-attaching iframe listeners every render.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  // Latest selection, read by the (once-attached) iframe hover handler.
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  // Keep onEdit current without re-attaching iframe listeners.
  const onEditRef = useRef(onEdit);
  useEffect(() => {
    onEditRef.current = onEdit;
  }, [onEdit]);
  // Latest `disabled`, read by the once-attached iframe handlers so lock/regen
  // toggles take effect without re-wiring.
  const disabledRef = useRef(disabled);
  useEffect(() => {
    disabledRef.current = disabled;
    if (!disabled) return;
    // Lock / regenerate flipped on mid-edit: end any open edit session too, not
    // just block new ones. Blur the active contenteditable (its one-shot blur
    // handler removes `contenteditable` + commits) and drop the hover box, so a
    // locked/regenerating slide can no longer accept keystrokes.
    place(hoverBoxRef.current, null);
    const active = iframeRef.current?.contentDocument?.activeElement as HTMLElement | null;
    if (active?.isContentEditable) active.blur();
  }, [disabled]);

  // Sanitise the slide HTML in an effect — DOMPurify needs the live window, so doing
  // it during render hits the fail-closed (empty) path. Same pattern as SlideRenderer;
  // first render is intentionally empty, then this fills it.
  //
  // PINNED to slide IDENTITY (slideId), not slide.html: the iframe is the live
  // editing surface, so a self-save — which updates slide.html to the serialized
  // DOM — must NOT rebuild the iframe and wipe the user's place. The iframe
  // rebuilds only when the slide changes (navigation) or `reloadKey` bumps
  // (restore / undo / peer edit), reading the latest slide.html at that moment.
  const [bodyHtml, setBodyHtml] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBodyHtml(sanitizeSlideHtml(slide.html));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide.slideId, reloadKey]);

  // Scale the CONTENT inside the iframe — a `transform` on the iframe ELEMENT clips
  // its paint in Chromium (element box scales but the slide gets cut to a sliver). The
  // iframe sits at DISPLAY size; an inner #tqe-stage holds the full slide scaled to
  // fit. getBoundingClientRect of slide elements then returns display coords, which the
  // overlays use directly.
  //
  // CEIL, not round: the clip parent is sized by `aspect-ratio` + `width:min()`, so
  // its height is fractional (e.g. 779.625px). The iframe ELEMENT is ceil'd so it
  // always ≥ the clip and overflow-hidden trims the overshoot (sharp integer paint;
  // a fractional iframe rounds its internal viewport).
  const dispW = Math.ceil(width * scale);
  const dispH = Math.ceil(height * scale);
  // OVERSCAN the content to FILL the ceil'd iframe, not the fractional clip. At the
  // exact fit, the slide's bottom/right edge lands ON the fractional clip boundary,
  // so its anti-aliased edge blends with whatever's behind it — and the iframe/body
  // bg is the DECK theme (e.g. white) while the slide section can be a different
  // colour (e.g. a black title slide). That mismatch is the ~1px white line. Scaling
  // the stage to dispW×dispH pushes the edge PAST the clip, so overflow-hidden trims
  // the fuzzy edge and only SOLID slide colour meets the boundary — works for any
  // slide colour or gradient. The overshoot on the other axis is sub-px, also clipped.
  const fillScale = Math.max(dispW / width, dispH / height);
  // The display scale lives in a CSS var (--tqe-scale), NOT baked into the srcDoc
  // string. A resize changes `scale` ~every frame; if that recomputed the srcDoc,
  // the iframe would RELOAD on every tick — flashing the canvas AND re-firing
  // onDocReady (which rebuilds the Layers tree → that panel flashes too). The
  // srcDoc bakes the current scale as the var's initial value (no first-paint pop)
  // but it's NOT a memo dep, so a resize doesn't recompute it. A ref carries the
  // latest scale to wire() (which sets the var on iframe load), and the effect below
  // sets it on every resize.
  const scaleRef = useRef(fillScale);
  useEffect(() => {
    scaleRef.current = fillScale;
  }, [fillScale]);
  // Slide's own root background — painted on the iframe element so it doesn't
  // flash white before the srcDoc loads (the reload FOUC). Fallback TRANSPARENT
  // (not the deck theme): decks that paint their visible bg on a CHILD leave the
  // root white, so a theme fallback would still flash white — transparent lets
  // the dark editor canvas behind show through that one frame. Same helper +
  // rationale as SlideRenderer's wrapper.
  const iframeBg = useMemo(
    () => slideRootBackground(slide.html, "transparent"),
    [slide.html],
  );
  const srcDoc = useMemo(() => {
    const vars = themeToCssVars(theme) as Record<string, string>;
    const rootVars = Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";");
    // Load the deck's actual fonts INTO the iframe (Google <link> + uploaded
    // @font-face) — same source the export uses; without it the iframe is its own
    // document and falls back to a system font (wrong, esp. Arabic).
    const { links, faceCss } = buildDeckFontHead(theme);
    // Per-element fonts the user picked (font-search) — inject the css2 <link>
    // for any catalog font referenced in this slide's HTML so it renders on load.
    const pickedFontLinks = googleFontLinkTags(bodyHtml);
    return `<!doctype html><html dir="${direction}" lang="${language}"><head><meta charset="utf-8">
${links}
${pickedFontLinks}
<style>
${faceCss ? `${faceCss}\n` : ""}  html,body{margin:0;padding:0;height:100%}
  :root{${rootVars};--tqe-scale:${fillScale}}
  /* Body fills the iframe ELEMENT (sized to dispW×dispH in React), so a resize
     resizes the iframe element without touching this document. */
  body{position:relative;width:100%;height:100%;overflow:hidden;background:${theme.background};color:${theme.text};font-family:var(--font-body),'Cairo',system-ui,sans-serif}
  /* absolute + top-left so the RTL body can't right-align this wider-than-body
     stage. Scale via the live --tqe-scale var (updated on resize, no reload). */
  #tqe-stage{position:absolute;top:0;left:0;width:${width}px;height:${height}px;transform:scale(var(--tqe-scale));transform-origin:top left}
  /* The slide is a CANVAS OF OBJECTS, not selectable text: a plain pointer cursor
     (never the text I-beam) and no native text selection, so the empty space inside
     a text box is fully inert and only an object's real ink is ever interactive.
     Both flip to text behaviour ONLY on the element actually being edited. */
  #tqe-stage,#tqe-stage *{cursor:default;-webkit-user-select:none;user-select:none}
  /* Hide the native caret (it's the font's full em box — ~2x the visible glyphs
     for Arabic) and draw a custom one sized to the text via .tqe-caret. */
  #tqe-stage [contenteditable="true"],#tqe-stage [contenteditable="true"] *{cursor:text;-webkit-user-select:text;user-select:text;caret-color:transparent}
  /* NOTE: the "lift the edited element above its neighbours" rule used to live here
     as a contenteditable position:relative + z-index, but an id-selector
     position:relative BEATS a class-based position:absolute — so editing an
     absolutely-positioned element (e.g. a 400px decorative number) snapped it to its
     in-flow spot. The lift is now applied in JS (enterEdit), position-aware: only add
     position:relative when the element is statically positioned. */
  .tqe-ov{position:fixed;pointer-events:none;z-index:2147483646;box-sizing:border-box;display:none}
  .tqe-hover{border:2px solid #10B981}
  .tqe-sel{border:2px solid #15B04F}
  .tqe-caret{position:fixed;width:2px;pointer-events:none;z-index:2147483646;display:none;animation:tqe-caret-blink 1.06s infinite}
  @keyframes tqe-caret-blink{0%,50%{opacity:1}50.01%,100%{opacity:0}}
  [contenteditable="true"]{outline:none}
  /* §19 — gen-image placeholder shimmer + live-patch fade, mirrored from
     globals.css so a regenerating image box reads as "loading" inside this
     iframe (which doesn't load the app stylesheet). A box whose src was dropped
     for a regen shows the shimmer; the patched src adds .tq-genimg-in to fade. */
  @keyframes tq-genimg-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
  img[data-genimage]:not([src]){background-color:var(--tq-bg-dim,rgba(12,12,12,0.55))!important;background-image:linear-gradient(110deg,rgba(255,255,255,0.05) 30%,rgba(255,255,255,0.18) 50%,rgba(255,255,255,0.05) 70%)!important;background-size:200% 100%!important;background-repeat:no-repeat!important;animation:tq-genimg-shimmer 1.4s ease-in-out infinite}
  @keyframes tq-genimg-fadein{from{opacity:0}to{opacity:1}}
  img[data-genimage].tq-genimg-in{animation:tq-genimg-fadein 450ms ease both}
  @media (prefers-reduced-motion:reduce){img[data-genimage]:not([src]){animation:none;background-position:50% 0}img[data-genimage].tq-genimg-in{animation:none}}
</style></head><body><div id="tqe-stage">${bodyHtml}</div></body></html>`;
    // scale intentionally excluded — it's presentation, applied live via the
    // --tqe-scale var + the iframe element's dispW×dispH size, so a resize never
    // rebuilds (reloads) this document. The memo bakes the initial scale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyHtml, theme, direction, language, width, height]);

  // Wire the iframe document once it loads (and on every srcDoc change → reload).
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const wire = () => {
      const doc = iframe.contentDocument as
        | (Document & { __tqWired?: boolean })
        | null;
      const sec = doc?.querySelector("section");
      if (!doc || !sec) return;
      // Run ONCE per document. The effect calls wire() both on the `load` event
      // AND synchronously when readyState is already "complete" (srcDoc iframes
      // usually are) — without this guard every doc listener + overlay would be
      // attached twice, so a single edit fired two save POSTs (and raced the DB
      // unique constraint). A fresh srcDoc → fresh document → re-wires.
      if (doc.__tqWired) return;
      doc.__tqWired = true;

      // Tag every element with a stable id; flag visual leaves (the editable units).
      let i = 0;
      for (const el of doc.querySelectorAll("*")) {
        if (el.tagName === "STYLE" || el.tagName === "SCRIPT") continue;
        el.setAttribute("data-tq-id", String(i++));
        if (isVisualLeaf(el)) el.setAttribute("data-tq-cc", "1");
      }

      // Overlay boxes (drawn inside the iframe → perfectly aligned, scale with it).
      const hover = doc.createElement("div");
      hover.className = "tqe-ov tqe-hover";
      const selBox = doc.createElement("div");
      selBox.className = "tqe-ov tqe-sel";
      const caret = doc.createElement("div");
      caret.className = "tqe-caret";
      doc.body.append(hover, selBox, caret);
      hoverBoxRef.current = hover;
      selBoxRef.current = selBox;

      // Draw the custom caret at the collapsed selection, sized to the VISIBLE text
      // (~font-size) rather than the native caret's font-em box (which is ~2x the
      // glyphs for Arabic). The browser's collapsed-range rect gives the x + the
      // text's vertical centre; we centre a font-size-tall bar on it.
      const placeCaret = (t: HTMLElement) => {
        const selc = doc.getSelection();
        if (!selc || !selc.isCollapsed || selc.rangeCount === 0 ||
            !t.contains(selc.getRangeAt(0).startContainer)) {
          caret.style.display = "none";
          return;
        }
        const r = selc.getRangeAt(0).getBoundingClientRect();
        const fs = parseFloat(getComputedStyle(t).fontSize) || 0;
        // The stage scales by fillScale now; read it via the live ref (this
        // setup effect runs once, so closing over `fillScale` directly would
        // go stale on resize, and the prop `scale` is the pre-overscan value).
        // CR #52: caret height was drifting at fractional overscan scales.
        const h = fs
          ? Math.min(r.height, fs * scaleRef.current * 1.02)
          : r.height;
        caret.style.display = "block";
        caret.style.left = `${r.left}px`;
        caret.style.top = `${r.top + r.height / 2 - h / 2}px`;
        caret.style.height = `${h}px`;
        caret.style.background = getComputedStyle(t).color;
      };

      // Last element the hover box was drawn for. Lets onMove skip the
      // (Range + canvas TextMetrics) re-measure in place()/inkBounds() when the
      // pointer hasn't crossed into a DIFFERENT unit since the previous move —
      // the common case on a dense slide, where the box is already correct.
      let lastHover: HTMLElement | null = null;
      const onMove = (e: MouseEvent) => {
        if (disabledRef.current) { place(hover, null); return; } // inert when locked/regen
        // resolveHit walks the FULL stack at the cursor and returns the topmost
        // element whose actual ink is under it — so an overlapping element's empty
        // overflow (e.g. a huge headline's glyphs spilling over a small label) never
        // steals the hover, and empty space hovers nothing.
        const unit = resolveHit(sec, e.clientX, e.clientY);
        const target = unit && unit !== selectedRef.current ? unit : null;
        if (target === lastHover) return;
        lastHover = target;
        place(hover, target);
      };
      const onLeave = () => {
        lastHover = null;
        place(hover, null);
      };

      // Put a text element into edit mode (contentEditable) + wire its edit session.
      const enterEdit = (t: HTMLElement) => {
        if (t.isContentEditable || !isTextEditable(t)) return;
        // Snapshot the slide BEFORE editing so blur can tell a real change from a
        // focus-and-leave (no-op → no save, no version churn).
        const before = serializeSlideSection(sec);
        t.setAttribute("contenteditable", "true");
        // preventScroll: focusing a huge-font element (whose glyphs overflow its
        // box) otherwise scrolls it into view and the whole number visibly JUMPS.
        t.focus({ preventScroll: true });
        // Lift the edited element above overlapping siblings so a drag-select lands
        // on it (siblings are user-select:none). Position-aware: only add
        // position:relative when the element is STATIC — forcing it onto an
        // absolutely-positioned element (e.g. a 400px decorative number) would snap
        // it to its in-flow spot. Restored in finish() before serialize, so the lift
        // never persists into the saved HTML.
        const liftStatic =
          (doc.defaultView ?? window).getComputedStyle(t).position === "static";
        const prevInlineZ = t.style.zIndex;
        const prevInlinePos = t.style.position;
        if (liftStatic) t.style.position = "relative";
        t.style.zIndex = "2147483640";
        try { doc.execCommand("defaultParagraphSeparator", false, "br"); } catch { /* unsupported */ }
        const onPaste = (ev: ClipboardEvent) => {
          ev.preventDefault();
          const raw = ev.clipboardData?.getData("text/plain") ?? "";
          const lines = raw.replace(/\r\n?/g, "\n").replace(/\n+$/g, "").split("\n");
          lines.forEach((line, idx) => {
            if (idx > 0) doc.execCommand("insertLineBreak");
            if (line) doc.execCommand("insertText", false, line);
          });
        };
        // Enter → a <br> inside THIS element (one editable unit, two visual lines).
        // Without intercepting it the browser splits the block into two separate
        // elements, leaving the first line uneditable. Shift+Enter is the same here.
        const onKeyDown = (ev: KeyboardEvent) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            doc.execCommand("insertLineBreak");
          }
        };
        // Keep the selection box wrapping the text + the custom caret tracking the
        // insertion point as the text grows/shrinks while typing (the controlled
        // `selected` doesn't change mid-edit, so its place() effect won't re-run).
        const onInput = () => { place(selBoxRef.current, t); placeCaret(t); };
        // selectionchange (document-level) covers caret moves from clicks + arrows.
        const onSelChange = () => placeCaret(t);
        // One-shot. Removing `contenteditable` from a FOCUSED element fires a
        // synchronous `blur`, which re-enters finish (→ a duplicate save, racing
        // the version unique-constraint) unless we latch + detach the listener
        // BEFORE removing the attribute.
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          t.removeEventListener("blur", finish);
          t.removeEventListener("paste", onPaste);
          t.removeEventListener("keydown", onKeyDown);
          t.removeEventListener("input", onInput);
          doc.removeEventListener("selectionchange", onSelChange);
          caret.style.display = "none";
          t.removeAttribute("contenteditable");
          // Undo the edit-time lift before serializing so it never lands in the HTML.
          t.style.zIndex = prevInlineZ;
          if (liftStatic) t.style.position = prevInlinePos;
          // Commit on settle: serialize the slide (editor artifacts stripped) and
          // hand it to the parent to persist — only if it actually changed.
          const after = serializeSlideSection(sec);
          if (after !== before) onEditRef.current?.(slide.slideId, after);
        };
        t.addEventListener("paste", onPaste);
        t.addEventListener("keydown", onKeyDown);
        t.addEventListener("input", onInput);
        t.addEventListener("blur", finish);
        doc.addEventListener("selectionchange", onSelChange);
        placeCaret(t);
      };

      const onClick = (e: MouseEvent) => {
        if (disabledRef.current) return; // locked/regen → no selection
        if ((e.target as HTMLElement | null)?.isContentEditable) return;
        const unit = resolveHit(sec, e.clientX, e.clientY);
        if (!unit) { onSelectRef.current(null); return; } // empty / bg → deselect
        e.preventDefault();
        // First click on a text leaf SELECTS it; clicking it AGAIN (now selected)
        // drops into edit mode — like Figma/Canva. A double-click is just two clicks,
        // so it lands in edit too (onDbl is the belt-and-braces shortcut below).
        if (unit === selectedRef.current && isTextEditable(unit)) {
          enterEdit(unit);
        } else {
          onSelectRef.current(unit);
        }
      };
      const onDbl = (e: MouseEvent) => {
        if (disabledRef.current) return; // locked/regen → no edit mode
        if ((e.target as HTMLElement | null)?.isContentEditable) return;
        const unit = resolveHit(sec, e.clientX, e.clientY);
        if (unit) { e.preventDefault(); enterEdit(unit); }
      };

      doc.addEventListener("mousemove", onMove);
      doc.addEventListener("mouseleave", onLeave);
      doc.addEventListener("click", onClick);
      doc.addEventListener("dblclick", onDbl);
      // Sync the live scale onto the freshly-loaded doc (the srcDoc's baked value
      // can be stale if `scale` changed while the iframe was loading).
      doc.documentElement.style.setProperty("--tqe-scale", String(scaleRef.current));
      onDocReady(doc);
    };

    iframe.addEventListener("load", wire);
    if (iframe.contentDocument?.readyState === "complete") wire();
    return () => {
      iframe.removeEventListener("load", wire);
      onDocReady(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcDoc]);

  // Push the live display scale into the iframe's --tqe-scale var on every resize
  // (the iframe ELEMENT is resized to dispW×dispH in React). This recolours the
  // #tqe-stage transform WITHOUT reloading the document — no flash. The srcDoc
  // already baked the correct initial value, so first paint is right too.
  useLayoutEffect(() => {
    iframeRef.current?.contentDocument?.documentElement?.style.setProperty(
      "--tqe-scale",
      String(fillScale),
    );
  }, [fillScale, srcDoc]);

  // Reposition the selection box whenever the controlled `selected` changes, AND
  // keep it glued to the element through two distinct kinds of change:
  //   • ResizeObserver — the element's BOX changes size (font-size bump, bold,
  //     web-font swap-in, container reflow).
  //   • MutationObserver on `style` — a text-align flip MOVES the glyphs inside
  //     an unchanged box, so it never triggers a resize. Watching the inline
  //     style attribute re-inks the box on align (and on any other pill write).
  useEffect(() => {
    // When disabled (locked/regen) the selection box is hidden too — the editor
    // is inert, so nothing should look selected.
    const sel = disabled ? null : selected;
    place(selBoxRef.current, sel);
    if (!sel) return;
    const replace = () => place(selBoxRef.current, sel);
    const ro = new ResizeObserver(replace);
    ro.observe(sel);
    const mo = new MutationObserver(replace);
    mo.observe(sel, { attributes: true, attributeFilter: ["style"] });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [selected, disabled]);

  return (
    // dispW×dispH are ceil'd (≥ the fractional clip), so the iframe slightly
    // overshoots and overflow-hidden on the parent trims it — no bottom/edge gap.
    <div style={{ width: dispW, height: dispH, position: "relative" }}>
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        title="slide editor"
        width={dispW}
        height={dispH}
        style={{
          border: 0,
          display: "block",
          width: `${dispW}px`,
          height: `${dispH}px`,
          background: iframeBg,
        }}
      />
    </div>
  );
}

// Resolve a pointer position to the topmost SELECTABLE leaf whose actual ink sits
// under it. Walks the full elementsFromPoint stack (not just e.target) so an
// overlapping element's EMPTY overflow can't capture the hit — e.g. a huge
// headline whose glyphs spill up over a small label, or a wide-but-mostly-empty
// text box. The first stacked element whose pointInInk passes wins; empty space
// (no ink under the cursor) resolves to null → deselect.
function resolveHit(sec: Element, x: number, y: number): HTMLElement | null {
  for (const el of sec.ownerDocument.elementsFromPoint(x, y)) {
    if (el === sec || !sec.contains(el)) continue;
    const unit = resolveSelectable(el, sec);
    if (unit && pointInInk(unit, x, y)) return unit;
  }
  return null;
}

// Per-line client rects for an element's text content (iframe viewport coords),
// or null for non-text (img / svg) / empty elements — callers fall back to the
// layout box. Returns the raw Range line rects; each caller filters as it needs.
// Shared by pointInInk (hit-testing) and inkBounds (overlay placement) so the
// "is this measurable text, and where are its lines" preamble lives in one place.
function textContentRects(el: HTMLElement): DOMRectList | null {
  const tag = el.tagName.toLowerCase();
  if (tag === "img" || tag === "svg" || !(el.textContent || "").trim()) return null;
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  return range.getClientRects();
}

// True when (x, y) — iframe viewport coords — is over the element's actual visible
// content. For an image/graphic that's its box. For TEXT it's the union of per-LINE
// hit regions: each line's HORIZONTAL span comes from its text rects (tight to the
// glyphs), its VERTICAL span from an equal slice of the element's line-height box.
// Keeps hover / select / edit off the empty layout space beside, above, and below
// the text (e.g. the gap left of a short right-aligned line).
//
// Why not use the raw Range client rects directly: for large, tight-leading text
// they're FONT-EM-sized — taller than the line box, overlapping each other, and
// spilling ~font-size past the box top and bottom — so a naive rect test reports a
// hit across the whole block and even outside it. We take only their horizontal
// extent and rebuild the vertical from the real line-height grid.
function pointInInk(el: HTMLElement, x: number, y: number): boolean {
  const box = el.getBoundingClientRect();
  const contentRects = textContentRects(el);
  if (!contentRects) {
    // img / svg / empty → the whole layout box is the hit target.
    return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  }
  const PAD = 3;
  // The layout box is the true vertical bound — anything past it isn't the text.
  if (
    x < box.left - PAD || x > box.right + PAD ||
    y < box.top - PAD || y > box.bottom + PAD
  ) {
    return false;
  }
  const win = el.ownerDocument.defaultView;
  const fs = win ? parseFloat(win.getComputedStyle(el).fontSize) || 0 : 0;
  const rects = [...contentRects].filter((r) => r.width > 0.5);
  if (!rects.length) return true; // text exists but unmeasurable → fall back to box
  // Group the text rects into LINES by vertical centre. We derive the line count
  // from the rects THEMSELVES, not box.height / line-height — the rendered height
  // and computed line-height don't always agree, which collapsed multi-line text
  // into a single full-width band. Two rects share a line when their centres are
  // within ~0.3em; distinct lines always sit farther apart.
  const gap = Math.max(3, fs * 0.3);
  const lines: { cy: number; left: number; right: number }[] = [];
  for (const r of rects.sort((a, b) => a.top + a.bottom - (b.top + b.bottom))) {
    const cy = (r.top + r.bottom) / 2;
    const last = lines[lines.length - 1];
    if (last && cy - last.cy <= gap) {
      last.left = Math.min(last.left, r.left);
      last.right = Math.max(last.right, r.right);
    } else {
      lines.push({ cy, left: r.left, right: r.right });
    }
  }
  // Each line's hit region: its rects' HORIZONTAL span × a VERTICAL band running to
  // the midpoints between adjacent line centres (clamped to the box top/bottom).
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const top = i === 0 ? box.top : (lines[i - 1].cy + L.cy) / 2;
    const bottom =
      i === lines.length - 1 ? box.bottom : (L.cy + lines[i + 1].cy) / 2;
    if (
      x >= L.left - PAD && x <= L.right + PAD &&
      y >= top - PAD && y <= bottom + PAD
    ) {
      return true;
    }
  }
  return false;
}

// Position an overlay box over the element's VISIBLE INK (iframe viewport coords),
// inflated ~2px so the border floats just outside the glyphs. Critically it tracks the
// real glyph ink — not the layout box — so it wraps the text correctly even when the
// font massively overflows its own box (e.g. a 440px decorative number in a 220px box).
function place(box: HTMLElement | null, el: HTMLElement | null) {
  if (!box) return;
  if (!el) { box.style.display = "none"; return; }
  const b = inkBounds(el);
  if (!b) { box.style.display = "none"; return; }
  const PAD = 2;
  // Inflate ~2px so the border floats just outside the ink, but CLAMP inside the
  // iframe viewport: a full-bleed image's box would otherwise extend past the
  // canvas edge, where the border is clipped and reads as "no selection box".
  const root = el.ownerDocument.documentElement;
  const maxW = root.clientWidth || Infinity;
  const maxH = root.clientHeight || Infinity;
  const left = Math.max(0, b.left - PAD);
  const top = Math.max(0, b.top - PAD);
  const right = Math.min(maxW, b.right + PAD);
  const bottom = Math.min(maxH, b.bottom + PAD);
  box.style.display = "block";
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
  box.style.width = `${Math.max(0, right - left)}px`;
  box.style.height = `${Math.max(0, bottom - top)}px`;
}

// Shared per-document measuring canvas for font-aware ink bounds.
let measureCanvas: HTMLCanvasElement | null = null;

// The element's visible-ink bounding box (iframe viewport coords). Images / graphics /
// empty elements use their layout box. For TEXT we walk the per-line text rects (which
// sit correctly on each line even when the glyphs overflow the element's own box) and,
// within each, carve out the actual painted ink via canvas TextMetrics: a line rect is
// the font's full em box, so the baseline sits a known fraction down it and the real
// ink runs from baseline − actualAscent to baseline + actualDescent. The union of those
// is the tight glyph box — robust for Arabic's baseline-heavy ink AND huge fonts.
function inkBounds(
  el: HTMLElement,
): { left: number; top: number; right: number; bottom: number } | null {
  const r = el.getBoundingClientRect();
  const fallback = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  const win = el.ownerDocument.defaultView;
  const contentRects = textContentRects(el);
  if (!contentRects || !win) return fallback;
  const rects = [...contentRects].filter(
    (c) => c.width > 0.5 && c.height > 0.5,
  );
  if (!rects.length) return fallback;
  const cs = win.getComputedStyle(el);
  const m = measureInk(
    el.ownerDocument,
    cs,
    (el.textContent || "").replace(/\s+/g, " ").trim(),
  );
  const fontH = m.fBA + m.fBD || 1;
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const c of rects) {
    const ratio = c.height / fontH; // display px per natural font-metric unit
    const baseline = c.top + m.fBA * ratio;
    top = Math.min(top, baseline - m.aBA * ratio);
    bottom = Math.max(bottom, baseline + m.aBD * ratio);
    left = Math.min(left, c.left);
    right = Math.max(right, c.right);
  }
  return { left, top, right, bottom };
}

// Canvas TextMetrics (natural px) for THIS text in THIS font: the real ink ascent /
// descent (actualBoundingBox) + the font's declared em box (fontBoundingBox).
function measureInk(
  doc: Document,
  cs: CSSStyleDeclaration,
  text: string,
): { aBA: number; aBD: number; fBA: number; fBD: number } {
  const fs = parseFloat(cs.fontSize) || 16;
  if (!measureCanvas || measureCanvas.ownerDocument !== doc) {
    measureCanvas = doc.createElement("canvas");
  }
  const ctx = measureCanvas.getContext("2d");
  if (!ctx) return { aBA: fs * 0.7, aBD: fs * 0.2, fBA: fs * 0.8, fBD: fs * 0.2 };
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${fs}px ${cs.fontFamily}`;
  const m = ctx.measureText(text || "X");
  return {
    aBA: m.actualBoundingBoxAscent || fs * 0.7,
    aBD: m.actualBoundingBoxDescent || fs * 0.2,
    fBA: m.fontBoundingBoxAscent || fs * 0.8,
    fBD: m.fontBoundingBoxDescent || fs * 0.2,
  };
}
