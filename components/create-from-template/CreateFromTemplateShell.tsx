"use client";

// Layout shell for the 2-step create-from-template flow. Mirrors
// CreateShell from the normal flow with one swap: the left-rail
// stepper is the 2-step CreateFromTemplateStepper (which also hosts
// the "from template" pill at its top so the cards column aligns
// flush with the pill's top edge — no vertical offset between rail
// and cards).
//
// Every other piece (header, cards section, bottom bar inset,
// min-height) matches CreateShell so both flows feel visually
// uniform.

import {
  CreateFromTemplateStepper,
  CREATE_FROM_TEMPLATE_STEPPER_WIDTH,
  type CreateFromTemplateStepId,
} from "./CreateFromTemplateStepper";

// Min cards-section height — same value as the normal CreateShell so
// step 1 and step 2 of either flow share the visual rhythm.
const CARDS_MIN_H_PX = 640;
const BOTTOM_BAR_INSET_REM = `calc(${CREATE_FROM_TEMPLATE_STEPPER_WIDTH}px + 1rem)`;

export function CreateFromTemplateShell({
  currentStep,
  title,
  subtitle,
  templateTitle,
  children,
  bottomBar,
}: {
  currentStep: CreateFromTemplateStepId;
  title: string;
  subtitle?: string;
  // Title of the template that seeded this flow. Drives the pill at
  // the top of the cards column. Required — if the consumer doesn't
  // have one, they shouldn't be in this shell.
  templateTitle: string;
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
        <CreateFromTemplateStepper
          currentStep={currentStep}
          templateTitle={templateTitle}
        />
        {/* Cards column — top edge aligns with the stepper's top
            edge (= pill top) since the pill now lives inside the
            stepper aside. No pill rendered here. */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {children}
        </div>
      </section>

      <div dir="rtl" style={{ paddingInlineEnd: BOTTOM_BAR_INSET_REM }}>
        {bottomBar}
      </div>
    </div>
  );
}
