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
import { buildLayerTree, stackingTarget, type LayerNode } from "@/lib/editor/leaves";
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
  if (node.kind === "shape") return t.shape;
  if (node.kind === "background") return t.background;
  return node.label;
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

// A row in the panel: a standalone leaf, or a FOLDER collecting every leaf that
// shares a data-tq-group id. The folder sits at its frontmost member's position;
// its members are listed front-first inside.
type Display =
  | { kind: "leaf"; key: string; node: LayerNode }
  | { kind: "group"; key: string; gid: string; members: LayerNode[] };

const displayId = (d: Display): string =>
  d.kind === "leaf" ? d.node.el.getAttribute("data-tq-id") ?? d.node.label : `g:${d.gid}`;

// Fold a front-first leaf list into display rows: each group becomes ONE folder at
// the position of its frontmost member (first seen), carrying every member of that
// group front-first; ungrouped leaves stay standalone.
function foldGroups(order: LayerNode[]): Display[] {
  const seen = new Set<string>();
  const out: Display[] = [];
  for (const node of order) {
    const gid = node.group;
    if (!gid) {
      out.push({ kind: "leaf", key: node.el.getAttribute("data-tq-id") ?? node.label, node });
      continue;
    }
    if (seen.has(gid)) continue;
    seen.add(gid);
    out.push({ kind: "group", key: `g:${gid}`, gid, members: order.filter((n) => n.group === gid) });
  }
  return out;
}

export function LayersPanel({
  doc,
  selected,
  onSelect,
  onCommit,
  onToggleLock,
  onDelete,
  restackTick = 0,
  slideId,
  collapsed = false,
}: {
  // The editor iframe's document (from SlideEditor.onDocReady), or null when the
  // editor isn't mounted yet.
  doc: Document | null;
  // The current selection SET. A single leaf → that row is active; a whole group
  // (every member of one data-tq-group) → that folder is active. Clicking a leaf
  // row replaces the set with [leaf]; clicking a folder header selects all members.
  selected: HTMLElement[];
  onSelect: (els: HTMLElement[]) => void;
  // Persist a reorder — same (slideId, html) save path the StylePill uses.
  onCommit: (slideId: string, html: string) => void;
  // Toggle a per-layer lock (data-tq-lock) on the element. A locked layer stays
  // selectable + restyleable but can't be dragged/resized/rotated on the canvas.
  // The parent owns the toggle so it can also force the canvas Moveable to
  // recompute its grabbable set.
  onToggleLock?: (el: HTMLElement) => void;
  // Delete a layer (its element) from the slide.
  onDelete?: (el: HTMLElement) => void;
  // Bumped when the pill's bring-to-front / send-to-back rewrites z-index, so the
  // panel re-sorts its front-first order to match (z changes don't mutate the DOM
  // tree, so the tree observer wouldn't otherwise catch them).
  restackTick?: number;
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
  // The controlled DISPLAY order (front-first rows: folders + standalone leaves).
  // framer Reorder reorders this during a drag; we persist z + save on drag END.
  const [displayOrder, setDisplayOrder] = useState<Display[]>([]);
  // Mirror into a ref so drag-END (an event handler) reads the LATEST order.
  const displayRef = useRef<Display[]>([]);
  useEffect(() => {
    displayRef.current = displayOrder;
  }, [displayOrder]);
  // Which group folders are EXPANDED (by gid). Empty = all collapsed: a group reads
  // as one folder row until the user opens it (a chevron toggles membership here).
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpand = (gid: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });

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
  // catches add/remove; characterData refreshes a text row's label;
  // data-tq-group (and ONLY that attribute) refreshes the folders the instant a
  // group/ungroup stamps it. Other attribute toggles (contenteditable, the
  // edit-time z-lift, OUR z-index writes, locks) are NOT observed, so editing /
  // reordering / locking doesn't churn the list. rAF-debounced.
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
    mo.observe(stage, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-tq-group"],
    });
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
    const ordered = stage && win ? frontFirst(tree, win, stage) : tree;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDisplayOrder(foldGroups(ordered));
    // restackTick: re-sort after a pill bring-to-front / send-to-back (z-only change).
  }, [tree, doc, restackTick]);

  // Auto-scroll the selected layer's row into view when the selection changes on
  // the CANVAS (clicking an off-screen element in a long list). Scoped to the
  // list container — a manual scrollTop nudge, not Element.scrollIntoView (which
  // would also pan any scrollable ancestor / the page). A no-op when the row is
  // already visible, so selecting from the panel never jumps. Re-runs on `order`
  // too, so a freshly-mounted row (selection set before the list rebuilt) still
  // scrolls once it exists. We resolve the list from the ROW (its `.closest('ul')`)
  // rather than a ref on Reorder.Group — framer's Reorder.Group doesn't forward a
  // ref to the underlying <ul>, so a ref there stays null.
  useEffect(() => {
    // The row to reveal: a sole leaf → its data-tq-id; a whole group → its folder
    // (data-layer-id `g:<gid>`). A member of a collapsed group resolves to null and
    // does not force-open the folder.
    let id: string | null = null;
    if (selected.length === 1) id = selected[0].getAttribute("data-tq-id");
    else if (selected.length > 1) {
      const gid = selected[0].getAttribute("data-tq-group");
      if (gid && selected.every((el) => el.getAttribute("data-tq-group") === gid)) id = `g:${gid}`;
    }
    if (!id) return;
    const row = document.querySelector<HTMLElement>(`[data-layer-id="${CSS.escape(id)}"]`);
    const list = row?.closest("ul");
    if (!row || !list) return;
    const lr = list.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    if (rr.top < lr.top) list.scrollTop -= lr.top - rr.top + 8;
    else if (rr.bottom > lr.bottom) list.scrollTop += rr.bottom - lr.bottom + 8;
  }, [selected, displayOrder]);

  // On drag end: flatten the display rows front-first (a folder expands to its
  // members in order), then reassign z to each stacking target (frontmost → highest
  // z; relative-if-static = no layout shift) and persist. Flattening a folder's
  // members adjacently makes the group a CONTIGUOUS z-band — a true stacking unit.
  const commitOrder = () => {
    const stage = doc?.getElementById("tqe-stage");
    const win = doc?.defaultView;
    if (!stage || !win) return;
    const flat: HTMLElement[] = [];
    for (const d of displayRef.current) {
      if (d.kind === "leaf") flat.push(d.node.el);
      else for (const m of d.members) flat.push(m.el); // members already front-first
    }
    const n = flat.length;
    const seen = new Set<HTMLElement>();
    flat.forEach((el, i) => {
      const target = stackingTarget(el, win, stage);
      if (seen.has(target)) return;
      seen.add(target);
      if (win.getComputedStyle(target).position === "static") {
        target.style.setProperty("position", "relative");
      }
      target.style.setProperty("z-index", String(n - i));
    });
    const section = stage.querySelector("[data-tq-id]");
    if (section) onCommit(slideId, serializeSlideSection(section));
  };

  // Keyboard reorder for the grip handle (a11y): move a row one step toward the
  // front (-1, ArrowUp) or back (+1, ArrowDown). A folder moves as one block.
  const moveDisplay = (d: Display, dir: -1 | 1) => {
    const cur = displayRef.current;
    const i = cur.indexOf(d);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cur.length) return;
    const next = [...cur];
    [next[i], next[j]] = [next[j], next[i]];
    displayRef.current = next;
    setDisplayOrder(next);
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

  // The lone selected element (single-select), else null — drives a leaf / member
  // row's active highlight. A FOLDER is active when the whole group is the
  // selection (every member, and nothing else).
  const sole = selected.length === 1 ? selected[0] : null;
  const selSet = new Set(selected);
  const groupActive = (members: LayerNode[]) =>
    selected.length === members.length && members.every((m) => selSet.has(m.el));

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

      {displayOrder.length === 0 && !bgNode ? (
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
            values={displayOrder}
            onReorder={setDisplayOrder}
            className={`flex-1 space-y-0.5 overscroll-contain pt-2 ${
              isDragging ? "overflow-visible" : "overflow-y-auto"
            }`}
          >
            {displayOrder.map((d) => {
              const dragging = draggingId === d.key;
              const onDragStart = () => setDraggingId(d.key);
              const onDragEnd = () => {
                commitOrder();
                setDraggingId(null);
              };
              if (d.kind === "leaf") {
                return (
                  <LayerRow
                    key={d.key}
                    value={d}
                    id={displayId(d)}
                    node={d.node}
                    active={sole === d.node.el}
                    dragging={dragging}
                    locked={d.node.el.hasAttribute("data-tq-lock")}
                    onSelect={(el) => onSelect(el ? [el] : [])}
                    onToggleLock={onToggleLock}
                    onDelete={onDelete}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                    onMove={(dir) => moveDisplay(d, dir)}
                    dict={dict}
                  />
                );
              }
              return (
                <GroupFolder
                  key={d.key}
                  value={d}
                  gid={d.gid}
                  members={d.members}
                  open={expanded.has(d.gid)}
                  onToggleOpen={() => toggleExpand(d.gid)}
                  active={groupActive(d.members)}
                  sole={sole}
                  dragging={dragging}
                  onSelectGroup={() => onSelect(d.members.map((m) => m.el))}
                  onSelectMember={(el) => onSelect([el])}
                  onToggleLock={onToggleLock}
                  onDelete={onDelete}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onMove={(dir) => moveDisplay(d, dir)}
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
                    // The panel sits on the LEFT edge, and this swatch is on the row's
                    // trailing edge (left in RTL) — so always open the 182px popover
                    // RIGHTWARD (physical left:0) to keep it on-screen in both locales.
                    align={dir === "rtl" ? "end" : "start"}
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
  value,
  id,
  node,
  active,
  dragging,
  locked,
  onSelect,
  onToggleLock,
  onDelete,
  onDragStart,
  onDragEnd,
  onMove,
  dict,
}: {
  // The Reorder.Item identity (this leaf's Display row) — framer keys reorder off it.
  value: Display;
  // Stable row id (the element's data-tq-id) — surfaced as data-layer-id so the
  // panel's auto-scroll effect can find this row's DOM node.
  id: string;
  node: LayerNode;
  active: boolean;
  dragging: boolean;
  locked: boolean;
  onSelect: (el: HTMLElement | null) => void;
  onToggleLock?: (el: HTMLElement) => void;
  onDelete?: (el: HTMLElement) => void;
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
      value={value}
      data-layer-id={id}
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
            ? "bg-[var(--tq-brand-blue)]" // selected → brand blue
            : locked
              ? "bg-foreground/[0.10]" // locked → the muted grey block
              : "hover:bg-foreground/[0.05]"
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(node.el)}
        className={`flex min-w-0 flex-1 items-center gap-2.5 px-2 py-2 text-start text-[13px] transition-colors ${
          active
            ? "text-white"
            : locked
              ? "text-foreground/60"
              : "text-foreground/70 group-hover/row:text-foreground"
        }`}
      >
        <LayerIcon kind={node.kind} active={active} />
        {/* No dir="auto": labels follow the panel's RTL so Latin names still sit
            on the leading edge. */}
        <span className="min-w-0 flex-1 truncate text-start">
          {displayLabel(node, dict)}
        </span>
      </button>
      {/* Lock toggle (trailing edge). A locked layer keeps the closed padlock
          visible at all times (and can't be dragged/resized on the canvas);
          an unlocked one shows an open padlock on row hover / focus only. */}
      {onToggleLock && (
        <button
          type="button"
          aria-label={locked ? dict.editor.layers.unlock : dict.editor.layers.lock}
          aria-pressed={locked}
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock(node.el);
          }}
          className={`flex shrink-0 items-center rounded px-1.5 py-2 outline-none transition-opacity focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-white/40 ${
            active
              ? "text-white/85 opacity-100 hover:text-white"
              : locked
                ? "text-foreground/65 opacity-100 hover:text-foreground"
                : "text-foreground/25 opacity-0 hover:text-foreground/60 group-hover/row:opacity-100"
          }`}
        >
          {locked ? <LockClosedIcon /> : <LockOpenIcon />}
        </button>
      )}
      {/* Delete (trailing edge). Hover / focus reveal, like the grip. */}
      {onDelete && (
        <button
          type="button"
          aria-label={dict.editor.layers.delete}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(node.el);
          }}
          className={`flex shrink-0 items-center rounded px-1.5 py-2 outline-none transition-opacity focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-white/40 ${
            active
              ? "text-white/85 opacity-100 hover:text-white"
              : "text-foreground/25 opacity-0 hover:text-red-400 group-hover/row:opacity-100"
          }`}
        >
          <TrashIcon />
        </button>
      )}
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
        className={`flex shrink-0 cursor-grab touch-none items-center rounded px-1.5 py-2 outline-none transition-opacity focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-white/40 active:cursor-grabbing ${
          active
            ? "text-white/85 opacity-100 hover:text-white"
            : "text-foreground/25 opacity-0 hover:text-foreground/60 focus-visible:text-foreground/70 group-hover/row:opacity-100"
        }`}
      >
        <GripIcon />
      </span>
    </Reorder.Item>
  );
}

// A group FOLDER row — the whole group as one draggable block. The header selects
// the whole group, toggles open/closed, and locks/deletes ALL members at once; when
// open it lists the members (indented) as individually selectable / lockable rows.
function GroupFolder({
  value,
  gid,
  members,
  open,
  onToggleOpen,
  active,
  sole,
  dragging,
  onSelectGroup,
  onSelectMember,
  onToggleLock,
  onDelete,
  onDragStart,
  onDragEnd,
  onMove,
  dict,
}: {
  value: Display;
  gid: string;
  members: LayerNode[];
  open: boolean;
  onToggleOpen: () => void;
  // True when the SELECTION is exactly this group (every member, nothing else).
  active: boolean;
  // The lone selected element (or null) — highlights one member row when you've
  // drilled into the group and selected a single member.
  sole: HTMLElement | null;
  dragging: boolean;
  onSelectGroup: () => void;
  onSelectMember: (el: HTMLElement) => void;
  onToggleLock?: (el: HTMLElement) => void;
  onDelete?: (el: HTMLElement) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (dir: -1 | 1) => void;
  dict: Dictionary;
}) {
  const t = dict.editor.layers;
  const { dir } = useLocale();
  const controls = useDragControls();
  const allLocked = members.length > 0 && members.every((m) => m.el.hasAttribute("data-tq-lock"));
  const toggleLockAll = () => {
    // All locked → unlock every member; otherwise lock the unlocked ones.
    for (const m of members) {
      const locked = m.el.hasAttribute("data-tq-lock");
      if (allLocked ? locked : !locked) onToggleLock?.(m.el);
    }
  };
  const deleteAll = () => {
    for (const m of members) onDelete?.(m.el);
  };
  const headTone = active
    ? "text-white/85 opacity-100 hover:text-white"
    : "text-foreground/25 opacity-0 hover:text-foreground/60 group-hover/row:opacity-100";
  return (
    <Reorder.Item
      value={value}
      dragListener={false}
      dragControls={controls}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      animate={{ scale: dragging ? 1.03 : 1 }}
      transition={SPRING}
      style={{
        position: "relative",
        zIndex: dragging ? 60 : undefined,
        background: dragging ? "rgba(var(--tq-bg-rgb), 0.96)" : undefined,
        border: dragging ? "1px solid var(--tq-border-hairline)" : undefined,
      }}
      className={`tq-layer-row rounded-xl ${dragging ? "is-dragging" : ""}`}
    >
      {/* Folder header — data-layer-id `g:<gid>` so auto-scroll can reveal it. */}
      <div
        data-layer-id={`g:${gid}`}
        className={`group/row flex items-center gap-0.5 rounded-xl pr-1 ${
          active ? "bg-[var(--tq-brand-blue)]" : allLocked ? "bg-foreground/[0.10]" : "hover:bg-foreground/[0.05]"
        }`}
      >
        <button
          type="button"
          aria-label={open ? t.collapse : t.expand}
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            onToggleOpen();
          }}
          className={`flex shrink-0 items-center rounded px-1 py-2 transition-colors ${
            active ? "text-white/85 hover:text-white" : "text-foreground/40 hover:text-foreground"
          }`}
        >
          <ChevronIcon open={open} dir={dir} />
        </button>
        <button
          type="button"
          onClick={onSelectGroup}
          className={`flex min-w-0 flex-1 items-center gap-2 px-1 py-2 text-start text-[13px] transition-colors ${
            active ? "text-white" : allLocked ? "text-foreground/60" : "text-foreground/70 group-hover/row:text-foreground"
          }`}
        >
          <FolderIcon active={active} />
          <span className="min-w-0 flex-1 truncate text-start">{t.group}</span>
          <span className={`shrink-0 text-[11px] tabular-nums ${active ? "text-white/70" : "text-foreground/40"}`}>
            {members.length}
          </span>
        </button>
        {onToggleLock && (
          <button
            type="button"
            aria-label={allLocked ? t.unlock : t.lock}
            aria-pressed={allLocked}
            onClick={(e) => {
              e.stopPropagation();
              toggleLockAll();
            }}
            className={`flex shrink-0 items-center rounded px-1.5 py-2 outline-none transition-opacity focus-visible:opacity-100 ${
              allLocked ? "text-foreground/65 opacity-100 hover:text-foreground" : headTone
            } ${active && allLocked ? "text-white/85" : ""}`}
          >
            {allLocked ? <LockClosedIcon /> : <LockOpenIcon />}
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            aria-label={t.delete}
            onClick={(e) => {
              e.stopPropagation();
              deleteAll();
            }}
            className={`flex shrink-0 items-center rounded px-1.5 py-2 outline-none transition-opacity focus-visible:opacity-100 ${
              active ? "text-white/85 opacity-100 hover:text-white" : "text-foreground/25 opacity-0 hover:text-red-400 group-hover/row:opacity-100"
            }`}
          >
            <TrashIcon />
          </button>
        )}
        <span
          role="button"
          tabIndex={0}
          aria-label={t.reorder}
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
          className={`flex shrink-0 cursor-grab touch-none items-center rounded px-1.5 py-2 outline-none transition-opacity focus-visible:opacity-100 active:cursor-grabbing ${
            active ? "text-white/85 opacity-100 hover:text-white" : "text-foreground/25 opacity-0 hover:text-foreground/60 group-hover/row:opacity-100"
          }`}
        >
          <GripIcon />
        </span>
      </div>
      {/* Members (open) — indented under a hairline guide; each individually
          selectable / lockable / deletable. */}
      {open && (
        <div className="ms-3 mt-0.5 space-y-0.5 border-s border-foreground/[0.08] ps-1.5">
          {members.map((m) => {
            const mid = m.el.getAttribute("data-tq-id") ?? m.label;
            return (
              <MemberRow
                key={mid}
                id={mid}
                node={m}
                active={sole === m.el}
                locked={m.el.hasAttribute("data-tq-lock")}
                onSelect={onSelectMember}
                onToggleLock={onToggleLock}
                onDelete={onDelete}
                dict={dict}
              />
            );
          })}
        </div>
      )}
    </Reorder.Item>
  );
}

// A single member row inside an open folder. Static (not drag-reorderable in v1) —
// members move as a block with their folder; restack a single one via the pill.
function MemberRow({
  id,
  node,
  active,
  locked,
  onSelect,
  onToggleLock,
  onDelete,
  dict,
}: {
  id: string;
  node: LayerNode;
  active: boolean;
  locked: boolean;
  onSelect: (el: HTMLElement) => void;
  onToggleLock?: (el: HTMLElement) => void;
  onDelete?: (el: HTMLElement) => void;
  dict: Dictionary;
}) {
  return (
    <div
      data-layer-id={id}
      className={`group/row flex items-center gap-1 rounded-lg pr-1 ${
        active ? "bg-[var(--tq-brand-blue)]" : locked ? "bg-foreground/[0.10]" : "hover:bg-foreground/[0.05]"
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(node.el)}
        className={`flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-start text-[12px] transition-colors ${
          active ? "text-white" : locked ? "text-foreground/55" : "text-foreground/65 group-hover/row:text-foreground"
        }`}
      >
        <LayerIcon kind={node.kind} active={active} />
        <span className="min-w-0 flex-1 truncate text-start">{displayLabel(node, dict)}</span>
      </button>
      {onToggleLock && (
        <button
          type="button"
          aria-label={locked ? dict.editor.layers.unlock : dict.editor.layers.lock}
          aria-pressed={locked}
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock(node.el);
          }}
          className={`flex shrink-0 items-center rounded px-1.5 py-1.5 outline-none transition-opacity focus-visible:opacity-100 ${
            active ? "text-white/85 opacity-100 hover:text-white" : locked ? "text-foreground/60 opacity-100 hover:text-foreground" : "text-foreground/25 opacity-0 hover:text-foreground/60 group-hover/row:opacity-100"
          }`}
        >
          {locked ? <LockClosedIcon /> : <LockOpenIcon />}
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          aria-label={dict.editor.layers.delete}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(node.el);
          }}
          className={`flex shrink-0 items-center rounded px-1.5 py-1.5 outline-none transition-opacity focus-visible:opacity-100 ${
            active ? "text-white/85 opacity-100 hover:text-white" : "text-foreground/25 opacity-0 hover:text-red-400 group-hover/row:opacity-100"
          }`}
        >
          <TrashIcon />
        </button>
      )}
    </div>
  );
}

// Folder glyph for a group row.
function FolderIcon({ active }: { active: boolean }) {
  return (
    <svg
      className={`shrink-0 ${active ? "text-white" : "text-foreground/45"}`}
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

// Disclosure chevron. Collapsed points in the reading direction (right in LTR, left
// in RTL); open rotates to point down. The base path points RIGHT.
function ChevronIcon({ open, dir }: { open: boolean; dir: "rtl" | "ltr" }) {
  const rotate = open ? 90 : dir === "rtl" ? 180 : 0;
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ transform: `rotate(${rotate}deg)`, transition: "transform 150ms ease" }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function LayerIcon({ kind, active }: { kind: LayerNode["kind"]; active: boolean }) {
  const cls = `shrink-0 ${active ? "text-white" : "text-foreground/45"}`;
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
  if (kind === "shape") {
    return (
      <svg className={cls} width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <rect x="4" y="4" width="16" height="16" rx="2.5" />
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

// Closed padlock — a locked layer.
function LockClosedIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

// Open padlock — an unlocked layer (shackle swung clear of the body).
function LockOpenIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.5-1.9" />
    </svg>
  );
}

// Trash — delete a layer.
function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}
