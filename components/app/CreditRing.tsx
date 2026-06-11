"use client";

// Circular used-vs-remaining credit meter, drawn AROUND the sidebar
// avatar (overlay on its 40px container). Pure SVG: hairline track +
// an accent arc for the remaining fraction, starting at 12 o'clock.
// Tokens only - track uses the border token, arc uses the one accent.

export function CreditRing({
  fraction,
  size = 48,
  stroke = 3,
  label,
  className = "absolute -inset-1 -rotate-90",
}: {
  // Remaining share of the cycle's credits, 0..1.
  fraction: number;
  size?: number;
  stroke?: number;
  // Localized aria description ("Credits: X of Y remaining").
  label: string;
  // Default draws a 48px ring around the avatar's 40px container
  // (-inset-1) so there's clear air between avatar fill and arc, and
  // a thicker stroke for legibility (user direction 2026-06-11).
  className?: string;
}) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, fraction));
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      role="img"
      aria-label={label}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--tq-border)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--tq-purple)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${circumference * clamped} ${circumference}`}
        // Animate spend/refund transitions so a live settle visibly
        // ticks the ring down instead of snapping.
        style={{ transition: "stroke-dasharray 0.6s ease" }}
      />
    </svg>
  );
}
