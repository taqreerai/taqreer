"use client";

// Layout shell for the 2-step Enhance flow. Mirrors CreateShell +
// CreateFromTemplateShell — same chrome, same min cards-section
// height, just wires in EnhanceStepper (2 steps: content + summary)
// instead of CREATE_STEPS (3 steps).

import {
  EnhanceStepper,
  ENHANCE_STEPPER_WIDTH,
  type EnhanceStepId,
} from "./EnhanceStepper";

// Min cards-section height — same value as CreateShell so step 1
// and step 2 share the visual rhythm with the create flow.
const CARDS_MIN_H_PX = 640;
const BOTTOM_BAR_INSET_REM = `calc(${ENHANCE_STEPPER_WIDTH}px + 1rem)`;

export function EnhanceShell({
  currentStep,
  title,
  subtitle,
  fileName,
  children,
  bottomBar,
}: {
  currentStep: EnhanceStepId;
  title: string;
  subtitle?: string;
  // Optional source filename — drives the pill at the top of the
  // stepper aside ("تحسين عرض: my-deck.pptx").
  fileName?: string;
  children: React.ReactNode;
  bottomBar: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="tq-h1">{title}</h1>
        {subtitle ? <p className="tq-subhead">{subtitle}</p> : null}
      </header>

      <section
        dir="rtl"
        className="flex flex-row-reverse gap-4"
        style={{ minHeight: `${CARDS_MIN_H_PX}px` }}
      >
        <EnhanceStepper currentStep={currentStep} fileName={fileName} />
        <div className="flex min-w-0 flex-1 flex-col gap-4">{children}</div>
      </section>

      <div dir="rtl" style={{ paddingInlineEnd: BOTTOM_BAR_INSET_REM }}>
        {bottomBar}
      </div>
    </div>
  );
}
