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

// Human labels for each flow. The ONE place admin surfaces (decks list badge,
// activity/stats feeds) read from, so a new flow shows up everywhere at once.
export const DECK_FLOW_LABEL: Record<string, string> = {
  create: "Create",
  enhance: "Enhance",
  mimic: "Mimic",
  datasheet: "Datasheet",
  social: "Social",
};

// Narrow an arbitrary stored string to a known DeckFlow (defaults to "create").
export function toDeckFlow(value: string | null | undefined): DeckFlow {
  return value === "enhance" ||
    value === "mimic" ||
    value === "datasheet" ||
    value === "social"
    ? value
    : "create";
}

// The flow a COMPLETED deck belongs to. Trust a recognized NON-create event
// type first: social is event-driven (no source kind), and a completed deck's
// Project.type already IS its flow even when the brief's source kind is missing
// or legacy (e.g. an old mimic/datasheet deck whose aiPrompt predates stored
// source.kind - passing sourceKind alone would mislabel it "create"). Only when
// the event type is create/unknown do we fall back to the source-kind mapper.
export function deckFlowFor(
  eventType: string | null | undefined,
  sourceKind: string | null | undefined,
): DeckFlow {
  const fromType = toDeckFlow(eventType);
  if (fromType !== "create") return fromType;
  return sourceKindToFlow(sourceKind);
}
