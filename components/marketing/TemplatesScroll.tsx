/* eslint-disable @next/next/no-img-element -- thumbnail src is a remote storage URL (see next.config remotePatterns); next/image optimization not needed for these decorative covers */
import React from "react";
import type { MarqueeThumbnail } from "@/lib/auth/marquee-projects";

// Fallback gradients — shown only when no real thumbnails are
// available (empty curator account / DB error) so the card never
// renders blank. Built from brand tokens (`--tq-bg` + `--tq-violet-rgb`)
// rather than hardcoded hex, varying angle + violet weight for visual
// variety.
const FALLBACK_GRADIENTS = [
  "linear-gradient(135deg, var(--tq-bg) 0%, rgba(var(--tq-violet-rgb), 0.55) 100%)",
  "linear-gradient(160deg, var(--tq-bg) 0%, rgba(var(--tq-violet-rgb), 0.32) 100%)",
  "linear-gradient(135deg, rgba(var(--tq-violet-rgb), 0.16) 0%, rgba(var(--tq-violet-rgb), 0.5) 100%)",
  "linear-gradient(120deg, var(--tq-bg) 0%, rgba(var(--tq-violet-rgb), 0.45) 100%)",
  "linear-gradient(135deg, var(--tq-bg) 0%, rgba(var(--tq-violet-rgb), 0.28) 100%)",
  "linear-gradient(150deg, rgba(var(--tq-violet-rgb), 0.12) 0%, rgba(var(--tq-violet-rgb), 0.5) 100%)",
];

// Two vertical columns, opposite scroll directions, each tripled for
// a seamless CSS loop. Real recent-project thumbnails (curator-gated,
// same source as the auth marquee) when available; gradients as a
// fallback. All tiles forced to 16:9 + object-cover so the two narrow
// columns stay tidy regardless of source orientation.
export function TemplatesScroll({
  thumbnails,
}: {
  thumbnails?: MarqueeThumbnail[];
}) {
  const tiles = thumbnails ?? [];
  const hasReal = tiles.length > 0;

  const col1 = hasReal ? tiles.filter((_, i) => i % 2 === 0) : [];
  const odd = hasReal ? tiles.filter((_, i) => i % 2 === 1) : [];
  // Tiny set (e.g. a single thumbnail) leaves the odd column empty →
  // blank second column. Mirror col1 so both columns stay populated.
  const col2 = odd.length > 0 ? odd : col1;

  return (
    <div
      className="templates-scroll-container mask-vertical-edges relative w-full overflow-hidden"
      style={{ height: "340px" }}
    >
      <div className="flex h-full w-full gap-4">
        {hasReal ? (
          <>
            <ThumbColumn
              tiles={col1}
              anim="animate-scroll-down-slow"
              keyPrefix="col1"
            />
            <ThumbColumn
              tiles={col2}
              anim="animate-scroll-up-slow"
              keyPrefix="col2"
            />
          </>
        ) : (
          <>
            <GradientColumn anim="animate-scroll-down-slow" keyPrefix="col1" />
            <GradientColumn
              anim="animate-scroll-up-slow"
              keyPrefix="col2"
              reverse
            />
          </>
        )}
      </div>
    </div>
  );
}

function ThumbColumn({
  tiles,
  anim,
  keyPrefix,
}: {
  tiles: MarqueeThumbnail[];
  anim: string;
  keyPrefix: string;
}) {
  return (
    <div className={`flex h-max w-full flex-1 flex-col gap-4 ${anim}`}>
      {[0, 1, 2].map((set) => (
        <React.Fragment key={`${keyPrefix}-set-${set}`}>
          {tiles.map((t, idx) => (
            <div
              key={`${keyPrefix}-${set}-${t.id}-${idx}`}
              className="template-card w-full shrink-0 overflow-hidden"
            >
              {/* Native <img>: Supabase storage URLs aren't in
                  next.config remotePatterns. */}
              <img
                src={t.thumbnail}
                alt=""
                aria-hidden
                loading="lazy"
                decoding="async"
                draggable={false}
                className="h-full w-full object-cover object-top"
              />
            </div>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}

function GradientColumn({
  anim,
  keyPrefix,
  reverse = false,
}: {
  anim: string;
  keyPrefix: string;
  reverse?: boolean;
}) {
  const grads = reverse ? [...FALLBACK_GRADIENTS].reverse() : FALLBACK_GRADIENTS;
  return (
    <div className={`flex h-max w-full flex-1 flex-col gap-4 ${anim}`}>
      {[0, 1, 2].map((set) => (
        <React.Fragment key={`${keyPrefix}-set-${set}`}>
          {grads.map((bg, idx) => (
            <div
              key={`${keyPrefix}-${set}-${idx}`}
              className="template-card w-full shrink-0"
              style={{ background: bg }}
            />
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}
