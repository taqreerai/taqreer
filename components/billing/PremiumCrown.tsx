// The gold crown that marks a paid feature everywhere in the app (2026-10-01:
// one shared mark so "premium" looks the same on every option, before the
// user clicks). Colour comes from --tq-premium-gold via .premium-crown.

export function PremiumCrown({
  size = 14,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`material-symbols-outlined premium-crown ${className}`}
      style={{ fontSize: size }}
      aria-hidden
    >
      crown
    </span>
  );
}
