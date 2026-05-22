"use client";

// Shared tile renderer for a Template, used by both the dashboard's
// "قوالبي" widget and the /templates browse page.
//
// The tile body is an ABSTRACT layout-grid rendered in the brand's
// colour palette. Caption row beneath shows title + format ratio.
//
// When `template.isMine` is true, a 3-dots actions button appears in
// the caption row. The tile OWNS the menu open/closed state, the
// delete-confirm dialog, and the API calls for visibility toggle +
// delete. After a successful mutation we call router.refresh() so the
// SSR-rendered list (dashboard widget or /templates) re-fetches and
// reflects the new state. Community tiles (isMine: false) render no
// 3-dots button at all — those actions don't apply to someone else's
// template.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TemplateActionsMenu } from "@/components/app/TemplateActionsMenu";
import { TemplateDeleteConfirmDialog } from "@/components/app/TemplateDeleteConfirmDialog";

export type TemplateTileBrand = {
  background: string;
  text: string;
  palette: string[];
  format: string;
};

export type TemplateTileData = {
  id: string;
  title: string;
  brand: TemplateTileBrand;
  // True when the viewing user owns this template. Drives the 3-dots
  // affordance — community tiles get no menu at all. Defaults false
  // is safer, but every call site sets it explicitly today.
  isMine: boolean;
  // Current visibility. Drives the menu chip label
  // ("اجعله عاماً" when private, "اجعله خاصاً" when public).
  // Optimistically updated on toggle before router.refresh re-fetches.
  isPublic: boolean;
};

export function TemplateTile({
  template,
  onClick,
  href,
}: {
  template: TemplateTileData;
  // If provided, the tile becomes a <button>; the lightbox opens at
  // the caller via this callback. Mutually exclusive with `href`.
  onClick?: () => void;
  // If provided (and `onClick` is not), the tile becomes a <Link>.
  // Dashboard widget passes "/templates" so a tap routes through.
  href?: string;
}) {
  const router = useRouter();

  // Optimistic copy of isPublic — the menu chip label flips
  // instantly on click for UX snappiness, even before router.refresh
  // pulls the canonical value back. Resync from props whenever
  // the canonical value changes (e.g. after a sibling tile flips
  // visibility + the dashboard's SSR re-fetch propagates a fresh
  // template prop down here) so the local state never drifts stale.
  const [isPublicLocal, setIsPublicLocal] = useState(template.isPublic);
  useEffect(() => {
    setIsPublicLocal(template.isPublic);
  }, [template.isPublic]);

  // Menu trigger state. menuRect = null means menu closed.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);
  const closeMenu = () => setMenuRect(null);

  // Delete-confirm dialog state.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const { brand, title, isMine, id } = template;
  const primary = brand.palette[0] ?? brand.text;
  const secondary = brand.palette[1] ?? brand.text;
  const accent = brand.palette[2] ?? primary;

  const handleToggleVisibility = async () => {
    const nextPublic = !isPublicLocal;
    setIsPublicLocal(nextPublic); // optimistic
    try {
      const res = await fetch(
        `/api/templates/${encodeURIComponent(id)}/visibility`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ isPublic: nextPublic }),
        },
      );
      if (!res.ok) {
        // Roll back optimism on failure. Surface as console.warn —
        // no toast infra yet for templates; v2 add.
        setIsPublicLocal(!nextPublic);
        console.warn("[TemplateTile] visibility PATCH failed", await res.text());
        return;
      }
      // Re-fetch SSR so other pages (/templates) reflect the new state.
      router.refresh();
    } catch (err) {
      setIsPublicLocal(!nextPublic);
      console.warn("[TemplateTile] visibility PATCH error", err);
    }
  };

  const handleConfirmDelete = async () => {
    if (deleteBusy) return;
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/templates/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        console.warn("[TemplateTile] DELETE failed", await res.text());
        // Keep dialog open so the user knows it didn't work — no toast
        // infra yet for inline errors. Close manually via Cancel.
        return;
      }
      // Success — close + refresh. The SSR fetch will drop the row,
      // which makes this tile unmount.
      setDeleteOpen(false);
      router.refresh();
    } finally {
      setDeleteBusy(false);
    }
  };

  const tileBody = (
    <div
      className="relative aspect-video w-full overflow-hidden rounded-[14px] transition-transform group-hover:scale-[1.01]"
      style={{
        background: brand.background,
        color: brand.text,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${brand.text} 12%, transparent)`,
      }}
    >
      {/* Accent column — full-height stripe on the start side. */}
      <div
        className="absolute inset-y-0 start-0 w-[14%]"
        style={{ background: primary }}
        aria-hidden
      />
      {/* Layout content — title bar, subtitle bar, three blocks. */}
      <div className="absolute inset-0 flex flex-col justify-center gap-[5%] px-[10%] py-[12%] ps-[18%]">
        <div
          className="h-[10%] w-[55%] rounded-[3px]"
          style={{ background: primary }}
          aria-hidden
        />
        <div
          className="h-[5%] w-[38%] rounded-[2px]"
          style={{
            background: `color-mix(in srgb, ${brand.text} 50%, transparent)`,
          }}
          aria-hidden
        />
        <div className="mt-[3%] flex h-[45%] gap-[3%]">
          <div
            className="flex-1 rounded-[5px]"
            style={{
              background: secondary,
              opacity: 0.85,
              border: `1px solid color-mix(in srgb, ${brand.text} 14%, transparent)`,
            }}
            aria-hidden
          />
          <div
            className="flex-1 rounded-[5px]"
            style={{ background: primary, opacity: 0.55 }}
            aria-hidden
          />
          <div
            className="flex-1 rounded-[5px]"
            style={{ background: accent, opacity: 0.7 }}
            aria-hidden
          />
        </div>
      </div>
    </div>
  );

  // The clickable surface around the 16:9 tile body. Anchor or button
  // depending on whether the caller wants navigation or a callback.
  const clickableTile = onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="group w-full text-start"
      aria-label={title}
    >
      {tileBody}
    </button>
  ) : (
    <Link
      href={href ?? "/templates"}
      className="group"
      aria-label={title}
    >
      {tileBody}
    </Link>
  );

  return (
    <div className="flex flex-col gap-3">
      {clickableTile}

      {/* Caption row — title + format on start side, 3-dots on end
          (only when the user owns the template). Mirrors
          ProjectThumbnail's caption row signature so the two libraries
          read as the same family. */}
      <div dir="rtl" className="flex items-start justify-between gap-2 px-0.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold leading-tight text-white">
            {title}
          </p>
          <p className="mt-0.5 text-[10px] text-muted">{brand.format}</p>
        </div>

        {isMine ? (
          <button
            ref={triggerRef}
            type="button"
            // `data-template-menu-trigger` lets TemplateActionsMenu's
            // outside-click handler tell THIS tile's trigger apart
            // from another tile's trigger when the user clicks across
            // tiles to swap menus.
            data-template-menu-trigger={id}
            aria-label="خيارات القالب"
            onClick={(e) => {
              e.stopPropagation();
              // Toggle — click again to close.
              if (menuRect) {
                closeMenu();
              } else if (triggerRef.current) {
                setMenuRect(triggerRef.current.getBoundingClientRect());
              }
            }}
            // Color-only hover (no bg). Same convention as
            // ProjectThumbnail's 3-dots after the bg-tint fix.
            className="-mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[color:var(--tq-text-muted)] transition-colors hover:text-white"
          >
            <span className="material-symbols-outlined text-[18px]">more_vert</span>
          </button>
        ) : null}
      </div>

      {isMine ? (
        <>
          <TemplateActionsMenu
            open={menuRect !== null}
            triggerRect={menuRect}
            templateId={id}
            isPublic={isPublicLocal}
            onClose={closeMenu}
            onToggleVisibility={handleToggleVisibility}
            onDelete={() => setDeleteOpen(true)}
          />
          <TemplateDeleteConfirmDialog
            open={deleteOpen}
            templateTitle={title}
            busy={deleteBusy}
            onCancel={() => {
              if (!deleteBusy) setDeleteOpen(false);
            }}
            onConfirm={handleConfirmDelete}
          />
        </>
      ) : null}
    </div>
  );
}
