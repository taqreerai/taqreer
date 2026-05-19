"use client";

// Shared layout shell for the 3-step create flow. Each create page
// renders its content inside <CreateShell currentStep="...">.
//
// Layout (top → bottom of the outer column):
//   • Page header (title + subtitle) — spans full width.
//   • Row: stepper + content column (cards + button bar).
//
// The header is OUTSIDE the stepper section so the stepper's top
// edge aligns with the cards' top edge — not with the page title.
// Bottom of the stepper still matches the column bottom (i.e. the
// button row) via `self-stretch` on the aside.
//
// All three pages target the same min-h on the section so the Next
// / Previous buttons land at identical viewport-Y across navigations.

import { CreateStepper } from "./CreateStepper";
import { type CreateStepId } from "./createSteps";

export function CreateShell({
  currentStep,
  title,
  subtitle,
  children,
}: {
  currentStep: CreateStepId;
  // Title + subtitle for the current step. Shown ABOVE the stepper
  // section so the stepper aside aligns with the cards, not the
  // header.
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* Header sits OUTSIDE the stepper section — moved here on
          2026-05-19 so the stepper's top edge aligns with the cards'
          top edge instead of the page title. */}
      <header>
        <h1 className="font-headline-lg text-[32px] font-bold text-white">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-2 text-sm text-[#9A94A8]">{subtitle}</p>
        ) : null}
      </header>

      {/* Stepper + content row. `min-h-[740px]` matches the cards
          area's natural height (step 2 reference, header excluded
          since it's now above) so the button bar lands at the same
          viewport-Y across all three steps. */}
      <section
        dir="rtl"
        className="flex min-h-[740px] flex-row-reverse gap-4"
      >
        <CreateStepper currentStep={currentStep} />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {children}
        </div>
      </section>
    </div>
  );
}
