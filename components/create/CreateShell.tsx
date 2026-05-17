"use client";

// Shared layout shell for the 4-step create flow. Each create page
// renders its own content inside <CreateShell currentStep="...">.
// The shell handles:
//   • Left rail — <CreateStepper /> (visual progress, not clickable).
//   • Content slot — children render in the remaining column.
//
// No top strip — the cancel/return + progress info both came at the
// cost of vertical space on a flow that's already content-heavy.
// Cancel goes through the sidebar's home link; progress through the
// left stepper.
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
    <section dir="rtl" className="flex flex-row-reverse gap-6">
      {/* Left rail (visually-right in RTL since the row uses
          `flex-row-reverse`). Stepper is always 260 px wide; the
          content column flexes to fill the rest. */}
      <CreateStepper currentStep={currentStep} />

      {/* Main content column — title + subtitle + page-specific
          children. `min-w-0` so flex children can shrink instead
          of pushing the row past the viewport. */}
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <header>
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
