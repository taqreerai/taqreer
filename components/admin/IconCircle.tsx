// A material-symbol glyph centered inside a circular tint. The glyph and the
// circle are SEPARATE elements on purpose: putting `material-symbols-outlined`
// (which sets its own display/line-height) on the same box as `grid
// place-items-center` breaks centering, so the circle owns the grid and the
// glyph is its centered child. Defaults to muted-white on a soft overlay.

export function IconCircle({
  icon,
  size = 36,
  iconSize = 18,
  color = "var(--tq-text-muted)",
  background = "var(--tq-overlay-soft)",
}: {
  icon: string;
  size?: number;
  iconSize?: number;
  color?: string;
  background?: string;
}) {
  return (
    <span
      className="grid flex-shrink-0 place-items-center rounded-full"
      style={{ width: size, height: size, background }}
    >
      <span
        className="material-symbols-outlined"
        style={{ fontSize: iconSize, color, lineHeight: 1 }}
        aria-hidden="true"
      >
        {icon}
      </span>
    </span>
  );
}
