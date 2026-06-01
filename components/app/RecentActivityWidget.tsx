"use client";

// Dashboard widget: "النشاطات الأخيرة" (Recent Activities).
//
// The notification feed rendered as a dashboard widget — same data source
// as the header bell (the module-level `notificationStore` via
// `useNotifications`), so the two never drift. The header bell is always
// mounted in the shell, so by the time this widget paints the store is
// already populated for the signed-in user.
//
// Row layout: a tinted, COLOURED square icon per notification TYPE on the
// visual right; then a text column whose first line pairs the TITLE (core
// event, e.g. "اكتمل توليد العرض") with the relative TIME pushed to the
// visual left; and a muted DESCRIPTION line beneath. No per-row
// expand/delete affordance — long descriptions clamp to two lines.
//
// RTL: `dir="rtl"`, so the icon sits on the visual right and the text
// column flows leftward.

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  formatNotificationTime,
  notificationStore,
  useNotifications,
  type Notification,
} from "@/lib/notifications/store";
import {
  notificationIcon,
  notificationTint,
} from "@/lib/notifications/visuals";

const MAX_VISIBLE = 6;

// Clip a description to its first N words, appending an ellipsis when it
// runs longer (e.g. "العرض BIM Capital جاهز للعرض، اضغط للاطّلاع …").
const DESC_MAX_WORDS = 7;
function truncateWords(text: string, max: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= max) return text;
  return `${words.slice(0, max).join(" ")} …`;
}

export function RecentActivityWidget() {
  const router = useRouter();
  const items = useNotifications();
  const visible = items.slice(0, MAX_VISIBLE);

  // Same behaviour as the bell row: mark read on click, follow the
  // notification's deep link when it has one.
  const handleClick = useCallback(
    (n: Notification) => {
      notificationStore.markRead(n.id);
      if (n.href) router.push(n.href);
    },
    [router],
  );

  return (
    <div className="glass-card flex h-full flex-col rounded-2xl p-5 sm:p-6" dir="rtl">
      <header className="mb-5">
        <h2 className="tq-widget-title">النشاطات الأخيرة</h2>
        <p className="mt-1 text-xs text-muted">آخر التحديثات على حسابك</p>
      </header>

      {visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">
          لا توجد نشاطات بعد — ستظهر هنا التحديثات والتعليقات.
        </p>
      ) : (
        <ul className="flex flex-1 flex-col justify-between">
          {visible.map((n) => {
            const row = (
              <>
                <span
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${notificationTint(n)}`}
                >
                  <span className="material-symbols-outlined text-[20px]">
                    {notificationIcon(n)}
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  {/* Title + time on one row — time pushed to the visual
                      left (the inline end in RTL). */}
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-white">
                      {n.title}
                    </span>
                    <span className="shrink-0 text-[11px] text-white/40">
                      {formatNotificationTime(n.createdAt)}
                    </span>
                  </span>
                  {n.desc ? (
                    <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-muted">
                      {truncateWords(n.desc, DESC_MAX_WORDS)}
                    </span>
                  ) : null}
                </span>
              </>
            );
            return (
              <li key={n.id}>
                {n.href ? (
                  <Link
                    href={n.href}
                    onClick={() => notificationStore.markRead(n.id)}
                    className="flex items-start gap-3 -mx-5 px-5 py-3 no-underline transition-colors hover:bg-white/[0.03] sm:-mx-6 sm:px-6"
                  >
                    {row}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleClick(n)}
                    className="flex items-start gap-3 -mx-5 px-5 py-3 text-right transition-colors hover:bg-white/[0.03] sm:-mx-6 sm:px-6"
                  >
                    {row}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
