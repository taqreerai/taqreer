"use client";

// Shared tile renderer for a Template, used by both the dashboard's
// "قوالبي" widget and the /templates browse page.
//
// The tile is the showcase thumbnail only — templates are UNTITLED
// (the public feed shows the preview image, no project-derived name).
// When real slide images exist the tile shows the source project's
// cover slide; otherwise it falls back to a brand-palette mock.
//
// When `template.isMine` is true, a 3-dots actions button overlays the
// thumbnail's top-end corner (opposite the premium badge) and reveals
// on hover. The tile OWNS the menu open/closed state, the delete-
// confirm dialog, and the API calls for visibility toggle + delete.
// After a successful mutation we call router.refresh() so the
// SSR-rendered list (dashboard widget or /templates) re-fetches and
// reflects the new state. Community tiles (isMine: false) render no
// 3-dots button at all — those actions don't apply to someone else's
// template.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TemplateActionsMenu } from "@/components/app/TemplateActionsMenu";
import { TemplateDeleteConfirmDialog } from "@/components/app/TemplateDeleteConfirmDialog";
import { ParagraphWriteIcon } from "@/components/preview/ParagraphWriteIcon";
import { PremiumBadge } from "@/components/app/PremiumBadge";
import { ScrubCounter } from "@/components/app/ScrubCounter";
import { prepareTemplateUse } from "@/lib/mimic/template-seed";
import { useSlideScrub } from "@/lib/hooks/useSlideScrub";
import { useDict } from "@/components/i18n/LocaleProvider";

export type TemplateTileBrand = {
  background: string;
  text: string;
  palette: string[];
  format: string;
};

export type TemplateTileData = {
  id: string;
  brand: TemplateTileBrand;
  // The template's real slide images (the source project's own
  // thumbnails). When present, the tile renders the cover slide; it
  // falls back to the brand-palette mock when absent (still rendering
  // or a legacy row). Optional so callers that don't carry it compile.
  thumbnailUrls?: string[];
  // True when the viewing user owns this template. Drives the 3-dots
  // affordance — community tiles get no menu at all. Defaults false
  // is safer, but every call site sets it explicitly today.
  isMine: boolean;
  // Current visibility. Drives the menu chip label
  // ("اجعله عاماً" when private, "اجعله خاصاً" when public).
  // Optimistically updated on toggle before router.refresh re-fetches.
  isPublic: boolean;
  // Premium templates show the "مميز" badge. Optional so callers that
  // don't carry it compile; the use-gate itself is enforced server-side.
  isPremium?: boolean;
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
  const dict = useDict();

  // Optimistic copy of isPublic — the menu chip label flips
  // instantly on click for UX snappiness, even before router.refresh
  // pulls the canonical value back. Resync from props whenever
  // the canonical value changes (e.g. after a sibling tile flips
  // visibility + the dashboard's SSR re-fetch propagates a fresh
  // template prop down here) so the local state never drifts stale.
  const [isPublicLocal, setIsPublicLocal] = useState(template.isPublic);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- canonical "resync local mirror when canonical prop changes" shape; useMemo can't store mutable local state for the optimistic toggle case
    setIsPublicLocal(template.isPublic);
  }, [template.isPublic]);

  // Menu trigger state. menuRect = null means menu closed.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);
  const closeMenu = () => setMenuRect(null);

  // Delete-confirm dialog state.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Use-as-template busy gate. Prevents a double-click from firing
  // two seed requests + two router.push calls (which would race the
  // sessionStorage write against the next page's hydrate).
  const [useBusy, setUseBusy] = useState(false);

  const handleUseAsTemplate = async () => {
    if (useBusy) return;
    setUseBusy(true);
    try {
      // Prepare the Mimic reference here (tile dims + loader) so the
      // forked flow opens instantly with no full-screen loader.
      await prepareTemplateUse("template", id);
      window.location.assign(`/use-template/${id}`);
    } catch (err) {
      console.warn("[TemplateTile] use prep failed", err);
      setUseBusy(false);
    }
  };

  const { brand, isMine, id, thumbnailUrls, isPremium } = template;
  const primary = brand.palette[0] ?? brand.text;
  const secondary = brand.palette[1] ?? brand.text;
  const accent = brand.palette[2] ?? primary;

  // Hover-scrub through the showcase slides — shared with ProjectThumbnail.
  const slides = thumbnailUrls ?? [];
  const tileRef = useRef<HTMLDivElement | null>(null);
  const scrub = useSlideScrub(slides, tileRef);
  const cover = slides[scrub.displayIndex] ?? null;

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
      ref={tileRef}
      onMouseMove={scrub.handleMouseMove}
      onMouseLeave={scrub.handleMouseLeave}
      className="relative aspect-video w-full overflow-hidden rounded-[14px] transition-transform group-hover:scale-[1.01]"
      style={{
        background: brand.background,
        color: brand.text,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${brand.text} 12%, transparent)`,
      }}
    >
      {cover ? (
        // Real cover slide (the source project's own image). Native
        // <img> — Supabase storage URLs aren't in next remotePatterns.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cover}
          alt=""
          aria-hidden
          loading="lazy"
          decoding="async"
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover object-top"
        />
      ) : (
        // Fallback: brand-palette mock (template still rendering, or a
        // legacy row with no images).
        <>
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
        </>
      )}
      {/* Scrub counter — bottom-end (left in RTL), only while scrubbing a
          multi-slide showcase. */}
      {scrub.isMultiSlide && scrub.hoverIndex !== null ? (
        <ScrubCounter index={scrub.hoverIndex} total={slides.length} />
      ) : null}

      {/* Premium marker — top-start corner. */}
      {isPremium ? (
        <PremiumBadge className="pointer-events-none absolute top-2 start-2 z-10" />
      ) : null}

      {useBusy ? (
        <div
          role="status"
          aria-label={dict.components.templateTile.preparing}
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 text-white"
        >
          <ParagraphWriteIcon size={32} />
        </div>
      ) : null}
    </div>
  );

  // Accessible name for the tile. Templates are untitled, so we describe
  // them by the attributes we DO have (ratio + premium) rather than a
  // bare "قالب" repeated across every tile in the grid — that gives
  // screen-reader users at least some way to tell tiles apart. (A fully
  // unique name would need the tile's grid position, which isn't threaded
  // down here.)
  const tileLabel =
    dict.components.templateTile.labelTemplate.replace("{format}", brand.format) +
    (isPremium ? dict.components.templateTile.premiumSuffix : "");

  // The clickable surface around the 16:9 tile body. Anchor or button
  // depending on whether the caller wants navigation or a callback.
  const clickableTile = onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="block w-full text-start"
      aria-label={tileLabel}
    >
      {tileBody}
    </button>
  ) : (
    <Link href={href ?? "/templates"} className="block" aria-label={tileLabel}>
      {tileBody}
    </Link>
  );

  // `group relative` so the thumbnail (a descendant) drives the
  // group-hover scale + the absolutely-positioned 3-dots overlay's
  // hover reveal, and the overlay positions against the thumbnail's
  // top-end corner. The overlay is a SIBLING of the clickable surface
  // (not a child) so we don't nest a <button> inside a <button>/<a>.
  return (
    <div className="group relative">
      {clickableTile}

      {isMine ? (
        <button
          ref={triggerRef}
          type="button"
          // `data-template-menu-trigger` lets TemplateActionsMenu's
          // outside-click handler tell THIS tile's trigger apart
          // from another tile's trigger when the user clicks across
          // tiles to swap menus.
          data-template-menu-trigger={id}
          aria-label={dict.components.templateTile.options}
          onClick={(e) => {
            e.stopPropagation();
            // Toggle — click again to close.
            if (menuRect) {
              closeMenu();
            } else if (triggerRef.current) {
              setMenuRect(triggerRef.current.getBoundingClientRect());
            }
          }}
          // Top-end corner (opposite the premium badge at top-2 start-2),
          // revealed on tile hover / keyboard focus. `--tq-bg-dim` is the
          // shared dark-scrim token (rgba(12,12,12,.55)) so the glyph stays
          // legible over any cover image without hardcoding a colour. Stays
          // visible while its menu is open so the trigger doesn't vanish
          // out from under the open popover.
          className={`absolute top-2 end-2 z-20 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--tq-bg-dim)] text-white transition-opacity focus-visible:opacity-100 group-hover:opacity-100 ${
            menuRect ? "opacity-100" : "opacity-0"
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">more_vert</span>
        </button>
      ) : null}

      {isMine ? (
        <>
          <TemplateActionsMenu
            open={menuRect !== null}
            triggerRect={menuRect}
            templateId={id}
            isPublic={isPublicLocal}
            onClose={closeMenu}
            onToggleVisibility={handleToggleVisibility}
            onUseAsTemplate={handleUseAsTemplate}
            onDelete={() => setDeleteOpen(true)}
          />
          <TemplateDeleteConfirmDialog
            open={deleteOpen}
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
