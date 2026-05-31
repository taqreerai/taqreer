"use client";

// Dashboard widget: "أحدث المشاريع" (Recent Projects) — a table-style
// card mirroring the reference "Recent Orders" layout: title + subtitle
// inside the card, a muted column-header row, then generously-spaced rows
// (ProjectTableRow) carrying thumbnail + title/orientation, date, status,
// points, and a 3-dots actions menu.
//
// Client component so it can own the optimistic-delete set + router
// refresh (a row trashed via its 3-dots menu disappears instantly while
// the SSR query backfills the next project). RTL: `dir="rtl"`.

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  GENERATION_COLS,
  ProjectTableRow,
} from "@/components/app/ProjectTableRow";

export type GenerationItem = {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  /** ISO timestamp. */
  createdAt: string;
  /** Project status: completed | generating | queued | failed | cancelled. */
  status: string;
  /** Generation flow = `Project.type` (create | enhance | mimic | datasheet).
   *  Shown under the title. */
  type?: string;
  isFavorite?: boolean;
  /** Points spent. Optional until the points model lands — the row
   *  supplies a static per-index placeholder when omitted. */
  points?: number;
};

const MAX_VISIBLE = 6;

export function RecentGenerationWidget({
  generations,
}: {
  generations: GenerationItem[];
}) {
  const router = useRouter();
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());

  const visible = generations
    .filter((g) => !deletedIds.has(g.id))
    .slice(0, MAX_VISIBLE);

  const handleDeleted = (id: string) => {
    setDeletedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    router.refresh();
  };

  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6" dir="rtl">
      <header className="mb-5 flex items-start justify-between">
        <div>
          <h2 className="tq-widget-title">أحدث المشاريع</h2>
          <p className="mt-1 text-xs text-muted">آخر المشاريع التي أنشأتها</p>
        </div>
        <Link className="tq-widget-link no-underline" href="/projects">
          عرض الكل
        </Link>
      </header>

      {visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">
          لا توجد مشاريع بعد — أنشئ أول عرض وسيظهر هنا.
        </p>
      ) : (
        <>
          <div
            className={`${GENERATION_COLS} -mx-5 px-5 pb-2.5 text-xs text-muted sm:-mx-6 sm:px-6 border-b border-white/[0.06]`}
          >
            <span>المشروع</span>
            <span className="text-right">التاريخ</span>
            <span className="text-right">الحالة</span>
            <span className="text-right">الاستخدام</span>
            <span aria-hidden />
          </div>

          <div className="divide-y divide-white/[0.04]">
            {visible.map((g, i) => (
              <ProjectTableRow
                key={g.id}
                item={g}
                index={i}
                onDeleted={handleDeleted}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
