// Single source of truth for the 4-step create flow.
//
// Every step is identified by a string id (also serves as the URL
// segment for clarity) and a 1-based number. Routes are absolute
// paths so router.push(step.route) works without further glue.
//
// Order matters — the array index drives the progress bar, the
// stepper's "current" position, and the "is this step done" lookup
// (a step is done iff its sessionStorage key has data).

export type CreateStepId = "content" | "brand" | "output" | "summary";

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
    id: "output",
    number: 3,
    label: "إعدادات الإخراج",
    route: "/create/output",
    storageKey: "taqreer:create:output",
  },
  {
    id: "summary",
    number: 4,
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
