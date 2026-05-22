"use client";

// Left-rail stepper for the 2-step "create from template" flow.
//
// Mirrors CreateStepper structurally (same glass card, same dot/pill
// vocabulary, same state-change event subscription) but with the
// template flow's 2-step list hardcoded — content → summary. The
// brand step is absent because the template supplies colours + fonts
// directly; the logo card relocates to step 1.
//
// Kept as a separate component (not a CreateStepper steps-prop) to
// honour the "normal create flow stays untouched" rule — the original
// CreateStepper hardcodes CREATE_STEPS and we don't add an opt-in
// here.

import { useEffect, useState } from "react";

export const CREATE_FROM_TEMPLATE_STEPPER_WIDTH = 260;
// Same event the normal stepper listens to. Re-used (not forked) so
// notifyCreateStateChange calls from the template content page reach
// both this stepper and any normal-flow stepper that happens to be
// mounted in a separate tab.
const STATE_REFRESH_EVENT = "taqreer:create:state-changed";

export type CreateFromTemplateStepId = "content" | "summary";

type StepDescriptor = {
  id: CreateFromTemplateStepId;
  number: number;
  label: string;
  storageKey: string | null;
};

// Hardcoded 2-step list. Storage keys match the ones the template
// flow pages write — `taqreer:create:content` from step 1, summary
// has no key of its own (mirrors the normal flow's summary step).
const STEPS: ReadonlyArray<StepDescriptor> = [
  {
    id: "content",
    number: 1,
    label: "إدخال المحتوى",
    storageKey: "taqreer:create:content",
  },
  {
    id: "summary",
    number: 2,
    label: "مراجعة الملخص",
    storageKey: null,
  },
];

function readDoneSteps(): Set<CreateFromTemplateStepId> {
  const done = new Set<CreateFromTemplateStepId>();
  if (typeof window === "undefined") return done;
  for (const step of STEPS) {
    if (!step.storageKey) continue;
    try {
      const v = window.sessionStorage.getItem(step.storageKey);
      if (v && v !== "null" && v !== "{}") done.add(step.id);
    } catch {
      /* sessionStorage blocked — leave step not-done */
    }
  }
  return done;
}

export function CreateFromTemplateStepper({
  currentStep,
  templateTitle,
}: {
  currentStep: CreateFromTemplateStepId;
  // Title of the source template. Drives the "إنشاء من قالب: <title>"
  // pill rendered at the TOP of this aside (above the "خطوات الإعداد"
  // heading) on user direction 2026-05-22 — moving it into the
  // stepper keeps the cards column flush with the pill's top edge
  // (no vertical offset between rail + cards).
  templateTitle: string;
}) {
  const [doneSet, setDoneSet] = useState<Set<CreateFromTemplateStepId>>(
    () => new Set(),
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDoneSet(readDoneSteps());
    const sync = () => setDoneSet(readDoneSteps());
    window.addEventListener(STATE_REFRESH_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(STATE_REFRESH_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const stateOf = (
    step: StepDescriptor,
  ): "current" | "done" | "pending" => {
    if (step.id === currentStep) return "current";
    if (doneSet.has(step.id)) return "done";
    return "pending";
  };

  return (
    <aside
      dir="rtl"
      aria-label="خطوات الإعداد"
      className="backdrop-blur-glass relative flex flex-none flex-col gap-5 self-stretch rounded-2xl border p-5"
      style={{
        width: CREATE_FROM_TEMPLATE_STEPPER_WIDTH,
        background: "rgba(255, 255, 255, var(--glass-opacity))",
        borderColor: "rgba(255, 255, 255, var(--glass-border-opacity))",
      }}
    >
      {/* From-template pill — anchors at the top of the aside so the
          cards column's first card aligns with the pill's top edge.
          Non-dismissable; the create flow is fundamentally tied to
          the seeded template. */}
      <div
        className="inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium text-white"
        style={{
          background: "rgba(255, 255, 255, var(--glass-opacity))",
          borderColor: "rgba(255, 255, 255, var(--glass-border-opacity))",
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 14 }}
          aria-hidden
        >
          dashboard_customize
        </span>
        <span className="text-white/60">إنشاء من قالب:</span>
        <span className="max-w-[150px] truncate">{templateTitle}</span>
      </div>

      <h2 className="text-base font-semibold text-white">خطوات الإعداد</h2>

      <div className="relative">
        <span
          aria-hidden
          className="absolute top-2 bottom-2 w-px bg-white/[0.08]"
          style={{ right: "calc(0.625rem - 0.5px)" }}
        />

        <ol className="flex flex-col gap-5">
          {STEPS.map((step) => {
            const state = stateOf(step);
            return (
              <li key={step.id} className="relative">
                <div className="flex w-full items-center gap-3 rounded-lg text-start">
                  <StepDot state={state} />
                  <div className="flex flex-1 flex-col gap-1">
                    <span
                      className={`text-sm font-medium ${
                        state === "pending" ? "text-white/40" : "text-white"
                      }`}
                    >
                      {step.label}
                    </span>
                    <StepPill state={state} />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </aside>
  );
}

function StepDot({ state }: { state: "current" | "done" | "pending" }) {
  if (state === "done") {
    return (
      <span
        className="relative z-10 flex h-5 w-5 flex-none items-center justify-center rounded-full text-white"
        style={{ background: "var(--tq-blue)" }}
      >
        <span
          className="material-symbols-outlined leading-none"
          style={{ fontSize: "14px" }}
        >
          check
        </span>
      </span>
    );
  }
  if (state === "current") {
    return (
      <span
        className="relative z-10 flex h-5 w-5 flex-none items-center justify-center rounded-full"
        style={{ background: "var(--tq-blue)" }}
      >
        <span className="h-2 w-2 rounded-full bg-white" />
      </span>
    );
  }
  return (
    <span
      className="relative z-10 flex h-5 w-5 flex-none items-center justify-center rounded-full border border-white/20"
      style={{ background: "rgba(3, 3, 13, 0.6)" }}
    />
  );
}

function StepPill({ state }: { state: "current" | "done" | "pending" }) {
  const label =
    state === "done" ? "مكتمل" : state === "current" ? "قيد الإجراء" : "قادم";
  const colorClass =
    state === "done"
      ? "text-emerald-300"
      : state === "current"
        ? "text-white"
        : "text-white/40";
  return (
    <span
      className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none ${colorClass}`}
      style={{
        background:
          state === "done"
            ? "rgba(16, 185, 129, 0.12)"
            : "rgba(255, 255, 255, var(--glass-opacity))",
        borderColor:
          state === "done"
            ? "rgba(16, 185, 129, 0.3)"
            : "rgba(255, 255, 255, var(--glass-border-opacity))",
      }}
    >
      {label}
    </span>
  );
}
