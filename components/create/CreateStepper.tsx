"use client";

// Left-rail stepper for the 4-step create flow.
//
// Glass-card panel docked on the start side (right in RTL) of every
// create page. PURELY VISUAL — no click navigation; the only way
// between steps is the Next / Previous CTAs at the bottom of each
// page. The stepper just communicates where the user is in the flow.
//
// Each step has three visual states driven by data:
//   • done    — the step's sessionStorage key has a non-empty payload
//                AND it's not the currently-rendered step.
//                Renders a filled check disc + "مكتمل" pill.
//   • current — the page we're rendering. Filled brand-tinted disc
//                + "قيد الإجراء" pill.
//   • pending — neither current nor done. Hollow disc + "قادم" pill.
//
// State is read directly from `sessionStorage` on mount and re-read
// on every "create-flow:state" custom event so the stepper updates
// when a sibling page writes its key (e.g. user clicks Next on
// content — the brand page's mount re-reads and shows step 1 done).
//
// Width is fixed at 260 px to match the preview's slide-nav so the
// app's right-rail visual rhythm stays consistent across screens.

import { useEffect, useState } from "react";
import { CREATE_STEPS, type CreateStep, type CreateStepId } from "./createSteps";

export const CREATE_STEPPER_WIDTH = 260;
const STATE_REFRESH_EVENT = "taqreer:create:state-changed";

// Read which steps have payloads in sessionStorage. Returns a Set of
// done step ids. Pure function — safe to call from useEffect.
function readDoneSteps(): Set<CreateStepId> {
  const done = new Set<CreateStepId>();
  if (typeof window === "undefined") return done;
  for (const step of CREATE_STEPS) {
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

// Notify other create pages that the user just wrote (or cleared)
// step data. Lets the stepper refresh its done-set without polling.
// Pages call this AFTER they sessionStorage.setItem(step.storageKey, ...).
export function notifyCreateStateChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(STATE_REFRESH_EVENT));
}

export function CreateStepper({ currentStep }: { currentStep: CreateStepId }) {
  const [doneSet, setDoneSet] = useState<Set<CreateStepId>>(() => new Set());

  // Hydrate on mount (sessionStorage is client-only). Also listen for
  // the cross-page state-change event + the storage event (cross-tab).
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

  const stateOf = (step: CreateStep): "current" | "done" | "pending" => {
    if (step.id === currentStep) return "current";
    if (doneSet.has(step.id)) return "done";
    return "pending";
  };

  return (
    <aside
      dir="rtl"
      aria-label="خطوات الإعداد"
      // Glass card primitives (no `.glass-card` because the hover
      // transition on that class is for actionable surfaces; the
      // stepper itself is static, only its rows are clickable).
      // `self-stretch` makes the panel match the content column's
      // full height (cards + nav button row); without it the aside
      // shrinks to its content (3 short rows) and visually looks
      // detached from the cards next to it.
      className="backdrop-blur-glass relative flex flex-none flex-col gap-5 self-stretch rounded-2xl border p-5"
      style={{
        width: CREATE_STEPPER_WIDTH,
        background: "rgba(255, 255, 255, var(--glass-opacity))",
        borderColor: "rgba(255, 255, 255, var(--glass-border-opacity))",
      }}
    >
      <h2 className="text-base font-semibold text-white">خطوات الإعداد</h2>

      {/* Wrapper carries `position: relative` so the connector <span>
          can live as a sibling of the <ol> (not a child of it — <ol>
          must contain only <li>) while still anchoring against the
          rows visually. */}
      <div className="relative">
        {/* Continuous vertical connector behind the dots — sits at
            the same horizontal position as the dot centres. RTL uses
            `right` so visual-right anchoring matches the dot column
            (which lives at the start side of each row). */}
        <span
          aria-hidden
          className="absolute top-2 bottom-2 w-px bg-white/[0.08]"
          style={{ right: "calc(0.625rem - 0.5px)" }}
        />

        <ol className="flex flex-col gap-5">
          {CREATE_STEPS.map((step) => {
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

// Step dot — visual indicator on the start side of each row. Sits
// over the vertical connector line; its `background` matches the
// stepper panel so the line disappears under the dot.
function StepDot({ state }: { state: "current" | "done" | "pending" }) {
  if (state === "done") {
    return (
      <span
        className="relative z-10 flex h-5 w-5 flex-none items-center justify-center rounded-full text-white"
        style={{ background: "var(--tq-violet)" }}
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
        style={{ background: "var(--tq-violet)" }}
      >
        <span className="h-2 w-2 rounded-full bg-white" />
      </span>
    );
  }
  // pending — hollow ring on the panel's own background colour so it
  // covers the vertical connector cleanly.
  return (
    <span
      className="relative z-10 flex h-5 w-5 flex-none items-center justify-center rounded-full border border-white/20"
      style={{ background: "rgba(3, 3, 13, 0.6)" }}
    />
  );
}

// Step pill — tiny status chip below the row label. Uses the same
// glass-pill chrome family as `.btn-pill` in globals.css; we set the
// variant-specific colour via inline style so this stays a single
// reusable shape across all 4 steps.
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
