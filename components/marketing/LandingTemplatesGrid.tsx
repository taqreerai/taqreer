"use client";

// Landing-page templates grid — 2 rows × 4 columns of public template
// covers. No titles, just the thumbnails. Each tile scrubs through its
// template's slides on mouse-move, mirroring the dashboard's Recent
// Projects tiles (components/app/ProjectThumbnail.tsx). Click routes a
// logged-out visitor to /signup and a signed-in user straight into the
// "use template" flow (/use-template/[id]).

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { LandingTemplate } from "@/lib/auth/marquee-projects";

// Mirror ProjectThumbnail's scrub-activation threshold so the landing
// tiles feel identical to the dashboard ones: bare hover doesn't scrub
// until the cursor has moved past this many px from where it entered.
const SCRUB_ACTIVATION_PX = 6;

export function LandingTemplatesGrid({
  templates,
  isAuthed,
}: {
  templates: LandingTemplate[];
  isAuthed: boolean;
}) {
  // No public templates → render nothing (the section collapses rather
  // than leaving an empty band).
  if (templates.length === 0) return null;

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-2 gap-4 md:grid-cols-4">
      {templates.map((tpl) => (
        <LandingTemplateTile key={tpl.id} template={tpl} isAuthed={isAuthed} />
      ))}
    </div>
  );
}

function LandingTemplateTile({
  template,
  isAuthed,
}: {
  template: LandingTemplate;
  isAuthed: boolean;
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLButtonElement | null>(null);
  const entryXRef = useRef<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const slides = template.slides;
  const isMultiSlide = slides.length > 1;
  const src = slides[hoverIndex ?? 0] ?? null;
  // Portrait covers crop from the top so they fill the 16:9 tile without
  // letterboxing — same rule the dashboard tiles use.
  const imgObjectClass =
    template.format === "9:16" ? "object-cover object-top" : "object-cover";

  // Scrub logic mirrors ProjectThumbnail.handleMouseMove: ignore bare
  // hover until the cursor moves past the activation threshold, then map
  // horizontal position to a slide index (RTL — rightmost pixel = slide 1).
  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!isMultiSlide) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    if (entryXRef.current == null) {
      entryXRef.current = e.clientX;
      return;
    }
    if (Math.abs(e.clientX - entryXRef.current) < SCRUB_ACTIVATION_PX) return;
    const relX = e.clientX - rect.left;
    const idx = Math.min(
      slides.length - 1,
      Math.max(
        0,
        Math.floor(((rect.width - relX) / rect.width) * slides.length),
      ),
    );
    setHoverIndex(idx);
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
    entryXRef.current = null;
  };

  const handleClick = () => {
    // Logged-in → straight into the use-template flow; logged-out →
    // the signup funnel (the page's CTA target). UseTemplateClient
    // mints the Mimic reference on arrival, so no pre-priming here.
    router.push(isAuthed ? `/use-template/${template.id}` : "/signup");
  };

  return (
    <div className="tq-thumbnail relative aspect-video w-full overflow-hidden rounded-[14px]">
      <button
        ref={rootRef}
        type="button"
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        aria-label="استخدم هذا القالب"
        className="absolute inset-0 block cursor-pointer"
      >
        {src ? (
          <img
            alt=""
            aria-hidden
            src={src}
            className={`h-full w-full ${imgObjectClass}`}
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center">
            <span className="material-symbols-outlined text-[28px] text-muted opacity-25">
              image
            </span>
          </span>
        )}
      </button>

      {/* Scrub counter — bottom-end, only while actively scrubbing a
          multi-slide template. Matches the dashboard tile's chrome. */}
      {isMultiSlide && hoverIndex !== null ? (
        <span
          dir="ltr"
          className="pointer-events-none absolute bottom-2 end-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white"
        >
          {hoverIndex + 1} / {slides.length}
        </span>
      ) : null}
    </div>
  );
}
