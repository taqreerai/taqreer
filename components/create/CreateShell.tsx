"use client";

// Shared layout shell for the 4-step create flow. Each create page
// renders its own content inside <CreateShell currentStep="...">.
// The shell handles:
//   • Top strip — page title, progress bar + "الخطوة N من 4", and a
//     "إلغاء والعودة" exit that returns to /dashboard (clears any
//     in-progress sessionStorage).
//   • Left rail — <CreateStepper /> (clickable on done steps).
//   • Content slot — children render in the remaining column.
//
// Pages are responsible for their OWN bottom row (Next / Previous /
// custom CTAs) since the buttons + their disabled state are step-
// specific. The shell just provides the surrounding chrome.

import Link from "next/link";
import { CreateStepper, CREATE_STEPPER_WIDTH } from "./CreateStepper";
import {
  CREATE_STEPS,
  getCreateStep,
  type CreateStepId,
} from "./createSteps";

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
  const step = getCreateStep(currentStep);
  const totalSteps = CREATE_STEPS.length;
  const percent = Math.round((step.number / totalSteps) * 100);

  return (
    <section dir="rtl" className="flex flex-col gap-6">
      <CreateProgressStrip
        stepNumber={step.number}
        total={totalSteps}
        percent={percent}
      />

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

// Top-of-page strip — gradient progress bar + step counter on the
// start side (right in RTL), "إلغاء والعودة" on the end side.
function CreateProgressStrip({
  stepNumber,
  total,
  percent,
}: {
  stepNumber: number;
  total: number;
  percent: number;
}) {
  return (
    <div className="flex items-center justify-between gap-6">
      <Link
        href="/dashboard"
        // Cancel + return — clears every create-flow sessionStorage
        // key so the next session starts clean. Plain anchor so the
        // browser handles the navigation (no router.push race with
        // sessionStorage.clear).
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
        <span
          className="material-symbols-outlined"
          style={{ fontSize: "18px" }}
        >
          arrow_forward
        </span>
        إلغاء والعودة
      </Link>

      <div className="flex flex-1 items-center gap-4 justify-self-end">
        <div className="progress-track flex-1" role="progressbar"
             aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="progress-bar" style={{ width: `${percent}%` }} />
        </div>
        <span className="whitespace-nowrap text-sm text-white/60">
          الخطوة {toArabicNumeral(stepNumber)} من {toArabicNumeral(total)}
        </span>
      </div>
    </div>
  );
}

// Replace ASCII digits with Arabic-Indic ones so the step counter
// matches the rest of the create flow's Arabic numerals.
function toArabicNumeral(n: number): string {
  return String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
}
