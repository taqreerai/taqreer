// Compact inline sparkline (line + faint area), NO card chrome — meant to
// drop into the bottom of an existing card. Echoes the reference dashboard's
// stat-card graphs. Colour follows `currentColor`, so the parent sets the
// accent with a Tailwind `text-*` class. Data is static placeholder for now
// (points-usage trend); pass a real series later.

type Props = {
  /** Series, oldest → newest. */
  data: number[];
  /** Unique slug for this instance's gradient `<defs>` id (avoids
   *  collisions when several sparklines share the DOM). */
  id: string;
  /** Render right-to-left (newest on the visual left) for RTL contexts.
   *  Reverses the series so time reads in the Arabic direction. */
  rtl?: boolean;
  /** Sizing/colour utilities (e.g. "h-12 w-full text-[var(--tq-violet)]"). */
  className?: string;
};

const VIEW_W = 200;
const VIEW_H = 44;
const PAD_Y = 4;

function buildPaths(data: number[]): { line: string; area: string } {
  // Empty series → no paths. Guards against Math.max(...[]) === -Infinity
  // (and Math.min(...[]) === Infinity) producing a garbage `d` attribute.
  if (data.length === 0) return { line: "", area: "" };
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const stepX = data.length > 1 ? VIEW_W / (data.length - 1) : VIEW_W;
  const pts = data.map((v, i) => {
    const x = i * stepX;
    const y = VIEW_H - PAD_Y - ((v - min) / span) * (VIEW_H - PAD_Y * 2);
    return [x, y] as const;
  });
  const line = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${VIEW_W},${VIEW_H} L0,${VIEW_H} Z`;
  return { line, area };
}

export function Sparkline({ data, id, rtl = false, className = "" }: Props) {
  // RTL: reverse the series so the newest point lands on the visual left
  // and time reads right→left, matching the Arabic reading direction.
  const series = rtl ? [...data].reverse() : data;
  const { line, area } = buildPaths(series);
  const gradientId = `sparkline-fill-${id}`;
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden
    >
      <defs>
        {/* Vertical fade — the line's colour (`currentColor`) at the top,
            fading to transparent at the card's bottom edge. */}
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.38} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
