"use client";

// Project tile — used by the dashboard RecentProjects widget and
// (later) /projects page.
//
// Layout: full-bleed 16:9 thumbnail surface on top; a flat info row
// underneath carrying the title + creation date + 3-dots actions
// trigger. No hover effects on the thumbnail (no dim, no overlay,
// no fade-in chrome). Everything below the thumbnail is always
// visible.
//
// THREE behaviours on the thumbnail surface:
//
//   1. ASPECT — always 16:9 so the grid stays uniform. 9:16
//      source thumbnails use `object-cover object-top` to show
//      the slide's top portion cropped to landscape. 16:9 decks
//      fit naturally with no crop.
//
//   2. SCRUB — once the cursor has moved past SCRUB_ACTIVATION_PX
//      from its entry position, the X position maps linearly to
//      a slide index. RTL direction: rightmost = slide 1,
//      leftmost = slide N. The first mousemove just records the
//      entry X; bare hover doesn't trigger scrub. Cursor leaves →
//      snap back to slide 0. A small counter chip shows at the
//      thumbnail's bottom-end while scrubbing.
//
//   3. CLICK — opens the lightbox via the parent's onOpen callback.
//
// FOOTER (always visible, below the thumbnail):
//   • Title (or rename input when renameMode=true) + creation
//     date on the start side (visual right in RTL).
//   • 3-dots menu trigger on the end side (visual left in RTL).
//     Stamped `data-project-menu-trigger` so the menu's outside-
//     click handler ignores it (otherwise the trigger's own click
//     re-opens the menu after the mousedown closes it — same
//     pattern as HistoryPopover's exclusion).
//
// MENU + ACTIONS (step 9f):
//   Per-tile state for menu open/closed, rename mode, and the
//   optimistic favorite toggle lives here. Three side effects
//   bubble up to the parent:
//     • onDeleted(projectId) — fires after a successful trash
//       DELETE so the dashboard can drop the tile from its list.
//     • onRenamed(projectId, title) — optional; lets the parent
//       reflect the new title elsewhere (none currently uses it,
//       but parity with onDeleted keeps the API symmetrical).
//   Favorite is local-only; nothing else on the dashboard reacts
//   to it. The /favorites page will fetch fresh.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { ar } from "date-fns/locale";
import type { SlideFormat } from "@/lib/schema/slide";
import { ProjectActionsMenu } from "@/components/app/ProjectActionsMenu";
import { TrashConfirmDialog } from "@/components/app/TrashConfirmDialog";

// Pixels of cursor travel required to consider the user actually
// scrubbing (not just hovering at rest). ~2 trackpad ticks.
const SCRUB_ACTIVATION_PX = 6;
// Mirror the server-side cap in /api/projects/[id] PATCH so the
// input can't write past what the route would silently truncate.
const MAX_TITLE_LENGTH = 200;

type Props = {
  // Stable per-project — drives API calls + clipboard URL.
  projectId: string;
  slides: string[];
  format: SlideFormat;
  title: string;
  createdAt: Date | string;
  isFavorite: boolean;
  // True when the thumbnail-render Inngest job has been queued (deck
  // is saved) but its output hasn't landed in `slides` yet. Drives
  // the loading spinner overlay so users see "thumbnails are coming"
  // instead of a stale-looking placeholder. Always false for legacy
  // decks that have never been saved — those get the static
  // placeholder icon (spinner that never resolves would be worse UX
  // than acknowledging "no thumbnails available").
  thumbnailsPending?: boolean;
  // Optional click-override. Default behaviour (post route split,
  // 2026-05-21) is to navigate to `/project/<id>` — the canonical
  // working-session route. Pass `onOpen` to opt back into a
  // callback-driven flow (e.g. the templates page renders the
  // ProjectLightbox preview instead of navigating). Project tiles
  // on /dashboard, /favorites, /projects don't pass it and use
  // the navigate default.
  onOpen?: () => void;
  // Fires AFTER the DELETE round-trip succeeds. Parent uses this
  // to drop the tile from its rendered list (we don't unmount
  // ourselves — the parent owns the projects array).
  onDeleted?: (projectId: string) => void;
  // Optional: notify parent of a successful rename. Tile updates
  // its own local title optimistically; this exists so other
  // surfaces showing the same title (none today) can sync.
  onRenamed?: (projectId: string, newTitle: string) => void;
  // Optional: notify parent of a confirmed favorite-state change
  // (server response landed). Used by /favorites to drop the tile
  // immediately when the user un-stars — without this, un-starring
  // a tile on the favorites view leaves it sitting there until the
  // user reloads, because the SSR `projects` array still has it.
  // RecentProjects doesn't pass this prop (dashboard tiles stay
  // regardless of star state) so behaviour there is unchanged.
  onFavoriteChange?: (projectId: string, isFavorite: boolean) => void;
};

export function ProjectThumbnail({
  projectId,
  slides,
  format,
  title,
  createdAt,
  isFavorite,
  thumbnailsPending = false,
  onOpen,
  onDeleted,
  onRenamed,
  onFavoriteChange,
}: Props) {
  const router = useRouter();
  const rootRef = useRef<HTMLButtonElement | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const entryXRef = useRef<number | null>(null);
  // Thumbnail-hover flag — flips title + 3-dots between muted /
  // white. Tracked in JS (not CSS group/peer) because the title
  // and dots live in a footer that's a sibling-of-sibling of the
  // thumbnail (Tailwind `peer-hover:` only walks one sibling
  // level). Easier to set state than to restructure DOM for a
  // CSS selector.
  const [thumbHovered, setThumbHovered] = useState(false);

  // ── Step 9f state ──────────────────────────────────────────────
  // Menu open + the DOMRect the menu anchors to. Null rect ↔ closed.
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);

  // Optimistic favorite — server response replaces this once the
  // PATCH lands. We don't revert on failure because the UX cost
  // of "star flicker" outweighs the rare network error case; an
  // error logs to console for traceability and the next reload
  // shows truth.
  const [favoriteState, setFavoriteState] = useState(isFavorite);
  // Local title — starts from the prop, mutated on rename for
  // optimistic UI. The prop is the SSR value and won't change
  // post-mount unless the parent re-fetches.
  const [titleState, setTitleState] = useState(title);
  const [renameMode, setRenameMode] = useState(false);
  const [renameDraft, setRenameDraft] = useState(title);
  const [renameSaving, setRenameSaving] = useState(false);

  // Trash confirmation dialog open + in-flight flag for the DELETE.
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashBusy, setTrashBusy] = useState(false);

  // Eagerly preload the FIRST FEW slide thumbnails on mount so the
  // initial hover-scrub feels instant. Bounded to the first
  // `EAGER_PRELOAD_LIMIT` (a 6-tile dashboard × 8 slides each ==
  // 48 simultaneous image fetches on first paint without the cap;
  // the cap drops that to 18 — caught by CR 2026-05-21). Slides
  // beyond the cap will fetch on first hover (single ~80 KB
  // request; cheap, and the brief blank-flash is acceptable for a
  // less-likely interaction). Cached for the page's lifetime once
  // fetched.
  const EAGER_PRELOAD_LIMIT = 3;
  useEffect(() => {
    for (const url of slides.slice(0, EAGER_PRELOAD_LIMIT)) {
      if (!url) continue;
      const img = new Image();
      img.src = url;
    }
  }, [slides]);

  // Focus + select the input when entering rename mode. useEffect
  // (not a callback ref) because the input only exists conditionally;
  // when renameMode flips on, we wait for the next paint then focus.
  useEffect(() => {
    if (renameMode) {
      // Defer focus to the next microtask so the input has actually
      // mounted by the time we call .focus().
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

  const displayIndex = hoverIndex ?? 0;
  const src = slides[displayIndex] ?? null;
  const hasSlides = slides.length > 0;
  const isMultiSlide = slides.length > 1;

  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!isMultiSlide) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    if (entryXRef.current == null) {
      entryXRef.current = e.clientX;
      return;
    }
    if (Math.abs(e.clientX - entryXRef.current) < SCRUB_ACTIVATION_PX) {
      return;
    }
    const relX = e.clientX - rect.left;
    // RTL mapping: rightmost pixel = slide 1, leftmost = slide N.
    const idx = Math.min(
      slides.length - 1,
      Math.max(0, Math.floor(((rect.width - relX) / rect.width) * slides.length)),
    );
    setHoverIndex(idx);
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
    entryXRef.current = null;
  };

  const imgObjectClass =
    format === "9:16" ? "object-cover object-top" : "object-cover";

  const relativeDate = formatDistanceToNow(new Date(createdAt), {
    addSuffix: true,
    locale: ar,
  });

  // ── Menu actions ───────────────────────────────────────────────
  const openMenu = () => {
    setMenuRect(menuBtnRef.current?.getBoundingClientRect() ?? null);
  };
  const closeMenu = () => setMenuRect(null);

  const handleToggleFavorite = async () => {
    const previous = favoriteState;
    const next = !previous;
    setFavoriteState(next);
    try {
      const res = await fetch(`/api/projects/${projectId}/favorite`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isFavorite: next }),
      });
      if (!res.ok) throw new Error(`favorite: ${res.status}`);
      const data = (await res.json()) as { isFavorite: boolean };
      setFavoriteState(data.isFavorite);
      onFavoriteChange?.(projectId, data.isFavorite);
    } catch (err) {
      // Revert the optimistic flip on failure. The dashboard has no
      // toast / retry chrome for this action, so without a revert
      // the tile silently keeps the wrong star until reload —
      // which is exactly the "user thinks it worked, server says
      // it didn't" desync we don't want. Flipping back makes the
      // failure visible (icon doesn't change → next click retries).
      setFavoriteState(previous);
      console.error("favorite toggle failed", err);
    }
  };

  const handleCopyLink = async () => {
    // Canonical working-session URL post route-split. /preview/<id>
    // still works (it just SSR-redirects to /project/<id> for any
    // completed deck) but /project is the URL we share / bookmark
    // so the recipient lands on the right route without a
    // redirect hop.
    const url = `${window.location.origin}/project/${projectId}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch (err) {
      console.error("copy link failed", err);
    }
  };

  const handleUseAsTemplate = () => {
    // Route lands in step 13. For 9f we just navigate — the page
    // will 404 today; that's the documented contract for the
    // intermediate state.
    window.location.href = `/create/from/${projectId}`;
  };

  const handleShare = () => {
    // Placeholder for step 15. Logged so a stray click on a
    // pre-modal build doesn't look broken-silent.
    console.info("[share] modal not implemented yet (step 15)");
  };

  // Rename ↔ submit flow. Enter / blur commits, Escape cancels.
  // Empty title is rejected client-side AND server-side (the
  // PATCH route returns 400 on empty after trim).
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
      // Nothing to save — bail out without an API call.
      cancelRename();
      return;
    }
    setRenameSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) throw new Error(`rename: ${res.status}`);
      const data = (await res.json()) as { title: string };
      setTitleState(data.title);
      onRenamed?.(projectId, data.title);
      setRenameMode(false);
    } catch (err) {
      console.error("rename failed", err);
      // Keep rename mode open + draft intact so the user can retry.
      // Real prod would surface a toast here; deferred until we
      // have a global toast system.
    } finally {
      setRenameSaving(false);
    }
  };

  const handleConfirmTrash = async () => {
    setTrashBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`delete: ${res.status}`);
      setTrashOpen(false);
      onDeleted?.(projectId);
    } catch (err) {
      console.error("delete failed", err);
      // Leave dialog open so the user can retry / cancel.
    } finally {
      setTrashBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Thumbnail — clean, no hover dim, no overlay chrome.
          mouseenter/leave on the wrapper flip the thumbHovered
          flag → title + 3-dots transition between muted/white. */}
      <div
        className="tq-thumbnail relative aspect-video w-full overflow-hidden rounded-[14px]"
        onMouseEnter={() => setThumbHovered(true)}
        onMouseLeave={() => setThumbHovered(false)}
      >
        <button
          ref={rootRef}
          type="button"
          // Tile click → navigate to /project/<id> by default; if
          // the caller passes `onOpen`, that wins (templates open
          // the ProjectLightbox preview instead of navigating).
          //
          // Always clickable — including tiles without thumbnails.
          // Pre-step-8b decks (and any deck whose thumbnail render
          // failed) have `thumbnailUrls: []`, so the previous
          // `disabled={!hasSlides}` gate made them unreachable from
          // the dashboard. After the route split that's wrong:
          // the working session at /project/<id> is valid regardless
          // of whether thumbnails were generated, so the click
          // should still navigate.
          onClick={() =>
            onOpen ? onOpen() : router.push(`/project/${projectId}`)
          }
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          aria-label={
            hasSlides
              ? `افتح ${titleState} — ${slides.length} ${slides.length === 1 ? "شريحة" : "شرائح"}`
              : `افتح ${titleState}`
          }
          className={`absolute inset-0 block ${
            onOpen ? "cursor-zoom-in" : "cursor-pointer"
          }`}
        >
          {src ? (
            <img
              alt=""
              aria-hidden
              src={src}
              className={`h-full w-full ${imgObjectClass}`}
              loading="lazy"
              decoding="async"
              draggable={false}
            />
          ) : thumbnailsPending ? (
            // Deck just saved — Inngest thumbnail job in flight.
            // `progress_activity` is Material Symbols' canonical
            // circular loader glyph; `animate-spin` provides the
            // rotation. `.tq-icon-lg` pins the font-size at 32 px
            // (chained-selector override of the global FILL=0 +
            // font-size:1em rules — same cascade fix family as
            // `.tq-fav-indicator`).
            <span
              role="status"
              aria-label="جاري إنشاء المعاينة"
              className="flex h-full w-full items-center justify-center"
            >
              <span className="material-symbols-outlined tq-icon-lg animate-spin text-muted">
                progress_activity
              </span>
            </span>
          ) : (
            <span className="flex h-full w-full items-center justify-center">
              <span className="material-symbols-outlined text-[28px] text-muted opacity-25">
                image
              </span>
            </span>
          )}
        </button>

        {/* Scrub counter — bottom-end (left in RTL). Only while
            scrubbing a multi-slide deck. Outside the click surface
            but inside the rounded thumbnail container. */}
        {isMultiSlide && hoverIndex !== null ? (
          <span
            dir="ltr"
            className="pointer-events-none absolute bottom-2 end-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white"
          >
            {hoverIndex + 1} / {slides.length}
          </span>
        ) : null}

        {/* Favorited indicator — top-start corner. Diagonal-opposite
            of the scrub counter so the two never crowd. Matches the
            counter's bg-black/70 chrome so the star reads against
            any slide content (light or dark). Inline FILL=1 because
            the global material-symbols-outlined rule sets FILL=0;
            without this the glyph would render as an outline. */}
        {favoriteState ? (
          <span
            aria-label="مشروع مفضّل"
            className="material-symbols-outlined tq-fav-indicator pointer-events-none absolute top-2 start-2 h-[18px] w-[18px] rounded-full bg-black/70 text-white"
          >
            star
          </span>
        ) : null}
      </div>

      {/* Info row — title (or rename input) + creation date on the
          start side (right in RTL), 3-dots menu trigger on the end
          side (left in RTL). Always visible, no hover gating. */}
      <div dir="rtl" className="flex items-start justify-between gap-2 px-0.5">
        <div className="min-w-0 flex-1">
          {/* Title + 3-dots color is driven by INLINE style (not
              Tailwind `text-white`/`text-muted` utilities) because
              the custom `.text-muted` rule in globals.css lives
              OUTSIDE Tailwind's `@layer utilities` and beats the
              layered `.text-white` rule even when only `text-white`
              is on the className — Tailwind v4's @layer cascade
              gives unlayered rules higher priority. Inline-style
              sidesteps the entire layer fight. */}
          {renameMode ? (
            <input
              ref={renameInputRef}
              type="text"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
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
              className="w-full truncate rounded-md border border-white/15 bg-white/[0.04] px-1.5 py-0.5 text-xs font-semibold leading-tight text-white outline-none transition-colors focus:border-white/40 disabled:opacity-60"
            />
          ) : (
            <p
              className="truncate text-xs font-semibold leading-tight transition-colors"
              style={{
                color: thumbHovered
                  ? "var(--tq-text-primary)"
                  : "var(--tq-text-muted)",
              }}
              title={titleState}
            >
              {titleState}
            </p>
          )}
          <p className="mt-0.5 text-[10px] text-muted">{relativeDate}</p>
        </div>
        <button
          ref={menuBtnRef}
          type="button"
          aria-label="خيارات المشروع"
          aria-haspopup="menu"
          aria-expanded={menuRect !== null}
          // The value (not just the attribute presence) carries the
          // projectId so the menu's outside-click handler can tell
          // "this same tile's trigger" apart from "some OTHER tile's
          // trigger" — clicking tile B's 3-dots now closes tile A's
          // open menu instead of leaving both popped.
          data-project-menu-trigger={projectId}
          onClick={(e) => {
            e.stopPropagation();
            // Toggle: closed → open at current rect, open → close.
            // Pattern mirrors the History pill's toggle handler.
            if (menuRect != null) {
              closeMenu();
            } else {
              openMenu();
            }
          }}
          className="btn-icon -mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center transition-colors"
          style={{
            // Stays white when favorited (even idle) so the tile reads
            // as "starred" at a glance, paired with the filled-star
            // indicator next to it. Hover behaviour unchanged.
            color:
              thumbHovered || favoriteState
                ? "var(--tq-text-primary)"
                : "var(--tq-text-muted)",
          }}
        >
          <span className="material-symbols-outlined text-[18px]">more_vert</span>
        </button>
      </div>

      <ProjectActionsMenu
        open={menuRect !== null}
        triggerRect={menuRect}
        projectId={projectId}
        isFavorite={favoriteState}
        onClose={closeMenu}
        onShare={handleShare}
        onRename={enterRenameMode}
        onToggleFavorite={handleToggleFavorite}
        onCopyLink={handleCopyLink}
        onUseAsTemplate={handleUseAsTemplate}
        onSendToTrash={() => setTrashOpen(true)}
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
    </div>
  );
}
