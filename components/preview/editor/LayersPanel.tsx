"use client";

// Studio — the Layers panel (left). A floating glass card that lists the focused
// slide's visual leaves (text runs, images, graphics) via the canonical
// `buildLayerTree`, mirroring the Slides nav on the right. Clicking a row selects
// that element in the editor (same `editorSelected` the canvas drives), and the
// active element is highlighted. Rebuilds live as the slide's DOM changes.

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { buildLayerTree, type LayerNode } from "@/lib/editor/leaves";

const PANEL_WIDTH = 280;
const SPRING = { type: "spring", stiffness: 500, damping: 35 } as const;

export function LayersPanel({
  doc,
  selected,
  onSelect,
  language = "ar",
}: {
  // The editor iframe's document (from SlideEditor.onDocReady), or null when the
  // editor isn't mounted yet.
  doc: Document | null;
  // The currently-selected in-iframe element (editorSelected) — same references
  // buildLayerTree returns, so `node.el === selected` highlights the active row.
  selected: HTMLElement | null;
  onSelect: (el: HTMLElement | null) => void;
  language?: "ar" | "en";
}) {
  const [tree, setTree] = useState<LayerNode[]>([]);

  // Build (and live-rebuild) the tree from the slide's stage. childList/subtree
  // catches element add/remove; characterData refreshes a text row's label as you
  // type. Attribute toggles (contenteditable, the edit-time z-lift) are NOT
  // observed, so entering edit mode doesn't churn the list. rAF-debounced.
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

  const isEn = language === "en";
  const countLabel = isEn
    ? `${tree.length} ${tree.length === 1 ? "layer" : "layers"}`
    : `${tree.length} ${tree.length === 1 ? "طبقة" : "طبقات"}`;

  return (
    <motion.aside
      dir={isEn ? "ltr" : "rtl"}
      aria-label={isEn ? "Layers" : "الطبقات"}
      className="backdrop-blur-glass fixed z-[30] flex flex-col overflow-hidden rounded-3xl border p-3 shadow-2xl"
      style={{
        left: 16,
        top: 76,
        bottom: 100,
        width: PANEL_WIDTH,
        background: "var(--tq-bg-glass)",
        borderColor: "var(--tq-border-glass)",
      }}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={SPRING}
    >
      <header className="border-b border-white/[0.08] px-1 pb-3 pt-1">
        <p className="text-muted text-[10px] uppercase tracking-widest" dir="auto">
          {countLabel}
        </p>
        <h2 className="mt-1 text-sm font-semibold text-white">
          {isEn ? "Layers" : "الطبقات"}
        </h2>
      </header>

      <ul className="flex-1 overflow-y-auto overscroll-contain pt-2">
        {tree.length === 0 ? (
          <li className="px-2 py-4 text-[12px] text-white/40">
            {isEn ? "No layers" : "لا توجد طبقات"}
          </li>
        ) : (
          tree.map((node, i) => (
            <LayerRow
              key={i}
              node={node}
              active={node.el === selected}
              onSelect={onSelect}
            />
          ))
        )}
      </ul>
    </motion.aside>
  );
}

function LayerRow({
  node,
  active,
  onSelect,
}: {
  node: LayerNode;
  active: boolean;
  onSelect: (el: HTMLElement | null) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(node.el)}
        className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-start text-[13px] transition-colors ${
          active
            ? "bg-white/[0.10] text-white"
            : "text-white/70 hover:bg-white/[0.05] hover:text-white"
        }`}
      >
        <LayerIcon kind={node.kind} active={active} />
        <span className="min-w-0 flex-1 truncate" dir="auto">
          {node.label}
        </span>
      </button>
    </li>
  );
}

function LayerIcon({
  kind,
  active,
}: {
  kind: LayerNode["kind"];
  active: boolean;
}) {
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
  // text
  return (
    <svg className={cls} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 7V5h16v2" />
      <path d="M9 19h6" />
      <path d="M12 5v14" />
    </svg>
  );
}
