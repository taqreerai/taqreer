"use client";

// I2 — the floating style pill. A contextual, type-aware property toolbar that
// floats over the element selected in the SlideEditor iframe. Lives in the PARENT
// document (portaled to <body>) because its controls are parent-doc React
// primitives — but it anchors to the in-iframe element via
// `target.ownerDocument.defaultView.frameElement`, the <iframe> seen from inside.
//
// Position is driven by a requestAnimationFrame LOOP (not React state): every frame
// it reads the live selection box (.tqe-sel) and writes the pill's left/top. So the
// pill ALWAYS tracks the current selection — switching elements, resizing via the
// size control, aligning, or any reflow leaves it glued, never stuck on the old one.
//
// Model (decided 2026-06-05): WHOLE-ELEMENT styling — one inline style on the
// element, never a <span> wrapper. Saving is deferred to "you're done": writes are
// live, but the serialize → I3 save (onCommit) fires once, on DESELECT (the pill
// unmounts / re-targets) — a run of tweaks is ONE version, not one-per-keystroke.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ColorPickerPopover } from "@/components/create/ColorPickerPopover";
import { MorePopover } from "./MorePopover";
import { FontControl } from "./FontControl";
import { canonicalFamily, googleFontUrl } from "@/lib/editor/font-search";
import { serializeSlideSection } from "@/lib/editor/serialize";
import type { GenImageAspect } from "@/lib/images/slide-images";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";

type Props = {
  // The selection SET (plan-editor §20). Length 1 → the classic single-element
  // pill (text / image / svg). Length > 1 → a multi-text pill: the gate below
  // only renders when EVERY target is text, and every control applies to ALL of
  // them (showing a "mixed" hint when their values differ). targets[0] is the
  // primary — it anchors the pill and represents the displayed values.
  targets: HTMLElement[];
  slideId: string;
  onCommit: (slideId: string, html: string) => void;
  // Clears the selection (→ unmounts the pill). Fired on a click outside the pill
  // AND outside the slide canvas (clicks inside the iframe go through SlideEditor).
  onDismiss: () => void;
  // Deck language — accepted for caller compatibility but unused now that the
  // pill chrome follows the UI locale (useDict / useLocale).
  language?: "en" | "ar";
  // §19 — regenerate an AI image box with an edited prompt. The pill shows the
  // Regenerate button only for an AI image (data-genid + data-genimage); on
  // confirm it updates the box's data-genimage (committed like Replace) and
  // calls this, which fires the regen route + drives the live swap (DeckView).
  onRegenImage?: (input: {
    genid: string;
    slideId: string;
    prompt: string;
    aspect: GenImageAspect;
  }) => void;
};

// Union of a list of rects (viewport coords) → the tight bounding box, or null
// for an empty list. Drives the multi-select pill's anchor (it spans the whole
// marquee set) while degrading to the single box for a length-1 selection.
function unionRect(
  rects: DOMRect[],
): { left: number; top: number; right: number; bottom: number; width: number; height: number } | null {
  if (!rects.length) return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const r of rects) {
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

type Kind = "text" | "image" | "svg";
function kindOf(el: HTMLElement): Kind {
  if (el.tagName === "IMG") return "image";
  if (el.tagName.toLowerCase() === "svg" || el.closest("svg")) return "svg";
  return "text";
}

// A decorative fill — a gradient scrim, a background image, or a colour block,
// with NO content (no text, no img/svg). These have no useful pill controls (you
// edit a gradient/background from the Layers panel), so the pill SUPPRESSES for
// them: selecting a تدرّج (or any fill) shows nothing on the canvas.
function isDecorativeFill(el: HTMLElement): boolean {
  // An <img>/<svg> IS the content leaf, never a decorative fill — even when it
  // carries a `background` placeholder. Gen-image boxes ship with an inline
  // `background: linear-gradient(…)` (Claude's pre-load placeholder), so the
  // `backgroundImage` test below would otherwise mis-classify the image as a
  // fill and suppress the whole pill (no Replace / §19 Regenerate). The
  // `querySelector("img, svg")` check only catches a WRAPPER containing one,
  // not the element itself — this guards the element-is-the-img/svg case.
  if (el.tagName === "IMG" || el.tagName.toLowerCase() === "svg") return false;
  if ((el.textContent ?? "").trim() !== "") return false;
  if (el.querySelector("img, svg")) return false;
  const cs = getComputedStyle(el);
  if (/gradient|url\(/i.test(cs.backgroundImage)) return true;
  return !isNoPaint(cs.backgroundColor);
}

function rgbToHex(rgb: string): string {
  const m = rgb.match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return "#000000";
  const [r, g, b] = m
    .slice(0, 3)
    .map((n) => Math.max(0, Math.min(255, Math.round(parseFloat(n)))));
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// A paint value that contributes no ink — skipped when reading/recolouring an
// SVG so its cut-outs / transparent backgrounds are preserved.
function isNoPaint(c: string): boolean {
  return !c || c === "none" || c === "transparent" || /,\s*0(\.0+)?\)\s*$/.test(c);
}

// The graphic's current paint colour (first inked fill, else first inked
// stroke) as hex — drives the recolour swatch.
function svgPaintHex(svg: HTMLElement): string {
  const els = [svg, ...svg.querySelectorAll<SVGElement>("*")];
  for (const el of els) {
    const f = getComputedStyle(el).fill;
    if (!isNoPaint(f)) return rgbToHex(f);
  }
  for (const el of els) {
    const s = getComputedStyle(el).stroke;
    if (!isNoPaint(s)) return rgbToHex(s);
  }
  return "#000000";
}

// Recolour a graphic: every shape that currently HAS a paint takes the new
// colour (fill→fill, stroke→stroke) via inline style — which serializes into
// the saved HTML and is what dom-to-pptx reads at export. `none`/transparent
// paints are left alone so the SVG's structure stays intact.
function recolorSvgEl(svg: HTMLElement, hex: string): void {
  for (const el of [svg, ...svg.querySelectorAll<SVGElement>("*")]) {
    if (!isNoPaint(getComputedStyle(el).fill)) el.style.fill = hex;
    if (!isNoPaint(getComputedStyle(el).stroke)) el.style.stroke = hex;
  }
}

type Align = "left" | "center" | "right" | "justify";

function AlignIcon({ a }: { a: Align }) {
  const widths = [11, 7, 10, 6];
  return (
    <svg width="17" height="14" viewBox="0 0 14 12" aria-hidden>
      {[1, 4, 7, 10].map((y, i) => {
        const w = widths[i];
        const x =
          a === "left" || a === "justify"
            ? 1.5
            : a === "right"
              ? 12.5 - w
              : (14 - w) / 2;
        return (
          <rect key={i} x={x} y={y} width={w} height={1.4} rx={0.7} fill="currentColor" />
        );
      })}
    </svg>
  );
}

const SIZE_MIN = 4;
const SIZE_MAX = 1200;

// Free-typing font-size control: type any value (commit on blur / Enter), with a
// tight stacked ▲/▼ column on the trailing edge that nudges by 1. Compact — the
// number reads first, the spinner is a quiet secondary affordance. Range spans the
// decorative 700px+ numbers.
function SizeStepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const t = useDict().editor.style;
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);
  const clamp = (n: number) => Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(n)));
  const commitText = () => {
    const n = parseFloat(text);
    if (Number.isFinite(n)) onChange(clamp(n));
    setText(String(Number.isFinite(n) ? clamp(n) : value));
  };
  return (
    <div
      className="flex items-center rounded-full border"
      style={{
        height: 30,
        // The pill's bg/border runs to its edge, so without margin it crowds the
        // neighbouring buttons (whose glyphs are inset 6px). 6px margin matches
        // that inset → even visual gaps on both sides.
        marginInline: 6,
        paddingInlineStart: 8,
        paddingInlineEnd: 3,
        borderColor: "var(--tq-border-hairline)",
        background: "var(--tq-surface)",
      }}
    >
      <input
        value={text}
        inputMode="numeric"
        aria-label={t.fontSize}
        dir="ltr"
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          focused.current = false;
          commitText();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          else if (e.key === "ArrowUp") { e.preventDefault(); onChange(clamp(value + 1)); }
          else if (e.key === "ArrowDown") { e.preventDefault(); onChange(clamp(value - 1)); }
        }}
        className="no-spinner w-[26px] border-none bg-transparent text-center text-[13px] tabular-nums text-foreground outline-none"
      />
      <div className="flex flex-col">
        <button
          type="button"
          aria-label={t.bigger}
          className="flex h-[12px] w-[15px] items-center justify-center text-foreground/45 transition-colors hover:text-foreground"
          onClick={() => onChange(clamp(value + 1))}
        >
          <Chevron up />
        </button>
        <button
          type="button"
          aria-label={t.smaller}
          className="flex h-[12px] w-[15px] items-center justify-center text-foreground/45 transition-colors hover:text-foreground"
          onClick={() => onChange(clamp(value - 1))}
        >
          <Chevron />
        </button>
      </div>
    </div>
  );
}

// Tiny single-stroke chevron — `up` points it up (size +), default points down.
function Chevron({ up = false }: { up?: boolean }) {
  return (
    <svg width="9" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={up ? "M1 5l4-4 4 4" : "M1 1l4 4 4-4"} />
    </svg>
  );
}

export function StylePill({ targets, slideId, onCommit, onDismiss, onRegenImage }: Props) {
  // The primary target — anchors positioning, drives single-element controls
  // (image/svg), and supplies the DISPLAYED value for every text control. A
  // multi-text selection still reads/writes through `targets`.
  const target = targets[0];
  // Pill controls are editor chrome → strings + chrome direction come from the
  // UI locale (useDict / useLocale), not the deck language.
  const dict = useDict();
  const t = dict.editor.style;
  const { dir } = useLocale();
  // True multi-element selection (the marquee picked 2+). When false this is the
  // classic single-element pill and every code path below collapses to `target`.
  const multi = targets.length > 1;
  const kind = kindOf(target);
  const pillRef = useRef<HTMLDivElement>(null);
  const [, force] = useState(0);
  const [colorOpen, setColorOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [fontOpen, setFontOpen] = useState(false);
  // §19 — the regenerate-image prompt editor (open state + draft prompt). The
  // draft is seeded from the box's data-genimage when the popover opens.
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenPrompt, setRegenPrompt] = useState("");
  // Whether the OPEN popover (colour picker / ⋯ menu) opens upward — set the
  // moment a popover opens, purely from which side of the pill the element is on
  // (see the layout effect below).
  const [popoverFlipUp, setPopoverFlipUp] = useState(false);
  // True while the pointer is pressed on the pill (clicking/holding a control).
  const [pillActive, setPillActive] = useState(false);
  // Image "Replace": hidden file input + in-flight upload flag.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const dirty = useRef(false);

  // ── position: a rAF loop reads the live selection box(es) (.tqe-sel) and writes
  // the pill's left/top every frame, so it always tracks the current selection.
  // For a multi-text selection it anchors over the UNION of every box. ──
  useEffect(() => {
    let raf = 0;
    // Place the pill ONCE per selection: track the element until its selection box
    // lands, then LOCK the position. Otherwise the follow-loop re-centers every
    // frame and an edit that resizes the element (the size stepper, alignment, …)
    // slides the controls out from under the cursor. Re-anchors only on a new
    // selection — this effect re-runs on `targets`, so `placed` starts false again.
    let placed = false;
    const tick = () => {
      const el = pillRef.current;
      const win = target.ownerDocument.defaultView;
      const iframeEl = (win?.frameElement as HTMLElement | null) ?? null;
      if (el && iframeEl && target.isConnected) {
        const ir = iframeEl.getBoundingClientRect();
        // Every live selection box (one per selected element). The pill anchors to
        // their UNION so a marquee pill spans the whole set; single-select is just
        // the one box.
        const selBoxes = [...target.ownerDocument.querySelectorAll<HTMLElement>(".tqe-sel")].filter(
          (b) => b.style.display !== "none",
        );
        const union = unionRect(selBoxes.map((b) => b.getBoundingClientRect()));
        const box = union ?? target.getBoundingClientRect();
        const cx = ir.left + box.left + box.width / 2;
        const topY = ir.top + box.top;
        const botY = ir.top + box.bottom;
        const pw = el.offsetWidth;
        const ph = el.offsetHeight;
        // Images: the pill floats INSIDE the image at its top, with a small margin
        // (Canva-style) — images are big and a pill above them wastes space / can
        // sit off-canvas. Everything else (incl. a multi-text set): ABOVE the
        // selection, flipping BELOW when it hugs the canvas top.
        let top: number;
        if (kind === "image" && !multi) {
          top = topY + 12;
        } else {
          top = topY - 10 - ph;
          if (top < ir.top + 4) top = botY + 10;
        }
        top = Math.max(8, Math.min(top, window.innerHeight - ph - 8));
        const left = Math.max(8, Math.min(cx - pw / 2, window.innerWidth - pw - 8));
        // Hold the placed position; only the first frames (until the box lands) move it.
        if (!placed) {
          el.style.left = `${left}px`;
          el.style.top = `${top}px`;
        }
        el.style.visibility = "visible";

        // Selection-outline visibility (user direction 2026-06-12: the
        // border stays visible from selection until EDITING starts).
        // The only hide condition is the target being contenteditable.
        // The old editingRef (popover/pill-press) and selectingRef /
        // box-landed guards were dropped - the landed-check latched
        // "hidden" after a click and kept the border invisible until
        // the next pointer event, the exact flicker the user reported.
        if (selBoxes.length) {
          // Pill placement still locks once the box has landed on the
          // current target (single-select), so an edit that resizes
          // the element doesn't slide the controls mid-interaction.
          if (!multi) {
            const selRect = selBoxes[0].getBoundingClientRect();
            const tr = target.getBoundingClientRect();
            const bcx = selRect.left + selRect.width / 2;
            const bcy = selRect.top + selRect.height / 2;
            if (bcx >= tr.left && bcx <= tr.right && bcy >= tr.top && bcy <= tr.bottom) {
              placed = true;
            }
          } else {
            placed = true;
          }
          const hidden = target.isContentEditable;
          for (const b of selBoxes) b.style.visibility = hidden ? "hidden" : "visible";
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      for (const b of target.ownerDocument.querySelectorAll<HTMLElement>(".tqe-sel")) {
        b.style.visibility = "visible";
      }
    };
  }, [target, kind, multi]);

  // ── Popovers open on the OPPOSITE side from the element, mirroring the pill's
  // own placement: pill ABOVE the element → open UP (above the pill); pill BELOW
  // the element → open DOWN. That single rule guarantees the popover never lands
  // over the element, in every position. Decided the moment a popover opens, in a
  // layout effect (before paint) so there's no flicker. ──
  useLayoutEffect(() => {
    if (!colorOpen && !moreOpen && !fontOpen) return;
    const pill = pillRef.current;
    const iframeEl = (target.ownerDocument.defaultView?.frameElement as HTMLElement | null) ?? null;
    if (!pill || !iframeEl) return;
    const pillBottom = pill.getBoundingClientRect().bottom;
    const elTop = iframeEl.getBoundingClientRect().top + target.getBoundingClientRect().top;
    setPopoverFlipUp(elTop >= pillBottom - 2); // element below the pill → open up
  }, [colorOpen, moreOpen, fontOpen, target]);

  // ── dismiss on a click outside the pill (and outside the canvas — clicks inside
  // the iframe live in a separate document and never reach this listener). ──
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (pillRef.current?.contains(e.target as Node)) return;
      onDismiss();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onDismiss]);

  // ── Iframe pointer events: the popovers' own outside-click listeners live on
  // the PARENT doc, so a pointer-down inside the iframe closes any open popover
  // here (before the new element is even selected - selection lands on `click`).
  useEffect(() => {
    const idoc = target.ownerDocument;
    const onDown = () => {
      setColorOpen(false);
      setMoreOpen(false);
      setFontOpen(false);
    };
    idoc.addEventListener("mousedown", onDown);
    return () => {
      idoc.removeEventListener("mousedown", onDown);
    };
  }, [target]);

  // ── commit ONCE on deselect/re-target (cleanup captures the OLD target set).
  // A run of tweaks across the whole selection is ONE save per affected slide: we
  // serialize each DISTINCT section the targets belong to (a marquee lives in one
  // slide, but dedupe defensively) and fire onCommit once for each. ──
  useEffect(() => {
    const els = targets;
    const sid = slideId;
    return () => {
      if (!dirty.current) return;
      dirty.current = false;
      // Dedupe by section so two targets in the same slide don't double-save.
      const seen = new Set<HTMLElement>();
      for (const el of els) {
        if (!el.isConnected) continue;
        const sec = el.closest("section") as HTMLElement | null;
        if (!sec || seen.has(sec)) continue;
        seen.add(sec);
        onCommit(sid, serializeSlideSection(sec));
      }
    };
  }, [targets, slideId, onCommit]);

  // (Selection-outline visibility is driven by the rAF above — it reads the box
  // every frame, so it can gate on whether the box has actually landed on the
  // current target, which a state-driven effect can't do race-free.) Mirror the
  // "editing" flag into a ref the rAF reads (can't write a ref during render).
  // Pointer released anywhere ends the "pressing the pill" state.
  useEffect(() => {
    const onUp = () => setPillActive(false);
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, []);

  // Apply an inline style to EVERY target (one element for single-select; the
  // whole text set for a marquee → "apply to all").
  const setStyle = useCallback(
    (prop: string, value: string) => {
      for (const t of targets) t.style.setProperty(prop, value);
      dirty.current = true;
      force((n) => n + 1);
    },
    [targets],
  );

  // Recolour the selected graphic — inline fill/stroke on its painted shapes
  // (serializes into the saved HTML).
  const recolorSvg = useCallback(
    (hex: string) => {
      recolorSvgEl(target, hex);
      dirty.current = true;
      force((n) => n + 1);
    },
    [target],
  );

  // Apply a picked font family (null = reset to the deck's theme font). Set the
  // inline font-family AND lazy-load the css2 face INTO THE IFRAME so the preview
  // renders immediately; on save the family persists in the slide HTML and the
  // render/export paths re-inject the link from `usedGoogleFonts()`.
  const onPickFont = useCallback(
    (family: string | null) => {
      for (const t of targets) {
        if (!family) {
          t.style.removeProperty("font-family");
        } else {
          t.style.setProperty("font-family", `"${family}", sans-serif`);
        }
      }
      // Lazy-load the css2 face ONCE into the iframe (all targets share the doc)
      // so the preview renders immediately; on save the family persists in the
      // slide HTML and the render/export paths re-inject the link.
      if (family) {
        const doc = target.ownerDocument;
        const id = `tq-font-${family.replace(/[^A-Za-z0-9]+/g, "-")}`;
        if (!doc.getElementById(id)) {
          const link = doc.createElement("link");
          link.id = id;
          link.rel = "stylesheet";
          link.href = googleFontUrl(family);
          doc.head.appendChild(link);
        }
      }
      dirty.current = true;
      force((n) => n + 1);
    },
    [targets, target],
  );

  // Replace the selected image: upload the picked file → permanent public URL →
  // swap the <img src>. Persists on deselect like any other edit.
  const onPickImage = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ""; // allow re-picking the same file later
      if (!file) return;
      setUploading(true);
      try {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/storage/upload-image", { method: "POST", body });
        const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
        if (!res.ok || !data?.url) throw new Error(data?.error || "upload failed");
        // setAttribute (a method call, like setStyle's setProperty) rather than
        // `img.src = …` — a direct property assignment on the captured element
        // trips react-hooks/immutability. removeAttribute drops any responsive
        // srcset so the browser can't keep serving the old image.
        target.removeAttribute("srcset");
        target.setAttribute("src", data.url);
        // Replacing an AI image with an uploaded one makes it a PLAIN image:
        // drop the gen metadata so the §19 Regenerate button hides (it gates on
        // data-genid + data-genimage) and the live-fill / hash-derivation paths
        // stop targeting this box. Otherwise Regenerate would discard the user's
        // upload and re-generate from the stale prompt (CodeRabbit, PR #53).
        target.removeAttribute("data-genid");
        target.removeAttribute("data-genimage");
        target.removeAttribute("data-genrole");
        target.removeAttribute("data-genaspect");
        dirty.current = true;
        force((n) => n + 1);
      } catch (err) {
        console.error("Image replace failed:", err);
      } finally {
        setUploading(false);
      }
    },
    [target],
  );

  // §19 — confirm the regenerate prompt. Persist the new prompt onto the box
  // (data-genimage; commits on deselect like Replace), drop the current image
  // so the box shows the gen-image shimmer until the new one lands, derive the
  // aspect from the box's own shape, then hand off to DeckView (route + swap).
  const regenPopoverRef = useRef<HTMLDivElement>(null);
  const handleRegenConfirm = useCallback(() => {
    const newPrompt = regenPrompt.trim();
    if (!newPrompt) return;
    const genid = target.getAttribute("data-genid");
    if (!genid) return;
    target.setAttribute("data-genimage", newPrompt);
    target.removeAttribute("srcset");
    target.removeAttribute("src");
    dirty.current = true;
    const r = target.getBoundingClientRect();
    const ratio = r.height > 0 ? r.width / r.height : 1;
    const aspect: GenImageAspect =
      ratio >= 1.15 ? "landscape" : ratio <= 0.87 ? "portrait" : "square";
    onRegenImage?.({ genid, slideId, prompt: newPrompt, aspect });
    setRegenOpen(false);
    force((n) => n + 1);
  }, [regenPrompt, target, slideId, onRegenImage]);

  // Click outside the prompt popover (but not on its toggle, which handles its
  // own open/close) closes it. Capture phase so it beats nested handlers.
  useEffect(() => {
    if (!regenOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (regenPopoverRef.current?.contains(t as Node)) return;
      if (t?.closest?.("[data-regen-toggle]")) return;
      setRegenOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [regenOpen]);

  if (!target.isConnected) return null;
  // Multi-select gate (plan-editor §20): a set of 2+ elements only shows the pill
  // when EVERY one is text — a mixed / non-text multi-selection shows NO pill. The
  // single-element pill (length 1) is unchanged: text, image, and svg all qualify.
  if (multi && !targets.every((t) => kindOf(t) === "text")) return null;
  // A decorative fill (a gradient scrim, a colour block) has no useful pill — you
  // edit it from the Layers panel. Suppress the canvas pill entirely. (Single-
  // element only; an all-text multi-set has no decorative fills by construction.)
  if (!multi && isDecorativeFill(target)) return null;

  // An AI-generated image box (vs an uploaded/replaced one) carries both
  // data-genid and a non-empty data-genimage prompt — only those can regen.
  const isAiImage =
    kind === "image" &&
    !!target.getAttribute("data-genid") &&
    !!(target.getAttribute("data-genimage") ?? "").trim();

  const cs = getComputedStyle(target);
  const fontPx = Math.round(parseFloat(cs.fontSize) || 16);
  const isBold = (parseInt(cs.fontWeight, 10) || 400) >= 600;
  const isItalic = cs.fontStyle === "italic";
  const color = rgbToHex(cs.color);
  const align = (target.style.textAlign || cs.textAlign || "right") as Align;
  const aligns: Align[] = ["left", "center", "right"];
  const svgColor = kind === "svg" ? svgPaintHex(target) : "#000000";
  const opacityRaw = parseFloat(cs.opacity);
  const opacityPct = Math.round((Number.isFinite(opacityRaw) ? opacityRaw : 1) * 100);
  // The element's explicitly-picked Google font (from its inline style), or null
  // when it's inheriting the deck's theme font.
  const inlineFontFirst = (target.style.fontFamily || "")
    .split(",")[0]
    .trim()
    .replace(/^["']|["']$/g, "");
  const currentFontFamily = inlineFontFirst ? canonicalFamily(inlineFontFirst) : null;
  // The font the element ACTUALLY renders in (theme font when no inline pick) —
  // shown on the collapsed font pill.
  const renderedFontName =
    (cs.fontFamily || "").split(",")[0].trim().replace(/^["']|["']$/g, "") || t.font;

  // ── "Mixed" indicators (multi-text only). Each control DISPLAYS the primary
  // target's value; when the set's values DIFFER for that control we flag it so the
  // UI can hint "متعدد / mixed". Single-select is never mixed. We read the same
  // value per element that the display read above uses for `target`. ──
  const someDiffer = (read: (el: HTMLElement) => string): boolean => {
    if (!multi) return false;
    const first = read(target);
    return targets.some((t) => read(t) !== first);
  };
  const sizeMixed = someDiffer((el) => String(Math.round(parseFloat(getComputedStyle(el).fontSize) || 16)));
  const boldMixed = someDiffer((el) => String((parseInt(getComputedStyle(el).fontWeight, 10) || 400) >= 600));
  const italicMixed = someDiffer((el) => (getComputedStyle(el).fontStyle === "italic" ? "1" : "0"));
  const colorMixed = someDiffer((el) => rgbToHex(getComputedStyle(el).color));
  const alignMixed = someDiffer((el) => (el.style.textAlign || getComputedStyle(el).textAlign || "right"));
  const fontMixed = someDiffer((el) => {
    const f = (el.style.fontFamily || "").split(",")[0].trim().replace(/^["']|["']$/g, "");
    return f ? (canonicalFamily(f) ?? f) : "";
  });
  const mixedLabel = t.mixed;

  return createPortal(
    <div
      ref={pillRef}
      dir={dir}
      style={{
        position: "fixed",
        left: -9999,
        top: -9999,
        visibility: "hidden",
        zIndex: 2147483600,
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
        setPillActive(true);
      }}
    >
      {/* The blurred glass sits on a SIBLING layer BEHIND the controls, not as
          their ancestor. A backdrop-filter element is a "backdrop root" for its
          descendants — so if the pill's blur wrapped the controls, the colour
          picker (which pops out below the controls) would be nested inside it
          and could only blur the pill's flat interior, never the slide. With the
          blur on a sibling layer, the picker's only backdrop-filter ancestor is
          none → it blurs the slide directly, exactly like the pill. */}
      <div
        className="surface-popover rounded-full"
        style={{ position: "absolute", inset: 0 }}
      />
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: "6px 6px",
        }}
      >
      {kind === "text" && (
        <>
          {/* Font family — a pill showing the current font that morphs into a
              search over the full Google Fonts catalog. The 6px end margin
              matches the size pill / buttons' inset so the divider sits evenly. */}
          <div style={{ marginInlineEnd: 6, display: "flex", alignItems: "center" }}>
            <FontControl
              open={fontOpen}
              onOpenChange={(o) => {
                setFontOpen(o);
                if (o) {
                  setColorOpen(false);
                  setMoreOpen(false);
                }
              }}
              currentFamily={fontMixed ? null : currentFontFamily}
              label={fontMixed ? mixedLabel : renderedFontName}
              flipUp={popoverFlipUp}
              onPick={onPickFont}
            />
            {fontMixed && <MixedDot label={mixedLabel} />}
          </div>
          <Divider />
          {/* Character cluster — size / bold / italic / colour, tightly spaced
              (gap 2) like the align cluster so every button sits evenly. */}
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <SizeStepper value={fontPx} onChange={(n) => setStyle("font-size", `${n}px`)} />
              {sizeMixed && <MixedDot label={mixedLabel} />}
            </div>
            {/* Bold / Italic show the primary's state; a "mixed" set isn't shown as
                uniformly active (the dot flags the divergence). */}
            <span style={{ display: "inline-flex", alignItems: "center" }}>
              <Btn active={isBold && !boldMixed} onClick={() => setStyle("font-weight", isBold ? "400" : "700")} label="Bold">
                <span style={{ fontWeight: 700, fontSize: 15 }}>B</span>
              </Btn>
              {boldMixed && <MixedDot label={mixedLabel} />}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center" }}>
              <Btn active={isItalic && !italicMixed} onClick={() => setStyle("font-style", isItalic ? "normal" : "italic")} label="Italic">
                <span style={{ fontStyle: "italic", fontWeight: 600, fontSize: 15, fontFamily: "Georgia, serif" }}>I</span>
              </Btn>
              {italicMixed && <MixedDot label={mixedLabel} />}
            </span>
            {/* Colour swatch centered in a 32px box so it lines up with the icon
                buttons (was a bare 22px circle that read as misaligned). */}
            <div className="relative flex h-8 items-center justify-center px-1.5">
              <button
                type="button"
                aria-label={colorMixed ? "Text colour (mixed)" : "Text colour"}
                onClick={() => {
                  setColorOpen((o) => !o);
                  setMoreOpen(false);
                  setFontOpen(false);
                }}
                style={{
                  display: "block",
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  border: "1px solid var(--tq-border-hairline)",
                  // MIXED set (selected elements have DIFFERENT colours) → a
                  // multi-hue wheel so the user can tell at a glance they picked
                  // different colours, instead of a single (misleading) swatch
                  // showing only the first element's colour. A uniform set shows
                  // the actual colour. (conic-gradient is fine here — pill chrome,
                  // never exported.)
                  background: colorMixed
                    ? "conic-gradient(from 90deg, #ef4444, #f59e0b, #facc15, #22c55e, #3b82f6, #8b5cf6, #ec4899, #ef4444)"
                    : color,
                  cursor: "pointer",
                }}
              />
              <ColorPickerPopover
                open={colorOpen}
                value={color}
                onChange={(hex) => setStyle("color", hex)}
                onClose={() => setColorOpen(false)}
                align="center"
                flipUp={popoverFlipUp}
                // Close instantly (no exit fade): the picker is a child of the pill,
                // so a lingering exit would relocate to the next element and flash.
                instantExit
                // Match the pill exactly: same dark glass + the modal-strength
                // boost blur (not the default white-tint card) so the picker
                // reads as frosted glass over a slide.
                surfaceClassName="surface-popover"
              />
            </div>
          </div>
          <Divider />
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            {aligns.map((a) => (
              <Btn key={a} active={align === a && !alignMixed} onClick={() => setStyle("text-align", a)} label={`Align ${a}`}>
                <AlignIcon a={a} />
              </Btn>
            ))}
            {alignMixed && <MixedDot label={mixedLabel} />}
          </div>
        </>
      )}
      {/* Graphic (svg): recolour swatch + inline opacity (no ⋯ — only two
          controls, both fit on the pill). */}
      {kind === "svg" && (
        <>
          <div className="relative flex h-8 items-center justify-center px-1.5">
            <button
              type="button"
              aria-label={t.graphicColour}
              onClick={() => {
                setColorOpen((o) => !o);
                setMoreOpen(false);
              }}
              style={{
                display: "block",
                width: 16,
                height: 16,
                borderRadius: "50%",
                border: "1px solid var(--tq-border-hairline)",
                background: svgColor,
                cursor: "pointer",
              }}
            />
            <ColorPickerPopover
              open={colorOpen}
              value={svgColor}
              onChange={recolorSvg}
              onClose={() => setColorOpen(false)}
              align="center"
              flipUp={popoverFlipUp}
              instantExit
              surfaceClassName="surface-popover"
            />
          </div>
          <Divider />
          <OpacityControl
            value={opacityPct}
            onChange={(pct) => setStyle("opacity", String(pct / 100))}
          />
        </>
      )}
      {/* Image: replace via upload → swap the src. */}
      {kind === "image" && (
        <>
          <button
            type="button"
            aria-label={t.replaceImage}
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] text-foreground/85 transition-colors hover:text-foreground disabled:opacity-60"
            style={{ background: "var(--tq-surface)", border: "1px solid var(--tq-border-hairline)" }}
          >
            <ReplaceIcon />
            {uploading ? t.uploading : t.replace}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={onPickImage}
          />
          {/* §19 — Regenerate an AI image with an edited prompt. Only for AI
              boxes (data-genid + data-genimage). Opens a surface-popover prompt
              editor pre-filled with the box's prompt. */}
          {isAiImage && onRegenImage && (
            <div style={{ position: "relative" }}>
              <button
                type="button"
                data-regen-toggle="true"
                aria-label={t.regenImage}
                onClick={() => {
                  setRegenPrompt(target.getAttribute("data-genimage") ?? "");
                  setRegenOpen((o) => !o);
                  setColorOpen(false);
                  setMoreOpen(false);
                  setFontOpen(false);
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] text-foreground/85 transition-colors hover:text-foreground"
                style={{ background: "var(--tq-surface)", border: "1px solid var(--tq-border-hairline)" }}
              >
                <RegenImageIcon />
                {t.regenerate}
              </button>
              {regenOpen && (
                <div
                  ref={regenPopoverRef}
                  dir={dir}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="surface-popover absolute z-20 rounded-xl p-2.5 text-foreground"
                  style={{
                    width: 300,
                    right: 0,
                    top: popoverFlipUp ? "auto" : "calc(100% + 8px)",
                    bottom: popoverFlipUp ? "calc(100% + 8px)" : "auto",
                  }}
                >
                  <textarea
                    autoFocus
                    dir="auto"
                    rows={3}
                    value={regenPrompt}
                    onChange={(e) => setRegenPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setRegenOpen(false);
                      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        handleRegenConfirm();
                      }
                    }}
                    placeholder={t.regenPlaceholder}
                    className="w-full resize-none rounded-lg border px-3 py-2 text-[13px] leading-relaxed text-foreground outline-none transition-colors placeholder:text-foreground/35 focus:border-foreground/40"
                    style={{ borderColor: "var(--tq-border-hairline)", background: "var(--tq-surface)" }}
                  />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-foreground/40">{t.regenHint}</span>
                    <button
                      type="button"
                      onClick={handleRegenConfirm}
                      disabled={!regenPrompt.trim()}
                      className="btn-gradient-anim inline-flex h-7 items-center rounded-full px-3.5 text-[12px] font-medium text-foreground disabled:opacity-40"
                    >
                      {t.generate}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
      {/* "⋯ more" — the rest of the inspector (weight/line/transform/decoration/
          opacity for text; opacity/rounding for image). SVG has no ⋯ — its two
          controls (colour + opacity) live inline above. The menu hangs
          from the ⋯ button's LEFT edge and extends rightward so it clears the
          element. */}
      {kind !== "svg" && (
        <>
          <Divider />
          <div style={{ position: "relative" }}>
            <Btn
              active={moreOpen}
              onClick={() => {
                setMoreOpen((o) => !o);
                setColorOpen(false);
                setFontOpen(false);
              }}
              label="More options"
            >
              <MoreIcon />
            </Btn>
            <MorePopover
              open={moreOpen}
              target={target}
              kind={kind}
              flipUp={popoverFlipUp}
              setStyle={setStyle}
              onClose={() => setMoreOpen(false)}
            />
          </div>
        </>
      )}
      </div>
    </div>,
    document.body,
  );
}

function MoreIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="3" cy="8" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="13" cy="8" r="1.4" />
    </svg>
  );
}

// Upload glyph (tray + up arrow) for the image "Replace" button.
function ReplaceIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

// Regenerate glyph (circular refresh arrows) for the §19 AI-image regen button.
function RegenImageIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  );
}

// Inline opacity slider (0–100%) — used directly on the pill for graphics, which
// only have two controls so a ⋯ menu would be overkill.
function OpacityControl({ value, onChange }: { value: number; onChange: (pct: number) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        aria-label="Opacity"
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="h-1.5 w-[48px] cursor-pointer"
        style={{ accentColor: "var(--tq-violet)" }}
      />
      <span className="w-[34px] shrink-0 text-right text-[11px] tabular-nums text-foreground">
        {value}%
      </span>
    </div>
  );
}

// Icon button: muted by default, white on hover, white when active (no fill box).
function Btn({
  active,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-8 items-center justify-center rounded-md px-1.5 transition-colors ${
        active ? "text-foreground" : "text-foreground/55 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 22, background: "var(--tq-border-hairline)" }} />;
}

// Compact "mixed" chip — a small brand-violet dot shown beside a control whose
// values differ across a multi-text selection (the control still DISPLAYS the
// primary's value; the dot flags that applying it would unify the set).
function MixedDot({ label }: { label: string }) {
  return (
    <span
      aria-label={label}
      title={label}
      style={{
        display: "inline-block",
        width: 5,
        height: 5,
        borderRadius: "50%",
        background: "var(--tq-violet)",
        marginInlineStart: 3,
        flexShrink: 0,
      }}
    />
  );
}
