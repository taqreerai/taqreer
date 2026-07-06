"use client";

/* eslint-disable @next/next/no-img-element -- thumbnail src is a generated storage/data URL; next/image's host allowlist + optimization don't apply */

// Landing-page templates grid — full-wrapper-width 2 × 4 grid of public
// template covers. No titles, just the thumbnails. Each tile scrubs
// through its template's slides on mouse-move, mirroring the dashboard's
// Recent Projects tiles (components/app/ProjectThumbnail.tsx).
//
// Clicking a tile opens the SAME TemplateLightbox modal as the dashboard
// "قوالبي" widget. Its "use" CTA routes a logged-out visitor to /signup
// and a signed-in user into the use-template flow (/use-template/[id]).
//
// `detailLinks` mode (the /presentation-templates hub): tiles with an
// admin-assigned slug render as REAL anchors to the template's SEO detail
// page (/presentation-templates/[slug]) — a crawlable path Google can follow —
// instead of opening the lightbox. Slugless tiles keep the lightbox.

import { useRef, useState } from "react";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { useUseTemplate } from "@/hooks/useUseTemplate";
import { localizedHref } from "@/lib/i18n/navigation";
import { TemplateLightbox } from "@/components/app/TemplateLightbox";
import { PremiumBadge } from "@/components/app/PremiumBadge";
import { ScrollReveal } from "@/components/marketing/ScrollReveal";
import type { LandingTemplate } from "@/lib/auth/marquee-projects";
import type { SlideFormat } from "@/lib/schema/slide";

// Mirror ProjectThumbnail's scrub-activation threshold so the landing
// tiles feel identical to the dashboard ones: bare hover doesn't scrub
// until the cursor has moved past this many px from where it entered.
const SCRUB_ACTIVATION_PX = 6;

// Deterministic 0..MAX pseudo-random delay per tile index. Tiles fade
// in scattered (not sequentially, not all at once) on scroll. Sin-hash
// instead of Math.random() so the value is identical on the server and
// client render — no hydration mismatch, no animation restart.
const FADE_STAGGER_MAX_S = 0.9;
function scatterDelay(index: number): number {
  const x = Math.sin((index + 1) * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * FADE_STAGGER_MAX_S;
}

export function LandingTemplatesGrid({
  templates,
  detailLinks = false,
}: {
  templates: LandingTemplate[];
  // Hub mode: slugged tiles become anchors to their SEO detail page.
  detailLinks?: boolean;
}) {
  // Lightbox target. null = closed.
  const [preview, setPreview] = useState<LandingTemplate | null>(null);
  const { locale } = useLocale();
  // Shared seed-then-navigate flow (hooks/useUseTemplate). On the landing,
  // the 402 → /#pricing redirect is a same-document hash nav (no unmount),
  // so close the lightbox when the gate fires.
  const { busy: useBusy, startTemplateUse } = useUseTemplate({
    onGated: () => setPreview(null),
  });

  const handleUseTemplate = async () => {
    if (!preview) return;
    await startTemplateUse(preview.id);
  };

  // No public templates → render nothing (the section collapses rather
  // than leaving an empty band + a dead nav anchor target).
  if (templates.length === 0) return null;

  const previewFormat: SlideFormat =
    preview?.format === "9:16" ? "9:16" : "16:9";

  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {templates.map((tpl, i) => (
          // Each tile fades in on its own (pure opacity, slow) with a
          // scattered delay so the grid doesn't pop in all at once.
          <ScrollReveal
            key={tpl.id}
            direction="none"
            duration={1.1}
            delay={scatterDelay(i)}
          >
            <LandingTemplateTile
              template={tpl}
              onOpen={() => setPreview(tpl)}
              href={
                detailLinks && tpl.slug
                  ? localizedHref(`/presentation-templates/${tpl.slug}`, locale)
                  : undefined
              }
            />
          </ScrollReveal>
        ))}
      </div>

      <TemplateLightbox
        open={!!preview}
        slides={preview?.slides ?? []}
        format={previewFormat}
        isPremium={preview?.isPremium ?? false}
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
  href,
}: {
  template: LandingTemplate;
  onOpen: () => void;
  // When set, the tile is a real anchor to the template's detail page
  // (crawlable). Otherwise it's a button that opens the lightbox.
  href?: string;
}) {
  const dict = useDict();
  const rootRef = useRef<HTMLElement | null>(null);
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
  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
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

  // Shared tile body — identical inside the anchor (detail-link mode) and
  // the lightbox button.
  const tileBody = src ? (
    <img
      alt={dict.landing.templatesGrid.coverAlt}
      src={src}
      className={`h-full w-full transition-transform duration-500 ease-out group-hover:scale-[1.06] ${imgObjectClass}`}
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
  );

  return (
    <div className="tq-thumbnail group relative aspect-video w-full overflow-hidden rounded-[14px]">
      {href ? (
        <a
          ref={rootRef as React.Ref<HTMLAnchorElement>}
          href={href}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          aria-label={dict.landing.templatesGrid.previewAria}
          className="absolute inset-0 block cursor-pointer"
        >
          {tileBody}
        </a>
      ) : (
        <button
          ref={rootRef as React.Ref<HTMLButtonElement>}
          type="button"
          onClick={onOpen}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          aria-label={dict.landing.templatesGrid.previewAria}
          className="absolute inset-0 block cursor-zoom-in"
        >
          {tileBody}
        </button>
      )}

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

      {/* Premium marker — top-start, diagonal-opposite the scrub
          counter so the two never crowd. */}
      {template.isPremium ? (
        <PremiumBadge className="pointer-events-none absolute top-2 start-2 z-10" />
      ) : null}
    </div>
  );
}
