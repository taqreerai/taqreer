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

import type { CommentRow } from "@/lib/types/comment";

// Same nominal width as SlideNavSidebar — both panels share the
// fixed slot against the main sidebar's inner edge, so swapping
// between them must not change the section's reserved gutter.
export const COMMENTS_PANEL_WIDTH = 260;

export function CommentsPanel({
  comments,
  slideId,
  onClose,
  onApply,
  mainSidebarWidth,
}: {
  comments: CommentRow[];
  slideId: string;
  onClose: () => void;
  // Click handler for the sticky-footer Apply button. Just exits
  // comment mode — drafts persist; the toolbar's AI-icon regen
  // button fires the actual partial regen.
  onApply: () => void;
  // Width of the main app sidebar (80 collapsed, 260 expanded).
  // Same prop SlideNavSidebar takes — keeps the panel docked
  // against the main sidebar's inner edge as it animates.
  mainSidebarWidth: number;
}) {
  const slideComments = comments.filter((c) => c.slideId === slideId);
  const totalDrafts = comments.length;
  return (
    <aside
      dir="rtl"
      aria-label="لوحة التعليقات"
      // Glass surface — built from primitives (no `.glass-card`
      // because that class carries a hover transition we don't want
      // on a sidebar panel). The `backdrop-blur-glass` utility is
      // the preset-linked blur token; the inline bg / border-color
      // use the same CSS variables `.glass-card` reads.
      className="backdrop-blur-glass fixed z-[30] flex flex-col border-l p-3 transition-[right] duration-300 ease-in-out"
      style={{
        top: 80, // Header height (h-20)
        bottom: 0,
        right: mainSidebarWidth,
        width: COMMENTS_PANEL_WIDTH,
        background: "rgba(255, 255, 255, var(--glass-opacity))",
        borderLeftColor: "rgba(255, 255, 255, var(--glass-border-opacity))",
      }}
    >
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
                className="rounded-md border border-white/10 bg-white/5 p-2 text-xs leading-relaxed text-white/90"
              >
                {c.content}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Sticky footer — Apply button. Visible whenever any draft
          exists in the deck. Clicking it just exits comment mode;
          drafts persist as drafts. The toolbar's regen button takes
          over from here (shows the AI icon and fires the partial
          regen on click). */}
      {totalDrafts > 0 ? (
        <div className="border-t border-white/[0.08] pt-3">
          <button
            type="button"
            onClick={onApply}
            className="btn-gradient flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "18px" }}
            >
              check
            </span>
            تطبيق التعليقات ({totalDrafts})
          </button>
        </div>
      ) : null}
    </aside>
  );
}
