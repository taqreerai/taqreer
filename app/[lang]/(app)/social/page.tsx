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
import { useSlideCap, useCreditBalance } from "@/lib/credits/store";
import { displaySlideEstimate, slideCapForFlow } from "@/lib/credits/cost";
import { isImagesLocked, IMAGES_GATE_TIER } from "@/lib/images/images-gating";
import { planLabel } from "@/lib/plan";
import { UpgradeModal } from "@/components/billing/UpgradeModal";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { GenerateSplitButton } from "@/components/create/GenerateSplitButton";
import { PillButton } from "@/components/create/PillButton";
import { WizardStepRail } from "@/components/create/WizardChrome";
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
import { useDefaultQuality } from "@/lib/credits/use-default-quality";
import { MAX_CONTENT_TEXT_CHARS } from "@/lib/types/brief-limits";
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
import { PremiumCrown } from "@/components/billing/PremiumCrown";
import { LockedFlowBanner } from "@/components/billing/LockedFlowBanner";

const MIN_PALETTE = 2;
const MAX_PALETTE = 6;
const DEFAULT_PALETTE = ["#000000", "#FFFFFF"];
const CARD_MIN_H_CLASS = "min-h-[440px]";

// Product photo caps - mirror POST /api/storage/upload-image (10MB, raster
// only). GIF is deliberately excluded here: gpt-image's images.edit input
// wants a still photo (the route itself stays permissive for the editor).
const PRODUCT_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const PRODUCT_IMAGE_EXT_RE = /\.(png|jpe?g|webp)$/i;
const PRODUCT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

// Same tiny helper /create + /mimic each keep locally.
function formatFileSize(size: number, kb: string, mb: string) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} ${kb}`;
  return `${(size / (1024 * 1024)).toFixed(1)} ${mb}`;
}

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
  // AI images toggle — same as /create: OFF by default since the Plus+ gate
  // (2026-08, lib/images/images-gating.ts). Social posts lean hard on imagery,
  // so it stays a first-class switch — subscribers opt in per post.
  const [imagesMode, setImagesMode] = useState<boolean>(false);

  // ─── Product photo ─────────────────────────────────────────────
  // The post is designed AROUND this shot: it uploads at submit time and
  // gpt-image receives it (images.edit) for the boxes Claude marks as
  // product shots. Needs imagesMode, so picking a photo auto-enables it
  // (one-way flip, mirroring /create's STYLE_REQUIRES_IMAGES); locked
  // (sub-Plus) users get the UpgradeModal instead - same derivation as
  // AIImagesPanel, incl. the null-plan-gates-like-free hydration rule.
  const [productFile, setProductFile] = useState<File | null>(null);
  // Blob-URL preview for the thumbnail. Lifecycle lives in the EVENT paths
  // (select / remove), never inside a state updater: React may replay
  // updaters, which would leak an uncommitted URL and double-revoke the
  // previous one (CR PR #186). The ref mirrors the live URL purely for the
  // unmount revoke.
  const [productPreviewUrl, setProductPreviewUrl] = useState<string | null>(
    null,
  );
  const productPreviewUrlRef = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (productPreviewUrlRef.current) {
        URL.revokeObjectURL(productPreviewUrlRef.current);
      }
    },
    [],
  );
  const setProductPhoto = (f: File | null) => {
    if (productPreviewUrlRef.current) {
      URL.revokeObjectURL(productPreviewUrlRef.current);
    }
    const next = f ? URL.createObjectURL(f) : null;
    productPreviewUrlRef.current = next;
    setProductFile(f);
    setProductPreviewUrl(next);
  };
  const [productUpgradeOpen, setProductUpgradeOpen] = useState(false);
  const credits = useCreditBalance();
  const imagesLocked = isImagesLocked({
    plan: credits?.plan ?? null,
    isAdmin: credits?.isAdmin ?? false,
  });

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
  // Wizard step (2026-08-30, user direction, mirrors /create): 0 Content,
  // 1 Brand, 2 Design + Generate. Cards stay MOUNTED (single-cell grid,
  // `invisible` when inactive) so heights stay constant and popovers /
  // upload state survive step changes.
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [creditGate, setCreditGate] = useState<CreditGatePayload | null>(null);
  const [quality, setQuality] = useDefaultQuality();

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

  // Validate + adopt a picked/dropped product photo. Locked users never reach
  // the picker (ProductPhotoRow gates the open), but the drop path lands here
  // too - gate again so a drag-drop can't bypass the crown.
  const acceptProductPhoto = (f: File | undefined | null) => {
    if (!f) return;
    if (imagesLocked) {
      setProductUpgradeOpen(true);
      return;
    }
    const typeOk = f.type
      ? PRODUCT_IMAGE_TYPES.has(f.type)
      : PRODUCT_IMAGE_EXT_RE.test(f.name);
    if (!typeOk) {
      setError(dict.flows.social.productPhotoInvalidType);
      return;
    }
    if (f.size > PRODUCT_IMAGE_MAX_BYTES) {
      setError(dict.flows.social.productPhotoTooLarge);
      return;
    }
    setError("");
    setProductPhoto(f);
    setImagesMode(true);
  };

  const handleGenerate = async (overrideSlideCount?: number) => {
    const reduced =
      typeof overrideSlideCount === "number" ? overrideSlideCount : null;
    if (topic.trim().length === 0) return;
    setError("");
    setSubmitting(true);
    try {
      const logoUploaded = await uploadAsset("brand-assets", "logos", logoFile);

      // Product photo uploads at SUBMIT time (like the logo above): on-select
      // uploads would leak a permanent public object per abandoned pick -
      // generated-images/uploads has no cleanup cron. Skipped when the user
      // manually turned imagesMode back off (the row renders muted then).
      let productImage: { url: string } | null = null;
      if (productFile && imagesMode) {
        const fd = new FormData();
        fd.append("file", productFile);
        const res = await fetch("/api/storage/upload-image", {
          method: "POST",
          body: fd,
        });
        const uploaded = res.ok
          ? ((await res.json().catch(() => null)) as { url?: string } | null)
          : null;
        if (!uploaded?.url) {
          throw new Error(dict.flows.social.productPhotoUploadFailed);
        }
        productImage = { url: uploaded.url };
      }

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
          ...(productImage ? { productImage } : {}),
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
      {/* Product-photo Plus+ gate - same modal + copy AIImagesPanel opens
          for a locked toggle enable. */}
      <UpgradeModal
        open={productUpgradeOpen}
        gateContext={{
          title: dict.components.creditGate.imagesLockedTitle,
          body: `${dict.components.creditGate.imagesLockedBody.replace(
            "{tier}",
            planLabel(dict.components.planUsage, IMAGES_GATE_TIER),
          )} ${dict.components.creditGate.chooseTier}`.trim(),
        }}
        onClose={() => setProductUpgradeOpen(false)}
      />
      <div className="mt-[6vh] flex w-full flex-col items-center gap-6 px-4">
        {/* Upfront plan notice when this flow isn't in the user's plan. */}
        <LockedFlowBanner flow="social" />
        <header className="text-center">
          <h1 className="tq-h1">{dict.flows.social.title}</h1>
          <p className="tq-subhead mt-2">{dict.flows.social.subtitle}</p>
        </header>

        <WizardStepRail
          steps={[
            dict.flows.social.contentCard,
            dict.flows.brandCard,
            dict.flows.social.designCard,
          ]}
          active={step}
          onJump={setStep}
        />

        {/* Wizard column (was a wrapping 3-across row until 2026-08-30):
            all three cards share ONE grid cell; inactive cards are
            `invisible` (not display:none) so the stack keeps the tallest
            card's height at every step. */}
        <div className="flex w-full flex-col items-center gap-4">
          <div className="grid w-full justify-items-center">
          {/* ── CONTENT CARD (step 1) ─────────────────────────── */}
          <div
            className={`surface-card ${step === 0 ? "" : "invisible"} col-start-1 row-start-1 flex w-full sm:w-[430px] ${CARD_MIN_H_CLASS} flex-col gap-4 rounded-2xl p-4`}
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
                // Mirrors the server's content.text 400 cap in
                // /api/projects (brief-limits.ts).
                maxLength={MAX_CONTENT_TEXT_CHARS}
                disabled={submitting}
                // min-h matches /create's textarea (was 240px): the taller
                // box pushed all 3 cards past the create flow's card height
                // (owner direction 2026-08-03). flex-1 still grows it to
                // fill whatever the card has.
                className="input-dark min-h-[60px] flex-1 resize-none text-sm leading-6 disabled:cursor-not-allowed disabled:opacity-50"
              />
              {/* Product photo - under the textarea; the textarea is the
                  card's only flex-1 child so it shrinks to make room and
                  the card keeps its height. Muted when the user turned
                  imagesMode back off (the photo won't be sent). */}
              <ProductPhotoRow
                file={productFile}
                previewUrl={productPreviewUrl}
                submitting={submitting}
                locked={imagesLocked}
                muted={Boolean(productFile) && !imagesMode}
                onPick={acceptProductPhoto}
                onRemove={() => setProductPhoto(null)}
                onLocked={() => setProductUpgradeOpen(true)}
              />
            </div>
            {/* Generate-images toggle — inside the content card, same as
                /create (owner direction 2026-08-03). Plus+ gated inside
                the panel itself. */}
            <div className="border-t border-[var(--tq-border-hairline)] pt-3">
              <AIImagesPanel
                value={imagesMode}
                onChange={setImagesMode}
                disabled={submitting}
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
            className={`surface-card ${step === 1 ? "" : "invisible"} col-start-1 row-start-1 flex w-full sm:w-[430px] ${CARD_MIN_H_CLASS} flex-col gap-4 rounded-2xl p-4`}
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
            className={`surface-card ${step === 2 ? "" : "invisible"} col-start-1 row-start-1 flex w-full sm:w-[430px] ${CARD_MIN_H_CLASS} flex-col gap-4 rounded-2xl p-4`}
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

            {/* Images toggle moved to the CONTENT card 2026-08-03 (same as
                /create) — this block keeps only the style picker. */}
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
            </div>
          </div>
          </div>

          {/* Next only (`.btn-gradient` CTA); back-travel via the rail. */}
          {step < 2 && (
            <div className="flex w-full justify-end sm:w-[430px]">
              <PillButton
                variant="primary"
                onClick={() => setStep((s) => Math.min(2, s + 1))}
                disabled={submitting || (step === 0 && topic.trim().length === 0)}
              >
                {dict.flows.wizard.next}
              </PillButton>
            </div>
          )}
        </div>

        {step === 2 && (
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
        )}

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

// ProductPhotoRow - compact dropzone under the content textarea (same visual
// language as /create's ContentDropzone: 44px dashed pill, icon chip, title +
// hint; violet drag state like LogoRow). Selected state swaps the chip for a
// 32px thumbnail; the blob URL's lifecycle is owned by the PARENT's select /
// remove handlers (CR PR #186: no side effects in state updaters).
function ProductPhotoRow({
  file,
  previewUrl,
  submitting,
  locked,
  muted,
  onPick,
  onRemove,
  onLocked,
}: {
  file: File | null;
  previewUrl: string | null;
  submitting: boolean;
  locked: boolean;
  muted: boolean;
  onPick: (f: File | undefined | null) => void;
  onRemove: () => void;
  onLocked: () => void;
}) {
  const dict = useDict();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div className={`relative ${muted ? "opacity-60" : ""}`}>
      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          onPick(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => {
          if (locked) {
            onLocked();
            return;
          }
          inputRef.current?.click();
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          onPick(event.dataTransfer.files?.[0]);
        }}
        disabled={submitting}
        className={`flex min-h-[44px] w-full items-center gap-3 rounded-xl border border-dashed p-2 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          dragging
            ? "border-[var(--tq-violet)]/60 bg-[var(--tq-violet)]/10"
            : "border-foreground/20 bg-overlay-soft hover:border-foreground/30"
        }`}
      >
        {file && previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={dict.flows.social.productPhoto}
            className="h-8 w-8 shrink-0 rounded-md object-cover"
          />
        ) : (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--tq-surface)]">
            <span
              className="material-symbols-outlined text-foreground/80"
              style={{ fontSize: 18 }}
            >
              photo_camera
            </span>
          </span>
        )}
        {file ? (
          <div className="min-w-0 flex-1 pe-7">
            {/* Fixed short label, NOT the filename: gen/camera filenames are
                40+ chars and wrapped the compact row to 3 lines on mobile
                (user direction 2026-08-08). The thumbnail + size line carry
                the identity. Localized per CR PR #188. */}
            <p className="truncate text-sm font-semibold text-foreground">
              {dict.flows.social.productPhotoLabel}
            </p>
            <p className="mt-0.5 truncate text-xs text-foreground/60">
              {formatFileSize(file.size, dict.flows.unitKB, dict.flows.unitMB)}
            </p>
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-foreground">
              {dict.flows.social.productPhoto}
              {locked ? (
                // Gold crown = paid feature (AIImagesPanel's affordance).
                <PremiumCrown size={14} />
              ) : null}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-foreground/40">
              {dict.flows.social.productPhotoHint}
            </p>
          </div>
        )}
      </button>
      {file && !submitting ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={dict.flows.social.productPhotoRemove}
          className="absolute end-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md bg-black/35 text-foreground/60 transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
            close
          </span>
        </button>
      ) : null}
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
