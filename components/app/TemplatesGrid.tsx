"use client";

// Templates grid — sibling of ProjectsGrid, mirrors its animation
// rhythm (per-tile staggered fade-in + Framer's `layout` for in-place
// reflow) so the two libraries feel like the same family at different
// surfaces. Differences:
//
//   • Tiles render via `TemplateTile`, not ProjectThumbnail.
//   • Click handler calls `onOpen(template)` so the parent can show
//     the in-page TemplateLightbox. (No route navigation — templates
//     don't have a per-template detail route the way projects do.)
//
// Purely presentational. Pagination, filtering, deletion all owned by
// the caller — same contract as ProjectsGrid.

import { motion } from "framer-motion";
import { TemplateTile } from "@/components/app/TemplateTile";
import type { TemplateForBrowse } from "@/app/(app)/templates/types";

const STAGGER_BETWEEN_TILES_S = 0.04;
const TILE_FADE_S = 0.24;

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
      {templates.map((tpl, index) => (
        <motion.div
          key={tpl.id}
          layout
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{
            delay: index * STAGGER_BETWEEN_TILES_S,
            duration: TILE_FADE_S,
          }}
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
