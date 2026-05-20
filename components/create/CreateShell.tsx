"use client";

// Shared layout shell for the 3-step create flow. Each create page
// renders its content inside <CreateShell currentStep="...">.
//
// Layout (top → bottom of the outer column):
//   • Page header (title + subtitle)
//   • Stepper section (stepper + cards) — min-h locked to step 2's
//     natural cards height so every step matches.
//   • Button bar (passed via `bottomBar`) — sits OUTSIDE the stepper
//     section, separated by gap-4. This is what makes the stepper
//     aside stop at the bottom of the cards instead of dangling
//     down to the buttons.
//
// All three steps target the same `CARDS_MIN_H_PX`. Steps that are
// naturally shorter use `flex-1` on a chosen card/row to absorb the
// slack so the cards still visually fill the section — no empty
// bands between rows.

import { CreateStepper, CREATE_STEPPER_WIDTH } from "./CreateStepper";
import { type CreateStepId } from "./createSteps";

// Step 2's natural cards-only height (fonts + gap-4 + colors-logo
// row). The reference value for the whole flow — step 1 + 3 use
// flex-1 on a card/row to grow up to the same height.
const CARDS_MIN_H_PX = 640;
// Inline-start (visual-right in RTL) padding for the button bar
// row so it aligns with the cards column's start edge, NOT the
// stepper's. Without this, the bar would stretch under the
// stepper aside.
const BOTTOM_BAR_INSET_REM = `calc(${CREATE_STEPPER_WIDTH}px + 1rem)`;

export function CreateShell({
  currentStep,
  title,
  subtitle,
  children,
  bottomBar,
}: {
  currentStep: CreateStepId;
  title: string;
  subtitle?: string;
  // Cards content. Lives INSIDE the stepper section so the stepper
  // aside ends at the cards' bottom edge.
  children: React.ReactNode;
  // Page-specific Next / Previous / Generate row. Rendered OUTSIDE
  // the stepper section so its top stays at gap-4 from the cards
  // and the stepper doesn't visually extend down past the cards.
  bottomBar: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <header>
        {/* `.tq-h1` + `.tq-subhead` is the canonical pair: tight
            4 px gap between them + 24 px breathing room below. */}
        <h1 className="tq-h1">{title}</h1>
        {subtitle ? <p className="tq-subhead">{subtitle}</p> : null}
      </header>

      <section
        dir="rtl"
        className="flex flex-row-reverse gap-4"
        style={{ minHeight: `${CARDS_MIN_H_PX}px` }}
      >
        <CreateStepper currentStep={currentStep} />
        <div className="flex min-w-0 flex-1 flex-col gap-4">{children}</div>
      </section>

      {/* Bottom bar sits OUTSIDE the stepper section. Its
          inline-end padding pushes content away from the stepper
          column so the buttons span only the cards column
          horizontally. In this layout the stepper actually sits on
          the visual-LEFT (flex-row-reverse + dir=rtl resolves that
          way), so the inset has to be on inline-end — padding-left
          in RTL — to clear the stepper's column. */}
      <div
        dir="rtl"
        style={{ paddingInlineEnd: BOTTOM_BAR_INSET_REM }}
      >
        {bottomBar}
      </div>
    </div>
  );
}
