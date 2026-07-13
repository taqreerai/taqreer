// Colored file-type icons for the export surfaces (user direction
// 2026-07-14): a rounded document body with a darker corner-fold triangle,
// per-format brand color + white label. Google Slides keeps the amber body
// with the slide graphic (the reference the set was built from); PDF/PPT/PNG
// carry a white bold label instead. Shared by ExportMenu + ShareDialog so
// both surfaces stay pixel-identical.

import type { ExportKind } from "@/lib/preview/use-export-actions";

// One 512x512 document silhouette + corner fold, reused for every format.
const BODY_PATH =
  "m407.273 512h-302.546c-19.2 0-34.909-15.709-34.909-34.909v-442.182c0-19.2 15.709-34.909 34.909-34.909h209.455l128 128v349.091c0 19.2-15.709 34.909-34.909 34.909z";
const FOLD_PATH = "m314.182 0 128 128h-128z";
// The Slides slide-graphic (from the source SVG) — only the gslides icon.
const SLIDES_GRAPHIC =
  "m139.636 200.728v162.909h232.727v-162.909zm203.637 133.817h-174.546v-104.727h174.545v104.727z";

type FormatStyle = { body: string; fold: string; label?: string };

const FORMAT_STYLES: Record<ExportKind, FormatStyle> = {
  pdf: { body: "#EF4136", fold: "#C92D24", label: "PDF" },
  pptx: { body: "#EC6C1A", fold: "#C4550D", label: "PPT" },
  png: { body: "#0057FF", fold: "#0044CC", label: "PNG" },
  gslides: { body: "#FFBF00", fold: "#FF9300" },
};

export function FormatIcon({
  kind,
  size = 20,
}: {
  kind: ExportKind;
  size?: number;
}) {
  const s = FORMAT_STYLES[kind];
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      style={{ display: "block", flexShrink: 0 }}
    >
      <path d={BODY_PATH} fill={s.body} />
      <path d={FOLD_PATH} fill={s.fold} />
      {s.label ? (
        <text
          x="256"
          y="352"
          textAnchor="middle"
          fontFamily="Arial, Helvetica, sans-serif"
          fontWeight="800"
          fontSize="130"
          letterSpacing="1"
          fill="#fff"
        >
          {s.label}
        </text>
      ) : (
        <path d={SLIDES_GRAPHIC} fill="#fbffff" />
      )}
    </svg>
  );
}
