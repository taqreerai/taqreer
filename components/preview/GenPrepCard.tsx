"use client";

// What the job has really done so far, shown on the canvas before the first
// slide (owner, 2026-11-05): true steps with real counts, then the plan for this
// deck. Never a fake percentage. Written by deck-generate into progress.prep.

import { useDict } from "@/components/i18n/LocaleProvider";

export type PrepStep = { key: "read" | "pictures" | "text" | "plan"; n?: number };
export type PrepView = { pages: number; steps: PrepStep[]; preview?: string };

export function GenPrepCard({ prep, dir }: { prep: PrepView; dir: "rtl" | "ltr" }) {
  const copy = useDict().editor.progress;
  const line = (s: PrepStep) => {
    const text = { read: copy.prepRead, pictures: copy.prepPictures, text: copy.prepText, plan: copy.prepPlan }[s.key];
    return text.replace("{n}", String(s.n ?? 0));
  };
  const steps = prep.steps.filter((s) => s.key === "plan" || (s.n ?? 0) > 0);
  if (steps.length === 0 && !prep.preview) return null;
  return (
    <div dir={dir} className="surface-card flex w-full max-w-md flex-col gap-2 rounded-xl p-4 text-start">
      {steps.map((s, i) => {
        const running = i === steps.length - 1 && !prep.preview;
        return (
          <div key={s.key} className="flex items-center gap-2 text-sm text-foreground">
            {running ? (
              <span className="spinner h-4 w-4 flex-shrink-0 rounded-full border-2 border-foreground/20 border-t-white" />
            ) : (
              <span className="material-symbols-outlined flex-shrink-0" style={{ fontSize: 16 }}>
                check
              </span>
            )}
            <span>{line(s)}</span>
          </div>
        );
      })}
      {prep.preview ? <p className="border-t border-[var(--tq-border-hairline)] pt-2 text-sm text-muted">{prep.preview}</p> : null}
    </div>
  );
}
