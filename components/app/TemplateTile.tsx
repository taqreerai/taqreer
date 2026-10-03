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

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TemplateActionsMenu } from "@/components/app/TemplateActionsMenu";
import { TemplateDeleteConfirmDialog } from "@/components/app/TemplateDeleteConfirmDialog";
import { ParagraphWriteIcon } from "@/components/preview/ParagraphWriteIcon";
import { PremiumBadge } from "@/components/app/PremiumBadge";
import { useTemplateLock } from "@/lib/templates/use-template-lock";
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
  // Current visibility (true only when APPROVED + live). Drives the
  // community-vs-mine split. Optimistically updated on toggle before
  // router.refresh re-fetches.
  isPublic: boolean;
  // Moderation state of the owner's publish request. Drives the menu label
  // (submit / cancel request / make private) and the "under review" chip.
  // Optional so legacy call sites compile; falls back to APPROVED/PRIVATE
  // derived from isPublic.
  reviewStatus?: "PRIVATE" | "PENDING" | "APPROVED";
  // Premium templates show the "مميز" badge. Optional so callers that
  // don't carry it compile; the use-gate itself is enforced server-side.
  isPremium?: boolean;
  // Curator free-plan template (Template.isFree): the one kind a free plan
  // may generate with. Drives the lock crown / "free" badge below.
  isFree?: boolean;
};

export function TemplateTile({
  template,
  onClick,
  href,
  viewerIsAdmin = false,
}: {
  template: TemplateTileData;
  // If provided, the tile becomes a <button>; the lightbox opens at
  // the caller via this callback. Mutually exclusive with `href`.
  onClick?: () => void;
  // If provided (and `onClick` is not), the tile becomes a <Link>.
  // Dashboard widget passes "/templates" so a tap routes through.
  href?: string;
  // True when the viewing user is an admin. Admins get the 3-dots menu on
  // EVERY tile (not just their own) with a Delete action, so they can remove
  // any user's template. Owner-only actions (publish toggle, use-as-template)
  // still render only on the admin's own tiles. Server-enforced regardless.
  viewerIsAdmin?: boolean;
}) {
  const router = useRouter();
  const dict = useDict();

  // Optimistic copy of the moderation state — the menu label + "under review"
  // chip flip instantly on click, even before router.refresh pulls the
  // canonical value back. Resync from props whenever the canonical value
  // changes (e.g. after a sibling tile flips + the SSR re-fetch propagates a
  // fresh prop down) so the local mirror never drifts stale. Falls back to
  // APPROVED/PRIVATE derived from isPublic when a caller omits reviewStatus.
  const canonicalStatus =
    template.reviewStatus ?? (template.isPublic ? "APPROVED" : "PRIVATE");
  const [statusLocal, setStatusLocal] = useState(canonicalStatus);
  // Resync the mirror during render (not a mount effect) when the canonical
  // prop changes — React's recommended "adjust state on prop change" shape,
  // which also keeps us clear of the repo's set-state-in-effect ban.
  const [prevCanonicalStatus, setPrevCanonicalStatus] = useState(canonicalStatus);
  if (canonicalStatus !== prevCanonicalStatus) {
    setPrevCanonicalStatus(canonicalStatus);
    setStatusLocal(canonicalStatus);
  }

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

  // Visibility-toggle busy gate. Blocks overlapping PATCHes from rapid
  // re-clicks (reopen menu -> click again before the first resolves), whose
  // responses could otherwise settle out of order.
  const [visibilityBusy, setVisibilityBusy] = useState(false);

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

  const { brand, isMine, id, thumbnailUrls, isPremium, isFree } = template;
  // Plan gate shown up front (2026-10-02): every template this viewer's plan
  // can't generate with wears the same gold "premium" badge as premium
  // templates (owner direction: free users must see at a glance which ones
  // are paid); the free-plan ones get a "free" badge instead.
  const { lockFor, flowLocked } = useTemplateLock();
  const showPremium = !!isPremium || lockFor(template) != null;
  const freeBadge = flowLocked && !!isFree;
  // Admins manage every tile (delete any user's template); owners manage
  // their own. Drives whether the 3-dots trigger + menu render at all.
  const canManage = isMine || viewerIsAdmin;
  const primary = brand.palette[0] ?? brand.text;
  const secondary = brand.palette[1] ?? brand.text;
  const accent = brand.palette[2] ?? primary;

  // Hover-scrub through the showcase slides — shared with ProjectThumbnail.
  const slides = thumbnailUrls ?? [];
  const tileRef = useRef<HTMLDivElement | null>(null);
  const scrub = useSlideScrub(slides, tileRef);
  const cover = slides[scrub.displayIndex] ?? null;

  const handleToggleVisibility = async () => {
    if (visibilityBusy) return;
    const prevStatus = statusLocal;
    // PRIVATE -> request review (enters the admin queue as PENDING).
    // PENDING or APPROVED -> withdraw back to PRIVATE. Publishing is never
    // self-service, so we only ever send a request; the server sets PENDING.
    const wantPublic = prevStatus === "PRIVATE";
    setVisibilityBusy(true);
    setStatusLocal(wantPublic ? "PENDING" : "PRIVATE"); // optimistic
    try {
      const res = await fetch(
        `/api/templates/${encodeURIComponent(id)}/visibility`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ isPublic: wantPublic }),
        },
      );
      if (!res.ok) {
        // Roll back optimism on failure. Surface as console.warn —
        // no toast infra yet for templates; v2 add.
        setStatusLocal(prevStatus);
        console.warn("[TemplateTile] visibility PATCH failed", await res.text());
        return;
      }
      // Re-fetch SSR so other pages (/templates) reflect the new state.
      router.refresh();
    } catch (err) {
      setStatusLocal(prevStatus);
      console.warn("[TemplateTile] visibility PATCH error", err);
    } finally {
      setVisibilityBusy(false);
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
        <ScrubCounter index={scrub.hoverIndex} total={scrub.scrubCount} />
      ) : null}

      {/* Premium marker — top-start corner. */}
      {showPremium ? (
        <PremiumBadge className="pointer-events-none absolute top-2 start-2 z-10" />
      ) : freeBadge ? (
        <span className="pointer-events-none absolute top-2 start-2 z-10 rounded-full bg-[var(--tq-brand-blue)] px-2 py-0.5 text-[11px] font-semibold text-white">
          {dict.flows.design.freeBadge}
        </span>
      ) : null}

      {/* "Under review" chip — only on the owner's own template while its
          publish request is pending admin approval. Bottom-start (the scrub
          counter sits bottom-end). `--tq-bg-dim` keeps it legible over any
          cover image, matching the 3-dots trigger. */}
      {isMine && statusLocal === "PENDING" ? (
        <span className="pointer-events-none absolute bottom-2 start-2 z-10 rounded-full bg-[var(--tq-bg-dim)] px-2 py-0.5 text-[11px] font-medium text-foreground">
          {dict.components.templateTile.pendingBadge}
        </span>
      ) : null}

      {useBusy ? (
        <div
          role="status"
          aria-label={dict.components.templateTile.preparing}
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 text-foreground"
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

      {canManage ? (
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
          className={`absolute top-2 end-2 z-20 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--tq-bg-dim)] text-foreground transition-opacity focus-visible:opacity-100 group-hover:opacity-100 ${
            menuRect ? "opacity-100" : "opacity-0"
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">more_vert</span>
        </button>
      ) : null}

      {canManage ? (
        <>
          <TemplateActionsMenu
            open={menuRect !== null}
            triggerRect={menuRect}
            templateId={id}
            reviewStatus={statusLocal}
            // Owner-only actions (publish toggle, use-as-template) render only
            // on the viewer's own tiles. An admin on someone else's tile gets
            // Delete only.
            ownerActions={isMine}
            onClose={closeMenu}
            onToggleVisibility={isMine ? handleToggleVisibility : undefined}
            onUseAsTemplate={isMine ? handleUseAsTemplate : undefined}
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
