// Canonical flow-card metadata shared by the dialog flow pickers
// (`UseBrandKitDialog`, `NewProjectDialog`). Mirrors — and must stay
// in sync with — the dashboard `QuickActions` tiles: same icon +
// Arabic title + desc + slug for each of the four landing flows.
//
// Kept here (not in `lib/create/seed-from-brand-kit.ts`) so the
// seed library stays pure logic — this file is UI copy only.

import type { BrandKitTargetFlow } from "@/lib/create/seed-from-brand-kit";

export type BrandFlowCard = {
  flow: BrandKitTargetFlow;
  icon: string;
  title: string;
  desc: string;
};

export const BRAND_FLOW_CARDS: BrandFlowCard[] = [
  {
    flow: "create",
    icon: "add_circle",
    title: "إنشاء عرض جديد",
    desc: "ابدأ من الصفر بمحتواك",
  },
  {
    flow: "enhance",
    icon: "auto_fix_high",
    title: "تحسين عرض موجود",
    desc: "ارفع ملفك واحصل على نسخة محسّنة",
  },
  {
    flow: "mimic",
    icon: "content_copy",
    title: "محاكاة أسلوب عرض",
    desc: "انسخ أسلوب عرض آخر وطبّقه",
  },
  {
    flow: "datasheet",
    icon: "dataset",
    title: "إنشاء من بيانات",
    desc: "حوّل ملف Excel إلى عرض احترافي",
  },
];
