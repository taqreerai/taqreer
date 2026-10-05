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

import { PickerExpandButton, PickerExpandModal } from "@/components/create/PickerExpandModal";
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

export type PickedTemplate = { template: PickerTemplate; use: MimicTemplateUse };

export function TemplatePickerGrid({
  selectedId,
  onSelect,
  onClear,
  disabled = false,
}: {
  selectedId: string | null;
  onSelect: (picked: PickedTemplate) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const dict = useDict();
  const { locale } = useLocale();
  const t = dict.flows.design;
  const [expanded, setExpanded] = useState(false);
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

  const tile = (tpl: PickerTemplate, big = false) => {
    const locked = lockFor(tpl) != null;
    const active = selectedId === tpl.id;
    const name = (locale === "en" ? tpl.name.en : tpl.name.ar) ?? undefined;
    return (
      <button
        key={tpl.id}
        type="button"
        disabled={disabled || (loadingId != null && loadingId !== tpl.id)}
        onClick={() => {
          if (big) setExpanded(false);
          void pick(tpl);
        }}
        title={name}
        aria-pressed={active}
        className={`pick-tile relative rounded-lg p-1 disabled:cursor-not-allowed ${
          active ? "is-active" : ""
        }`}
      >
        <div className="relative overflow-hidden rounded-md bg-[var(--tq-surface)]" style={{ aspectRatio: "16/9" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={tpl.thumbnailUrl}
            alt=""
            loading="lazy"
            className={`h-full w-full object-cover transition-opacity ${loadingId === tpl.id ? "opacity-40" : ""}`}
          />
          {loadingId === tpl.id ? (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="spinner h-5 w-5 rounded-full border-2 border-white/30 border-t-white" />
            </span>
          ) : null}
          {locked ? (
            <PremiumBadge className="pointer-events-none absolute end-1 top-1 scale-90" />
          ) : null}
          {flowLocked && tpl.isFree ? (
            <span className="absolute end-1 top-1 rounded-full bg-[var(--tq-brand-blue)] px-1.5 py-0.5 text-[9px] font-semibold text-white">
              {t.freeBadge}
            </span>
          ) : null}
          {tpl.isMine ? (
            <span className="absolute bottom-1 start-1 rounded-full bg-black/65 px-1.5 py-0.5 text-[9px] font-medium text-white">
              {t.mine}
            </span>
          ) : null}
        </div>
        {big && name ? (
          <span className="mt-1.5 block truncate px-0.5 text-start text-xs font-medium text-foreground/80">
            {name}
          </span>
        ) : null}
      </button>
    );
  };

  const noneTile = (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        setExpanded(false);
        if (selectedId) onClear();
      }}
      title={t.noTemplateDesc}
      aria-pressed={selectedId === null}
      className={`pick-tile rounded-lg p-1 ${selectedId === null ? "is-active" : ""}`}
    >
      <div
        className="flex flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-[var(--tq-border-hairline)] text-foreground/70"
        style={{ aspectRatio: "16/9" }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>
          auto_awesome
        </span>
        <span className="text-[10px] font-medium">{t.noTemplate}</span>
      </div>
    </button>
  );

  const list = templates ?? [];

  return (
    <div className="@container flex flex-col gap-1.5">
      {/* auto-rows-max + shrink-0 (2026-10-05): the tiles are overflow-hidden,
          which lets CSS shrink their rows to nothing when the card is tight
          (seen squashed in /enhance). Rows keep their 16:9 height; the list
          scrolls instead. */}
      <div className="design-scroll grid shrink-0 auto-rows-max grid-cols-3 gap-2 @min-[26rem]:grid-cols-4 @min-[34rem]:grid-cols-5 @min-[46rem]:grid-cols-6">
        {noneTile}
        {templates === null
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-lg bg-[var(--tq-overlay-soft)]" style={{ aspectRatio: "16/10" }} />
            ))
          : list.map((tpl) => tile(tpl))}
      </div>
      {list.length > 5 ? (
        <PickerExpandButton onClick={() => setExpanded(true)} disabled={disabled} />
      ) : null}
      <PickerExpandModal
        open={expanded}
        title={t.allTemplates}
        onClose={() => setExpanded(false)}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {noneTile}
          {list.map((tpl) => tile(tpl, true))}
        </div>
      </PickerExpandModal>
      {error || (templates && list.length === 0) ? (
        <span className={`text-[11px] ${error ? "text-red-400" : "text-foreground/50"}`}>
          {error ? t.failed : t.templatesEmpty}
        </span>
      ) : null}

      <TemplateUpgradeModal gate={gate} onClose={() => setGate(null)} />
    </div>
  );
}
