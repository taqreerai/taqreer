// Admin console layout. Gates on User.role === "admin" (requireAdminPage 404s
// everyone else), then renders the English/LTR shell + tab nav. The console is
// an internal ops tool: English only, dark only, forced LTR (see adminpanel.md).

import { requireAdminPage } from "@/lib/api/admin-context";
import { AdminTabs } from "@/components/admin/AdminTabs";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminPage();

  return (
    <div dir="ltr" className="space-y-6 md:space-y-8">
      <header className="space-y-4">
        <div className="space-y-1">
          <h1
            className="text-2xl font-bold"
            style={{ color: "var(--tq-text-primary)" }}
          >
            Admin
          </h1>
          <p className="text-sm" style={{ color: "var(--tq-text-muted)" }}>
            Internal ops console - templates, users, credits, and broadcasts.
          </p>
        </div>
        <AdminTabs />
      </header>
      {children}
    </div>
  );
}
