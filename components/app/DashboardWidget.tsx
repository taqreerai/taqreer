import Link from "next/link";
import type { ReactNode } from "react";

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

export function DashboardWidgetHeader({ title, href, actionLabel = "عرض الكل" }: DashboardWidgetHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="tq-widget-title">{title}</h2>
      {href ? (
        <Link className="tq-widget-link no-underline" href={href}>
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

export function DashboardEmptyState({ icon, title, description, className = "", action }: DashboardEmptyStateProps) {
  return (
    <div className={`glass-empty-state flex flex-col items-center justify-center py-10 px-6 text-center min-h-[160px] ${className}`}>
      <span className="material-symbols-outlined text-[26px] text-muted/40 mb-3">{icon}</span>
      <h3 className="text-sm font-semibold text-white mb-1">{title}</h3>
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
  return <section className="space-y-3">{children}</section>;
}
