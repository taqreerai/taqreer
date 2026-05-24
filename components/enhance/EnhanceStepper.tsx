"use client";

// Left-rail stepper for the 2-step Enhance flow.
//
// Mirrors CreateFromTemplateStepper structurally (same glass card,
// same dot/pill vocabulary, same state-change event subscription)
// but with the Enhance flow's 2-step list hardcoded:
//   1. الإعداد (content + logo + palette in one step)
//   2. مراجعة الملخص (review + submit)
// The brand step is absent per 2026-05-25 user direction — palette
// + logo now live on step 1.
//
// Kept as a separate component (not a steps-prop on CreateStepper)
// to honor the "normal create flow stays untouched" rule.

import { useEffect, useState } from "react";

export const ENHANCE_STEPPER_WIDTH = 260;
const STATE_REFRESH_EVENT = "taqreer:create:state-changed";

export type EnhanceStepId = "content" | "summary";

type StepDescriptor = {
  id: EnhanceStepId;
  number: number;
  label: string;
  storageKey: string | null;
};

// Storage keys match the canonical ones the create flow uses —
// /enhance/content writes `taqreer:create:content` (a stub) +
// `taqreer:create:source` so the stepper's "done" detection works.
const STEPS: ReadonlyArray<StepDescriptor> = [
  {
    id: "content",
    number: 1,
    label: "الإعداد",
    storageKey: "taqreer:create:content",
  },
  {
    id: "summary",
    number: 2,
    label: "مراجعة الملخص",
    storageKey: null,
  },
];

function readDoneSteps(): Set<EnhanceStepId> {
  const done = new Set<EnhanceStepId>();
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

export function EnhanceStepper({
  currentStep,
  fileName,
}: {
  currentStep: EnhanceStepId;
  // Optional file label shown in a pill at the TOP of the aside —
  // mirrors the "from template" pill pattern. Hidden until a file
  // is uploaded.
  fileName?: string;
}) {
  const [doneSet, setDoneSet] = useState<Set<EnhanceStepId>>(
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
      aria-label="خطوات التحسين"
      className="backdrop-blur-glass relative flex flex-none flex-col gap-5 self-stretch rounded-2xl border p-5"
      style={{
        width: ENHANCE_STEPPER_WIDTH,
        background: "var(--tq-bg-glass)",
        borderColor: "var(--tq-border-glass)",
      }}
    >
      {/* Enhance pill — mirrors the "from template" pattern. Anchors
          at the top so the cards column's first card aligns with
          the pill's top edge. */}
      <div
        className="inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium text-white"
        style={{
          background: "var(--tq-bg-glass)",
          borderColor: "var(--tq-border-glass)",
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 14 }}
          aria-hidden
        >
          auto_fix_high
        </span>
        <span className="text-white/60">تحسين عرض</span>
        {fileName ? (
          <span className="max-w-[140px] truncate text-white/80">
            : {fileName}
          </span>
        ) : null}
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
            : "var(--tq-bg-glass)",
        borderColor:
          state === "done"
            ? "rgba(16, 185, 129, 0.3)"
            : "var(--tq-border-glass)",
      }}
    >
      {label}
    </span>
  );
}
