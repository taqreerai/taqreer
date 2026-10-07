"use client";

// Template picker for /create's Design step (2026-10-02). Picking a template
// turns the run into a template generation (the Mimic engine: Claude reuses
// the template deck's design with the user's content); "No template" keeps
// the from-scratch path with a design style.
//
// Picking resolves the template in place (POST /api/templates/[id]/use mints
// the design reference, cached per id in sessionStorage) behind a tile
// spinner, then hands the result up so /create can pre-fill the template's
// colours + font. Gates, shown BEFORE the click as a gold crown:
//   - the template flow itself (Plus and up, tier `flows`), EXCEPT the
//     curator's free-plan templates (Template.isFree, server-enforced in
//     POST /api/projects), and
//   - premium templates (Pro and up; owners + admins always pass).
// A locked click opens the UpgradeModal instead of resolving. Every template
// shows (the locked ones too, crowned) in one scrolling grid.
//
// 2026-10-06 (owner direction): hovering a tile flips through the template's
// slides so the user sees what it includes, and the eye button opens a
// preview window with every slide (the touch path). `wide` = the full-width
// grid of /create's own Design step: big tiles with name + slide count +
// palette, no inner scroll and no "Show all" modal.

import { PickerExpandButton, PickerExpandModal } from "@/components/create/PickerExpandModal";
import { PillButton } from "@/components/create/PillButton";
import { useEffect, useState } from "react";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { TemplateUpgradeModal, type TemplateGate } from "@/components/app/TemplateUpgradeModal";
import { useTemplateLock } from "@/lib/templates/use-template-lock";
import { PremiumBadge } from "@/components/app/PremiumBadge";
import type { KnownPlan } from "@/lib/plan";
import {
  fetchUse,
  isPremiumGate,
  readCachedUse,
  writeCachedUse,
  type MimicTemplateUse,
} from "@/lib/mimic/template-seed";
import type { PickerTemplate } from "@/app/api/templates/route";
import { useFitCount } from "@/components/create/useFitCount";

export type PickedTemplate = { template: PickerTemplate; use: MimicTemplateUse };

// How long each slide shows while a tile is hovered.
const FLIP_MS = 900;

function slidesOf(tpl: PickerTemplate): string[] {
  return tpl.thumbnails?.length ? tpl.thumbnails : [tpl.thumbnailUrl];
}

export function TemplatePickerGrid({
  selectedId,
  onSelect,
  onClear,
  disabled = false,
  wide = false,
  fit = false,
  onGuestSelect,
}: {
  selectedId: string | null;
  onSelect: (picked: PickedTemplate) => void;
  // Signed-out visitor (/create, 2026-10-06): the pick is only remembered;
  // the paid template setup (/api/templates/[id]/use) runs after sign-in.
  onGuestSelect?: (tpl: PickerTemplate) => void;
  onClear: () => void;
  disabled?: boolean;
  wide?: boolean;
  // With `wide`: a grid inside a fixed-height card (/create's Design card):
  // columns follow the CARD width, and on a viewport-fit stage only the rows
  // that fit render (no scroll), the rest behind "Show all".
  fit?: boolean;
}) {
  const dict = useDict();
  const { locale } = useLocale();
  const t = dict.flows.design;
  const [expanded, setExpanded] = useState(false);
  const [previewing, setPreviewing] = useState<PickerTemplate | null>(null);
  const { lockFor, isPremiumLock, flowLocked } = useTemplateLock();
  const [templates, setTemplates] = useState<PickerTemplate[] | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [gate, setGate] = useState<TemplateGate>(null);

  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const res = await fetch("/api/templates", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { templates?: PickerTemplate[] };
        if (!aborted) setTemplates(data.templates ?? []);
      } catch {
        if (!aborted) setTemplates([]);
      }
    })();
    return () => {
      aborted = true;
    };
  }, []);

  const openGate = (tier: KnownPlan, premium: boolean) => setGate({ tier, premium });

  const pick = async (tpl: PickerTemplate) => {
    if (loadingId) return;
    const tier = lockFor(tpl);
    if (tier) {
      openGate(tier, isPremiumLock(tpl));
      return;
    }
    if (selectedId === tpl.id) {
      onClear();
      return;
    }
    if (onGuestSelect) {
      onGuestSelect(tpl);
      return;
    }
    setError(false);
    setLoadingId(tpl.id);
    try {
      let use = readCachedUse("template", tpl.id);
      if (!use) {
        use = await fetchUse("template", tpl.id);
        writeCachedUse("template", tpl.id, use);
      }
      onSelect({ template: tpl, use });
    } catch (err) {
      if (isPremiumGate(err)) openGate("pro", true);
      else setError(true);
    } finally {
      setLoadingId(null);
    }
  };

  const nameOf = (tpl: PickerTemplate) =>
    (locale === "en" ? tpl.name.en : tpl.name.ar) ?? tpl.name.ar ?? tpl.name.en ?? "";

  // Arabic counts 3-10 take the plural form ("شرائح"), the rest the
  // singular ("شريحة"); English uses one form.
  const slideCountLabel = (n: number) =>
    (n >= 3 && n <= 10 ? t.slidesFew : t.slidesMany).replace("{n}", String(n));

  const tile = (tpl: PickerTemplate, big = false) => (
    <TemplateTile
      key={tpl.id}
      tpl={tpl}
      name={nameOf(tpl)}
      meta={slideCountLabel(tpl.slideCount)}
      big={big}
      wide={wide}
      active={selectedId === tpl.id}
      locked={lockFor(tpl) != null}
      freeBadge={flowLocked && tpl.isFree ? t.freeBadge : null}
      mineBadge={tpl.isMine ? t.mine : null}
      loading={loadingId === tpl.id}
      disabled={disabled || (loadingId != null && loadingId !== tpl.id)}
      previewLabel={t.preview}
      onPick={() => {
        if (big) setExpanded(false);
        void pick(tpl);
      }}
      onPreview={() => setPreviewing(tpl)}
    />
  );

  const noneTile = (
    <button
      key="none"
      type="button"
      disabled={disabled}
      onClick={() => {
        setExpanded(false);
        if (selectedId) onClear();
      }}
      title={t.noTemplateDesc}
      aria-pressed={selectedId === null}
      className={`pick-tile flex flex-col rounded-lg p-1 ${wide ? "rounded-xl p-1.5" : ""} ${selectedId === null ? "is-active" : ""}`}
    >
      <div
        className="flex w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed border-[var(--tq-border-hairline)] px-2 text-center text-foreground/70"
        style={{ aspectRatio: "16/9" }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: wide ? 26 : 16 }} aria-hidden>
          auto_awesome
        </span>
        <span className={wide ? "text-sm font-semibold text-foreground" : "text-[10px] font-medium"}>
          {t.noTemplate}
        </span>
        {wide ? (
          <span className="text-[11px] leading-4 text-foreground/55">{t.noTemplateDesc}</span>
        ) : null}
      </div>
    </button>
  );

  const list = templates ?? [];
  const skeletons = Array.from({ length: wide ? 7 : 5 }).map((_, i) => (
    <div
      key={i}
      className="animate-pulse rounded-lg bg-[var(--tq-overlay-soft)]"
      style={{ aspectRatio: wide ? "16/12" : "16/10" }}
    />
  ));

  const { boxRef: fitBoxRef, gridRef: fitGridRef, count: fitCount } = useFitCount(wide && fit, list.length + 1);
  const allTiles = [noneTile, ...(templates === null ? skeletons : list.map((tpl) => tile(tpl)))];
  const expandModal = (
    <PickerExpandModal open={expanded} title={t.allTemplates} onClose={() => setExpanded(false)}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {noneTile}
        {list.map((tpl) => tile(tpl, true))}
      </div>
    </PickerExpandModal>
  );

  return (
    <div className={`@container flex flex-col gap-1.5 ${fit ? "stage:h-full stage:min-h-0" : ""}`}>
      {wide && fit ? (
        <>
          {/* Viewport-fit: whole rows that fit the card, no scroll; the rest
              behind "Show all" (useFitCount). */}
          <div
            ref={fitBoxRef}
            className="p-0.5 stage:min-h-0 stage:flex-1 stage:overflow-hidden"
          >
            <div
              ref={fitGridRef}
              className="grid auto-rows-max grid-cols-2 gap-3 @min-[32rem]:grid-cols-3 @min-[52rem]:grid-cols-4"
            >
              {allTiles.slice(0, fitCount ?? undefined)}
            </div>
          </div>
          {fitCount != null && allTiles.length > fitCount ? (
            <PickerExpandButton onClick={() => setExpanded(true)} disabled={disabled} />
          ) : null}
          {expandModal}
        </>
      ) : wide ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 2xl:grid-cols-5">
          {noneTile}
          {templates === null ? skeletons : list.map((tpl) => tile(tpl))}
        </div>
      ) : (
        <>
          {/* auto-rows-max + shrink-0 (2026-10-05): the tiles are overflow-hidden,
              which lets CSS shrink their rows to nothing when the card is tight
              (seen squashed in /enhance). Rows keep their 16:9 height; the list
              scrolls instead. */}
          <div className="design-scroll grid shrink-0 auto-rows-max grid-cols-3 gap-2 @min-[26rem]:grid-cols-4 @min-[34rem]:grid-cols-5 @min-[46rem]:grid-cols-6">
            {noneTile}
            {templates === null ? skeletons : list.map((tpl) => tile(tpl))}
          </div>
          {list.length > 5 ? (
            <PickerExpandButton onClick={() => setExpanded(true)} disabled={disabled} />
          ) : null}
          {expandModal}
        </>
      )}
      {error || (templates && list.length === 0) ? (
        <span className={`text-[11px] ${error ? "text-red-400" : "text-foreground/50"}`}>
          {error ? t.failed : t.templatesEmpty}
        </span>
      ) : null}

      {/* Preview window: every slide of the template, then "Use this
          template" (a locked template still routes to the upgrade gate). */}
      <PickerExpandModal
        open={previewing != null}
        title={previewing ? nameOf(previewing) || t.preview : t.preview}
        onClose={() => setPreviewing(null)}
      >
        {previewing ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-xs text-foreground/60">
                <span>{slideCountLabel(previewing.slideCount)}</span>
                <PaletteDots colors={previewing.palette} />
              </div>
              <PillButton
                variant="primary"
                size="sm"
                icon={selectedId === previewing.id ? "check" : undefined}
                disabled={disabled}
                onClick={() => {
                  const tpl = previewing;
                  setPreviewing(null);
                  if (selectedId !== tpl.id) void pick(tpl);
                }}
              >
                {selectedId === previewing.id ? t.selected : t.useTemplate}
              </PillButton>
            </div>
            <div
              className={`grid gap-3 ${
                previewing.format === "9:16"
                  ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4"
                  : "grid-cols-1 sm:grid-cols-2 md:grid-cols-3"
              }`}
            >
              {slidesOf(previewing).map((src, i) => (
                <div
                  key={src}
                  className="relative overflow-hidden rounded-lg border border-[var(--tq-border-hairline)] bg-[var(--tq-surface)]"
                  style={{ aspectRatio: previewing.format === "9:16" ? "9/16" : "16/9" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
                  <span className="absolute bottom-1.5 start-1.5 rounded-full bg-black/60 px-1.5 text-[10px] font-medium text-white">
                    {i + 1}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </PickerExpandModal>

      <TemplateUpgradeModal gate={gate} onClose={() => setGate(null)} />
    </div>
  );
}

function PaletteDots({ colors }: { colors: readonly string[] }) {
  if (colors.length === 0) return null;
  return (
    <span className="flex items-center" aria-hidden>
      {colors.slice(0, 5).map((c, i) => (
        <span
          key={`${c}-${i}`}
          className="-ms-1 h-3.5 w-3.5 rounded-full border border-[var(--tq-surface)] first:ms-0"
          style={{ background: c }}
        />
      ))}
    </span>
  );
}

// One template tile. Hover flips through the slides (they mount on the first
// hover only, so an idle grid loads just the covers) with a segment bar
// showing where it is; the eye button opens the preview window and stays
// visible on touch screens, where there is no hover.
function TemplateTile({
  tpl,
  name,
  meta,
  big,
  wide,
  active,
  locked,
  freeBadge,
  mineBadge,
  loading,
  disabled,
  previewLabel,
  onPick,
  onPreview,
}: {
  tpl: PickerTemplate;
  name: string;
  meta: string;
  big: boolean;
  wide: boolean;
  active: boolean;
  locked: boolean;
  freeBadge: string | null;
  mineBadge: string | null;
  loading: boolean;
  disabled: boolean;
  previewLabel: string;
  onPick: () => void;
  onPreview: () => void;
}) {
  const slides = slidesOf(tpl);
  const [hover, setHover] = useState(false);
  const [seen, setSeen] = useState(false);
  const [idx, setIdx] = useState(0);
  const flips = hover && slides.length > 1;

  useEffect(() => {
    if (!flips) return;
    const id = window.setInterval(() => setIdx((i) => (i + 1) % slides.length), FLIP_MS);
    return () => window.clearInterval(id);
  }, [flips, slides.length]);

  const showInfo = wide || big;
  return (
    <div
      className="group relative"
      onMouseEnter={() => {
        setHover(true);
        setSeen(true);
      }}
      onMouseLeave={() => {
        setHover(false);
        setIdx(0);
      }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={onPick}
        title={name || undefined}
        aria-pressed={active}
        className={`pick-tile relative flex w-full flex-col text-start disabled:cursor-not-allowed ${
          wide ? "rounded-xl p-1.5" : "rounded-lg p-1"
        } ${active ? "is-active" : ""}`}
      >
        <div
          className={`relative w-full overflow-hidden bg-[var(--tq-surface)] ${wide ? "rounded-lg" : "rounded-md"}`}
          style={{ aspectRatio: "16/9" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={tpl.thumbnailUrl}
            alt=""
            loading="lazy"
            className={`h-full w-full object-cover transition-[opacity,transform] duration-300 ${
              loading ? "opacity-40" : ""
            } ${wide ? "group-hover:scale-[1.03]" : ""}`}
          />
          {seen
            ? slides.slice(1).map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={src}
                  src={src}
                  alt=""
                  className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
                    idx === i + 1 ? "opacity-100" : "opacity-0"
                  }`}
                />
              ))
            : null}
          {flips ? (
            <span className="pointer-events-none absolute inset-x-1.5 bottom-1.5 flex gap-0.5" aria-hidden>
              {slides.map((src, i) => (
                <span
                  key={src}
                  className={`h-[3px] flex-1 rounded-full ${i === idx ? "bg-white" : "bg-white/40"}`}
                />
              ))}
            </span>
          ) : null}
          {loading ? (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="spinner h-5 w-5 rounded-full border-2 border-white/30 border-t-white" />
            </span>
          ) : null}
          {locked ? (
            <PremiumBadge className="pointer-events-none absolute end-1 top-1 scale-90" />
          ) : null}
          {freeBadge ? (
            <span className="absolute end-1 top-1 rounded-full bg-[var(--tq-brand-blue)] px-1.5 py-0.5 text-[9px] font-semibold text-white">
              {freeBadge}
            </span>
          ) : null}
          {mineBadge && !flips ? (
            <span className="absolute bottom-1 start-1 rounded-full bg-black/65 px-1.5 py-0.5 text-[9px] font-medium text-white">
              {mineBadge}
            </span>
          ) : null}
          {active ? (
            <span className="absolute start-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--tq-brand-blue)] text-white shadow">
              <span className="material-symbols-outlined" style={{ fontSize: 14 }} aria-hidden>
                check
              </span>
            </span>
          ) : null}
        </div>
        {showInfo ? (
          <span className="mt-2 flex w-full items-center justify-between gap-2 px-0.5">
            <span className="min-w-0">
              <span className={`block truncate font-medium text-foreground/85 ${wide ? "text-[13px]" : "text-xs"}`}>
                {name}
              </span>
              {wide ? (
                <span className="block text-[11px] text-foreground/50">{meta}</span>
              ) : null}
            </span>
            {wide ? <PaletteDots colors={tpl.palette} /> : null}
          </span>
        ) : null}
      </button>
      {/* The preview opener sits on the image's bottom end corner; always
          shown where there is no hover (touch). */}
      <button
        type="button"
        onClick={onPreview}
        aria-label={`${previewLabel}${name ? `: ${name}` : ""}`}
        title={previewLabel}
        className={`absolute flex items-center justify-center rounded-full bg-black/65 text-white opacity-0 transition-opacity hover:bg-black/80 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100 ${
          wide ? "end-3 h-8 w-8" : "end-2 h-6 w-6"
        } ${
          // Below the crown / free badge when one sits in that corner.
          locked || freeBadge ? (wide ? "top-10" : "top-8") : wide ? "top-3" : "top-2"
        }`}
      >
        <span className="material-symbols-outlined" style={{ fontSize: wide ? 17 : 14 }} aria-hidden>
          visibility
        </span>
      </button>
    </div>
  );
}
