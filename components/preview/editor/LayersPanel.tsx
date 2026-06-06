"use client";

// Studio — the Layers panel (left). A floating glass card that lists the focused
// slide's visual leaves (text runs, images, graphics) via the canonical
// buildLayerTree, mirroring the Slides nav on the right. Clicking a row selects
// that element in the canvas; the active element's row is highlighted. Rows are
// drag-reorderable by a grip handle (framer-motion Reorder — the same smooth
// draggable-list feel) to change stacking order: on drop we reassign z-index by
// the new order and persist. Rebuilds live as the slide's DOM changes.

import { useEffect, useRef, useState } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { buildLayerTree, type LayerNode } from "@/lib/editor/leaves";
import { serializeSlideSection } from "@/lib/editor/serialize";
import { SLIDE_NAV_WIDTH } from "@/components/preview/SlideNavSidebar";

const SPRING = { type: "spring", stiffness: 500, damping: 35 } as const;

// Localize the non-text kind labels. buildLayerTree (shared with the lab) hands
// back English "Image"/"Generated image"/"Graphic"; text rows already carry the
// slide's own (Arabic) text. We translate here, never in the shared builder.
function displayLabel(node: LayerNode, isEn: boolean): string {
  if (node.kind === "image") {
    const gen = node.el.hasAttribute("data-genimage");
    return isEn ? (gen ? "Generated image" : "Image") : gen ? "صورة مولّدة" : "صورة";
  }
  if (node.kind === "graphic") return isEn ? "Graphic" : "رسمة";
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
  language = "ar",
}: {
  // The editor iframe's document (from SlideEditor.onDocReady), or null when the
  // editor isn't mounted yet.
  doc: Document | null;
  selected: HTMLElement | null;
  onSelect: (el: HTMLElement | null) => void;
  // Persist a reorder — same (slideId, html) save path the StylePill uses.
  onCommit: (slideId: string, html: string) => void;
  slideId: string;
  language?: "ar" | "en";
}) {
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

  const isEn = language === "en";
  const countLabel = isEn
    ? `${tree.length} ${tree.length === 1 ? "layer" : "layers"}`
    : `${tree.length} ${tree.length === 1 ? "طبقة" : "طبقات"}`;

  return (
    <aside
      dir={isEn ? "ltr" : "rtl"}
      aria-label={isEn ? "Layers" : "الطبقات"}
      className="backdrop-blur-glass fixed z-[30] flex flex-col overflow-hidden rounded-3xl border p-3 shadow-2xl"
      style={{
        left: 16,
        top: 76,
        bottom: 100,
        width: SLIDE_NAV_WIDTH,
        background: "var(--tq-bg-glass)",
        borderColor: "var(--tq-border-glass)",
      }}
    >
      <header className="border-b border-white/[0.08] px-1 pb-3 pt-1">
        <p className="text-muted text-[10px] uppercase tracking-widest">{countLabel}</p>
        <h2 className="mt-1 text-sm font-semibold text-white">
          {isEn ? "Layers" : "الطبقات"}
        </h2>
      </header>

      {order.length === 0 ? (
        <p className="px-2 py-4 text-[12px] text-white/40">
          {isEn ? "No layers" : "لا توجد طبقات"}
        </p>
      ) : (
        <Reorder.Group
          axis="y"
          values={order}
          onReorder={setOrder}
          className="flex-1 space-y-0.5 overflow-y-auto overscroll-contain pt-2"
        >
          {order.map((node) => (
            <LayerRow
              key={node.el.getAttribute("data-tq-id") ?? node.label}
              node={node}
              active={node.el === selected}
              onSelect={onSelect}
              onDragEnd={commitOrder}
              isEn={isEn}
            />
          ))}
        </Reorder.Group>
      )}
    </aside>
  );
}

function LayerRow({
  node,
  active,
  onSelect,
  onDragEnd,
  isEn,
}: {
  node: LayerNode;
  active: boolean;
  onSelect: (el: HTMLElement | null) => void;
  onDragEnd: () => void;
  isEn: boolean;
}) {
  // Drag is initiated ONLY by the grip handle (dragListener off) so the rest of
  // the row stays a plain click-to-select target — no gesture conflict.
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={node}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDragEnd}
      transition={SPRING}
      whileDrag={{ scale: 1.03, boxShadow: "0 12px 32px rgba(0,0,0,0.5)" }}
      className={`group/row flex items-center gap-1 rounded-xl pr-1 ${
        active ? "bg-white/[0.10]" : "hover:bg-white/[0.05]"
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(node.el)}
        className={`flex min-w-0 flex-1 items-center gap-2.5 px-2 py-2 text-start text-[13px] transition-colors ${
          active ? "text-white" : "text-white/70 group-hover/row:text-white"
        }`}
      >
        <LayerIcon kind={node.kind} active={active} />
        {/* No dir="auto": labels follow the panel's RTL so Latin names still sit
            on the leading edge. */}
        <span className="min-w-0 flex-1 truncate text-start">
          {displayLabel(node, isEn)}
        </span>
      </button>
      {/* Grip handle (trailing edge). Appears on row hover; cursor-grab. */}
      <span
        role="button"
        aria-label={isEn ? "Reorder" : "إعادة الترتيب"}
        onPointerDown={(e) => controls.start(e)}
        className="flex shrink-0 cursor-grab touch-none items-center px-1.5 py-2 text-white/25 opacity-0 transition-opacity group-hover/row:opacity-100 hover:text-white/60 active:cursor-grabbing"
      >
        <GripIcon />
      </span>
    </Reorder.Item>
  );
}

function LayerIcon({ kind, active }: { kind: LayerNode["kind"]; active: boolean }) {
  const cls = `shrink-0 ${active ? "text-white" : "text-white/45"}`;
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
