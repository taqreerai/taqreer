"use client";

// Dedicated edit surface for a completed deck — /project/[id]/edit (Editor I1-B).
// A separate route from the working-session <DeckView> so the editor is its own
// clean surface (like Canva's editor vs. viewer) and we never destabilise the live
// view. Mounts the proven <SlideEditor> (iframe-isolated) + a flat Layers list.
//
// Scope (I1): mount + select + text-edit + nav. Edits live in the iframe DOM only —
// persistence (serialize → new SlideVersion) is I3; the property panel is I2.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { dimensionsForFormat, type SlideManifest } from "@/lib/schema/slide";
import { SlideEditor } from "@/components/preview/editor/SlideEditor";
import { buildLayerTree, type LayerNode } from "@/lib/editor/leaves";

const MAX_W = 1000;
const MAX_H = 620;

export function ProjectEditor({
  projectId,
  manifest,
}: {
  projectId: string;
  manifest: SlideManifest;
  role: string;
}) {
  const slides = manifest.slides;
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<HTMLElement | null>(null);
  const [doc, setDoc] = useState<Document | null>(null);
  const [layers, setLayers] = useState<LayerNode[]>([]);

  // Render through a portal to <body> so the fullscreen takeover escapes the (app)
  // layout's nested stacking context and covers the dashboard header + sidebar.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const slide = slides[idx];
  const dims = dimensionsForFormat(manifest.format);
  const scale = useMemo(
    () => Math.min(MAX_W / dims.width, MAX_H / dims.height),
    [dims.width, dims.height],
  );

  // Reset selection when changing slides (the old element belongs to the old doc).
  const goto = (i: number) => {
    setSelected(null);
    setIdx(i);
  };

  // Rebuild the flat Layers list once the iframe doc is ready / the slide changes.
  useEffect(() => {
    const sec = doc?.querySelector("section") as HTMLElement | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayers(sec ? buildLayerTree(sec) : []);
  }, [doc, idx]);

  // Esc deselects (only visual leaves are selectable — there's nothing to escalate to).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && document.activeElement?.tagName !== "BODY") return;
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ui = (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#0D0B1F] text-white" dir="ltr">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-2.5">
        <Link
          href={`/project/${projectId}`}
          className="rounded-md bg-white/8 px-2.5 py-1 text-[13px] text-white/80 transition hover:bg-white/15"
        >
          ‹ Back to deck
        </Link>
        <span className="truncate text-[13px] text-white/55">{manifest.title}</span>
        <span className="text-[12px] text-white/40">
          {manifest.format} · {manifest.direction} · {manifest.language}
        </span>
        <div className="flex-1" />
        <button
          className="rounded-md bg-white/8 px-2 py-1 text-[13px] disabled:opacity-40"
          onClick={() => goto(Math.max(0, idx - 1))}
          disabled={idx === 0}
        >
          ‹
        </button>
        <span className="text-[12px] tabular-nums text-white/55">
          {idx + 1} / {slides.length}
        </span>
        <button
          className="rounded-md bg-white/8 px-2 py-1 text-[13px] disabled:opacity-40"
          onClick={() => goto(Math.min(slides.length - 1, idx + 1))}
          disabled={idx === slides.length - 1}
        >
          ›
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Canvas */}
        <div className="flex flex-1 flex-col items-center justify-center gap-2 overflow-auto p-6">
          <div className="min-h-5 text-[11px] text-white/40">
            click an element · double-click text to edit · Esc to deselect
          </div>
          <SlideEditor
            slide={slide}
            theme={manifest.theme}
            direction={manifest.direction}
            language={manifest.language}
            width={dims.width}
            height={dims.height}
            scale={scale}
            selected={selected}
            onSelect={setSelected}
            onDocReady={setDoc}
          />
        </div>

        {/* Right rail — flat Layers (properties panel = I2) */}
        <div className="w-[280px] shrink-0 overflow-auto border-l border-white/10 p-3">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-white/40">
            Layers ({layers.length})
          </div>
          <div className="grid gap-0.5">
            {layers.map((n, i) => (
              <button
                key={i}
                onClick={() => setSelected(n.el)}
                className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-start text-[12px] transition ${
                  selected === n.el ? "bg-[#15B04F]/20 text-white" : "text-white/70 hover:bg-white/8"
                }`}
              >
                <span className="opacity-50">
                  {n.kind === "text" ? "T" : n.kind === "image" ? "🖼" : "◆"}
                </span>
                <span className="truncate">{n.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  return mounted ? createPortal(ui, document.body) : null;
}
