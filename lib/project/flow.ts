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

// The canonical flow set INCLUDING social (which every deck store speaks now).
export type DeckFlow = BrandKitTargetFlow | "social";

// The flow a COMPLETED deck belongs to. Social is EVENT-driven (it carries no
// source kind, so sourceKindToFlow alone would fall through to "create" and
// clobber Project.type on completion); every other flow is derived from the
// source kind. Read the event type FIRST, then fall back to the source mapper.
export function deckFlowFor(
  eventType: string | null | undefined,
  sourceKind: string | null | undefined,
): DeckFlow {
  if (eventType === "social") return "social";
  return sourceKindToFlow(sourceKind);
}
