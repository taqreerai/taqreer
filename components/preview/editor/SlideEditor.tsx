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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Moveable from "react-moveable";
import type { SlideType, ThemeType } from "@/lib/schema/slide";
import { sanitizeSlideHtml } from "@/lib/export/sanitize";
import { themeToCssVars } from "@/lib/export/theme-css-vars";
import { isVisualLeaf, isTextEditable, resolveSelectable, hasOwnPaint } from "@/lib/editor/leaves";
import { serializeSlideSection } from "@/lib/editor/serialize";
import { flattenSlideSection, type FlattenParity } from "@/lib/editor/flatten";
import { buildDeckFontHead } from "@/lib/export/font-head";
import { googleFontLinkTags } from "@/lib/editor/font-search";
import { fitArtboard } from "@/lib/editor/canvas-fit";

type Props = {
  slide: SlideType;
  theme: ThemeType;
  direction: "rtl" | "ltr";
  language: "ar" | "en";
  width: number;
  height: number;
  scale: number;
  // The current selection set. Single-click → one element; a marquee drag → the
  // intersected set; bg-click / Esc → empty. Length-1 preserves ALL the
  // single-select behaviour (hover, click-again-to-edit a lone text leaf).
  selected: HTMLElement[];
  onSelect: (els: HTMLElement[]) => void;
  onDocReady: (doc: Document | null) => void;
  // Fired when a text edit settles (blur) and actually changed the slide — the
  // parent persists it. Carries the slide's id (so a save lands on the right
  // slide even if focus moved) + the serialized section HTML.
  onEdit?: (slideId: string, html: string) => void;
  // Fired once on enter after the slide is FLATTENED (every element hoisted to a
  // standalone absolute box). The parent adopts the flat html as the slide's
  // baseline (manifest + persist) so the saved source, the undo baseline, and the
  // live DOM all agree on the flat structure. A no-op when already flat.
  onNormalize?: (slideId: string, html: string) => void;
  // Fired once per flatten with the parity report, for the fidelity observatory.
  // Advisory only (DeckView logs sub-threshold cases); never affects the swap.
  onFlattenResult?: (slideId: string, parity: FlattenParity) => void;
  // Slide-level undo / redo (⌘Z / ⌘⇧Z). The parent's window keydown listener
  // never sees keys pressed while focus is INSIDE the iframe, so the editor
  // forwards them out to the parent's local history stack. While a text box is
  // actively being edited the browser's native char-level undo wins instead.
  onUndo?: () => void;
  onRedo?: () => void;
  // Bump to force the iframe to re-render from `slide.html` (restore / undo /
  // peer edit). The iframe is otherwise PINNED to the slide identity so a
  // self-save — which updates `slide.html` — never blows away the live DOM the
  // user is editing. See the bodyHtml effect.
  reloadKey?: number;
  // When true, SKIP the flatten-on-enter pass and keep the slide's original
  // authored HTML. Social (3:4) carousels use the full CSS toolbox — descendant
  // selectors (`.list li::before` bullets), pseudo-element decoration, and
  // nested fills (`.progress i`) — which flatten's de-nesting silently breaks
  // (the selectors stop matching once every node becomes a flat sibling). For
  // those decks fidelity beats flat-layer editing, so we render as authored
  // (editing runs in the same degraded-but-lossless mode as a parity-fail).
  disableFlatten?: boolean;
  // When true (slide locked / mid-regen) the editor renders IDENTICALLY but is
  // inert — no hover box, no click-to-select, no edit mode, no selection box.
  // Kept mounted (rather than swapped for SlideRenderer) so disabling never
  // swaps renderers, which would flash + nudge the content.
  disabled?: boolean;
  // Bumped by the parent whenever a per-layer lock toggles (LayersPanel). Locks
  // live as a `data-tq-lock` attribute on the element (not React state), so the
  // editor has no other signal to recompute which elements Moveable may grab;
  // this prop forces that recompute.
  lockTick?: number;
  // Apply restored html (undo / redo) to the LIVE iframe DOM in place — replacing
  // the section's content + re-tagging — instead of rebuilding the srcDoc, which
  // reloads the iframe (re-fetches fonts, flashes the whole canvas). Bump `token`
  // to apply; `html` is the slide source to restore.
  inPlaceApply?: { html: string; token: number } | null;
  // Delete the current selection (Delete / Backspace on the canvas). The parent
  // owns the DOM removal + commit + selection clear.
  onDeleteSelected?: () => void;
  // Group / ungroup the current selection (⌘G / ⌘⇧G). Grouping is virtual (a
  // shared data-tq-group id, no reparenting), so the parent just stamps/clears
  // the attribute and keeps the set selected.
  onGroup?: () => void;
  onUngroup?: () => void;
};

// Read/write an element's translate + rotation (used by the self-driven group drag).
function readTR(el: HTMLElement): { tx: number; ty: number; rot: number } {
  const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
  return {
    tx: m.e,
    ty: m.f,
    rot: Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI * 100) / 100,
  };
}
function applyTR(el: HTMLElement, tx: number, ty: number, rot: number) {
  el.style.transform =
    `translate(${Math.round(tx)}px, ${Math.round(ty)}px)` + (rot ? ` rotate(${rot}deg)` : "");
}

// Apply a Moveable resize to one element. A TEXT box reflows to the new width:
// we drop the flatten-time `white-space:nowrap` pin (so the text wraps instead of
// overflowing on one line) and let its height auto-fit the wrapped lines — a text
// box hugs its content, and a fixed height would clip / overflow the new wrap.
// Untouched boxes (e.g. the page number) keep their own nowrap, so resizing one
// box never reflows another. Non-text boxes (image / shape) take the explicit
// width + height as drawn.
// Shift while rotating snaps to 15deg increments (Figma/Canva). Rewrites the
// rotate(...) inside Moveable's transform string with the snapped angle, leaving the
// translate untouched.
function snapRotate(transform: string, rotation: number, inputEvent: unknown): string {
  const shift = !!inputEvent && typeof inputEvent === "object" && "shiftKey" in inputEvent && (inputEvent as { shiftKey?: boolean }).shiftKey;
  if (!shift) return transform;
  const snapped = Math.round(rotation / 15) * 15;
  return transform.replace(/rotate\([^)]*\)/, `rotate(${snapped}deg)`);
}

function applyResize(el: HTMLElement, width: number, height: number, transform: string) {
  const isText = (el.textContent ?? "").trim().length > 0;
  el.style.width = `${Math.round(width)}px`;
  if (isText) {
    el.style.removeProperty("white-space");
    el.style.height = "auto";
  } else {
    el.style.height = `${Math.round(height)}px`;
  }
  el.style.transform = transform;
}

export function SlideEditor({
  slide, theme, direction, language, width, height, scale,
  selected, onSelect, onDocReady, onEdit, onNormalize, onFlattenResult, onUndo, onRedo, reloadKey = 0, disableFlatten = false, disabled = false,
  lockTick = 0, onDeleteSelected, onGroup, onUngroup, inPlaceApply = null,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // The live iframe document + slide <section>, captured on wire() so the JSX can
  // portal <Moveable> INTO the iframe (same coordinate + event space as the slide)
  // and compute snap guidelines from the real leaves.
  const [editorDoc, setEditorDoc] = useState<Document | null>(null);
  const [section, setSection] = useState<HTMLElement | null>(null);
  // Side the rotation knob renders on — FLIPS to the opposite side from the style
  // pill so they never overlap (the pill sits below the selection unless it hugs
  // the viewport bottom, in which case it flips above → knob goes below).
  const [rotationPos, setRotationPos] = useState<"top" | "bottom">("top");
  // Set the instant a drag/resize/rotate actually mutates geometry, so a press
  // that ends WITHOUT moving (a click meant to re-select / enter text edit) never
  // fires a no-op save. Read + reset by commitTransform on settle.
  const movedRef = useRef(false);
  // The Moveable instance — so a pointer-DOWN on an element can hand off into a
  // drag in the SAME gesture (press-and-drag, no select-then-drag two-step).
  const moveableRef = useRef<Moveable>(null);
  // The element pressed this gesture + whether it was already the sole selection
  // (a press-without-move on an already-selected text box drops into edit).
  const pressRef = useRef<{ unit: HTMLElement; wasSole: boolean } | null>(null);
  // enterEdit lives inside the once-wired iframe effect; expose it so Moveable's
  // onDragEnd (rendered out here in JSX) can trigger text edit on a no-move press.
  const enterEditRef = useRef<((el: HTMLElement) => void) | null>(null);
  // Pool of selection boxes — one per selected element. The first is the
  // canonical `.tqe-sel` the StylePill anchors to (single-select keeps exactly
  // one); a marquee adds more, all sharing the same class so the rAF / pill
  // machinery is unchanged. Created lazily in syncSelBoxes.
  const selBoxesRef = useRef<HTMLElement[]>([]);
  const hoverBoxRef = useRef<HTMLElement | null>(null);
  // The marquee (rubber-band) overlay box, drawn inside the iframe while dragging.
  const marqueeBoxRef = useRef<HTMLElement | null>(null);
  // Keep the latest onSelect without re-attaching iframe listeners every render.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  // Latest selection set, read by the (once-attached) iframe handlers.
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  // Keep onEdit current without re-attaching iframe listeners.
  const onEditRef = useRef(onEdit);
  useEffect(() => {
    onEditRef.current = onEdit;
  }, [onEdit]);
  const onNormalizeRef = useRef(onNormalize);
  useEffect(() => {
    onNormalizeRef.current = onNormalize;
  }, [onNormalize]);
  const onFlattenResultRef = useRef(onFlattenResult);
  useEffect(() => {
    onFlattenResultRef.current = onFlattenResult;
  }, [onFlattenResult]);
  // Read inside the once-attached wire() closure without re-wiring on change.
  const disableFlattenRef = useRef(disableFlatten);
  useEffect(() => {
    disableFlattenRef.current = disableFlatten;
  }, [disableFlatten]);
  // Same pattern for the undo/redo callbacks (read by the once-attached iframe
  // keydown bridge).
  const onUndoRef = useRef(onUndo);
  const onRedoRef = useRef(onRedo);
  useEffect(() => {
    onUndoRef.current = onUndo;
  }, [onUndo]);
  useEffect(() => {
    onRedoRef.current = onRedo;
  }, [onRedo]);
  // Delete / group / ungroup callbacks, read by the once-attached iframe keydown.
  const onDeleteSelectedRef = useRef(onDeleteSelected);
  const onGroupRef = useRef(onGroup);
  const onUngroupRef = useRef(onUngroup);
  useEffect(() => {
    onDeleteSelectedRef.current = onDeleteSelected;
    onGroupRef.current = onGroup;
    onUngroupRef.current = onUngroup;
  }, [onDeleteSelected, onGroup, onUngroup]);
  // The group the user has "entered" (double-clicked into), or null. While set, a
  // click selects an INDIVIDUAL member of that group; otherwise clicking any
  // grouped element selects the WHOLE group. A live ref so the once-wired iframe
  // handlers always read the current value.
  const activeGroupRef = useRef<string | null>(null);
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

  // ── Canva-style WORKSPACE. The iframe fills the whole canvas area; the slide is an
  // artboard floating inside a fit-and-centre "scene". We measure the iframe wrapper, fit
  // the artboard to it, and centre it. Selection borders + Moveable handles live in the
  // (unscaled) body so they draw over the WHOLE workspace, not clipped to the slide.
  //
  // #tqe-scene { transform: translate(pan) scale(zoom) }  ← centres + fit-scales the artboard
  //   #tqe-stage { width:native; height:native; overflow:hidden }  ← clips CONTENT to the slide
  // The on-screen scale (the fit zoom) drives the overlays + raw-pointer drag; it's
  // mirrored into refs + live CSS vars so a resize never rebuilds srcDoc.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setViewport((p) =>
        p.w === r.width && p.h === r.height ? p : { w: r.width, h: r.height },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Fit the artboard into the measured workspace (centred). Falls back to the prop
  // scale until the wrapper is measured (avoids a 0 on first paint). The SAME fit fn
  // drives DeckView's AI halo + comment overlay, so the iframe artboard and those
  // overlays stay pixel-aligned (see lib/editor/canvas-fit).
  const fit = fitArtboard(viewport.w, viewport.h, width, height);
  const totalZoom = fit ? fit.scale : scale;
  const panX = fit ? fit.offsetX : (viewport.w - width * scale) / 2;
  const panY = fit ? fit.offsetY : (viewport.h - height * scale) / 2;
  // Refs mirror the live transform for srcDoc baking (a slide-switch rebuild reads the
  // current values → no flash), wire() on iframe load, and the raw-pointer drag math.
  const scaleRef = useRef(totalZoom);
  const panRef = useRef({ x: panX, y: panY });
  useEffect(() => {
    scaleRef.current = totalZoom;
    panRef.current = { x: panX, y: panY };
  }, [totalZoom, panX, panY]);
  const srcDoc = useMemo(() => {
    const vars = themeToCssVars(theme) as Record<string, string>;
    const rootVars = Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";");
    // Editor selection accent = the design system's brand blue (--tq-brand-blue).
    // The iframe is its own document and only receives the DECK theme above, so the
    // app token can't cascade in; read its resolved value off the app root and inject
    // it as the editor's own --tqe-accent. Lowercased to match the SSR fallback so the
    // srcDoc string hydrates identically.
    const accent =
      (typeof window !== "undefined"
        ? getComputedStyle(document.documentElement)
            .getPropertyValue("--tq-brand-blue")
            .trim()
            .toLowerCase()
        : "") || "#0057ff";
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
  :root{${rootVars};--tqe-zoom:${totalZoom};--tqe-pan-x:${panX}px;--tqe-pan-y:${panY}px;--tqe-accent:${accent}}
  /* Body = the WORKSPACE (fills the iframe element, which fills the canvas area).
     TRANSPARENT so the iframe element's own background:var(--tq-bg) (set in the parent
     doc — no SSR branch, no hydration mismatch) shows as the dark page around the
     floating artboard. */
  html,body{background:transparent}
  body{position:relative;width:100%;height:100%;overflow:hidden;color:${theme.text};font-family:var(--font-body),'Cairo',system-ui,sans-serif}
  /* The pan/zoom SCENE — one transform carries fit + user zoom + pan; updated live via
     the CSS vars (no srcDoc rebuild). transform-origin 0,0 so pan/zoom math is linear. */
  #tqe-scene{position:absolute;top:0;left:0;transform:translate(var(--tqe-pan-x),var(--tqe-pan-y)) scale(var(--tqe-zoom));transform-origin:0 0;will-change:transform}
  /* The ARTBOARD: native slide size, clips the slide CONTENT to its rect (the scene
     scales it down to fit). The slide's own bg lives here, not on the workspace body. */
  #tqe-stage{position:absolute;top:0;left:0;width:${width}px;height:${height}px;overflow:hidden;background:${theme.background}}
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
  /* HOVER = the same thin accent outline Moveable draws on selection, so hovering
     previews exactly what selecting will show (no fill, no handles). */
  .tqe-hover{border:1px solid var(--tqe-accent)}
  /* SELECTION box is invisible — Moveable draws the visible selection (accent
     border + handles). This element stays ONLY as the StylePill's position anchor.
     A LOCKED selected element (no Moveable handles) gets a dashed outline via JS. */
  .tqe-sel{border:0}
  /* Rubber-band marquee — accent border + faint fill. */
  .tqe-marquee{border:1px solid var(--tqe-accent);background:color-mix(in srgb, var(--tqe-accent) 14%, transparent)}
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
  img[data-genimage].tq-genimg-in{animation:tq-genimg-fadein 450ms ease backwards}
  @media (prefers-reduced-motion:reduce){img[data-genimage]:not([src]){animation:none;background-position:50% 0}img[data-genimage].tq-genimg-in{animation:none}}
  /* ── Moveable selection chrome (Canva-style). react-moveable injects its own
     stylesheet into THIS iframe document; these override it: a thin accent border,
     white round corner handles, white side pills (left/right), and a white
     rotation knob (rotate glyph) below. ── */
  .moveable-line{background:var(--tqe-accent)!important}
  /* Snap / align / centre guides: the selection accent (inherited from .moveable-line
     above), 2px stroke (vertical = width, horizontal = height). */
  .moveable-line.moveable-guideline.moveable-vertical{width:2px!important}
  .moveable-line.moveable-guideline.moveable-horizontal{height:2px!important}
  /* CANVAS-CENTRE cross — drawn by the custom centre-snap (centerSnap() in this file),
     NOT react-moveable, because react-moveable's snapDirections is a single global filter
     that can't allow edge-to-edge AND centre-to-centre at once. Same blue 2px look as the
     guidelines above; toggled per axis in JS (display none by default). */
  .tqe-cg{position:fixed;pointer-events:none;z-index:2147483646;background:var(--tqe-accent);display:none}
  .tqe-cg-v{top:0;width:2px;height:100%}
  .tqe-cg-h{left:0;height:2px;width:100%}
  /* Corners + top/bottom mid-points: white circles. Size = --tqe-hc (set per
     selection in JS), so handles SHRINK on a small shape instead of overlapping. */
  .moveable-control{background:#fff!important;border:1px solid rgba(0,0,0,0.12)!important;box-shadow:0 1px 3px rgba(0,0,0,0.3)!important;width:var(--tqe-hc,12px)!important;height:var(--tqe-hc,12px)!important;margin-top:calc(var(--tqe-hc,12px) / -2)!important;margin-left:calc(var(--tqe-hc,12px) / -2)!important;border-radius:50%!important}
  /* Left/right mid-points: vertical pills, also scaled to --tqe-hc. */
  .moveable-control.moveable-w,.moveable-control.moveable-e{width:calc(var(--tqe-hc,12px) * 0.58)!important;height:calc(var(--tqe-hc,12px) * 2)!important;margin-top:calc(var(--tqe-hc,12px) * -1)!important;margin-left:calc(var(--tqe-hc,12px) * -0.29)!important;border-radius:calc(var(--tqe-hc,12px) * 0.42)!important}
  .moveable-control.moveable-rotation-control{width:24px!important;height:24px!important;margin-left:-12px!important;margin-top:-12px!important;border-radius:50%!important;background:#fff url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23555' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M21 12a9 9 0 1 1-2.6-6.4'/><polyline points='21 3 21 9 15 9'/></svg>") center/14px no-repeat!important}
  /* Smart-guide distance / dimension numbers — the selection accent, smaller + light.
     react-moveable renders them as .moveable-size-value (the gap distance + the resize
     W/H readout); its default is a chunky bold 12px, so shrink + lighten it. */
  .moveable-size-value{color:var(--tqe-accent)!important;font-size:10px!important;font-weight:300!important}
</style></head><body><div id="tqe-scene"><div id="tqe-stage">${bodyHtml}</div></div><!--r:${reloadKey}--></body></html>`;
    // scale intentionally excluded — it's presentation, applied live via the
    // --tqe-scale var + the iframe element's dispW×dispH size, so a resize never
    // rebuilds (reloads) this document. The memo bakes the initial scale.
    //
    // `reloadKey` IS baked in (as an invisible comment): an undo/redo can revert
    // to html that EQUALS the current (stale) bodyHtml — the edit path leaves
    // bodyHtml untouched to preserve the caret — so setBodyHtml is a no-op and
    // srcDoc wouldn't otherwise change. The reloadKey token forces a fresh srcDoc
    // (→ iframe reload from bodyHtml) on every restore/undo/redo/peer bump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyHtml, theme, direction, language, width, height, reloadKey]);

  // Wire the iframe document once it loads (and on every srcDoc change → reload).
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const wire = async () => {
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

      // ── FULL FLATTEN on enter ──────────────────────────────────────────────
      // Wait for fonts + layout (geometry must be font-accurate), then replace the
      // section's content with the fully-flat structure: every element becomes a
      // standalone absolute box, a DIRECT child of the section, in ONE stacking
      // context. This is what makes global z-order / restack / layer-drag / grouping
      // actually work. `sec` stays the SAME element (innerHTML swap), so the wiring
      // below binds to it unchanged. Idempotent: re-entering a flat slide reproduces
      // it. The flat html is adopted as the slide's baseline (onNormalize) so the
      // manifest, the undo baseline, and the live DOM all agree.
      try {
        if (doc.fonts?.ready) await doc.fonts.ready;
      } catch { /* fonts API absent */ }
      await new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      );
      // Social (3:4) decks skip flatten entirely — its de-nesting breaks the
      // descendant selectors + pseudo-elements the social prompt leans on. Keep
      // the authored HTML (same lossless, degraded-editing path as parity-fail);
      // tagging + overlay wiring below still run on the nested structure.
      if (disableFlattenRef.current) {
        // nothing to flatten — fall through to tagging/overlays
      } else {
      try {
        // The gen-image fade animation must NOT be live when flatten reads computed
        // styles: mid-fade the class .tq-genimg-in holds opacity below 1, and flatten
        // bakes whatever getComputedStyle returns inline (undo later replays that stale
        // fractional value). Neutralize the class synchronously here, in the same tick
        // as the flatten, so getComputedStyle returns the resting opacity (1, or a
        // user-set inline value). Class-only: do not touch style.opacity. DeckView
        // re-adds the class on the next URL land, so the fade still plays for users.
        for (const img of sec.querySelectorAll<HTMLImageElement>(
          "img[data-genimage][src]",
        )) {
          img.classList.remove("tq-genimg-in");
        }
        const flat = flattenSlideSection(sec as HTMLElement, { scale: scaleRef.current });
        // Observatory: report the parity result once per flatten (both branches), so the
        // fidelity loop can log a content shortfall (and, once Phase 1 lands, style drift).
        onFlattenResultRef.current?.(slide.slideId, flat.parity);
        if (!flat.parity.ok) {
          // SAFETY NET: the flatten lost visible text or a visual atom (img/svg/
          // embed). Do NOT swap or persist - leave the slide on its original AI
          // HTML so editing is degraded (nested stacking) but content is never
          // silently dropped from the deck or the export.
          console.warn("[flatten] parity mismatch, keeping slide unflattened", {
            slide: slide.slideId,
            missingWords: flat.parity.missingWords,
            census: { src: flat.parity.srcCensus, out: flat.parity.outCensus },
          });
        } else {
          const tmp = doc.createElement("div");
          tmp.innerHTML = flat.html;
          const flatSec = tmp.querySelector("section");
          if (flatSec && flatSec.innerHTML !== sec.innerHTML) {
            sec.innerHTML = flatSec.innerHTML;
            onNormalizeRef.current?.(slide.slideId, serializeSlideSection(sec));
          }
        }
      } catch (err) {
        console.error("flatten on enter failed", err);
      }
      }

      // Normalize FILLED gen-images saved with their transient streaming
      // state (2026-06-12): the placeholder's inline opacity:0 and the
      // one-shot fade class both got serialized into older decks. The
      // class's animation used to pin opacity at 1 (masking the stale 0
      // AND freezing the opacity slider); strip both so inline opacity
      // is the editable source of truth. Placeholders WITHOUT src keep
      // their shimmer + class untouched.
      for (const img of doc.querySelectorAll<HTMLImageElement>(
        "img[data-genimage][src]",
      )) {
        img.classList.remove("tq-genimg-in");
        if (img.style.opacity === "0") img.style.removeProperty("opacity");
      }

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
      // The canonical first selection box (the StylePill anchors to `.tqe-sel`;
      // single-select uses exactly this one). A marquee adds siblings via
      // syncSelBoxes — all `.tqe-sel`, so the existing pill/rAF code is unchanged.
      const selBox = doc.createElement("div");
      selBox.className = "tqe-ov tqe-sel";
      // The rubber-band marquee box, hidden until a drag starts.
      const marquee = doc.createElement("div");
      marquee.className = "tqe-ov tqe-marquee";
      const caret = doc.createElement("div");
      caret.className = "tqe-caret";
      doc.body.append(hover, selBox, marquee, caret);
      hoverBoxRef.current = hover;
      selBoxesRef.current = [selBox];
      marqueeBoxRef.current = marquee;

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
        // Don't hover an element that's ALREADY selected (single OR part of a
        // multi-selection) — it already has Moveable's box, and a lingering hover
        // outline on a selected member is what got stranded behind a group drag.
        const target = unit && !selectedRef.current.includes(unit) ? unit : null;
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
        const onInput = () => { place(selBoxesRef.current[0] ?? null, t); placeCaret(t); };
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
      // Expose enterEdit so Moveable's onDragEnd (JSX scope) can drop into text
      // edit on a no-move press of an already-selected text box.
      enterEditRef.current = enterEdit;

      const onClick = (e: MouseEvent) => {
        if (disabledRef.current) return; // locked/regen → no selection
        // A marquee drag JUST ended (mouseup fires a click too) — it already
        // committed the selection set; swallow this click.
        if (marqueeConsumedClick) { marqueeConsumedClick = false; return; }
        if ((e.target as HTMLElement | null)?.isContentEditable) return;
        // Selection + the press-and-drag handoff now happen on mousedown. The only
        // thing left for a plain click is DESELECTING when the press landed on
        // empty canvas and never became a marquee.
        if (!resolveHit(sec, e.clientX, e.clientY)) {
          activeGroupRef.current = null;
          onSelectRef.current([]);
        }
      };
      const onDbl = (e: MouseEvent) => {
        if (disabledRef.current) return; // locked/regen → no edit mode
        if ((e.target as HTMLElement | null)?.isContentEditable) return;
        const unit = resolveHit(sec, e.clientX, e.clientY);
        if (!unit) return;
        // Double-click a GROUPED element (from outside the group): ENTER the group
        // and select the clicked member individually. A second double-click — now
        // inside the group — falls through to text edit below.
        const gid = unit.getAttribute("data-tq-group");
        if (gid && activeGroupRef.current !== gid) {
          e.preventDefault();
          activeGroupRef.current = gid;
          onSelectRef.current([unit]);
          return;
        }
        // A painted SHAPE with no text is not a text box — double-clicking it must
        // NOT drop into "type inside it". A shape that ALREADY has text stays
        // editable (it's a labelled shape), as do plain text boxes (no own paint).
        const win = doc.defaultView;
        if (win && (unit.textContent ?? "").trim() === "" && hasOwnPaint(unit, win)) return;
        e.preventDefault();
        enterEdit(unit);
      };

      // ── Marquee (rubber-band) multi-select. A mousedown on EMPTY canvas (no
      // ink leaf under the cursor) arms a drag; once the pointer travels past a
      // small threshold the marquee box appears and every [data-tq-cc] whose ink
      // bounds intersect it is selected on mouseup. A press that never passes the
      // threshold disarms and falls through UNTOUCHED to the single-click path. ──
      const MARQUEE_THRESHOLD = 4; // px of travel before a drag becomes a marquee
      let marqueeStart: { x: number; y: number } | null = null;
      let marqueeActive = false;
      let marqueeConsumedClick = false;
      const drawMarquee = (x0: number, y0: number, x1: number, y1: number) => {
        const box = marqueeBoxRef.current;
        if (!box) return;
        box.style.display = "block";
        box.style.left = `${Math.min(x0, x1)}px`;
        box.style.top = `${Math.min(y0, y1)}px`;
        box.style.width = `${Math.abs(x1 - x0)}px`;
        box.style.height = `${Math.abs(y1 - y0)}px`;
      };
      const endMarquee = () => {
        marqueeStart = null;
        marqueeActive = false;
        if (marqueeBoxRef.current) marqueeBoxRef.current.style.display = "none";
        doc.removeEventListener("mousemove", onMarqueeMove);
        doc.removeEventListener("mouseup", onMarqueeUp);
        window.removeEventListener("mouseup", onWindowMarqueeCancel);
      };
      // A release OUTSIDE the iframe never reaches `doc`'s mouseup, so the
      // marquee would otherwise stay armed and its listeners leak. The parent
      // window only sees the up-event when the pointer left the iframe (events
      // don't cross the frame boundary), so here we simply cancel — no
      // cross-frame coordinate translation, and in-frame drags still finalize
      // via `onMarqueeUp` (CodeRabbit, PR #53).
      const onWindowMarqueeCancel = () => endMarquee();
      const onMarqueeMove = (e: MouseEvent) => {
        if (!marqueeStart) return;
        const dx = e.clientX - marqueeStart.x;
        const dy = e.clientY - marqueeStart.y;
        if (!marqueeActive && Math.hypot(dx, dy) < MARQUEE_THRESHOLD) return;
        marqueeActive = true;
        place(hover, null); // drop the hover box while marqueeing
        drawMarquee(marqueeStart.x, marqueeStart.y, e.clientX, e.clientY);
      };
      const onMarqueeUp = (e: MouseEvent) => {
        const start = marqueeStart;
        const wasActive = marqueeActive;
        endMarquee();
        if (!start || !wasActive) return; // never passed threshold → let click run
        // A real marquee happened → claim the trailing click so it can't reset the
        // selection, then collect every leaf whose ink intersects the rubber-band.
        marqueeConsumedClick = true;
        const rect = {
          left: Math.min(start.x, e.clientX),
          top: Math.min(start.y, e.clientY),
          right: Math.max(start.x, e.clientX),
          bottom: Math.max(start.y, e.clientY),
        };
        const hits: HTMLElement[] = [];
        const seen = new Set<HTMLElement>();
        const intersects = (b: { left: number; top: number; right: number; bottom: number }) =>
          b.left <= rect.right && b.right >= rect.left && b.top <= rect.bottom && b.bottom >= rect.top;
        // Content leaves (text / image / svg) by their INK bounds.
        for (const el of sec.querySelectorAll<HTMLElement>("[data-tq-cc]")) {
          const b = inkBounds(el);
          if (b && intersects(b) && !seen.has(el)) { seen.add(el); hits.push(el); }
        }
        // PAINTED SHAPES too (colour blocks / accent bars) — they carry no data-tq-cc
        // (not visual leaves), so add them here by their box. Skip full-bleed layers
        // (the slide bg / full-slide scrim) so a partial marquee can't sweep them in.
        const win = doc.defaultView;
        if (win) {
          const secR = sec.getBoundingClientRect();
          for (const el of Array.from(sec.children) as HTMLElement[]) {
            if (el.hasAttribute("data-tq-cc") || isVisualLeaf(el)) continue;
            if ((el.textContent ?? "").trim() !== "" || el.querySelector("img, svg")) continue;
            if (!hasOwnPaint(el, win)) continue;
            const r = el.getBoundingClientRect();
            if (r.width >= secR.width * 0.9 && r.height >= secR.height * 0.9) continue; // full-bleed
            if (intersects({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }) && !seen.has(el)) {
              seen.add(el);
              hits.push(el);
            }
          }
        }
        onSelectRef.current(hits);
      };
      const onMouseDown = (e: MouseEvent) => {
        if (disabledRef.current) return; // locked/regen → inert
        if (e.button !== 0) return; // primary button only
        if ((e.target as HTMLElement | null)?.isContentEditable) return;
        const unit = resolveHit(sec, e.clientX, e.clientY);
        if (!unit) {
          // Empty canvas → arm a marquee. A press that never passes the threshold
          // falls through to onClick, which deselects.
          marqueeStart = { x: e.clientX, y: e.clientY };
          marqueeActive = false;
          doc.addEventListener("mousemove", onMarqueeMove);
          doc.addEventListener("mouseup", onMarqueeUp);
          window.addEventListener("mouseup", onWindowMarqueeCancel);
          return;
        }
        // Pressed an element → select it (or its group) and, in the SAME gesture,
        // hand off into a Moveable drag — press-and-drag, no select-then-drag step.
        e.preventDefault(); // no native image-drag / text-selection / focus
        lastHover = null;
        place(hover, null);
        const gid = unit.getAttribute("data-tq-group");
        if (activeGroupRef.current && gid !== activeGroupRef.current) {
          activeGroupRef.current = null;
        }
        // Shift+click toggles membership (no drag).
        if (e.shiftKey) {
          const cur = selectedRef.current;
          onSelectRef.current(
            cur.includes(unit) ? cur.filter((el) => el !== unit) : [...cur, unit],
          );
          return;
        }
        const cur = selectedRef.current;
        const mv = moveableRef.current;
        // CASE A — pressing an element ALREADY in the selection: keep the selection
        // and drag it.
        if (cur.includes(unit)) {
          // MULTI-selection → SELF-DRIVEN group drag (NOT mv.dragStart). We move each
          // member by the raw pointer delta (÷scale, so RTL/scaled-stage safe) and let
          // Moveable only RE-MEASURE its box (updateRect, safe since Moveable itself
          // isn't dragging). Self-driving is what lets us EXCLUDE locked members from
          // the drag — Moveable's native group drag (the click-group-from-outside path,
          // onDragGroup) would move every target including locked ones.
          if (cur.length > 1) {
            const movable = cur.filter((el) => el.isConnected && !el.hasAttribute("data-tq-lock"));
            if (!movable.length) return;
            const base = new Map<HTMLElement, { tx: number; ty: number; rot: number }>();
            movable.forEach((el) => base.set(el, readTR(el)));
            const sx = e.clientX;
            const sy = e.clientY;
            const s = scaleRef.current || 1;
            let moved = false;
            const onMove = (ev: MouseEvent) => {
              if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
              moved = true;
              const dx = (ev.clientX - sx) / s;
              const dy = (ev.clientY - sy) / s;
              for (const el of movable) {
                const b = base.get(el)!;
                applyTR(el, b.tx + dx, b.ty + dy, b.rot);
              }
              moveableRef.current?.updateRect();
            };
            const onUp = () => {
              doc.removeEventListener("mousemove", onMove);
              doc.removeEventListener("mouseup", onUp);
              window.removeEventListener("mouseup", onUp);
              if (moved) onEditRef.current?.(slide.slideId, serializeSlideSection(sec));
            };
            doc.addEventListener("mousemove", onMove);
            doc.addEventListener("mouseup", onUp);
            window.addEventListener("mouseup", onUp);
            return;
          }
          // SINGLE, already selected: a locked element can't drag; otherwise let
          // Moveable's own gesto drag it (or hand off if the press landed on an
          // overlapping element so gesto never fired).
          if (unit.hasAttribute("data-tq-lock")) {
            pressRef.current = null;
            return;
          }
          pressRef.current = { unit, wasSole: true };
          if (mv && !unit.contains(e.target as Node)) {
            try { mv.dragStart(e); } catch { /* released before handoff */ }
          }
          return;
        }
        // CASE B — a NEW element / group: select it (whole group from outside a
        // group), then hand the SAME press off into a drag once the target lands.
        let nextSel: HTMLElement[];
        if (gid && activeGroupRef.current !== gid) {
          const members = [...sec.querySelectorAll<HTMLElement>(`[data-tq-group="${gid}"]`)];
          nextSel = members.length ? members : [unit];
        } else {
          nextSel = [unit];
        }
        onSelectRef.current(nextSel);
        if (unit.hasAttribute("data-tq-lock")) {
          pressRef.current = null;
          return;
        }
        pressRef.current = { unit, wasSole: false };
        if (mv) {
          mv.waitToChangeTarget().then(() => {
            try { mv.dragStart(e); } catch { /* press released before handoff */ }
          });
        }
      };

      // ⌘Z / ⌘⇧Z bridge: keys pressed while focus is inside the iframe never
      // reach the parent's window listener, so forward slide-level undo/redo out.
      // A LIVE text edit keeps the browser's native char-level undo (don't
      // intercept); otherwise hand off to the parent's local history stack.
      const onDocKeyDown = (e: KeyboardEvent) => {
        const editing = (doc.activeElement as HTMLElement | null)?.isContentEditable;
        const meta = e.metaKey || e.ctrlKey;
        // ⌘Z / ⌘⇧Z → slide-level undo / redo (forwarded to the parent stack).
        if (meta && !e.altKey && e.key.toLowerCase() === "z") {
          if (editing) return; // a live text edit keeps native char-level undo
          e.preventDefault();
          if (e.shiftKey) onRedoRef.current?.();
          else onUndoRef.current?.();
          return;
        }
        // ⌘G / ⌘⇧G → group / ungroup the current selection.
        if (meta && e.key.toLowerCase() === "g") {
          if (editing) return;
          e.preventDefault();
          if (e.shiftKey) onUngroupRef.current?.();
          else onGroupRef.current?.();
          return;
        }
        // Delete / Backspace → remove the selection (never while editing text).
        if (e.key === "Delete" || e.key === "Backspace") {
          if (editing || !selectedRef.current.length) return;
          e.preventDefault();
          onDeleteSelectedRef.current?.();
          return;
        }
        // Escape → leave any entered group, then clear the selection.
        if (e.key === "Escape") {
          if (editing) return; // blur ends the edit; don't also deselect
          e.preventDefault();
          activeGroupRef.current = null;
          onSelectRef.current([]);
        }
      };

      doc.addEventListener("mousedown", onMouseDown);
      doc.addEventListener("mousemove", onMove);
      doc.addEventListener("mouseleave", onLeave);
      doc.addEventListener("click", onClick);
      doc.addEventListener("dblclick", onDbl);
      doc.addEventListener("keydown", onDocKeyDown);
      // Sync the live pan/zoom onto the freshly-loaded doc (the srcDoc's baked values
      // can be stale if the viewport was measured while the iframe was loading).
      doc.documentElement.style.setProperty("--tqe-zoom", String(scaleRef.current));
      doc.documentElement.style.setProperty("--tqe-pan-x", `${panRef.current.x}px`);
      doc.documentElement.style.setProperty("--tqe-pan-y", `${panRef.current.y}px`);
      // Expose the live doc + section so the JSX can portal <Moveable> into the
      // iframe and snap against the real leaves. setState from a load handler (or
      // the sync readyState-complete path) is intentional here.
      setEditorDoc(doc);
      setSection(sec as HTMLElement);
      onDocReady(doc);
    };

    iframe.addEventListener("load", wire);
    if (iframe.contentDocument?.readyState === "complete") wire();
    return () => {
      iframe.removeEventListener("load", wire);
      setEditorDoc(null);
      setSection(null);
      onDocReady(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcDoc]);

  // Push the live pan/zoom (fit + user zoom + pan) into the iframe's CSS vars on every
  // viewport/zoom change — recomputes the #tqe-scene transform WITHOUT reloading the
  // document (no flash). The srcDoc baked the current values, so first paint is right.
  useLayoutEffect(() => {
    const root = iframeRef.current?.contentDocument?.documentElement;
    if (!root) return;
    root.style.setProperty("--tqe-zoom", String(totalZoom));
    root.style.setProperty("--tqe-pan-x", `${panX}px`);
    root.style.setProperty("--tqe-pan-y", `${panY}px`);
  }, [totalZoom, panX, panY, srcDoc]);

  // Reposition the selection box(es) whenever the controlled `selected` set
  // changes — ONE `.tqe-sel` box per selected element. The pool grows/shrinks to
  // match the set (the first box is the canonical one the StylePill anchors to).
  // Each box stays glued to its element through two distinct kinds of change:
  //   • ResizeObserver — the element's BOX changes size (font-size bump, bold,
  //     web-font swap-in, container reflow).
  //   • MutationObserver on `style` — a text-align flip MOVES the glyphs inside
  //     an unchanged box, so it never triggers a resize. Watching the inline
  //     style attribute re-inks the box on align (and on any other pill write).
  useEffect(() => {
    // When disabled (locked/regen) the selection boxes are hidden too — the
    // editor is inert, so nothing should look selected.
    const els = disabled ? [] : selected;
    const doc =
      selBoxesRef.current[0]?.ownerDocument ??
      iframeRef.current?.contentDocument ??
      null;
    if (!doc) return;
    const pool = selBoxesRef.current;
    // Grow the pool to cover every selected element.
    while (pool.length < els.length) {
      const extra = doc.createElement("div");
      extra.className = "tqe-ov tqe-sel";
      doc.body.appendChild(extra);
      pool.push(extra);
    }
    // Draw/hide each box for its element (extras beyond the set are hidden, not
    // removed — kept so box[0] is always the stable StylePill anchor). The box is
    // kept POSITIONED (the StylePill anchors to its rect) but its WHITE border is
    // hidden whenever Moveable owns the element — an unlocked, non-editing target
    // already gets Moveable's own outline, so showing both reads as a double
    // border. A LOCKED element (no Moveable handles) keeps the white box.
    const drawSel = (box: HTMLElement, el: HTMLElement | null) => {
      place(box, el);
      // Moveable draws the visible selection chrome; this box is just the
      // StylePill's position anchor (invisible). A LOCKED element gets no Moveable
      // handles, so mark it with a dashed accent outline instead.
      box.style.border =
        el && el.hasAttribute("data-tq-lock") ? "1px dashed var(--tqe-accent)" : "0";
    };
    pool.forEach((box, i) => drawSel(box, els[i] ?? null));
    if (!els.length) return;
    // Re-glue the anchor boxes when a selected element's box/inline style changes.
    // Moveable's OWN control box is kept in sync by its useMutationObserver (below),
    // which is drag-AWARE — calling updateRect() here fought Moveable's group-drag
    // rendering and stranded the clicked element's outline at its start position.
    const replace = () => {
      pool.forEach((box, i) => drawSel(box, els[i] ?? null));
    };
    const ro = new ResizeObserver(replace);
    const mo = new MutationObserver(replace);
    for (const el of els) {
      ro.observe(el);
      mo.observe(el, { attributes: true, attributeFilter: ["style"] });
    }
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
    // lockTick: re-evaluate the border when a lock toggles (locked ⇒ show the box).
  }, [selected, disabled, lockTick]);

  // ── Undo / redo: restore html into the LIVE iframe IN PLACE (no srcDoc rebuild,
  // so no reload + no font re-fetch + no canvas flash). Replace the <section>'s
  // content + re-tag, then clear the now-stale selection. bodyHtml is intentionally
  // left alone — a later genuine reload reads the updated slide.html. ──
  useEffect(() => {
    if (!inPlaceApply) return;
    const doc = iframeRef.current?.contentDocument;
    const liveSec = doc?.querySelector("section");
    if (!doc || !liveSec) return;
    const tmp = doc.createElement("div");
    tmp.innerHTML = sanitizeSlideHtml(inPlaceApply.html);
    const newSec = tmp.querySelector("section");
    if (!newSec) return;
    liveSec.innerHTML = newSec.innerHTML;
    const style = newSec.getAttribute("style");
    if (style != null) liveSec.setAttribute("style", style);
    else liveSec.removeAttribute("style");
    liveSec.className = newSec.className;
    // Re-tag the section subtree (same scheme as wire()).
    let i = 0;
    liveSec.setAttribute("data-tq-id", String(i++));
    for (const el of liveSec.querySelectorAll("*")) {
      if (el.tagName === "STYLE" || el.tagName === "SCRIPT") continue;
      el.setAttribute("data-tq-id", String(i++));
      if (isVisualLeaf(el)) el.setAttribute("data-tq-cc", "1");
    }
    place(hoverBoxRef.current, null);
    onSelectRef.current([]); // old selected nodes are gone
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inPlaceApply?.token]);

  // ── Manipulation (Moveable) ────────────────────────────────────────────────
  // Which selected elements get drag/resize/rotate handles: everything selected
  // EXCEPT locked layers (data-tq-lock, toggled from the Layers panel) and a text
  // box that's mid-edit (contentEditable). A locked element stays selectable (so
  // it can be unlocked / restyled) — it just can't be moved.
  const moveableTargets = useMemo<HTMLElement[]>(() => {
    if (disabled) return [];
    return selected.filter(
      (el) => el.isConnected && !el.hasAttribute("data-tq-lock") && !el.isContentEditable,
    );
    // lockTick: a lock toggles a bare DOM attribute (no React signal), so the
    // parent bumps this to force the recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, disabled, lockTick]);

  // Snap targets = the OTHER visual leaves on the slide (Moveable draws smart
  // guides + snaps to their edges/centres). Full-bleed fills (bg / scrims) are
  // excluded so a resize never yanks to the whole 1920-wide canvas.
  const guidelines = useMemo<HTMLElement[]>(() => {
    if (!section || moveableTargets.length === 0) return [];
    const picked = new Set(moveableTargets);
    const leaves = Array.from(
      section.querySelectorAll<HTMLElement>("[data-tq-cc]"),
    ).filter(
      (el) =>
        !picked.has(el) &&
        (el.offsetWidth < width * 0.92 || el.offsetHeight < height * 0.92),
    );
    // Canva-style CANVAS-EDGE snap: the #tqe-stage rect IS the slide, so adding it as a
    // guideline magnetizes an element's edges to the artboard edges (and to the other
    // leaves' edges). Composes through the scene transform for free (Moveable reads
    // on-screen rects).
    const stage = editorDoc?.getElementById("tqe-stage") ?? null;
    return stage ? [stage, ...leaves] : leaves;
  }, [section, moveableTargets, width, height, editorDoc]);

  // Recompute the handle geometry for the current selection: (1) which side the
  // rotation knob sits on (opposite the pill), and (2) the handle SIZE — scaled to
  // the selection's short side so handles on a tiny shape shrink instead of
  // overlapping. Reads live rects, so it's also called after a drag/resize settles.
  const applyHandleGeometry = useCallback(
    (els: HTMLElement[]) => {
      const doc = editorDoc;
      const iframeEl = iframeRef.current;
      const live = els.filter((el) => el.isConnected);
      if (!doc || !iframeEl || live.length === 0) return;
      let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
      for (const el of live) {
        const r = el.getBoundingClientRect();
        top = Math.min(top, r.top);
        bottom = Math.max(bottom, r.bottom);
        left = Math.min(left, r.left);
        right = Math.max(right, r.right);
      }
      // The pill flips ABOVE the selection only when it can't fit below (selection
      // hugging the viewport bottom). Mirror that so the knob takes the other side.
      const ir = iframeEl.getBoundingClientRect();
      const pillAbove = ir.top + bottom + 56 > window.innerHeight;
      setRotationPos(pillAbove ? "bottom" : "top");
      // ~quarter of the short side, clamped [5,12]px, so a small shape's handles
      // don't pile up (and you can actually grab them).
      const hc = Math.max(5, Math.min(12, Math.round(Math.min(right - left, bottom - top) / 4)));
      doc.documentElement.style.setProperty("--tqe-hc", `${hc}px`);
    },
    [editorDoc],
  );
  // Recompute on every selection change (and once the doc is ready).
  useEffect(() => {
    applyHandleGeometry(selected);
  }, [selected, applyHandleGeometry]);

  // ── Custom CANVAS-CENTRE snap (react-moveable can't do it alongside edge snapping —
  // its snapDirections is one global filter, so exposing the centre line makes element
  // EDGES stick to it too). So AFTER react-moveable writes its edge-snapped transform, we
  // nudge the element's translate so its CENTRE lands exactly on the artboard centre when
  // it's within threshold — exclusive to the centre, so it composes with edge snapping
  // instead of fighting it. The snap is ABSOLUTE (idempotent: re-centring an already-
  // centred element is a no-op), so react-moveable re-reading style.transform each frame
  // doesn't accumulate; its own updateRect() then re-aligns the selection box for free.
  const CENTER_SNAP_PX = 6;
  const centerSnap = useCallback((el: HTMLElement) => {
    const doc = editorDoc;
    const stage = doc?.getElementById("tqe-stage");
    if (!doc || !stage) return;
    const sr = stage.getBoundingClientRect();
    const ccx = sr.left + sr.width / 2;
    const ccy = sr.top + sr.height / 2;
    const er = el.getBoundingClientRect();
    const dx = er.left + er.width / 2 - ccx;
    const dy = er.top + er.height / 2 - ccy;
    const scale = scaleRef.current || 1;
    const m = new DOMMatrixReadOnly(el.style.transform);
    const rotated = Math.abs(m.b) > 1e-4 || Math.abs(m.a - 1) > 1e-4;
    // A rotated element's bbox centre isn't its geometric centre, and editing the translate
    // alone would skew it — leave rotated elements to edge snapping only.
    const snapX = !rotated && Math.abs(dx) < CENTER_SNAP_PX;
    const snapY = !rotated && Math.abs(dy) < CENTER_SNAP_PX;
    if (snapX || snapY) {
      const tx = snapX ? m.e - dx / scale : m.e;
      const ty = snapY ? m.f - dy / scale : m.f;
      el.style.transform = `translate(${tx}px, ${ty}px)`;
    }
    const v = doc.getElementById("tqe-cg-v");
    const h = doc.getElementById("tqe-cg-h");
    if (v) { v.style.left = `${ccx}px`; v.style.display = snapX ? "block" : "none"; }
    if (h) { h.style.top = `${ccy}px`; h.style.display = snapY ? "block" : "none"; }
  }, [editorDoc]);

  const hideCenterGuides = useCallback(() => {
    const doc = editorDoc;
    if (!doc) return;
    const v = doc.getElementById("tqe-cg-v");
    const h = doc.getElementById("tqe-cg-h");
    if (v) v.style.display = "none";
    if (h) h.style.display = "none";
  }, [editorDoc]);

  // The two centre-cross guide lines live in the iframe body (same layer as the .tqe-sel
  // overlays). Created once per document; centerSnap() positions + toggles them.
  useEffect(() => {
    const doc = editorDoc;
    if (!doc) return;
    const mk = (cls: string) => {
      const d = doc.createElement("div");
      d.className = cls;
      doc.body.appendChild(d);
      return d;
    };
    const v = mk("tqe-cg tqe-cg-v");
    v.id = "tqe-cg-v";
    const h = mk("tqe-cg tqe-cg-h");
    h.id = "tqe-cg-h";
    return () => {
      v.remove();
      h.remove();
    };
  }, [editorDoc]);

  // Re-glue the selection box(es) to their elements after a transform (the
  // style-MutationObserver already does this live, but a final pass guarantees
  // the box is tight on settle), then persist the slide — ONE save per gesture.
  const commitTransform = useCallback(() => {
    hideCenterGuides();
    selected.forEach((el, i) => place(selBoxesRef.current[i] ?? null, el));
    applyHandleGeometry(selected); // resize/move can change which side fits + the size
    if (!movedRef.current) return; // a press that never moved → no save
    movedRef.current = false;
    if (section) onEditRef.current?.(slide.slideId, serializeSlideSection(section));
  }, [section, selected, slide.slideId, applyHandleGeometry, hideCenterGuides]);

  // Moveable mounts in the iframe BODY (an unscaled, fixed-position overlay layer,
  // same as the .tqe-sel boxes): its control box reads the targets' on-screen
  // (post-#tqe-stage-scale) rects there and aligns exactly, with constant-size
  // handles. (Mounting it INSIDE the scaled #tqe-stage made react-moveable fail to
  // paint the control box at all.) Drag/resize map screen px → slide px via the
  // live stage scale in the handlers.
  const moveableHost = editorDoc?.body ?? null;

  return (
    // The iframe FILLS the workspace (the canvas area between the rails). The slide
    // artboard floats inside it (scene transform); wrapRef is measured for the fit.
    <div ref={wrapRef} style={{ width: "100%", height: "100%", position: "relative" }}>
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        // The deck/AI HTML is sanitized, but sandbox it as defence-in-depth: any
        // sanitizer bypass can't run scripts, navigate the top frame, open popups,
        // or submit forms. NO allow-scripts: the srcDoc carries only HTML + CSS,
        // and ALL editor interactivity (Moveable, selection, contenteditable) runs
        // in the parent React app via a portal into editorDoc.body + listeners on
        // editorDoc. allow-same-origin is REQUIRED so the editor keeps its
        // contentDocument / contentWindow access.
        sandbox="allow-same-origin"
        title="slide editor"
        style={{
          border: 0,
          display: "block",
          width: "100%",
          height: "100%",
          // TRANSPARENT — the studio's dotted + glow backdrop (MagneticGlow, -z-[1])
          // lives BEHIND the canvas; a solid bg here would mask it. The iframe doc is
          // transparent too, so only the opaque artboard paints; the workspace margins
          // reveal the page texture.
          background: "transparent",
        }}
      />
      {/* Moveable lives INSIDE the iframe (portal → editorDoc.body): one document,
          one coordinate space — its control box aligns with the scaled slide, its
          pointer events sit with the slide's own select/edit handlers, and it
          snaps against the real leaves. Drag writes a raw-pointer translate (RTL-
          safe); resize/rotate use Moveable's transform. Commit fires once on
          settle. */}
      {editorDoc && moveableHost
        ? createPortal(
            <Moveable
              ref={moveableRef}
              // ALWAYS mounted (even with no target) so a press on an unselected
              // element has a live Moveable instance to hand the drag off to
              // (waitToChangeTarget → dragStart). With no target it renders nothing.
              target={moveableTargets}
              draggable
              resizable
              rotatable
              snappable
              origin={false}
              keepRatio={false}
              // Canva-style handle set: 4 corners + the 4 edge-midpoints (top/bottom
              // circles, left/right pills). Styled + size-scaled via the iframe CSS.
              // The rotation knob flips to whichever side the pill ISN'T on.
              renderDirections={["nw", "n", "ne", "w", "e", "sw", "s", "se"]}
              rotationPosition={rotationPos}
              // Group mode: render only the ONE outer bounding box, never a per-child
              // outline (matches Canva). Also means neither drag path — the self-driven
              // group drag (onMouseDown CASE A) nor the native onDragGroup — can leave a
              // child outline stranded at its pre-drag position.
              hideChildMoveableDefaultLines={true}
              // Moveable follows its target's own size / inline-style changes (e.g.
              // the StylePill's canvas-align writing a transform) — drag-aware, so it
              // never fights an in-progress drag the way a manual updateRect did.
              useMutationObserver={true}
              useResizeObserver={true}
              elementGuidelines={guidelines}
              // Edge snapping: an element's edges magnetize to the artboard edges + the
              // other leaves' edges (snapDirections defaults to edges). A canvas-CENTRE
              // cross is intentionally NOT wired here — react-moveable's snapDirections is a
              // single GLOBAL filter, so exposing the centre line makes element EDGES stick
              // to it too (you can't get edge-to-edge AND centre-to-centre cleanly from one
              // Moveable). Canvas-centre snapping, if wanted, needs a custom handler.
              snapThreshold={6}
              onDragEnd={(e) => {
                // A press that didn't move on an ALREADY-selected text box → edit it
                // (first press selects, second press edits — Figma/Canva behaviour).
                const p = pressRef.current;
                pressRef.current = null;
                if (!e.isDrag && p && p.wasSole && enterEditRef.current) {
                  enterEditRef.current(p.unit);
                }
              }}
              onDrag={(e) => {
                // SINGLE-element drag, native Moveable transform. On the FLAT structure
                // the target's matrix stack already accounts for the #tqe-stage scale, so
                // the element AND Moveable's box move by the same value — the box can't
                // lag. (Multi-selection drags elsewhere: an existing selection self-drives
                // from onMouseDown CASE A; clicking a group from outside the selection
                // runs Moveable's native onDragGroup.)
                (e.target as HTMLElement).style.transform = e.transform;
                // Custom canvas-centre snap as a POST-step (after react-moveable's edge
                // snap). Absolute + idempotent, so re-reading the DOM next frame is safe.
                centerSnap(e.target as HTMLElement);
                movedRef.current = true;
              }}
              onResize={(e) => {
                applyResize(e.target as HTMLElement, e.width, e.height, e.drag.transform);
                movedRef.current = true;
              }}
              onRotate={(e) => {
                (e.target as HTMLElement).style.transform = snapRotate(e.transform, e.rotation, e.inputEvent);
                movedRef.current = true;
              }}
              onDragGroup={(e) => {
                // Native group transform — same value drives each element AND the group
                // box, so the box follows the whole selection (no stranded border).
                e.events.forEach((sub) => {
                  (sub.target as HTMLElement).style.transform = sub.transform;
                });
                movedRef.current = true;
              }}
              onResizeGroup={(e) => {
                e.events.forEach((sub) =>
                  applyResize(sub.target as HTMLElement, sub.width, sub.height, sub.drag.transform),
                );
                movedRef.current = true;
              }}
              onRotateGroup={(e) => {
                e.events.forEach((sub) => {
                  (sub.target as HTMLElement).style.transform = snapRotate(sub.transform, sub.rotation, e.inputEvent);
                });
                movedRef.current = true;
              }}
              onRenderEnd={commitTransform}
              onRenderGroupEnd={commitTransform}
            />,
            moveableHost,
          )
        : null}
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
  const stack = [...sec.ownerDocument.elementsFromPoint(x, y)].filter(
    (el) => el !== sec && sec.contains(el),
  );
  const secR = sec.getBoundingClientRect();
  // Skip zero-area elements (Claude sometimes emits empty 0px divs — never a hit).
  const sized = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1;
  };
  // Full-bleed = covers ~the whole slide (bg image, full-slide scrim/overlay). These
  // are NOT foreground content — they drop to pass 2 so a click never hijacks the
  // small text/image on top of them, and the TOPMOST one (the visible scrim) wins
  // over the bg image beneath. Full-bleed layers stay selectable here (pass 2) and
  // from the Layers panel, so they can still be moved.
  const fullBleed = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return r.width >= secR.width * 0.9 && r.height >= secR.height * 0.9;
  };
  // Pass 1 — real foreground CONTENT (text / image / svg), not full-bleed: wins over
  // any painted overlay above it (a scrim hit-tests as a solid box even where it's
  // visually clear, so resolving content first lets you click what's beneath it).
  for (const el of stack) {
    const unit = resolveSelectable(el, sec, { paint: false });
    if (unit && sized(unit) && !fullBleed(unit) && pointInInk(unit, x, y)) return unit;
  }
  // Pass 2 — everything else, TOPMOST first: painted shapes, scrims, and full-bleed
  // layers (incl. the bg image). The topmost block under the cursor wins; occluded
  // ones are reached from the Layers panel.
  for (const el of stack) {
    const unit = resolveSelectable(el, sec);
    if (unit && sized(unit) && pointInInk(unit, x, y)) return unit;
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

// Position an overlay box over the element's LAYOUT box (iframe viewport coords) —
// the SAME box react-moveable draws its selection on, so the hover outline and the
// Moveable selection align pixel-for-pixel and the StylePill (which anchors to the
// selection box) floats exactly under Moveable's box. (Earlier this tracked the
// glyph INK; switched to the layout box on the move to Moveable-only chrome.)
function place(box: HTMLElement | null, el: HTMLElement | null) {
  if (!box) return;
  if (!el) { box.style.display = "none"; return; }
  const b = el.getBoundingClientRect();
  if (!b || (b.width === 0 && b.height === 0)) { box.style.display = "none"; return; }
  // CLAMP inside the iframe viewport: a full-bleed element's box would otherwise
  // extend past the canvas edge, where the border is clipped and reads as missing.
  const root = el.ownerDocument.documentElement;
  const maxW = root.clientWidth || Infinity;
  const maxH = root.clientHeight || Infinity;
  const left = Math.max(0, b.left);
  const top = Math.max(0, b.top);
  const right = Math.min(maxW, b.right);
  const bottom = Math.min(maxH, b.bottom);
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
