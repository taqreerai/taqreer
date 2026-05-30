"use client";

// One row of the "أحدث المشاريع" table widget.
//
// Renders the deck thumbnail + title (or rename input) + orientation,
// date, status pill, points, and a 3-dots actions menu on the visual
// left. The actions menu + its dialogs reuse the EXACT same components
// the project cards use (ProjectActionsMenu, TrashConfirmDialog,
// SaveAsTemplateDialog, ShareDialog) and the same API calls — so the
// table offers the full project-card action set (rename / favorite /
// share / copy link / use-as-template / save-as-template / trash).
//
// The whole row navigates to /project/<id> on click (mirroring the
// project card's navigate). The 3-dots button + the rename input stop
// propagation so interacting with them never triggers navigation.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ProjectActionsMenu } from "@/components/app/ProjectActionsMenu";
import { TrashConfirmDialog } from "@/components/app/TrashConfirmDialog";
import { SaveAsTemplateDialog } from "@/components/app/SaveAsTemplateDialog";
import { ShareDialog } from "@/components/app/ShareDialog";
import { prepareTemplateUse } from "@/lib/mimic/template-seed";
import type { GenerationItem } from "@/components/app/RecentGenerationWidget";

// Mirror the server-side cap in /api/projects/[id] PATCH.
const MAX_TITLE_LENGTH = 200;

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

  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);
  const [favoriteState, setFavoriteState] = useState(item.isFavorite ?? false);
  const [titleState, setTitleState] = useState(item.title);
  const [renameMode, setRenameMode] = useState(false);
  const [renameDraft, setRenameDraft] = useState(item.title);
  const [renameSaving, setRenameSaving] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashBusy, setTrashBusy] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [useTplBusy, setUseTplBusy] = useState(false);

  useEffect(() => {
    if (renameMode) {
      const id = window.requestAnimationFrame(() => {
        const el = renameInputRef.current;
        if (el) {
          el.focus();
          el.select();
        }
      });
      return () => window.cancelAnimationFrame(id);
    }
  }, [renameMode]);

  const status = STATUS_META[item.status] ?? FALLBACK_STATUS;
  const points = item.points ?? STATIC_POINTS[index % STATIC_POINTS.length];
  const flowLabel = FLOW_LABEL[item.type ?? ""] ?? "إنشاء عرض";

  // ── Menu actions (lifted from ProjectThumbnail) ─────────────────────
  const openMenu = () =>
    setMenuRect(menuBtnRef.current?.getBoundingClientRect() ?? null);
  const closeMenu = () => setMenuRect(null);

  const handleToggleFavorite = async () => {
    const previous = favoriteState;
    const next = !previous;
    setFavoriteState(next);
    try {
      const res = await fetch(`/api/projects/${item.id}/favorite`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isFavorite: next }),
      });
      if (!res.ok) throw new Error(`favorite: ${res.status}`);
      const data = (await res.json()) as { isFavorite: boolean };
      setFavoriteState(data.isFavorite);
    } catch (err) {
      setFavoriteState(previous);
      console.error("favorite toggle failed", err);
    }
  };

  const handleCopyLink = async () => {
    const url = `${window.location.origin}/project/${item.id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch (err) {
      console.error("copy link failed", err);
    }
  };

  const enterRenameMode = () => {
    setRenameDraft(titleState);
    setRenameMode(true);
  };
  const cancelRename = () => {
    setRenameMode(false);
    setRenameDraft(titleState);
  };
  const commitRename = async () => {
    const trimmed = renameDraft.trim().slice(0, MAX_TITLE_LENGTH);
    if (trimmed.length === 0 || trimmed === titleState) {
      cancelRename();
      return;
    }
    setRenameSaving(true);
    try {
      const res = await fetch(`/api/projects/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) throw new Error(`rename: ${res.status}`);
      const data = (await res.json()) as { title: string };
      setTitleState(data.title);
      setRenameMode(false);
    } catch (err) {
      console.error("rename failed", err);
    } finally {
      setRenameSaving(false);
    }
  };

  const handleConfirmTrash = async () => {
    setTrashBusy(true);
    try {
      const res = await fetch(`/api/projects/${item.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`delete: ${res.status}`);
      setTrashOpen(false);
      onDeleted(item.id);
    } catch (err) {
      console.error("delete failed", err);
    } finally {
      setTrashBusy(false);
    }
  };

  const handleUseAsTemplate = async () => {
    if (useTplBusy) return;
    setUseTplBusy(true);
    try {
      await prepareTemplateUse("project", item.id);
      window.location.assign(`/use-template/project/${item.id}`);
    } catch (err) {
      console.warn("[ProjectTableRow] use-as-template prep failed", err);
      setUseTplBusy(false);
    }
  };

  return (
    // The row div has NO onClick — navigation lives on the stretched
    // overlay <Link> below. Critical: ProjectActionsMenu + the dialogs
    // are React children of this div and portal to <body>; React events
    // bubble through the REACT tree, so if this div carried a navigate
    // onClick, clicking a menu item would also navigate. Keeping nav on a
    // sibling overlay link avoids that — and a real <a> keeps native link
    // affordances (middle-click / cmd-click / open-in-new-tab).
    <div
      className={`relative ${GENERATION_COLS} py-3.5 transition-colors hover:bg-white/[0.02] ${
        useTplBusy ? "pointer-events-none opacity-60" : ""
      }`}
    >
      {/* Full-row navigation target (hidden while renaming). Sits beneath
          the cells (z-0); cells are pointer-events-none so clicks fall
          through to it, except the 3-dots + rename input which opt back
          in. */}
      {!renameMode ? (
        <Link
          href={`/project/${item.id}`}
          aria-label={`افتح ${titleState}`}
          className="absolute inset-0 z-0 rounded-md"
        />
      ) : null}

      {/* Thumbnail + title/orientation */}
      <div className="pointer-events-none relative z-[1] flex min-w-0 items-center gap-3">
        <div className="relative aspect-video w-14 shrink-0 overflow-hidden rounded-md bg-white/[0.05]">
          {item.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.thumbnailUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center text-muted/40">
              <span className="material-symbols-outlined text-[18px]">
                slideshow
              </span>
            </span>
          )}
        </div>
        <div className="min-w-0">
          {renameMode ? (
            <input
              ref={renameInputRef}
              type="text"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={commitRename}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelRename();
                }
              }}
              disabled={renameSaving}
              maxLength={MAX_TITLE_LENGTH}
              aria-label="اسم المشروع"
              className="pointer-events-auto relative z-[2] w-full truncate rounded-md border border-white/15 bg-white/[0.04] px-1.5 py-0.5 text-sm font-medium leading-tight text-white outline-none transition-colors focus:border-white/40 disabled:opacity-60"
            />
          ) : (
            <p className="flex items-center gap-1 truncate text-sm font-medium text-white">
              {favoriteState ? (
                <span className="material-symbols-outlined tq-fav-indicator shrink-0 text-[14px] text-amber-300">
                  star
                </span>
              ) : null}
              <span className="truncate" title={titleState}>
                {titleState}
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
          aria-expanded={menuRect !== null}
          data-project-menu-trigger={item.id}
          onClick={(e) => {
            e.stopPropagation();
            if (menuRect != null) closeMenu();
            else openMenu();
          }}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:text-white"
        >
          <span className="material-symbols-outlined text-[18px]">more_vert</span>
        </button>
      </div>

      <ProjectActionsMenu
        open={menuRect !== null}
        triggerRect={menuRect}
        projectId={item.id}
        isFavorite={favoriteState}
        onClose={closeMenu}
        onShare={() => setShareOpen(true)}
        onRename={enterRenameMode}
        onToggleFavorite={handleToggleFavorite}
        onCopyLink={handleCopyLink}
        onUseAsTemplate={handleUseAsTemplate}
        onSaveAsTemplate={() => setSaveTemplateOpen(true)}
        onSendToTrash={() => setTrashOpen(true)}
      />

      <SaveAsTemplateDialog
        open={saveTemplateOpen}
        projectId={item.id}
        onCancel={() => setSaveTemplateOpen(false)}
        onSaved={() => setSaveTemplateOpen(false)}
      />

      <TrashConfirmDialog
        open={trashOpen}
        projectTitle={titleState}
        busy={trashBusy}
        onCancel={() => {
          if (!trashBusy) setTrashOpen(false);
        }}
        onConfirm={handleConfirmTrash}
      />

      <ShareDialog
        open={shareOpen}
        projectId={item.id}
        projectTitle={titleState}
        onClose={() => setShareOpen(false)}
      />
    </div>
  );
}
