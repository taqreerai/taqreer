"use client";

// Comments panel — fixed-positioned glass card that REPLACES the
// SlideNavSidebar in the same right-edge slot whenever the user is
// in comment mode. The swap is intentional: while commenting, the
// user is focused on the currently selected slide, so the slide
// navigator's value drops to zero. Reusing the slot avoids a layout
// shift (section's marginRight stays = SLIDE_NAV_WIDTH at all times)
// and lets the hero claim the full remaining row width.
//
// Apply button in the sticky footer simply EXITS comment mode —
// drafts persist as drafts; the actual partial-regen API call is
// fired by the toolbar's regen button (which morphs to an AI icon
// while drafts exist, see PreviewActionBar).

import type { CommentAuthor, CommentRow } from "@/lib/types/comment";
import { Avatar } from "@/components/common/Avatar";
import { formatRelativeArabic } from "@/lib/util/relative-time";

// Same nominal width as SlideNavSidebar — both panels share the
// fixed slot against the main sidebar's inner edge, so swapping
// between them must not change the section's reserved gutter.
export const COMMENTS_PANEL_WIDTH = 320;

export function CommentsPanel({
  comments,
  slideId,
  onClose,
  onApply,
  mainSidebarWidth,
  embedded = false,
}: {
  comments: CommentRow[];
  slideId: string;
  onClose: () => void;
  // Embedded mode (command-bar redesign §16): render INSIDE the slide-nav's
  // Comments tab — drop the fixed `<aside>` chrome + the title/close header
  // (the tab provides both) and just fill the tab body with the list + the
  // "finish commenting" footer.
  embedded?: boolean;
  // Click handler for the sticky-footer "finish commenting" button.
  // Despite the historical `onApply` name, this never actually
  // triggers regen — it just exits comment mode. Drafts persist as
  // drafts; the toolbar's regen button is what fires the partial
  // regen for owner / edit. Comment-only viewers also see this
  // button because their flow is identical: write comments, close
  // the panel. The owner gets notified separately.
  onApply: () => void;
  // Width of the main app sidebar (80 collapsed, 260 expanded).
  // Same prop SlideNavSidebar takes — keeps the panel docked
  // against the main sidebar's inner edge as it animates.
  mainSidebarWidth: number;
}) {
  const slideComments = comments.filter((c) => c.slideId === slideId);
  return (
    <aside
      dir="rtl"
      aria-label="لوحة التعليقات"
      // Glass surface — built from primitives (no `.glass-card`
      // because that class carries a hover transition we don't want
      // on a sidebar panel). The `backdrop-blur-glass` utility is
      // the preset-linked blur token; the inline bg / border-color
      // use the same CSS variables `.glass-card` reads.
      className={
        embedded
          ? // Inside the nav's Comments tab — fill the body, no chrome.
            "flex h-full min-h-0 flex-col"
          : "backdrop-blur-glass-boost fixed z-[30] flex flex-col border-l p-3 transition-[right] duration-300 ease-in-out"
      }
      style={
        embedded
          ? undefined
          : {
              top: 80, // Header height (h-20)
              bottom: 0,
              right: mainSidebarWidth,
              width: COMMENTS_PANEL_WIDTH,
              background: "var(--glass-fill)",
              borderLeftColor:
                "rgba(255, 255, 255, var(--glass-border-opacity))",
            }
      }
    >
      {/* Standalone-only header — in embedded mode the nav's tab bar is the
          header, so the title + close button are dropped. */}
      {embedded ? null : (
        <header className="flex items-center justify-between gap-2 border-b border-white/[0.08] pb-3 px-1">
          <p className="text-sm font-semibold text-white">التعليقات</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق وضع التعليق"
            className="flex h-7 w-7 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "18px" }}
            >
              close
            </span>
          </button>
        </header>
      )}

      {/* Scrollable list area — flex-1 takes whatever vertical
          space the footer leaves. */}
      <div className="flex-1 overflow-y-auto py-3">
        {slideComments.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-2 text-center">
            <span
              className="material-symbols-outlined text-white/30"
              style={{ fontSize: "32px" }}
            >
              comment
            </span>
            <p className="text-xs text-white/50">
              لا توجد تعليقات على هذه الشريحة
            </p>
            <p className="text-[10px] leading-relaxed text-white/30">
              ارسم مربعاً على الشريحة لإضافة تعليق
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {slideComments.map((c) => (
              <li
                key={c.id}
                className="rounded-md border border-white/10 bg-white/5 p-2.5"
              >
                <CommentMeta
                  author={c.author}
                  createdAt={c.createdAt}
                />
                <div
                  // NO `dir="auto"` — inherit the panel's RTL flow.
                  // `dir="auto"` would flip a comment starting with
                  // a Latin char ("Make the title…") to LTR locally,
                  // misaligning the block against the RTL panel
                  // chrome. The Unicode BiDi engine still handles
                  // glyph order inside the line based on script.
                  className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-white/90"
                >
                  {c.content}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer — standalone mode only. In embedded mode (the slide-nav's
          Comments tab) there's no Apply button: the user exits comment mode
          by clicking the Slides tab, clicking outside the canvas, or Esc.
          Drafts persist regardless; the toolbar's regen button fires the
          partial regen. */}
      {embedded ? null : (
        <div className="border-t border-white/[0.08] pt-3">
          <button
            type="button"
            onClick={onApply}
            className="btn-pill flex w-full items-center justify-center gap-2 text-sm"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "18px" }}
              aria-hidden
            >
              check
            </span>
            إنهاء التعليق
          </button>
        </div>
      )}
    </aside>
  );
}

// ─── Per-comment metadata row ────────────────────────────────────
//
// New layout (2026-05-23): avatar on the visual-right (logical-start
// in the RTL CommentsPanel), name + relative-time stacked vertically
// on the visual-left (logical-end). Comment content is rendered by
// the caller BELOW this row. Same shape used by
// `MarkerPreviewPopup` in HeroCommentOverlay so both surfaces read
// identically.
//
// Why the stack: showing the time UNDER the name (instead of beside
// it) frees horizontal room for longer names without truncating the
// timestamp, and reads more naturally in RTL where two short fields
// flowing horizontally compete with the comment body below.

function CommentMeta({
  author,
  createdAt,
}: {
  author: CommentAuthor | null;
  createdAt: string;
}) {
  // Email is intentionally not in the wire shape (PII). When a user
  // has no display name set we fall back to "غير معروف" — visually
  // the gradient-initial avatar still differentiates rows.
  const displayName = author?.name?.trim() || "غير معروف";
  return (
    <div className="flex items-center gap-2">
      {/* First child = logical-start = visual-right under RTL parent. */}
      <Avatar
        name={author?.name ?? null}
        image={author?.image ?? null}
        seedId={author?.id ?? null}
        size={28}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* NO `dir="auto"` on the name — the panel is RTL, so the
            span should inherit RTL flow and text-align: start (right
            visually). `dir="auto"` would flip a Latin name like
            "Osama" to LTR locally, snapping the text to visual-left
            inside an RTL panel — exactly the misalignment users
            complained about. BiDi glyph order is still handled
            correctly by the parent's RTL context. */}
        <span className="truncate text-[11px] font-medium leading-tight text-white">
          {displayName}
        </span>
        <time
          className="text-[10px] leading-tight text-white/40"
          dateTime={createdAt}
          title={new Date(createdAt).toLocaleString("ar")}
        >
          {formatRelativeArabic(createdAt)}
        </time>
      </div>
    </div>
  );
}

// `formatRelativeArabic` lives in `lib/util/relative-time.ts` — see
// the import at the top of the file. Shared with HeroCommentOverlay's
// MarkerPreviewPopup so wording stays locked across surfaces.
