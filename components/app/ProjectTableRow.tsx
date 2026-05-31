"use client";

// One row of the "أحدث المشاريع" table widget.
//
// Renders the deck thumbnail + title (or rename input) + flow, date,
// status pill, usage, and a 3-dots actions menu on the visual left. The
// action logic + the four dialogs are shared with the project cards via
// `useProjectActions` + `<ProjectActionsDialogs>` — only the LAYOUT (table
// row vs card footer) is forked here.
//
// The whole row navigates to /project/<id> via a stretched <Link> overlay.
// The 3-dots button + the rename input stop propagation / opt back into
// pointer events so interacting with them never triggers navigation.

import { useRef } from "react";
import Link from "next/link";
import { ProjectActionsDialogs } from "@/components/app/ProjectActionsDialogs";
import { ParagraphWriteIcon } from "@/components/preview/ParagraphWriteIcon";
import {
  MAX_TITLE_LENGTH,
  useProjectActions,
} from "@/lib/hooks/useProjectActions";
import type { GenerationItem } from "@/components/app/RecentGenerationWidget";

// Shared 5-column grid (4 data columns + a narrow trailing actions
// column) used by BOTH the table's header row and every data row.
// RTL flows the first column to the visual right; the actions column
// lands on the visual left. The actions column is a FIXED 1.75rem (=
// the 3-dots button's h-7/w-7) — NOT `auto` — so it's the same width in
// the header (where it's empty) and the rows (where the button lives);
// otherwise the fr columns shift between header and rows and the date /
// status / usage labels stop lining up with their data.
export const GENERATION_COLS =
  "grid grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_1.75rem] items-center gap-4";

// Static placeholder costs, cycled by row index, until usage is tracked.
const STATIC_POINTS = [120, 85, 140, 95, 110, 75];

const STATUS_META: Record<string, { label: string; cls: string }> = {
  completed: { label: "مكتمل", cls: "bg-emerald-500/12 text-emerald-300" },
  generating: { label: "قيد الإنشاء", cls: "bg-amber-500/12 text-amber-300" },
  queued: { label: "قيد الانتظار", cls: "bg-amber-500/12 text-amber-300" },
  failed: { label: "فشل", cls: "bg-red-500/12 text-red-300" },
  cancelled: { label: "أُلغي", cls: "bg-white/10 text-white/50" },
};
const FALLBACK_STATUS = { label: "—", cls: "bg-white/10 text-white/50" };

// Arabic label per generation flow (`Project.type`).
const FLOW_LABEL: Record<string, string> = {
  create: "إنشاء عرض",
  enhance: "تحسين عرض",
  mimic: "محاكاة أسلوب",
  datasheet: "إنشاء من بيانات",
};

// Arabic month name + Latin digits (product rule: Latin numerals only).
const DATE_FMT = new Intl.DateTimeFormat("ar-u-nu-latn", {
  day: "numeric",
  month: "long",
});

export function ProjectTableRow({
  item,
  index,
  onDeleted,
}: {
  item: GenerationItem;
  index: number;
  onDeleted: (projectId: string) => void;
}) {
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const actions = useProjectActions(item.id, {
    initialFavorite: item.isFavorite ?? false,
    initialTitle: item.title,
    menuBtnRef,
    renameInputRef,
    onDeleted,
  });

  const status = STATUS_META[item.status] ?? FALLBACK_STATUS;
  const points = item.points ?? STATIC_POINTS[index % STATIC_POINTS.length];
  const flowLabel = FLOW_LABEL[item.type ?? ""] ?? "إنشاء عرض";

  return (
    // The row div has NO onClick — navigation lives on the stretched
    // overlay <Link> below. Critical: ProjectActionsDialogs portals to
    // <body>; React events bubble through the REACT tree, so if this div
    // carried a navigate onClick, clicking a menu item would also
    // navigate. Keeping nav on a sibling overlay link avoids that — and a
    // real <a> keeps native link affordances (middle-click / cmd-click).
    <div
      // `-mx-5/-mx-6 px-5/px-6` bleeds the row (hover bg + divider) out to
      // the card's full inner width — cancels the card's `p-5 sm:p-6` and
      // re-adds it so the grid content stays put.
      className={`relative ${GENERATION_COLS} -mx-5 px-5 py-3.5 transition-colors hover:bg-white/[0.02] sm:-mx-6 sm:px-6 ${
        actions.useTplBusy ? "pointer-events-none opacity-60" : ""
      }`}
    >
      {/* Full-row navigation target (hidden while renaming). Sits beneath
          the cells (z-0); cells are pointer-events-none so clicks fall
          through to it, except the 3-dots + rename input which opt back
          in. */}
      {!actions.renameMode ? (
        <Link
          href={`/project/${item.id}`}
          aria-label={`افتح ${actions.titleState}`}
          className="absolute inset-0 z-0 rounded-md"
        />
      ) : null}

      {/* Thumbnail + title/flow */}
      <div className="pointer-events-none relative z-[1] flex min-w-0 items-center gap-3">
        <div className="relative aspect-video w-14 shrink-0 overflow-hidden rounded-md bg-white/[0.05]">
          {item.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.thumbnailUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : item.status === "generating" || item.status === "queued" ? (
            // Mid-generation (no thumbnail yet) → the animated paragraph-
            // write icon (same one the slide-nav placeholders use), so the
            // row reads as actively-working instead of showing a static
            // "slideshow" glyph that looks like a play button.
            <span className="absolute inset-0 flex items-center justify-center text-amber-300/80">
              <ParagraphWriteIcon size={18} rtl mode="loop" />
            </span>
          ) : (
            <span className="absolute inset-0 flex items-center justify-center text-muted/40">
              <span className="material-symbols-outlined text-[18px]">
                slideshow
              </span>
            </span>
          )}
        </div>
        <div className="min-w-0">
          {actions.renameMode ? (
            <input
              ref={renameInputRef}
              type="text"
              value={actions.renameDraft}
              onChange={(e) => actions.setRenameDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={actions.commitRename}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  actions.commitRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  actions.cancelRename();
                }
              }}
              disabled={actions.renameSaving}
              maxLength={MAX_TITLE_LENGTH}
              aria-label="اسم المشروع"
              className="pointer-events-auto relative z-[2] w-full truncate rounded-md border border-white/15 bg-white/[0.04] px-1.5 py-0.5 text-sm font-medium leading-tight text-white outline-none transition-colors focus:border-white/40 disabled:opacity-60"
            />
          ) : (
            <p className="flex items-center gap-1 truncate text-sm font-medium text-white">
              {actions.favoriteState ? (
                <span className="material-symbols-outlined tq-fav-indicator shrink-0 text-[14px] text-amber-300">
                  star
                </span>
              ) : null}
              <span className="truncate" title={actions.titleState}>
                {actions.titleState}
              </span>
            </p>
          )}
          <p className="mt-0.5 text-[11px] text-muted">{flowLabel}</p>
        </div>
      </div>

      {/* Date — muted/recessive, right-aligned to its column. */}
      <span className="pointer-events-none relative z-[1] text-right text-sm text-white/40">
        {DATE_FMT.format(new Date(item.createdAt))}
      </span>

      {/* Status — right-aligned. */}
      <span className="pointer-events-none relative z-[1] text-right">
        <span
          className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-medium ${status.cls}`}
        >
          {status.label}
        </span>
      </span>

      {/* Usage (points) — right-aligned. */}
      <span className="pointer-events-none relative z-[1] text-right text-sm">
        <span className="font-semibold text-white">{points}</span>{" "}
        <span className="text-xs text-muted">نقطة</span>
      </span>

      {/* 3-dots actions (visual left) */}
      <div className="relative z-[2] flex justify-end">
        <button
          ref={menuBtnRef}
          type="button"
          aria-label="خيارات المشروع"
          aria-haspopup="menu"
          aria-expanded={actions.menuRect !== null}
          data-project-menu-trigger={item.id}
          onClick={(e) => {
            e.stopPropagation();
            actions.toggleMenu();
          }}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:text-white"
        >
          <span className="material-symbols-outlined text-[18px]">more_vert</span>
        </button>
      </div>

      <ProjectActionsDialogs actions={actions} />
    </div>
  );
}
