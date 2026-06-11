// §25: CSS-only background — replaces the canvas implementation. No JS, no RAF,
// no canvas buffers, no pointer interaction.
//   • DOT field: a single tiled radial-gradient (static, GPU-painted once).
//   • AURORA: two brand-colour gradient groups along the bottom that drift in
//     opposite directions via GPU CSS animations (`.tq-aurora-a/-b` + keyframes
//     in globals.css), masked to the bottom band. The browser auto-throttles
//     the animation when the tab is hidden.

import type { CSSProperties } from "react";

export function MagneticGlow({
  // Pushes the aurora gradients lower (normalized fraction) via the --yo var the
  // keyframes read — used on the home panel so the glow sits a touch further down.
  glowYOffset = 0,
  // When false, render ONLY the dot field (flow pages use a static CSS glow).
  aurora = true,
  // `fixed` pins the layers to the viewport (landing backdrop) instead of the
  // positioned ancestor (dashboard panel).
  fixed = false,
  // When false, hide the dot field (landing keeps only the aurora glow).
  dots = true,
}: {
  glowYOffset?: number;
  aurora?: boolean;
  fixed?: boolean;
  dots?: boolean;
} = {}) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none ${fixed ? "fixed" : "absolute"} inset-x-0 top-0 -z-[1] h-[167vh] w-full overflow-hidden`}
    >
      {/* Aurora — outer carries the blur + bottom-band mask; the two inner layers
          carry the drifting brand-colour gradients. */}
      {aurora ? (
        <div
          className="tq-aurora absolute inset-0"
          style={{ "--yo": `${glowYOffset * 100}%` } as CSSProperties}
        >
          <div className="tq-aurora-a absolute inset-0" />
          <div className="tq-aurora-b absolute inset-0" />
        </div>
      ) : null}

      {/* Dot field — tiled radial-gradient (muted white, 23px grid). */}
      {dots ? (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle, var(--tq-dot) 0.9px, transparent 1.1px)",
            backgroundSize: "23px 23px",
          }}
        />
      ) : null}
    </div>
  );
}
