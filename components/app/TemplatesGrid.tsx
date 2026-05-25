"use client";

// Templates grid — sibling of ProjectsGrid. Same shape, same set of
// props, so the two libraries feel like one family at different
// surfaces. Differences:
//
//   • Tiles render via `TemplateTile`, not ProjectThumbnail.
//   • Click handler calls `onOpen(template)` so the parent can show
//     the in-page TemplateLightbox. (No route navigation — templates
//     don't have a per-template detail route the way projects do.)
//
// Purely presentational. Pagination, filtering, deletion all owned by
// the caller — same contract as ProjectsGrid.
//
// Fade-in cascade REMOVED 2026-05-25 (same fix applied to ProjectsGrid
// the same day). The per-tile `motion.div` used to mount with
// `initial: { opacity: 0 } → animate: { opacity: 1 }` plus a per-tile
// delay. Dropped because framer-motion's `initial → animate` doesn't
// reliably re-fire when the React tree is restored from bfcache
// (Safari, sometimes Chrome) or Next.js's router cache (any browser)
// on browser-back navigation. Tiles ended up in the DOM but stuck at
// `opacity: 0` — a blank grid with no tiles and no empty state.
// User reproduced this on /templates with the same flow as
// /dashboard + /projects. `layout` (Framer's position animation for
// delete-backfill / filter reflow) stays — it only fires on position
// changes, never on initial mount or restore, so it's bfcache-safe.

import { motion } from "framer-motion";
import { TemplateTile } from "@/components/app/TemplateTile";
import type { TemplateForBrowse } from "@/app/(app)/templates/types";

type Props = {
  templates: TemplateForBrowse[];
  gridClassName: string;
  padTo?: number;
  staggerKey?: string | number;
  emptyState: React.ReactNode;
  // Fires when the user clicks a tile — parent opens TemplateLightbox
  // with the clicked template's data.
  onOpen: (template: TemplateForBrowse) => void;
};

export function TemplatesGrid({
  templates,
  gridClassName,
  padTo,
  staggerKey,
  emptyState,
  onOpen,
}: Props) {
  if (templates.length === 0) {
    return <>{emptyState}</>;
  }

  const placeholderCount =
    padTo !== undefined ? Math.max(0, padTo - templates.length) : 0;

  return (
    <div key={staggerKey ?? "default"} className={`grid ${gridClassName}`}>
      {templates.map((tpl) => (
        // `layout` only — fade-in cascade removed for the same
        // bfcache/router-cache reason documented in the module
        // header. Tiles render at default opacity (1) immediately.
        <motion.div
          key={tpl.id}
          layout
        >
          <TemplateTile
            template={tpl}
            // Skip opening the lightbox if showcase render hasn't
            // completed yet (no slides to show). Phase D will add a
            // "rendering…" overlay on the tile so this case is
            // visible before click; for now the click is just inert.
            onClick={() => {
              if (tpl.thumbnailUrls.length > 0) onOpen(tpl);
            }}
          />
        </motion.div>
      ))}
      {Array.from({ length: placeholderCount }, (_, i) => (
        <div
          key={`tile-placeholder-${i}`}
          aria-hidden
          className="pointer-events-none flex flex-col gap-3 opacity-0"
        >
          <div className="aspect-video w-full rounded-[14px]" />
          <div className="flex items-start justify-between gap-2 px-0.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold leading-tight">.</p>
              <p className="mt-0.5 text-[10px]">.</p>
            </div>
            <div className="h-7 w-7 shrink-0" />
          </div>
        </div>
      ))}
    </div>
  );
}
