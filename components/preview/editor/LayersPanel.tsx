"use client";

// Studio — the Layers panel (left). A floating glass card that lists the focused
// slide's visual leaves (text runs, images, graphics) via the canonical
// buildLayerTree, mirroring the Slides nav on the right. Clicking a row selects
// that element in the canvas; the active element's row is highlighted. Rows are
// drag-reorderable by a grip handle (framer-motion Reorder — the same smooth
// draggable-list feel) to change stacking order: on drop we reassign z-index by
// the new order and persist. Rebuilds live as the slide's DOM changes.

import { useEffect, useReducer, useRef, useState } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { buildLayerTree, type LayerNode } from "@/lib/editor/leaves";
import { serializeSlideSection } from "@/lib/editor/serialize";
import {
  SLIDE_NAV_WIDTH,
  RAIL_TOP,
  RAIL_BOTTOM,
} from "@/components/preview/SlideNavSidebar";
import { ParagraphWriteIcon } from "@/components/preview/ParagraphWriteIcon";
import { ColorPickerPopover } from "@/components/create/ColorPickerPopover";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import type { Dictionary } from "@/lib/i18n/dictionaries";

// Snappier than the house 500/35 so a dropped row settles into its new slot
// quickly (the reorder/settle was reading slow at the default).
const SPRING = { type: "spring", stiffness: 700, damping: 42 } as const;

// rgb(a)/named computed colour → hex for the colour-picker value. (Local copy —
// the StylePill has its own; not worth a shared module for six lines.)
function rgbToHex(rgb: string): string {
  const m = rgb.match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return "#000000";
  const [r, g, b] = m
    .slice(0, 3)
    .map((n) => Math.max(0, Math.min(255, Math.round(parseFloat(n)))));
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Localize the non-text kind labels. buildLayerTree (shared with the lab) hands
// back English "Image"/"Generated image"/"Graphic"; text rows already carry the
// slide's own text. Labels are editor chrome → UI-locale dictionary, never the
// deck language and never the shared builder.
function displayLabel(node: LayerNode, dict: Dictionary): string {
  const t = dict.editor.layers;
  if (node.kind === "image") {
    const gen = node.el.hasAttribute("data-genimage");
    return gen ? t.generatedImage : t.image;
  }
  if (node.kind === "graphic") return t.graphic;
  if (node.kind === "gradient") return t.gradient;
  if (node.kind === "background") return t.background;
  return node.label;
}

// The element whose z-index actually governs this leaf's stacking: the leaf itself
// if positioned, else the nearest positioned ancestor (a leaf nested in an abs
// content block restacks the whole block). Falls back to the leaf (forced
// position:relative) when nothing up the chain is positioned. Bounded by the stage.
function stackingTarget(el: HTMLElement, win: Window, stage: Element): HTMLElement {
  let n: HTMLElement | null = el;
  while (n && n !== stage) {
    if (win.getComputedStyle(n).position !== "static") return n;
    n = n.parentElement;
  }
  return el;
}

function effectiveZ(el: HTMLElement, win: Window, stage: Element): number {
  const z = parseInt(win.getComputedStyle(stackingTarget(el, win, stage)).zIndex, 10);
  return Number.isNaN(z) ? 0 : z;
}

// Leaves sorted by effective z, FRONT first (design-tool convention: top of list =
// on top). Ties (z auto) fall back to DOM order with later-in-DOM = front.
function frontFirst(tree: LayerNode[], win: Window, stage: Element): LayerNode[] {
  return [...tree]
    .map((n, i) => ({ n, i, z: effectiveZ(n.el, win, stage) }))
    .sort((a, b) => b.z - a.z || b.i - a.i)
    .map((x) => x.n);
}

export function LayersPanel({
  doc,
  selected,
  onSelect,
  onCommit,
  slideId,
  collapsed = false,
}: {
  // The editor iframe's document (from SlideEditor.onDocReady), or null when the
  // editor isn't mounted yet.
  doc: Document | null;
  selected: HTMLElement | null;
  onSelect: (el: HTMLElement | null) => void;
  // Persist a reorder — same (slideId, html) save path the StylePill uses.
  onCommit: (slideId: string, html: string) => void;
  slideId: string;
  // Deck language — accepted for caller compatibility but unused now that the
  // panel (editor chrome) follows the UI locale via useDict/useLocale.
  language?: "ar" | "en";
  // Studio: collapsed → slide off the left edge (kept mounted); DeckView shows
  // a bare edge arrow to reopen.
  collapsed?: boolean;
}) {
  const dict = useDict();
  const { dir } = useLocale();
  const t = dict.editor.layers;
  const [tree, setTree] = useState<LayerNode[]>([]);
  // The controlled display order (front-first). framer Reorder reorders this
  // visually during a drag; we persist z-index + save on drag END.
  const [order, setOrder] = useState<LayerNode[]>([]);
  // Mirror the order into a ref so drag-END (an event handler) reads the LATEST
  // order without re-subscribing.
  const orderRef = useRef<LayerNode[]>([]);
  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  // Which row is mid-drag (its data-tq-id), or null. Drives the per-row lift, the
  // un-clip so the dragged row floats free of the sidebar, and the global
  // grab-cursor + no-select lock (else the pointer reverts and drag-selects text).
  const [draggingId, setDraggingId] = useState<string | null>(null);
  useEffect(() => {
    if (!draggingId) return;
    document.body.classList.add("tq-grabbing");
    return () => document.body.classList.remove("tq-grabbing");
  }, [draggingId]);
  const isDragging = draggingId != null;

  // The background-colour swatch on the pinned الخلفية row. forceBg re-reads the
  // root's computed colour after a live recolour so the swatch tracks the picker.
  const [bgPickerOpen, setBgPickerOpen] = useState(false);
  const [, forceBg] = useReducer((x: number) => x + 1, 0);

  // Build + live-rebuild the tree from the slide's stage. childList/subtree
  // catches add/remove; characterData refreshes a text row's label. Attribute
  // toggles (contenteditable, the edit-time z-lift, OUR z-index writes) are NOT
  // observed, so editing / reordering doesn't churn the list. rAF-debounced.
  useEffect(() => {
    const stage = doc?.getElementById("tqe-stage");
    if (!stage) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTree([]);
      return;
    }
    let raf = 0;
    const rebuild = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setTree(buildLayerTree(stage)));
    };
    rebuild();
    const mo = new MutationObserver(rebuild);
    mo.observe(stage, { childList: true, subtree: true, characterData: true });
    return () => {
      mo.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [doc]);

  // Re-derive the front-first order whenever the leaf set changes. Because a
  // committed reorder writes z-index, this round-trips to the same order — so a
  // text edit (which rebuilds the tree) never loses the user's stacking.
  useEffect(() => {
    const stage = doc?.getElementById("tqe-stage");
    const win = doc?.defaultView;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrder(stage && win ? frontFirst(tree, win, stage) : tree);
  }, [tree, doc]);

  // On drag end: reassign z-index to each stacking target by the final order
  // (frontmost → highest z; relative-if-static = no layout shift), then persist.
  const commitOrder = () => {
    const stage = doc?.getElementById("tqe-stage");
    const win = doc?.defaultView;
    if (!stage || !win) return;
    const next = orderRef.current;
    const n = next.length;
    const seen = new Set<HTMLElement>();
    next.forEach((node, i) => {
      const target = stackingTarget(node.el, win, stage);
      if (seen.has(target)) return;
      seen.add(target);
      if (win.getComputedStyle(target).position === "static") {
        target.style.position = "relative";
      }
      target.style.zIndex = String(n - i);
    });
    const section = stage.querySelector("[data-tq-id]");
    if (section) onCommit(slideId, serializeSlideSection(section));
  };

  // Keyboard reorder for the grip handle (a11y): move a layer one step toward the
  // front (-1, ArrowUp) or back (+1, ArrowDown). Mirrors a drag — swap in `order`,
  // then reassign z + persist. orderRef is synced first so commitOrder sees it.
  const moveLayer = (node: LayerNode, dir: -1 | 1) => {
    const cur = orderRef.current;
    const i = cur.indexOf(node);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cur.length) return;
    const next = [...cur];
    [next[i], next[j]] = [next[j], next[i]];
    orderRef.current = next;
    setOrder(next);
    commitOrder();
  };

  // The slide BACKGROUND — synthesized from the real slide root (the first tagged
  // element inside the stage), since buildLayerTree is handed the stage, not the
  // root. Pinned as a fixed bottom row; never in the draggable list.
  const slideRoot =
    doc?.getElementById("tqe-stage")?.querySelector<HTMLElement>("[data-tq-id]") ?? null;
  const bgNode: LayerNode | null = slideRoot
    ? { el: slideRoot, label: "Background", kind: "background", depth: 0 }
    : null;
  // The background's current colour (shown in the swatch). Computed in the
  // IFRAME's view, since slideRoot lives there.
  const bgRgb =
    slideRoot && doc?.defaultView
      ? doc.defaultView.getComputedStyle(slideRoot).backgroundColor
      : "rgba(0, 0, 0, 0)";
  // Live recolour the canvas as the picker drags; persist once on close.
  const recolorBgLive = (hex: string) => {
    slideRoot?.style.setProperty("background-color", hex);
    forceBg();
  };
  const commitBg = () => {
    setBgPickerOpen(false);
    if (slideRoot) onCommit(slideId, serializeSlideSection(slideRoot));
  };
  const countLabel = `${tree.length} ${tree.length === 1 ? t.layerOne : t.layerMany}`;

  return (
    <aside
      // Collapsed → off-screen: take it out of the tab order + a11y tree too,
      // not just pointer events (CR), so hidden controls can't be focused.
      inert={collapsed}
      aria-hidden={collapsed || undefined}
      dir={dir}
      aria-label={t.title}
      // Drop the clip while dragging (lifted row floats past the edges) OR while
      // the background colour picker is open (it spills below the panel).
      className={` fixed z-[30] flex flex-col rounded-3xl border p-3 ${
        isDragging || bgPickerOpen ? "overflow-visible" : "overflow-hidden"
      }`}
      style={{
        left: 16,
        // Anchored to the fixed page band [RAIL_TOP, vh - RAIL_BOTTOM] so it's
        // full-height + matches the Slides rail exactly, centered on the page
        // (user direction 2026-06-14). Collapsed → slide off the left edge (still
        // mounted; DeckView shows a bare edge arrow to reopen).
        top: RAIL_TOP,
        bottom: RAIL_BOTTOM,
        transform: collapsed ? "translateX(calc(-100% - 24px))" : undefined,
        width: SLIDE_NAV_WIDTH,
        background: "var(--tq-surface)",
        borderColor: "var(--tq-border-hairline)",
        pointerEvents: collapsed ? "none" : undefined,
        transition: "transform 300ms ease",
      }}
    >
      <header className="border-b border-foreground/[0.08] px-1 pb-3 pt-1">
        <p className="text-muted text-[10px] uppercase tracking-widest">{countLabel}</p>
        <h2 className="mt-1 text-sm font-semibold text-foreground">{t.title}</h2>
      </header>

      {order.length === 0 && !bgNode ? (
        doc == null ? (
          // No editor document yet = the deck is still generating (the panel is
          // shown disabled in the unified shell). Show the same branded
          // paragraph-write animation the streaming slide thumbnails use, so the
          // empty Layers panel reads as "designing…" rather than "nothing here".
          <div className="flex flex-1 items-center justify-center py-8">
            <ParagraphWriteIcon rtl={dir === "rtl"} size={28} className="text-foreground/40" />
          </div>
        ) : (
          <p className="px-2 py-4 text-[12px] text-foreground/40">{t.none}</p>
        )
      ) : (
        <>
          <Reorder.Group
            axis="y"
            values={order}
            onReorder={setOrder}
            className={`flex-1 space-y-0.5 overscroll-contain pt-2 ${
              isDragging ? "overflow-visible" : "overflow-y-auto"
            }`}
          >
            {order.map((node) => {
              const id = node.el.getAttribute("data-tq-id") ?? node.label;
              return (
                <LayerRow
                  key={id}
                  node={node}
                  active={node.el === selected}
                  dragging={draggingId === id}
                  onSelect={onSelect}
                  onDragStart={() => setDraggingId(id)}
                  onDragEnd={() => {
                    commitOrder();
                    setDraggingId(null);
                  }}
                  onMove={(d) => moveLayer(node, d)}
                  dict={dict}
                />
              );
            })}
          </Reorder.Group>
          {/* The slide background — pinned at the bottom (always backmost), not
              draggable. Its colour is changed inline from the swatch on the
              trailing (left in RTL) edge; no canvas pill. */}
          {bgNode && (
            <div className="mt-1 shrink-0 border-t border-foreground/[0.06] pt-1">
              <div className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] text-foreground/70">
                <LayerIcon kind="background" active={false} />
                <span className="min-w-0 flex-1 truncate text-start">
                  {displayLabel(bgNode, dict)}
                </span>
                <div className="relative shrink-0">
                  <button
                    type="button"
                    aria-label={t.bgColor}
                    // Closing via the swatch must persist too — commitBg() both
                    // closes and serializes, else a live recolor is dropped.
                    onClick={() => (bgPickerOpen ? commitBg() : setBgPickerOpen(true))}
                    className="block h-[18px] w-[18px] rounded-full border transition-transform hover:scale-110"
                    style={{ borderColor: "var(--tq-border-hairline)", background: bgRgb }}
                  />
                  {/* align="start" so the 182px popover opens RIGHTWARD into the
                      panel from the left-edge swatch instead of off the edge. */}
                  <ColorPickerPopover
                    open={bgPickerOpen}
                    value={rgbToHex(bgRgb)}
                    onChange={recolorBgLive}
                    onClose={commitBg}
                    align="start"
                    flipUp
                    instantExit
                    surfaceClassName="surface-popover"
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </aside>
  );
}

function LayerRow({
  node,
  active,
  dragging,
  onSelect,
  onDragStart,
  onDragEnd,
  onMove,
  dict,
}: {
  node: LayerNode;
  active: boolean;
  dragging: boolean;
  onSelect: (el: HTMLElement | null) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (dir: -1 | 1) => void;
  dict: Dictionary;
}) {
  // Drag is initiated ONLY by the grip handle (dragListener off) so the rest of
  // the row stays a plain click-to-select target — no gesture conflict.
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={node}
      dragListener={false}
      dragControls={controls}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      // Scale via framer `animate`; the lift SHADOW is a CSS transition (.is-
      // dragging) so it always fades back to none on drop — animating box-shadow
      // through framer was getting stranded by the drop's layout animation.
      animate={{ scale: dragging ? 1.03 : 1 }}
      transition={SPRING}
      style={{
        position: "relative",
        zIndex: dragging ? 60 : undefined,
        // Opaque + bordered while dragging so the floating chip reads solidly
        // once it leaves the panel over the canvas.
        background: dragging ? "rgba(var(--tq-bg-rgb), 0.96)" : undefined,
        border: dragging ? "1px solid var(--tq-border-hairline)" : undefined,
      }}
      className={`tq-layer-row group/row flex items-center gap-1 rounded-xl pr-1 ${
        dragging
          ? "is-dragging"
          : active
            ? "bg-foreground/[0.10]"
            : "hover:bg-foreground/[0.05]"
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(node.el)}
        className={`flex min-w-0 flex-1 items-center gap-2.5 px-2 py-2 text-start text-[13px] transition-colors ${
          active ? "text-foreground" : "text-foreground/70 group-hover/row:text-foreground"
        }`}
      >
        <LayerIcon kind={node.kind} active={active} />
        {/* No dir="auto": labels follow the panel's RTL so Latin names still sit
            on the leading edge. */}
        <span className="min-w-0 flex-1 truncate text-start">
          {displayLabel(node, dict)}
        </span>
      </button>
      {/* Grip handle (trailing edge). Drag with the pointer, or focus it and use
          ↑/↓ to reorder by keyboard (a11y). Appears on row hover OR keyboard focus. */}
      <span
        role="button"
        tabIndex={0}
        aria-label={dict.editor.layers.reorder}
        onPointerDown={(e) => controls.start(e)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            onMove(-1);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            onMove(1);
          }
        }}
        className="flex shrink-0 cursor-grab touch-none items-center rounded px-1.5 py-2 text-foreground/25 opacity-0 outline-none transition-opacity hover:text-foreground/60 focus-visible:opacity-100 focus-visible:text-foreground/70 focus-visible:ring-1 focus-visible:ring-white/40 group-hover/row:opacity-100 active:cursor-grabbing"
      >
        <GripIcon />
      </span>
    </Reorder.Item>
  );
}

function LayerIcon({ kind, active }: { kind: LayerNode["kind"]; active: boolean }) {
  const cls = `shrink-0 ${active ? "text-foreground" : "text-foreground/45"}`;
  if (kind === "image") {
    return (
      <svg className={cls} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.5-3.5a2 2 0 0 0-2.8 0L5 21" />
      </svg>
    );
  }
  if (kind === "graphic") {
    return (
      <svg className={cls} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 2 2 7l10 5 10-5-10-5Z" />
        <path d="m2 17 10 5 10-5" />
        <path d="m2 12 10 5 10-5" />
      </svg>
    );
  }
  if (kind === "gradient") {
    return (
      <svg className={cls} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (kind === "background") {
    return (
      <svg className={cls} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="3" width="13" height="13" rx="2" />
        <path d="M8 21h11a2 2 0 0 0 2-2V8" />
      </svg>
    );
  }
  return (
    <svg className={cls} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 7V5h16v2" />
      <path d="M9 19h6" />
      <path d="M12 5v14" />
    </svg>
  );
}

function GripIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  );
}
