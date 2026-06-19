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

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { useIsAuthed } from "@/hooks/useIsAuthed";
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
}: {
  templates: LandingTemplate[];
}) {
  // Lightbox target. null = closed.
  const [preview, setPreview] = useState<LandingTemplate | null>(null);
  const { locale } = useLocale();
  // Auth resolved client-side (useIsAuthed: cookie-presence check, no Supabase
  // client) so the pages that render this stay static AND light.
  const isAuthed = useIsAuthed();
  // "Use template" busy gate — blocks double-clicks while the seed
  // request is in flight (logged-in path only). Mirrors MyTemplates.
  const [useBusy, setUseBusy] = useState(false);
  const router = useRouter();

  const handleUseTemplate = async () => {
    if (!preview || useBusy) return;
    // Logged-out → straight to the signup funnel (no seed work).
    if (!isAuthed) {
      router.push(localizedHref("/signup", locale));
      return;
    }
    // Logged-in → mint the Mimic reference behind the CTA's busy
    // spinner, then hard-navigate to the (now-cached) use flow. The seed logic
    // (lib/mimic/template-seed) pulls zod (~280 KB), so it's dynamically
    // imported here at click-time — it never ships in the static landing bundle.
    setUseBusy(true);
    const { prepareTemplateUse, redirectToPricingIfGated } = await import(
      "@/lib/mimic/template-seed"
    );
    try {
      await prepareTemplateUse("template", preview.id);
      window.location.assign(`/use-template/${preview.id}`);
    } catch (err) {
      // 402 = premium template, user isn't on Pro → route to pricing.
      // On the landing, /#pricing is a same-document hash nav (no
      // unmount), so release the busy gate + close the lightbox.
      if (redirectToPricingIfGated(err)) {
        setUseBusy(false);
        setPreview(null);
        return;
      }
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
}: {
  template: LandingTemplate;
  onOpen: () => void;
}) {
  const dict = useDict();
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
        aria-label={dict.landing.templatesGrid.previewAria}
        className="absolute inset-0 block cursor-zoom-in"
      >
        {src ? (
          <img
            alt={dict.landing.templatesGrid.coverAlt}
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
          className="pointer-events-none absolute bottom-2 end-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium leading-none text-foreground"
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
