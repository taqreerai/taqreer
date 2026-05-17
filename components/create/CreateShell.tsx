"use client";

// Shared layout shell for the 4-step create flow. Each create page
// renders its own content inside <CreateShell currentStep="...">.
// The shell handles:
//   • Top strip — single "إلغاء والعودة" exit that returns to
//     /dashboard (clears any in-progress sessionStorage). The
//     progress bar + counter were dropped — the left-rail stepper
//     already shows the same information without competing for the
//     top of the page.
//   • Left rail — <CreateStepper /> (visual progress, not clickable).
//   • Content slot — children render in the remaining column.
//
// Pages are responsible for their OWN bottom row (Next / Previous /
// custom CTAs) since the buttons + their disabled state are step-
// specific. The shell just provides the surrounding chrome.

import Link from "next/link";
import { CreateStepper } from "./CreateStepper";
import { type CreateStepId } from "./createSteps";

// Storage keys to clear on "exit + cancel" — every key the create
// flow writes. Keeping the list here means future steps that add a
// new key only have to extend this constant.
const CREATE_STORAGE_KEYS = [
  "taqreer:create:content",
  "taqreer:create:brand",
  "taqreer:create:brand:savedSnapshot",
  "taqreer:create:output",
];

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
    <section dir="rtl" className="flex flex-col gap-4">
      <CancelLink />

      <div className="flex flex-row-reverse gap-6">
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
      </div>
    </section>
  );
}

// Cancel + return — clears every create-flow sessionStorage key so
// the next session starts clean. Plain anchor so the browser handles
// the navigation (no router.push race with sessionStorage.clear).
// Sits on the start side (RTL → right) of the page above the stepper.
function CancelLink() {
  return (
    <div className="flex items-center justify-start">
      <Link
        href="/dashboard"
        onClick={() => {
          if (typeof window === "undefined") return;
          for (const key of CREATE_STORAGE_KEYS) {
            try {
              window.sessionStorage.removeItem(key);
            } catch {
              /* storage blocked — best effort */
            }
          }
        }}
        className="inline-flex items-center gap-1.5 text-sm text-white/60 transition-colors hover:text-white"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          arrow_forward
        </span>
        إلغاء والعودة
      </Link>
    </div>
  );
}
