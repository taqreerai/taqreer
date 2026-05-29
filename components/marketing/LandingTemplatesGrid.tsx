"use client";

// Landing-page templates grid — full-wrapper-width 2 × 4 grid of public
// template covers. No titles, just the thumbnails. Each tile scrubs
// through its template's slides on mouse-move, mirroring the dashboard's
// Recent Projects tiles (components/app/ProjectThumbnail.tsx).
//
// Clicking a tile opens the SAME TemplateLightbox modal as the dashboard
// "قوالبي" widget. Its "use" CTA routes a logged-out visitor to /signup
// and a signed-in user into the use-template flow (/use-template/[id]).

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TemplateLightbox } from "@/components/app/TemplateLightbox";
import { prepareTemplateUse } from "@/lib/mimic/template-seed";
import type { LandingTemplate } from "@/lib/auth/marquee-projects";
import type { SlideFormat } from "@/lib/schema/slide";

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
  // Lightbox target. null = closed.
  const [preview, setPreview] = useState<LandingTemplate | null>(null);
  // "Use template" busy gate — blocks double-clicks while the seed
  // request is in flight (logged-in path only). Mirrors MyTemplates.
  const [useBusy, setUseBusy] = useState(false);
  const router = useRouter();

  const handleUseTemplate = async () => {
    if (!preview || useBusy) return;
    // Logged-out → straight to the signup funnel (no seed work).
    if (!isAuthed) {
      router.push("/signup");
      return;
    }
    // Logged-in → mint the Mimic reference behind the CTA's busy
    // spinner, then hard-navigate to the (now-cached) use flow.
    setUseBusy(true);
    try {
      await prepareTemplateUse("template", preview.id);
      window.location.assign(`/use-template/${preview.id}`);
    } catch (err) {
      console.warn("[LandingTemplatesGrid] use prep failed", err);
      setUseBusy(false);
    }
  };

  // No public templates → render nothing (the section collapses rather
  // than leaving an empty band + a dead nav anchor target).
  if (templates.length === 0) return null;

  const previewFormat: SlideFormat =
    preview?.format === "9:16" ? "9:16" : "16:9";

  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {templates.map((tpl) => (
          <LandingTemplateTile
            key={tpl.id}
            template={tpl}
            onOpen={() => setPreview(tpl)}
          />
        ))}
      </div>

      <TemplateLightbox
        open={!!preview}
        slides={preview?.slides ?? []}
        format={previewFormat}
        title={preview?.title ?? ""}
        onClose={() => setPreview(null)}
        onUseTemplate={preview ? handleUseTemplate : undefined}
        useBusy={useBusy}
      />
    </>
  );
}

function LandingTemplateTile({
  template,
  onOpen,
}: {
  template: LandingTemplate;
  onOpen: () => void;
}) {
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

  return (
    <div className="tq-thumbnail relative aspect-video w-full overflow-hidden rounded-[14px]">
      <button
        ref={rootRef}
        type="button"
        onClick={onOpen}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        aria-label="معاينة القالب"
        className="absolute inset-0 block cursor-zoom-in"
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
