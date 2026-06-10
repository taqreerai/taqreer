// Canonical flow-card metadata shared by the dialog flow pickers
// (`UseBrandKitDialog`, `NewProjectDialog`) and the dashboard
// `QuickActions`: icon + slug for each of the four landing flows.
//
// Copy (title/desc) is NOT stored here — it lives in the `quickActions`
// dictionary, resolved per flow in the consuming components (datasheet → the
// `fromData` key). That keeps all three surfaces in sync AND localized.

import type { BrandKitTargetFlow } from "@/lib/create/seed-from-brand-kit";

export type BrandFlowCard = {
  flow: BrandKitTargetFlow;
  icon: string;
};

export const BRAND_FLOW_CARDS: BrandFlowCard[] = [
  { flow: "create", icon: "add_circle" },
  { flow: "enhance", icon: "auto_fix_high" },
  { flow: "mimic", icon: "content_copy" },
  { flow: "datasheet", icon: "dataset" },
];

// Map a flow slug to its `quickActions` dictionary key (datasheet copy lives
// under `fromData`).
export function flowCopyKey(
  flow: BrandKitTargetFlow,
): "create" | "enhance" | "mimic" | "fromData" {
  return flow === "datasheet" ? "fromData" : flow;
}
