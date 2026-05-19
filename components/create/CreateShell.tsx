"use client";

// Shared layout shell for the 3-step create flow. Each create page
// renders its own content inside <CreateShell currentStep="...">.
// The shell handles:
//   • Left rail — <CreateStepper /> (visual progress, not clickable).
//   • Content slot — children render in the remaining column.
//
// CRITICAL LAYOUT INVARIANT (2026-05-19):
// All three steps render at the SAME min-height so the Next /
// Previous buttons land at the same vertical position across the
// flow. Without this, step 1's two-row card grid is taller than
// step 2's, and step 3 is shorter — every navigation tick would
// visibly shift the page and the buttons. Pages push their button
// bar to the column bottom with `mt-auto`. The stepper
// (`self-stretch`) inherits the same height so خطوات الإعداد is
// also constant.
//
// Pages are responsible for their OWN bottom row (Next / Previous /
// custom CTAs) since the buttons + their disabled state are step-
// specific. The shell just provides the surrounding chrome.

import { CreateStepper } from "./CreateStepper";
import { type CreateStepId } from "./createSteps";

export function CreateShell({
  currentStep,
  title,
  subtitle,
  children,
}: {
  currentStep: CreateStepId;
  // Title + subtitle for the current step. Shown in the content
  // column above the page's main UI so every page reads the same.
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    // `min-h-[810px]` matches step 2 (the brand page)'s natural
    // height — the reference for this flow. Step 1 is compacted so
    // its natural height stays under 810; step 3 expands up to the
    // floor via the `mt-auto` push of its button bar. Result: the
    // Next / Previous buttons sit at the same viewport-Y on every
    // step, and خطوات الإعداد (via `self-stretch`) is also constant.
    <section
      dir="rtl"
      className="flex min-h-[810px] flex-row-reverse gap-4"
    >
      {/* Left rail (visually-right in RTL since the row uses
          `flex-row-reverse`). Stepper is always 260 px wide; the
          content column flexes to fill the rest. */}
      <CreateStepper currentStep={currentStep} />

      {/* Main content column — title + subtitle + page-specific
          children. `min-w-0` so flex children can shrink instead
          of pushing the row past the viewport. `pt-5` on the header
          matches the stepper's own `p-5` panel padding so the page
          step title ("ما هو موضوع عرضك...") and the stepper's
          "خطوات الإعداد" title sit at the same top edge. Pages
          add `mt-auto` to their button-row wrapper to push it to
          the column bottom regardless of card height. `gap-4` is
          the single inter-block gap shared across every step (in-
          row card grids use the same `gap-4`). */}
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <header className="pt-5">
          <h1 className="font-headline-lg text-[32px] font-bold text-white">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-2 text-sm text-[#9A94A8]">{subtitle}</p>
          ) : null}
        </header>
        {children}
      </div>
    </section>
  );
}
