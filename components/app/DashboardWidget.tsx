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
  action?: {
    label: string;
    href: string;
  };
};

export function DashboardWidgetHeader({ title, href, actionLabel = "عرض الكل" }: DashboardWidgetHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-6">
      <h2 className="font-headline-lg text-[32px] font-bold text-on-surface">{title}</h2>
      {href ? (
        <Link className="text-primary hover:text-primary-container font-label-lg transition-colors" href={href}>
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

export function DashboardEmptyState({ icon, title, description, action }: DashboardEmptyStateProps) {
  return (
    <div className="glass-card rounded-xl p-8 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        <span className="material-symbols-outlined text-[28px]">{icon}</span>
      </div>
      <h3 className="mb-2 text-[20px] font-bold text-on-surface">{title}</h3>
      <p className="mx-auto max-w-md text-sm leading-relaxed text-on-surface-variant">
        {description}
      </p>
      {action ? (
        <Link className="btn-gradient mt-6 inline-flex px-6 py-3 no-underline" href={action.href}>
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

export function DashboardWidget({ children }: { children: ReactNode }) {
  return <section>{children}</section>;
}
