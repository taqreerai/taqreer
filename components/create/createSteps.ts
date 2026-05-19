// Single source of truth for the 3-step create flow.
//
// Was 4 steps; "output" (إعدادات الإخراج) merged into step 1 on
// 2026-05-19 — the slide-size / slide-count / generation-rules cards
// became step 1's bottom row, and logo placement moved to step 2's
// logo card. The `taqreer:create:output` sessionStorage key still
// exists (written from step 1, read from summary) so wire-level
// consumers stay unchanged.
//
// Every step is identified by a string id (also serves as the URL
// segment for clarity) and a 1-based number. Routes are absolute
// paths so router.push(step.route) works without further glue.
//
// Order matters — the array index drives the progress bar, the
// stepper's "current" position, and the "is this step done" lookup
// (a step is done iff its sessionStorage key has data).

export type CreateStepId = "content" | "brand" | "summary";

export type CreateStep = {
  id: CreateStepId;
  number: number;
  label: string;
  route: string;
  // sessionStorage key that holds this step's serialised output.
  // Used by the stepper to determine "done" vs "pending" status.
  storageKey: string | null; // null = summary (no own state, just reads earlier keys)
};

export const CREATE_STEPS: ReadonlyArray<CreateStep> = [
  {
    id: "content",
    number: 1,
    label: "إدخال المحتوى",
    route: "/create/content",
    storageKey: "taqreer:create:content",
  },
  {
    id: "brand",
    number: 2,
    label: "الهوية البصرية",
    route: "/create/brand",
    storageKey: "taqreer:create:brand",
  },
  {
    id: "summary",
    number: 3,
    label: "مراجعة الملخص",
    route: "/create/summary",
    storageKey: null,
  },
];

// Convenience lookup — fails loud (throws) if a caller passes an id
// that isn't in the step list, so a typo doesn't silently render an
// undefined step.
export function getCreateStep(id: CreateStepId): CreateStep {
  const step = CREATE_STEPS.find((s) => s.id === id);
  if (!step) throw new Error(`Unknown create step: ${id}`);
  return step;
}
