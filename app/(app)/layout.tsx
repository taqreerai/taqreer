import { DashboardShell } from "@/components/app/DashboardShell";

export const metadata = {
  title: 'لوحة التحكم | تقرير',
  description: 'إدارة مشاريعك وعروضك التقديمية',
};

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardShell>{children}</DashboardShell>;
}
