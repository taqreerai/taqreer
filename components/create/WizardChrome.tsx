"use client";

// Wizard step rail for the /create flow (stepper chrome re-introduced
// 2026-08-30 by user direction: the Phase 17.D single-shot layout put
// three dense cards + ~12 controls in front of the user at once, which
// read as overwhelming; the flow now presents one card per step).
//
// Presentation-only: the page keeps ALL state and all three cards stay
// MOUNTED (display-toggled, never transform-slid: a transformed
// ancestor becomes the containing block for the position:fixed color /
// brand-kit popovers and would break their placement; unmounting would
// drop the hidden file input and logo blob URLs).
//
// Steps are labelled with the existing card titles (dict.flows.*), so
// the rail introduces no card-name copy of its own. Latin numerals per
// the project rule; layout is logical-flow only so RTL mirrors free.

export function WizardStepRail({
  steps,
  active,
  onJump,
  reachable = active,
}: {
  steps: string[];
  active: number;
  // Fired for any other step up to `reachable` (default: completed steps
  // only, so forward travel goes through Next and gating stays in one place).
  onJump: (i: number) => void;
  // Highest step index the user may jump to (/create: every step once the
  // content is in, 2026-10-06).
  reachable?: number;
}) {
  return (
    <nav className="flex items-center justify-center">
      {steps.map((title, i) => {
        const done = i < active;
        const current = i === active;
        const jumpable = !current && i <= reachable;
        return (
          <div key={title} className="flex items-center">
            {i > 0 && (
              <span
                aria-hidden
                className={`mx-2 h-px w-5 sm:w-8 ${
                  i <= active ? "bg-[var(--tq-blue)]" : "bg-[var(--tq-border-hairline)]"
                }`}
              />
            )}
            <button
              type="button"
              onClick={() => jumpable && onJump(i)}
              disabled={!jumpable}
              aria-current={current ? "step" : undefined}
              className={`flex items-center gap-2 rounded-full py-1 ps-1 pe-2.5 transition-colors ${
                jumpable
                  ? "cursor-pointer hover:bg-[var(--tq-overlay-soft)]"
                  : "cursor-default"
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  current
                    ? "bg-[var(--tq-blue)] text-white"
                    : done
                      ? "bg-[var(--tq-surface)] text-foreground"
                      : "bg-[var(--tq-surface)] text-foreground/40"
                }`}
              >
                {done ? (
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 14 }}
                  >
                    check
                  </span>
                ) : (
                  i + 1
                )}
              </span>
              {/* Title hidden on the narrowest phones for the inactive
                  steps so the rail never wraps; the active title always
                  shows. */}
              <span
                className={`text-xs font-semibold ${
                  current
                    ? "text-foreground"
                    : done
                      ? "hidden text-foreground/70 sm:inline"
                      : jumpable
                        ? "hidden text-foreground/60 sm:inline"
                        : "hidden text-foreground/40 sm:inline"
                }`}
              >
                {title}
              </span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}
