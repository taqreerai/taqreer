"use client";

// /social flow (v3): a normal Claude HTML deck at social-media ratios, exported
// PDF/PNG. 3-card layout forked from /datasheet so the design system stays
// consistent. It posts `type: "social"` + `brand.slideSize` = the chosen ratio;
// the deck engine + full studio + pricing are reused unchanged.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import {
  CreditGateDialog,
  isCreditGatePayload,
  type CreditGatePayload,
} from "@/components/credits/CreditGateDialog";
import { useSlideCap } from "@/lib/credits/store";
import { displaySlideEstimate, slideCapForFlow } from "@/lib/credits/cost";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { GenerateSplitButton } from "@/components/create/GenerateSplitButton";
import { BrandFontPicker } from "@/components/brand/BrandFontPicker";
import { LogoRow } from "@/components/brand/LogoRow";
import { PersistentRow } from "@/components/brand/PersistentRow";
import {
  BrandKitDropdown,
  type BrandKitOption,
} from "@/components/brand/BrandKitDropdown";
import { ColorPickerPopover } from "@/components/create/ColorPickerPopover";
import { InlineStepper, type SlideCountMode } from "@/components/create/OutputCards";
import { DesignStylePicker } from "@/components/create/DesignStylePicker";
import { AIImagesPanel } from "@/components/brand/AIImagesPanel";
import {
  CardHeader,
  SegmentedToggle,
  Toggle,
  type LanguageCode,
} from "@/components/create/controls";
import {
  emptyBrandFont,
  googleFontUrl,
  HEADING_SAMPLE_AR,
  HEADING_SAMPLE_LATIN,
  type BrandFontState,
} from "@/lib/brand/fonts";
import {
  uploadAsset,
  resolveUploadedFontFamilies,
  type UploadedFontFieldBrief,
} from "@/lib/brand/upload";
import { DEFAULT_QUALITY, type Quality } from "@/lib/types/quality";
import {
  readBrandFromSession,
  fetchDefaultBrandKit,
  mapKitToHydrated,
  CREATE_BRAND_KEY,
  type HydratedBrand,
} from "@/lib/create/hydrate-brand-from-session";
import type { SlideFormat } from "@/lib/schema/slide";
import { localizedHref } from "@/lib/i18n/navigation";
import {
  DEFAULT_PLATFORM,
  defaultRatioFor,
  type SocialPlatform,
} from "@/lib/social/platforms";
import { SocialFormatFields } from "@/components/social/SocialFormatFields";

const MIN_PALETTE = 2;
const MAX_PALETTE = 6;
const DEFAULT_PALETTE = ["#000000", "#FFFFFF"];
const CARD_MIN_H_CLASS = "min-h-[440px]";

type ResolvedFontField = {
  name: string;
  url: string | null;
  storageUrl: string | null;
  family: string;
} | null;

function fewWords(s: string, max = 3): string {
  const parts = s.trim().split(/\s+/).filter(Boolean);
  return parts.length <= max ? s.trim() : `${parts.slice(0, max).join(" ")}…`;
}

export default function SocialPage() {
  const dict = useDict();
  const { dir, locale } = useLocale();
  const router = useRouter();

  const LANGUAGE_OPTIONS: { value: LanguageCode; label: string }[] = [
    { value: "ar", label: dict.flows.langArabic },
    { value: "en", label: dict.flows.langEnglish },
  ];
  // Slide-count control mirrors /create: Auto (model decides from the content)
  // or Custom (a fixed count via the stepper). Same mechanism so the credit
  // price is estimated + held identically.
  const SLIDE_COUNT_OPTIONS = [
    { value: "auto" as const, label: dict.flows.auto },
    { value: "custom" as const, label: dict.flows.custom },
  ];

  // ─── Content ───────────────────────────────────────────────────
  const [topic, setTopic] = useState("");
  const [language, setLanguage] = useState<LanguageCode>("ar");
  // Persistent element (date, handle, website) repeated on every card.
  const [persistentText, setPersistentText] = useState<string>("");

  // ─── Design / format ───────────────────────────────────────────
  const [platform, setPlatform] = useState<SocialPlatform>(DEFAULT_PLATFORM);
  const [format, setFormat] = useState<SlideFormat>(
    defaultRatioFor(DEFAULT_PLATFORM).format,
  );
  const [slideCountMode, setSlideCountMode] = useState<SlideCountMode>("auto");
  const [slideCountValue, setSlideCountValue] = useState<number>(6);
  // Cap to a carousel-sane max (SOCIAL_SLIDE_CAP) below the tier cap, so AUTO's
  // "up to" estimate + the Custom stepper never price a post like a 75-slide
  // deck. Matches the server hold (preflight uses the same slideCapForFlow).
  const slideCap = slideCapForFlow("social", useSlideCap());
  // Clamp the custom pick to the tier ceiling (also covers a mid-session
  // downgrade). Preflight rejects an over-cap run server-side regardless.
  if (slideCountValue > slideCap) setSlideCountValue(slideCap);
  const [designStyle, setDesignStyle] = useState<string | null>(null);
  // AI images toggle — same as /create (default on). Social posts lean hard on
  // imagery, so it stays a first-class, user-controllable switch.
  const [imagesMode, setImagesMode] = useState<boolean>(true);

  // ─── Branding (identical to /datasheet + /create) ──────────────
  const [colors, setColors] = useState<string[]>([]);
  const [brandFont, setBrandFont] = useState<BrandFontState>(emptyBrandFont());
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [loadedLogo, setLoadedLogo] = useState<HydratedBrand["logo"]>(null);
  const [saveBrandKit, setSaveBrandKit] = useState<boolean>(false);
  const [kitOptions, setKitOptions] = useState<BrandKitOption[]>([]);
  const kitRawRef = useRef<Map<string, unknown>>(new Map());

  const applyBrand = useCallback((h: HydratedBrand) => {
    if (h.colors.length > 0) setColors(h.colors);
    const heading = h.headingFontSlot;
    if (heading.googleFamily) {
      setBrandFont({
        mode: "google",
        googleFamily: heading.googleFamily,
        uploaded: [],
      });
    } else if (heading.uploadStorageUrl) {
      setBrandFont({
        mode: "upload",
        googleFamily: null,
        uploaded: [
          {
            name: heading.uploadName ?? heading.uploadFamily ?? "Custom",
            faces: [
              { weight: 400, file: null, storageUrl: heading.uploadStorageUrl },
            ],
          },
        ],
      });
    }
    if (h.logo) {
      setLogoFile(null);
      setLoadedLogo(h.logo);
    }
  }, []);

  useEffect(() => {
    let aborted = false;
    (async () => {
      let hydrated = readBrandFromSession();
      if (!hydrated) hydrated = await fetchDefaultBrandKit();
      if (aborted || !hydrated) return;
      applyBrand(hydrated);
      try {
        window.sessionStorage.removeItem(CREATE_BRAND_KEY);
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      aborted = true;
    };
  }, [applyBrand]);

  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const res = await fetch("/api/brand-kits", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          kits?: Array<{ id: string; name: string }>;
        };
        if (aborted || !Array.isArray(data.kits)) return;
        const last5 = data.kits.slice(0, 5);
        kitRawRef.current = new Map(last5.map((k) => [k.id, k]));
        setKitOptions(last5.map((k) => ({ id: k.id, name: fewWords(k.name) })));
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      aborted = true;
    };
  }, []);

  const handlePickKit = (id: string) => {
    const raw = kitRawRef.current.get(id);
    if (raw)
      applyBrand(
        mapKitToHydrated(raw as Parameters<typeof mapKitToHydrated>[0]),
      );
  };

  const updateColor = (index: number, next: string) =>
    setColors((c) => c.map((v, i) => (i === index ? next : v)));
  const addColor = () =>
    setColors((c) =>
      c.length === 0
        ? [...DEFAULT_PALETTE]
        : c.length >= MAX_PALETTE
          ? c
          : [...c, "#FFFFFF"],
    );
  const removeColor = (index: number) =>
    setColors((c) =>
      c.length <= MIN_PALETTE ? c : c.filter((_, i) => i !== index),
    );

  // ─── Submit ────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [creditGate, setCreditGate] = useState<CreditGatePayload | null>(null);
  const [quality, setQuality] = useState<Quality>(DEFAULT_QUALITY);

  // Split-button credit estimate. Custom = the exact pick; Auto = the model
  // decides, so the display is the held CEILING rendered as "up to" (same
  // contract as /create).
  const estimated = useMemo(
    () =>
      displaySlideEstimate(
        slideCountMode === "custom"
          ? { kind: "fixed", count: slideCountValue }
          : { kind: "text", text: topic },
        slideCap,
      ),
    [slideCountMode, slideCountValue, topic, slideCap],
  );
  const generateDisabled = topic.trim().length === 0 || submitting;

  const handleGenerate = async (overrideSlideCount?: number) => {
    const reduced =
      typeof overrideSlideCount === "number" ? overrideSlideCount : null;
    if (topic.trim().length === 0) return;
    setError("");
    setSubmitting(true);
    try {
      const logoUploaded = await uploadAsset("brand-assets", "logos", logoFile);

      let fontField: ResolvedFontField = null;
      const uploadedFontFields: UploadedFontFieldBrief[] = [];
      if (brandFont.uploaded.length === 0 && brandFont.googleFamily) {
        fontField = {
          name: brandFont.googleFamily,
          url: googleFontUrl(brandFont.googleFamily),
          storageUrl: null,
          family: brandFont.googleFamily,
        };
      } else if (brandFont.uploaded.length > 0) {
        const resolved = await resolveUploadedFontFamilies(brandFont.uploaded);
        uploadedFontFields.push(...resolved);
        if (uploadedFontFields.length > 0) {
          fontField = {
            name: uploadedFontFields[0].name,
            url: null,
            storageUrl: null,
            family: uploadedFontFields[0].name,
          };
        }
      }

      const noExclude: ("cover" | "closing")[] = [];
      const brand = {
        colors,
        paletteMode:
          colors.length > 0 ? ("manual" as const) : ("auto" as const),
        paletteScreenshotUrl: null,
        fonts: {
          heading: fontField,
          body: fontField,
          ...(uploadedFontFields.length > 0
            ? { uploaded: uploadedFontFields }
            : {}),
        },
        logo: (logoUploaded?.storageUrl ?? loadedLogo?.storageUrl)
          ? {
              storageUrl: (logoUploaded?.storageUrl ?? loadedLogo?.storageUrl)!,
              exclude: noExclude,
            }
          : null,
        slideSize: format,
        slideCount: {
          mode: slideCountMode,
          value: slideCountMode === "custom" ? slideCountValue : null,
        },
      };

      const rules = {
        designStyle,
        fixTypos: false,
        pagination: false,
        // Same shape /create sends: null when blank, else the text with an
        // EMPTY exclude list (the element is on every card by definition).
        // ‼️ `exclude` must stay present, not be dropped: the API payload type
        // declares it required and ruleLines() reads `.exclude.length`
        // unguarded, so omitting it throws at generation time.
        persistent: persistentText.trim()
          ? { text: persistentText.trim(), exclude: [] as ("cover" | "closing")[] }
          : null,
      };

      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "social",
          content: { type: "text", text: topic.trim() },
          brand,
          rules,
          language,
          saveBrandKit,
          slideCount:
            reduced ??
            (slideCountMode === "custom" ? slideCountValue : null),
          quality,
          imagesMode,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (response.status === 402 && isCreditGatePayload(data)) {
          setCreditGate(data);
          setSubmitting(false);
          return;
        }
        throw new Error(data?.error ?? dict.flows.createFailed);
      }

      const data = (await response.json()) as { projectId: string };
      // Locale-aware like /create: keep the UI locale (the deck's own language is
      // independent) so we don't cross the [lang] segment and force a root-layout
      // re-render (which trips React's "script tag on the client" warning).
      router.push(localizedHref(`/project/${data.projectId}`, locale));
    } catch (caughtError) {
      console.error("[social] generate failed:", caughtError);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : dict.flows.startFailed,
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="page-container flex w-full justify-center" dir={dir}>
      <CreditGateDialog
        gate={creditGate}
        onClose={() => setCreditGate(null)}
        onReduce={(slides) => {
          setCreditGate(null);
          void handleGenerate(slides);
        }}
      />
      <div className="mt-[6vh] flex w-full flex-col items-center gap-6 px-4">
        <header className="text-center">
          <h1 className="tq-h1">{dict.flows.social.title}</h1>
          <p className="tq-subhead mt-2">{dict.flows.social.subtitle}</p>
        </header>

        <div className="flex flex-wrap justify-center gap-4">
          {/* ── CONTENT CARD ──────────────────────────────────── */}
          <div
            className={`surface-card flex w-[360px] shrink-0 ${CARD_MIN_H_CLASS} flex-col gap-4 rounded-2xl p-4`}
          >
            <CardHeader icon="edit_note" title={dict.flows.social.contentCard} />
            <div className="flex flex-1 flex-col space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground/70">
                  {dict.flows.language}
                </span>
                <SegmentedToggle
                  options={LANGUAGE_OPTIONS}
                  value={language}
                  onChange={setLanguage}
                  ariaLabel={dict.flows.language}
                />
              </div>
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={dict.flows.social.topicPlaceholder}
                dir={language === "en" ? "ltr" : "rtl"}
                disabled={submitting}
                className="input-dark min-h-[240px] flex-1 resize-none text-sm leading-6 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            {/* Persistent element: the same control /create and /datasheet put
                at the bottom of the content card. Text only, Claude places it
                (position picker went away 2026-06-02), on every card. */}
            <div className="border-t border-[var(--tq-border-hairline)] pt-3">
              <PersistentRow
                text={persistentText}
                language={language}
                onText={setPersistentText}
              />
            </div>
          </div>

          {/* ── BRAND CARD (identical to /datasheet) ──────────── */}
          <div
            className={`surface-card flex w-[360px] shrink-0 ${CARD_MIN_H_CLASS} flex-col gap-4 rounded-2xl p-4`}
          >
            <header className="relative z-30 border-b border-foreground/[0.08] pb-4">
              <div className="relative flex items-center gap-2">
                <span
                  className="material-symbols-outlined text-foreground"
                  style={{ fontSize: 18 }}
                >
                  palette
                </span>
                <h3 className="text-sm font-semibold text-foreground">
                  {dict.flows.brandCard}
                </h3>
                {kitOptions.length > 0 ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.2 }}
                    className="absolute end-0 top-1/2 -translate-y-1/2"
                  >
                    <BrandKitDropdown kits={kitOptions} onSelect={handlePickKit} />
                  </motion.div>
                ) : null}
              </div>
            </header>

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-foreground/70">
                {dict.flows.colors}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setColors([])}
                  disabled={colors.length === 0}
                  aria-pressed={colors.length === 0}
                  title={dict.flows.autoColorsHint}
                  className={`flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors ${
                    colors.length === 0
                      ? "border-foreground/40 text-foreground"
                      : "border-dashed border-foreground/20 text-foreground/60 hover:border-foreground/40 hover:text-foreground"
                  }`}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 13 }}
                  >
                    auto_awesome
                  </span>
                  {dict.flows.autoColors}
                </button>
                {colors.map((color, index) => (
                  <InlinePaletteSwatch
                    key={index}
                    value={color}
                    index={index}
                    removable={colors.length > MIN_PALETTE}
                    onChange={(next) => updateColor(index, next)}
                    onRemove={() => removeColor(index)}
                    dict={dict}
                  />
                ))}
                {colors.length < MAX_PALETTE ? (
                  <button
                    type="button"
                    onClick={addColor}
                    aria-label={dict.flows.addColor}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-dashed border-foreground/20 text-foreground/60 transition-colors hover:border-foreground/40 hover:text-foreground"
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 14 }}
                    >
                      add
                    </span>
                  </button>
                ) : null}
              </div>
            </div>

            <div className="border-t border-[var(--tq-border-hairline)] pt-3">
              <BrandFontPicker
                value={brandFont}
                onChange={setBrandFont}
                sampleText={
                  language === "en" ? HEADING_SAMPLE_LATIN : HEADING_SAMPLE_AR
                }
              />
            </div>

            <div className="flex flex-1 flex-col gap-4 border-t border-[var(--tq-border-hairline)] pt-3">
              <span className="block text-xs font-semibold text-foreground/70">
                {dict.flows.logo}
              </span>
              <LogoRow
                file={logoFile}
                previewUrl={loadedLogo?.displayUrl ?? null}
                onSelect={(f) => {
                  setLogoFile(f);
                  setLoadedLogo(null);
                }}
                onRemove={() => {
                  setLogoFile(null);
                  setLoadedLogo(null);
                }}
              />
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-[var(--tq-border-hairline)] pt-2">
              <span className="text-xs font-semibold text-foreground/70">
                {dict.flows.saveAsDefault}
              </span>
              <Toggle
                ariaLabel={dict.flows.saveAsDefault}
                value={saveBrandKit}
                onChange={setSaveBrandKit}
              />
            </div>
          </div>

          {/* ── DESIGN CARD ───────────────────────────────────── */}
          <div
            className={`surface-card flex w-[360px] shrink-0 ${CARD_MIN_H_CLASS} flex-col gap-4 rounded-2xl p-4`}
          >
            <CardHeader icon="tune" title={dict.flows.social.designCard} />

            <SocialFormatFields
              platform={platform}
              onPlatform={setPlatform}
              format={format}
              onFormat={setFormat}
            />

            <div className="border-t border-[var(--tq-border-hairline)] pt-3">
              <div className="flex min-h-[24px] items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground/70">
                  {dict.flows.social.count}
                </span>
                {/* Same animated Auto/Custom + stepper as /create (spring
                    500/35): the toggle FLIPs over as the stepper grows in. */}
                <motion.div
                  layout
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  className="flex items-center gap-1.5"
                >
                  <SegmentedToggle
                    options={SLIDE_COUNT_OPTIONS}
                    value={slideCountMode}
                    onChange={setSlideCountMode}
                    ariaLabel={dict.flows.social.count}
                  />
                  <AnimatePresence initial={false}>
                    {slideCountMode === "custom" ? (
                      <motion.div
                        key="slide-count-stepper"
                        initial={{ width: 0, opacity: 0, marginInlineStart: -6 }}
                        animate={{ width: 66, opacity: 1, marginInlineStart: 0 }}
                        exit={{ width: 0, opacity: 0, marginInlineStart: -6 }}
                        transition={{ type: "spring", stiffness: 500, damping: 35 }}
                        style={{ overflow: "hidden" }}
                      >
                        <InlineStepper
                          value={slideCountValue}
                          onChange={setSlideCountValue}
                          min={1}
                          max={slideCap}
                        />
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </motion.div>
              </div>
            </div>

            <div className="mt-auto flex flex-col gap-3 border-t border-[var(--tq-border-hairline)] pt-3">
              <div className="space-y-1.5">
                <span className="block text-xs font-semibold text-foreground/70">
                  {dict.flows.social.style}
                </span>
                <DesignStylePicker
                  value={designStyle}
                  onChange={setDesignStyle}
                  disabled={submitting}
                  variant="social"
                />
              </div>
              <AIImagesPanel
                value={imagesMode}
                onChange={setImagesMode}
                disabled={submitting}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-center">
          <GenerateSplitButton
            onGenerate={handleGenerate}
            quality={quality}
            onQualityChange={setQuality}
            slideCount={estimated.slides}
            slideCountUpTo={estimated.upTo}
            imagesMode={imagesMode}
            disabled={generateDisabled}
            loading={submitting}
          />
        </div>

        <p
          className="min-h-5 text-center text-sm text-red-400"
          role={error ? "alert" : undefined}
          aria-live={error ? "polite" : undefined}
        >
          {error || " "}
        </p>
      </div>
    </div>
  );
}

// InlinePaletteSwatch — identical copy of /datasheet's + /create's swatch.
function InlinePaletteSwatch({
  value,
  index,
  removable,
  onChange,
  onRemove,
  dict,
}: {
  value: string;
  index: number;
  removable: boolean;
  onChange: (next: string) => void;
  onRemove: () => void;
  dict: Dictionary;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setPickerOpen((v) => !v)}
        className="block h-7 w-7 shrink-0 rounded-md border border-foreground/15 transition-shadow hover:shadow-md"
        style={{ backgroundColor: value }}
        aria-label={dict.flows.controls.colorN.replace("{n}", String(index + 1))}
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={!removable}
        aria-label={dict.flows.controls.removeColor}
        className="absolute -top-1 -end-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-black/70 text-white transition-opacity hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-0"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 8 }}>
          close
        </span>
      </button>
      <ColorPickerPopover
        open={pickerOpen}
        value={value}
        onChange={onChange}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}
