"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useDict } from "@/components/i18n/LocaleProvider";

type DashboardWidgetHeaderProps = {
  title: string;
  href?: string;
  actionLabel?: string;
};

type DashboardEmptyStateProps = {
  icon: string;
  title: string;
  description: string;
  className?: string;
  action?: {
    label: string;
    href: string;
  };
};

export function DashboardWidgetHeader({ title, href, actionLabel }: DashboardWidgetHeaderProps) {
  const dict = useDict();
  const resolvedActionLabel = actionLabel ?? dict.components.dashboardWidget.viewAll;
  return (
    <div className="flex items-center justify-between">
      {/* `.tq-widget-title` is 18 px — smaller than the page-level
          `.tq-h1` (24 px) so widget headers don't compete with the
          page title. Kept as <h2> for semantic structure: these are
          subsection titles. Bottom breathing room is provided by the
          parent `DashboardWidget`'s `space-y-5` so widget headers
          stay visually anchored to their content row. */}
      <h2 className="tq-widget-title">{title}</h2>
      {href ? (
        <Link className="tq-widget-link no-underline" href={href}>
          {resolvedActionLabel}
        </Link>
      ) : null}
    </div>
  );
}

export function DashboardEmptyState({ icon, title, description, className = "", action }: DashboardEmptyStateProps) {
  return (
    <div className={`surface-empty-state flex flex-col items-center justify-center py-10 px-6 text-center min-h-[160px] ${className}`}>
      <span className="material-symbols-outlined text-[26px] text-muted/40 mb-3">{icon}</span>
      <h3 className="text-sm font-semibold text-foreground mb-1">{title}</h3>
      <p className="text-xs text-muted leading-6 max-w-[220px]">
        {description}
      </p>
      {action ? (
        <Link className="btn-gradient px-4 py-1.5 text-xs mt-4 inline-block no-underline" href={action.href}>
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

export function DashboardWidget({ children }: { children: ReactNode }) {
  // `space-y-6` (24 px) — one step on the 8pt grid above the previous
  // 20 px. Cleaner label→content hierarchy under the 18 px widget
  // header glyph. The earlier 20 px sat at an awkward in-between
  // value (not on the 8pt scale); 24 px aligns the widget rhythm
  // with the page-level `space-y-16` cadence wrapping the section.
  return <section className="space-y-6">{children}</section>;
}
