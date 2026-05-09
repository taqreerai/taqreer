import { QuickActions } from "@/components/app/QuickActions";
import { RecentProjects } from "@/components/app/RecentProjects";
import { MyTemplates } from "@/components/app/MyTemplates";
import { PlanUsage } from "@/components/app/PlanUsage";

export default function DashboardPage() {
  return (
    <>
      <QuickActions />
      <RecentProjects />
      <MyTemplates />
      <PlanUsage />
    </>
  );
}
