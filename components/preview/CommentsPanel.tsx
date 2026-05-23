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
                className="rounded-md border border-white/10 bg-white/5 p-2.5"
              >
                <CommentMeta
                  author={c.author}
                  createdAt={c.createdAt}
                />
                <div
                  className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-white/90"
                  dir="auto"
                >
                  {c.content}
                </div>
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
      {/* "إنهاء التعليق" — always visible while comment-mode is
          active. Clicking just exits comment mode; drafts persist.
          Normal pill (not gradient) because this doesn't trigger a
          model call — that's the toolbar's regen button. */}
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
    </aside>
  );
}

// ─── Per-comment metadata row ────────────────────────────────────
//
// Avatar (or initials fallback) + name + relative-time createdAt.
// Under `dir="rtl"` the row reads right-to-left visually: avatar on
// the visual right, then name, with the date floating to the left.
// `Intl.RelativeTimeFormat` produces a localised relative string
// ("منذ 3 دقائق") so commenters and viewers across the deck see the
// same wording regardless of their browser locale.

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
      <Avatar author={author} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium text-white" dir="auto">
          {displayName}
        </div>
      </div>
      <time
        className="shrink-0 text-[10px] text-white/40"
        dateTime={createdAt}
        title={new Date(createdAt).toLocaleString("ar")}
      >
        {formatRelativeArabic(createdAt)}
      </time>
    </div>
  );
}

function Avatar({ author }: { author: CommentAuthor | null }) {
  // Image when available, otherwise first letter of name/email on a
  // brand-gradient fallback. 24×24 keeps the row compact while still
  // being visually distinct from the comment body.
  if (author?.image) {
    return (
      <img
        src={author.image}
        alt=""
        width={24}
        height={24}
        className="h-6 w-6 shrink-0 rounded-full object-cover"
      />
    );
  }
  const seed = (author?.name || "?").trim();
  const initial = seed.charAt(0).toUpperCase() || "?";
  return (
    <div
      aria-hidden
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
      style={{
        background: "linear-gradient(135deg, #370BF4, #E036B8)",
      }}
    >
      {initial}
    </div>
  );
}

// Compact Arabic relative-time. Falls back to a short date for
// anything older than ~30 days where "منذ شهرين" reads weirder than
// a date stamp. Uses Intl APIs for the locale-correct plural forms.
function formatRelativeArabic(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const now = Date.now();
  const diffSec = Math.round((then - now) / 1000);
  const absSec = Math.abs(diffSec);

  const rtf = new Intl.RelativeTimeFormat("ar", { numeric: "auto" });
  if (absSec < 60) return rtf.format(diffSec, "second");
  if (absSec < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (absSec < 86_400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (absSec < 86_400 * 30) {
    return rtf.format(Math.round(diffSec / 86_400), "day");
  }
  // Beyond a month: absolute date is clearer than "منذ X شهراً".
  return new Date(iso).toLocaleDateString("ar", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
