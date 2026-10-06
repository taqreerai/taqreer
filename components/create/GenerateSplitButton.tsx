"use client";

// Shared Generate CTA — the pill-shaped split button used at the
// end of the create flow (post-summary) AND on the single-shot
// /enhance/content page. Two clickable halves inside one glass
// pill:
//
//   ┌──────────────────┬───┐
//   │  ✨ إنشاء          │ ▲ │   ← right half opens preset menu
//   └──────────────────┴───┘
//
// The visual chrome is the canonical `.btn-gradient-anim` class
// (animated mesh-stroke at idle + full-body gradient on hover —
// the design system's signal for "Claude does work here", see
// globals.css PATTERN 4). The menu pops ABOVE the button so it
// doesn't trigger a viewport scroll on shorter screens (matches
// /create/summary's anchoring).
//
// Lifted out of app/create/summary/page.tsx 2026-05-25 so the
// /enhance flow's single-shot page can reuse the exact same CTA
// (per "reuse existing components" rule). Both call sites pass
// their own `onGenerate`, `quality`, `disabled`, `loading`.

import { TEASER_DEFAULT_TOTAL, TEASER_VISIBLE_COUNT } from "@/lib/credits/cost";
import { imageCreditsForPlan } from "@/lib/images/images-gating";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  QUALITY_PRESETS,
  type Quality,
} from "@/lib/types/quality";
import { useDict } from "@/components/i18n/LocaleProvider";
import {
  CREDIT_COST,
  TIERS,
  TIER_ORDER,
  SYSTEM_SLIDE_CAP,
  imagesSurcharge,
  MIN_REDUCED_SLIDES,
} from "@/lib/credits/cost";
import { normalizePlan, planLabel } from "@/lib/plan";
import {
  useCreditBalance,
  formatCredits,
  type CreditPreset,
} from "@/lib/credits/store";
import { fillPricingTokens } from "@/lib/credits/pricing-tokens";
import { UpgradeModal } from "@/components/billing/UpgradeModal";
import { SlideCapUpsellDialog } from "./SlideCapUpsellDialog";
import type { KnownPlan } from "@/lib/plan";
import { PremiumCrown } from "@/components/billing/PremiumCrown";

// Pre-hydration fallback = the bundled snapshot (matches the seed). Once
// /api/credits resolves, the picker uses the DB-driven `credits.presets` so an
// admin-toggled-inactive preset disappears and cost/gating track Settings edits.
const FALLBACK_PRESETS: CreditPreset[] = QUALITY_PRESETS.filter(
  // Inactive presets never render - matches getActivePresets() server-side,
  // so the pre-hydration menu can't flash a preset /api/credits will drop.
  (p) => p.active,
).map((p) => ({
  key: p.key,
  label: p.label,
  thinking: p.thinking,
  effort: p.effort,
  baseCredits: CREDIT_COST[p.key]?.base ?? 0,
  perSlideCredits: CREDIT_COST[p.key]?.perSlide ?? 0,
  gateTier: TIER_ORDER.find((t) => TIERS[t].presets.includes(p.key)) ?? null,
}));

// Design-quality name by LADDER RANK (Sonnet restructure + Fable-for-Max
// 2026-07-21). Multiple no-thinking presets exist (Sonnet + opus-fast), so the
// old thinking-based level collided. Name by position instead - presets arrive
// sorted by sortOrder (cheapest first): 0 = basic, 1 = balanced, 2 = advanced,
// 3+ = pro (Fable, Max-only). The four "level" keys map to the dict labels
// (draftDesign="أساسي", standardDesign="متوازن", premiumDesign="متقدم",
// proDesign="احترافي").
function designLevel(rank: number): "draft" | "standard" | "premium" | "pro" {
  if (rank <= 0) return "draft";
  if (rank === 1) return "standard";
  if (rank === 2) return "premium";
  return "pro";
}

export function GenerateSplitButton({
  onGenerate,
  quality,
  onQualityChange,
  // Slide count drives the ETA shown in the preset menu. Falls
  // back to 8 (the historical default) when missing — the menu
  // is decorative anyway, no real consequence.
  slideCount,
  // AUTO (model-decided) count: slideCount is the held CEILING, not a
  // committed size - the per-preset estimate renders as "up to N cr" so
  // the shown maximum still equals the held maximum (price == charge
  // parity; the settle refunds down to the authored count).
  slideCountUpTo = false,
  // Images-mode deck: the per-preset estimate carries the per-image
  // surcharge, mirroring the server quote (preflight) so the shown
  // number stays the held number (price == charge parity).
  imagesMode = false,
  disabled = false,
  loading = false,
  // Label override — defaults to the localized "Create" (the create-flow term,
  // dict.flows.generate.create). /enhance can pass its own copy. Pass through.
  label,
  loadingLabel,
  // Signed-out visitor on /create (2026-10-06): no balance to wait for and no
  // trial pop-up yet; the click goes straight to `onGenerate` (which opens the
  // sign-up window). The pop-up shows after sign-up, via autoStart.
  guest = false,
  // Back from the sign-up with a restored draft: press Generate once, by
  // itself, as soon as the balance has loaded and the button is enabled (a
  // free user then sees the trial pop-up, as on a real click).
  autoStart = false,
}: {
  onGenerate: () => void;
  quality: Quality;
  onQualityChange: (next: Quality) => void;
  slideCount?: number | null;
  slideCountUpTo?: boolean;
  imagesMode?: boolean;
  disabled?: boolean;
  loading?: boolean;
  label?: string;
  loadingLabel?: string;
  guest?: boolean;
  autoStart?: boolean;
}) {
  const dict = useDict();
  const resolvedLabel = label ?? dict.flows.generate.create;
  const resolvedLoadingLabel = loadingLabel ?? dict.flows.generate.creating;
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  // Gated-preset click → upgrade modal (pricing cards + embedded
  // checkout in place, user direction 2026-06-12). Holds the tier
  // that gates the clicked preset; null = closed.
  const [upgradeTier, setUpgradeTier] = useState<KnownPlan | null>(null);
  // Free-tier slide-cap upsell shown on the Generate click (before generating).
  const [showSlideCapUpsell, setShowSlideCapUpsell] = useState(false);
  const splitButtonRef = useRef<HTMLDivElement>(null);

  // Close the menu on outside click / Escape. Same shape as the
  // inline version in /create/summary (single source of truth now).
  useEffect(() => {
    if (!presetMenuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!splitButtonRef.current?.contains(event.target as Node)) {
        setPresetMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPresetMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [presetMenuOpen]);

  // Live balance for the per-preset credit estimate (§3a of the
  // subscription model: model choice is a cost choice, made with the
  // price in view). Null until the first fetch - rows render without
  // the credit chip rather than with a wrong number.
  const credits = useCreditBalance();
  // Free trial teaser (owner direction 2026-10-05): the price shown is the
  // FULL deck's (what the whole deck is worth), but a free (non-admin) deck
  // only builds and charges the first TEASER_VISIBLE_COUNT slides, so
  // affordability is judged on those (no amber "can't afford" on a long
  // deck the 400 signup credits do cover). Auto plans TEASER_DEFAULT_TOTAL
  // slides for free users, same as the server (app/api/projects/route.ts).
  const teaserPriced = !!credits && !credits.isAdmin && credits.plan === "free";
  const requestedSlides =
    teaserPriced && slideCountUpTo
      ? TEASER_DEFAULT_TOTAL
      : slideCount && slideCount > 0
        ? slideCount
        : 8;
  const effectiveSlideCount = requestedSlides;
  // Tier gating pill: the lowest tier whose preset list carries each
  // preset. Rows above the user's plan show that tier name as a pill
  // (clicking still works - preflight 402s into the upgrade dialog).
  const userPlan = credits ? normalizePlan(credits.plan) : null;
  // Free tier gets the slide-cap upsell popup on Generate (every run). Treat an
  // unknown plan (credits not loaded yet) as free — normalizePlan defaults
  // unknown to "free" — so a free user can't skip the upsell by clicking
  // Generate during the brief credits-load race. `userPlan` stays
  // null-until-loaded for the preset-gating logic below, which must not gate
  // before the balance resolves.
  const isFree = normalizePlan(credits?.plan) === "free";
  // Admin/superuser: every preset is unlocked and no credit cost shows
  // (the run is never charged). Mirrors the server preflight bypass.
  const isAdmin = credits?.isAdmin ?? false;
  // DB-driven active presets from admin Settings; bundled fallback until the
  // first /api/credits resolves. Inactive presets are absent -> never shown.
  // Also hide presets that NO tier unlocks (gateTier null) from non-admins:
  // they'd render ungated/selectable but the server refuses them with
  // preset_locked. Admins see everything (they bypass gating). This also covers
  // the transient state where a preset is added but not yet unlocked in a tier.
  const presets = (credits?.presets ?? FALLBACK_PRESETS).filter(
    (p) => isAdmin || p.gateTier !== null,
  );

  // Highlight reconciliation: if the selected quality is no longer an ACTIVE
  // preset (admin retired it), highlight the default the server coerces to - but
  // only if that default is a RENDERED row; else the first listed preset, so the
  // highlight never lands on a row the picker doesn't show.
  const reconciledKey =
    presets.find((p) => p.key === credits?.defaultPresetKey)?.key ??
    presets[0]?.key ??
    quality;
  const effectiveQuality = presets.some((p) => p.key === quality)
    ? quality
    : reconciledKey;

  // The Generate click. Credits not resolved yet: no-op (sub-second window).
  // Closes BOTH load races - a free user can't skip the upsell, and an admin
  // can't be shown it (CR #154). The button stays visually enabled; the next
  // click lands normally. Free tier: the trial pop-up before generating
  // (restored 2026-10-05, owner direction): only the first
  // TEASER_VISIBLE_COUNT slides are designed; see plans or design those.
  const startGenerate = () => {
    if (guest) {
      onGenerate();
      return;
    }
    if (!credits) return;
    if (isFree && !isAdmin) {
      setShowSlideCapUpsell(true);
      return;
    }
    onGenerate();
  };

  // autoStart: one press per mount, once the click would actually land.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStarted.current || guest) return;
    if (!credits || disabled || loading) return;
    autoStarted.current = true;
    // Next tick, outside the effect body (set-state-in-effect); not
    // cancelled on re-render, the ref already marks it done.
    window.setTimeout(startGenerate, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startGenerate is rebuilt every render; the guard flags above are the real triggers
  }, [autoStart, guest, credits, disabled, loading]);

  return (
    <div ref={splitButtonRef} className="relative">
      {/* Outer pill — the `.btn-gradient-anim` class supplies the full animated
          chrome (border + hover fill). Inner buttons carry no background of their
          own. The pill inherits the locale direction so the two halves mirror in
          RTL (Generate on the start side, Quality on the end side); the inner
          buttons round with logical start/end radii to match. */}
      <div
        className="btn-gradient-anim group relative flex h-11 items-stretch transition-shadow"
        style={{ borderRadius: 9999 }}
      >
        {/* Generate half — `motion.button` with `layout` so the pill
            width transitions smoothly when the label switches between
            the idle term ("إنشاء", short) and the loading variant
            ("جار الإنشاء...", longer). Without `layout` the button
            snaps to its new width in one frame, which reads as a
            jarring "expand" the moment loading kicks in. `layout`
            measures the before/after size and tweens. Position
            animation only — bfcache-safe (verified pattern from
            ProjectsGrid 2026-05-25). */}
        <motion.button
          layout
          type="button"
          onClick={startGenerate}
          disabled={disabled || loading}
          aria-label={label}
          className="relative z-10 inline-flex items-center justify-center gap-2 rounded-s-full bg-transparent px-6 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
          transition={{ duration: 0.22, ease: "easeOut" }}
        >
          {loading ? (
            <span className="spinner h-4 w-4 rounded-full border-2 border-foreground/30 border-t-white" />
          ) : (
            <span
              className="material-symbols-outlined leading-none"
              style={{ fontSize: 18 }}
            >
              auto_awesome
            </span>
          )}
          <span>{loading ? resolvedLoadingLabel : resolvedLabel}</span>
        </motion.button>
        {/* 1 px divider between the two clickable areas. Muted via
            the glass-border opacity token (--tq-border-hairline). */}
        <span
          aria-hidden
          className="my-2 w-px bg-[var(--tq-border-hairline)] group-hover:bg-white/25"
        />
        {/* Quality selector = the split-button's right half. A visible "جودة"
            label next to the chevron so it reads as the quality control instead
            of a bare arrow. Keeps the pill's transparent surface. */}
        <button
          type="button"
          onClick={() => setPresetMenuOpen((v) => !v)}
          disabled={disabled || loading}
          aria-label={presetMenuOpen ? dict.flows.generate.closeQualityMenu : dict.flows.generate.chooseQuality}
          aria-expanded={presetMenuOpen}
          className="relative z-10 inline-flex items-center gap-1.5 rounded-e-full bg-transparent px-3.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span>{dict.flows.generate.qualityLabel}</span>
          <span
            className={`material-symbols-outlined leading-none transition-transform ${
              presetMenuOpen ? "rotate-180" : ""
            }`}
            style={{ fontSize: 18 }}
          >
            expand_less
          </span>
        </button>
      </div>

      {/* Preset menu — pops ABOVE the split button. Anchored to
          bottom-full + mb-2 so it never triggers viewport scroll. */}
      <AnimatePresence>
        {presetMenuOpen ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 4 }}
            transition={{ type: "spring", bounce: 0.25, duration: 0.25 }}
            className=" absolute start-0 bottom-full z-30 mb-2 w-[28rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border bg-[var(--tq-surface)] border-[var(--tq-border-hairline)]"
          >
            <div className="flex items-center justify-between px-4 py-2.5 text-[11px] text-foreground/40">
              <span>{dict.flows.generate.generationQuality}</span>
              {/* Balance shows for EVERYONE (admins included) - it's the
                  denominator the per-row estimates are judged against. */}
              {credits ? (
                <span dir="ltr" className="tabular-nums">
                  {dict.flows.generate.balance.replace(
                    "{count}",
                    formatCredits(credits.balance.total),
                  )}
                </span>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5 px-2 pb-2">
            {presets.map((preset, presetRank) => {
              // Ladder rank drives the design-quality name (see designLevel).
              const level = designLevel(presetRank);
              // The row's sub-line names the MODEL. `{model}` is filled from the
              // preset's LIVE label (DB-driven once /api/credits resolves), so an
              // admin model swap shows up here instead of the old hardcoded
              // family names. `|| preset.key` because fillPricingTokens leaves the
              // token intact on a falsy value. The thinking word comes off the
              // preset's own flag, so it can't outlive a non-thinking preset.
              const descTemplate =
                level === "pro"
                  ? dict.flows.generate.proDesignDesc
                  : level === "premium"
                    ? dict.flows.generate.premiumDesignDesc
                    : level === "standard"
                      ? dict.flows.generate.standardDesignDesc
                      : dict.flows.generate.draftDesignDesc;
              const rowDesc = `${fillPricingTokens(descTemplate, {
                model: preset.label || preset.key,
              })}${
                preset.thinking
                  ? ` ${dict.flows.generate.thinkingSuffix}`
                  : ""
              }`;
              const rowCost = (slides: number) =>
                preset.baseCredits +
                slides * preset.perSlideCredits +
                // Same surcharge the server holds (preset-independent);
                // live DB rate once /api/credits resolves, constant before.
                // Free plan: 0 per image (trial perk), same rule as the hold.
                imagesSurcharge(
                  slides,
                  imagesMode,
                  credits
                    ? imageCreditsForPlan(credits.plan, credits.imageCredits)
                    : undefined,
                );
              // "Up to" (auto) ceiling: mirror preflight's probe-down so the
              // shown maximum equals what the server will actually HOLD for
              // this preset - a low balance lowers the ceiling instead of
              // showing an unpayable tier-cap price (CR #154). Floor at
              // MIN_REDUCED_SLIDES; below it the server blocks anyway and
              // the unaffordable amber styling tells the story.
              let rowSlides = effectiveSlideCount;
              if (slideCountUpTo && !isAdmin && credits && !teaserPriced) {
                while (
                  rowSlides > MIN_REDUCED_SLIDES &&
                  rowCost(rowSlides) > credits.balance.total
                ) {
                  rowSlides--;
                }
              }
              const cost = rowCost(rowSlides);
              const gateTier = preset.gateTier;
              const gated =
                !isAdmin &&
                userPlan !== null &&
                gateTier !== null &&
                TIER_ORDER.indexOf(userPlan) < TIER_ORDER.indexOf(gateTier);
              const affordable = credits
                ? (teaserPriced
                    ? rowCost(Math.min(rowSlides, TEASER_VISIBLE_COUNT))
                    : cost) <= credits.balance.total
                : true;
              const active = effectiveQuality === preset.key;
              return (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => {
                    setPresetMenuOpen(false);
                    // A gated preset doesn't select - it upsells.
                    if (gated && gateTier) {
                      setUpgradeTier(gateTier);
                      return;
                    }
                    onQualityChange(preset.key);
                  }}
                  // Each level is a card; the selected one gets the brand-blue
                  // outline + check (2026-10-01 quality-menu redesign).
                  className={`quality-option flex w-full items-center gap-3 rounded-xl px-3 py-3 text-start ${
                    active ? "is-active text-foreground" : "text-foreground/75 hover:text-foreground"
                  }`}
                >
                  {/* Check + title/description column. The DESIGN-LEVEL
                      name is the row title (user direction 2026-07-08:
                      chips dropped as redundant next to the descriptions;
                      without them the model label alone would read
                      "Opus 4.8" three times). */}
                  <span
                    className="material-symbols-outlined shrink-0 leading-none text-[var(--tq-brand-blue)]"
                    style={{ fontSize: 18, opacity: active ? 1 : 0 }}
                  >
                    check
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {level === "pro"
                        ? dict.flows.generate.proDesign
                        : level === "premium"
                          ? dict.flows.generate.premiumDesign
                          : level === "standard"
                            ? dict.flows.generate.standardDesign
                            : dict.flows.generate.draftDesign}
                    </span>
                    {/* The middle rung is the suggested default. */}
                    {level === "standard" ? (
                      <span className="quality-recommended shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none">
                        {dict.flows.generate.recommended}
                      </span>
                    ) : null}
                    </span>
                    <span className="truncate text-xs text-foreground/45">
                      {rowDesc}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2.5">
                    {gated && gateTier ? (
                      // Gated tier: gold crown + plan name, the same premium
                      // mark as every other paid option (click upsells).
                      <span className="badge-premium">
                        <PremiumCrown size={12} />
                        {planLabel(dict.components.planUsage, gateTier)}
                      </span>
                    ) : null}
                    {/* Per-preset credit estimate - the same cost table the
                        ledger charges from (lib/credits/cost.ts), so the
                        shown number IS the held number. Shown for everyone
                        (it replaced the design chip as the row's key fact);
                        amber when the balance doesn't cover it. */}
                    {/* Neutral colour: gold now means "premium", so the
                        cost no longer turns amber when unaffordable; a
                        muted line says so instead. */}
                    <span className="flex min-w-16 flex-col items-end gap-0.5">
                      <span
                        className="text-end text-xs font-medium tabular-nums text-foreground/70"
                        dir="ltr"
                      >
                        {(slideCountUpTo
                          ? dict.flows.generate.creditsEstimateUpTo
                          : dict.flows.generate.creditsEstimate
                        ).replace("{credits}", formatCredits(cost))}
                      </span>
                      {!affordable ? (
                        <span className="text-[10px] text-foreground/40">
                          {dict.flows.generate.notEnoughCredits}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              );
            })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Free-tier slide-cap upsell — shown before generating. Reuses the
          canonical dialog shell + the design-system button primitives. */}
      <SlideCapUpsellDialog
        open={showSlideCapUpsell}
        cap={TEASER_VISIBLE_COUNT}
        max={SYSTEM_SLIDE_CAP}
        // Dismiss (X / Esc / outside-click): cancel, don't generate.
        onClose={() => setShowSlideCapUpsell(false)}
        // Continue: proceed with generation. The free tier's slide cap is
        // enforced upstream (slide picker) + server-side (preflight), so this
        // is just the normal generate path.
        onContinue={() => {
          setShowSlideCapUpsell(false);
          onGenerate();
        }}
        // See plans: close this and open the pricing modal at the first paid
        // tier (any paid plan unlocks the full deck).
        onUpgrade={() => {
          setShowSlideCapUpsell(false);
          setUpgradeTier("plus");
        }}
      />

      <UpgradeModal
        open={upgradeTier !== null}
        requiredTier={upgradeTier}
        onClose={() => setUpgradeTier(null)}
      />
    </div>
  );
}
