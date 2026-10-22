"use client";

// ChangeLevelPanel - Enhance's "how much to change" choice (owner, 2026-10-22).
// Auto (default) follows the file's analysis (lib/extract/rework-score.ts),
// which the server applies at generation, so a signed-out visitor needs
// nothing computed here; Keep exact is the classic 1:1 redesign; Redesign
// freely keeps the essence and may restructure. The line under the control
// says what Auto picked (or that it decides after the file is read); the info
// tip explains the three options.

import { SegmentedToggle } from "@/components/create/controls";
import { useDict } from "@/components/i18n/LocaleProvider";
import { Tooltip } from "@/components/common/Tooltip";
import type { ReworkDecision } from "@/lib/extract/rework-score";

export type ChangeLevel = "auto" | "keep" | "rework";

export function ChangeLevelPanel({
  value,
  onChange,
  decision,
  disabled = false,
}: {
  value: ChangeLevel;
  onChange: (v: ChangeLevel) => void;
  // The file's analysis; null until it is read (a visitor's file waits).
  decision: ReworkDecision | null;
  disabled?: boolean;
}) {
  const dict = useDict();
  const copy = dict.flows.brand;
  const hint =
    value === "auto"
      ? decision
        ? copy.changeLevelAuto
            .replace("{mode}", copy.changeLevelModes[decision.mode])
            .replace("{reason}", copy.reworkReasons[decision.reason])
        : copy.changeLevelAutoPending
      : copy.changeLevelHints[value];
  return (
    <div className={`flex flex-col gap-2 ${disabled ? "pointer-events-none opacity-50" : ""}`}>
      <div className="flex items-center gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--tq-overlay-soft)] text-foreground/55"
          aria-hidden
        >
          <span className="material-symbols-outlined leading-none" style={{ fontSize: 22 }}>
            tune
          </span>
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1 text-xs font-semibold leading-4 text-foreground/70">
          {copy.changeLevelTitle}
          <Tooltip label={copy.changeLevelInfo} placement="top" multiline>
            <span
              className="material-symbols-outlined cursor-help leading-none text-foreground/40 hover:text-foreground/70"
              style={{ fontSize: 15 }}
              tabIndex={0}
              aria-label={copy.changeLevelInfo}
            >
              info
            </span>
          </Tooltip>
        </span>
      </div>
      <SegmentedToggle<ChangeLevel>
        ariaLabel={copy.changeLevelTitle}
        value={value}
        onChange={onChange}
        size="comfortable"
        fullWidth
        options={[
          { value: "auto", label: copy.changeLevelOptions.auto },
          { value: "keep", label: copy.changeLevelOptions.keep },
          { value: "rework", label: copy.changeLevelOptions.rework },
        ]}
      />
      <span className="text-[11px] leading-4 text-foreground/50">{hint}</span>
    </div>
  );
}
