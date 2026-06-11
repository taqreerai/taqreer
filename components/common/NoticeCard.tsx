"use client";

// NoticeCard - THE canonical "stop and tell the user something" surface
// (user direction 2026-06-11, promoted from the /lab/billing locked-flow
// mock): a centered circular icon chip, bold title, muted body, and an
// actions row. One pattern for every warning / confirm / outcome state
// app-wide - locked features, cancel-generation confirms, "generation
// cancelled", delete confirmations, empty-but-blocked states - instead
// of each dialog inventing its own header layout.
//
// Composes existing vocabulary only: the caller wraps it in whatever
// surface fits (`.surface-card` inline, `.surface-modal` inside a
// dialog portal) and passes `.btn-gradient` / `.btn-pill` buttons as
// actions. Buttons in the row stretch equally (flex-1) - same-row
// buttons are always the same size (user direction 2026-06-11).
//
// `tone="warn"` tints the icon chip with the status-warn tokens for
// destructive / failure contexts (delete, payment failed, cancelled).

export function NoticeCard({
  icon,
  title,
  body,
  actions,
  tone = "default",
}: {
  // Material Symbols glyph name (e.g. "lock", "warning", "delete").
  icon: string;
  title: string;
  body?: React.ReactNode;
  // Usually 1-2 buttons; they render equal-width in one row.
  actions?: React.ReactNode;
  tone?: "default" | "warn";
}) {
  return (
    <div className="flex flex-col items-center p-8 text-center">
      <span
        className={`mb-4 flex h-12 w-12 items-center justify-center rounded-full ${
          tone === "warn"
            ? "bg-[var(--tq-status-warn-bg)] text-[var(--tq-status-warn-text)]"
            : "bg-[var(--tq-surface)] text-foreground/70"
        }`}
      >
        <span className="material-symbols-outlined leading-none" style={{ fontSize: 22 }} aria-hidden>
          {icon}
        </span>
      </span>
      <h3 className="mb-2 text-base font-bold text-foreground">{title}</h3>
      {body ? <p className="mb-6 text-sm text-muted">{body}</p> : null}
      {actions ? (
        <div className="flex w-full items-stretch justify-center gap-3 [&>*]:flex-1 [&>*]:max-w-[200px]">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
