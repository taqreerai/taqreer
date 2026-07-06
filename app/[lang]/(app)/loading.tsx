// Neutral group-level fallback for (app) pages WITHOUT their own
// loading.tsx (billing, invoices, usage, plans, admin, use-template, the
// editor). Deliberately shape-agnostic - just the standard page header
// ghost - so it never mimics the wrong page. Pages with a distinct layout
// get their own matching skeleton (dashboard, projects, favorites,
// templates, library, brand-kits, settings). See
// components/app/PageSkeletons.tsx for the conventions.

import { PageHeaderSkeleton } from "@/components/app/PageSkeletons";

export default function AppLoading() {
  return (
    <div className="page-container animate-pulse" aria-hidden="true">
      <PageHeaderSkeleton />
    </div>
  );
}
