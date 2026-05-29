// Small "مميز" (premium) pill — crown glyph + label on the shared
// .badge-purple token (the same violet chip used for the "احترافي"/Pro
// plan elsewhere). Used on premium template tiles + the template
// lightbox header. `backdrop-blur-glass` keeps it legible when it sits
// over a bright thumbnail.

export function PremiumBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`badge-purple backdrop-blur-glass inline-flex items-center gap-1 ${className}`}
    >
      <span
        className="material-symbols-outlined"
        style={{ fontSize: 12 }}
        aria-hidden
      >
        workspace_premium
      </span>
      مميز
    </span>
  );
}
