import type { BrandKitTargetFlow } from "@/lib/create/seed-from-brand-kit";

// Single source of truth for the "which flow produced this deck"
// translation. The generation event speaks `FlowSourceKind`
// ("scratch" | "enhance" | "mimic" | "data") while everything
// user-facing — `Project.type`, the dashboard label, the notification
// icon/title — speaks the canonical `BrandKitTargetFlow`
// ("create" | "enhance" | "mimic" | "datasheet").
//
// This mapper is idempotent: passing a canonical value back returns it
// unchanged, so callers can normalize EITHER vocabulary (e.g. the
// notification route handles both new canonical payloads and older raw
// ones). Keep this the ONLY place the `scratch↔create` / `data↔datasheet`
// rename lives.
export function sourceKindToFlow(
  kind: string | null | undefined,
): BrandKitTargetFlow {
  switch (kind) {
    case "enhance":
      return "enhance";
    case "mimic":
      return "mimic";
    case "data":
    case "datasheet":
      return "datasheet";
    default:
      // "scratch" | "create" | unknown
      return "create";
  }
}
