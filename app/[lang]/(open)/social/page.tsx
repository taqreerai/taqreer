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
import {
  displaySlideEstimate,
  slideCapForFlow,
  SOCIAL_MIN_POSTS,
  SOCIAL_TEASER_DEFAULT_TOTAL,
  SOCIAL_TEASER_VISIBLE,
} from "@/lib/credits/cost";
import { isImagesLocked, IMAGES_GATE_TIER } from "@/lib/images/images-gating";
import { planLabel } from "@/lib/plan";
import { UpgradeModal } from "@/components/billing/UpgradeModal";
import { GenerateSplitButton } from "@/components/create/GenerateSplitButton";
import { PersistentRow } from "@/components/brand/PersistentRow";
import { type BrandKitOption, } from "@/components/brand/BrandKitDropdown";
import { InlineStepper, type SlideCountMode } from "@/components/create/OutputCards";
import { SocialStyleGrid } from "@/components/create/DesignStylePicker";
import {
  BrandCard,
  SplitStep,
  WizardBar,
  WizardCard,
  WizardHead,
  WizardStage,
  scrollWizardTop,
} from "@/components/create/wizard";
import posthog from "posthog-js";
import { useIsGuest } from "@/components/app/GuestContext";
import { GuestSignupDialog } from "@/components/create/GuestSignupDialog";
import {
  GUEST_SAVE_EVENT,
  clearGuestDraft,
  fontFromDraft,
  fontToDraft,
  loadGuestDraft,
  readResumeMode,
  saveGuestFiles,
  saveGuestSettings,
  type SocialGuestSettings,
} from "@/lib/create/guest-draft";
import { AIImagesPanel } from "@/components/brand/AIImagesPanel";
import {
  SegmentedToggle,
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


// Wizard (2026-10-07, /create's two-step layout): content + post settings,
// then style + brand + Create.
const SOCIAL_LAST_STEP = 1;

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

  // Signed-out visitor (2026-10-06, /social open before sign-up): brand
  // kits and generation wait for sign-in; the draft carries the setup.
  const guest = useIsGuest();

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
    // Visitors have no kits; a resumed draft carries its own brand.
    if (guest || readResumeMode()) return;
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
  }, [applyBrand, guest]);

  useEffect(() => {
    if (guest) return;
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
  }, [guest]);

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

  // ─── Guest draft (2026-10-06) ──────────────────────────────────
  // Same model as the other open flows. Nothing is uploaded before Create
  // here (the product photo uploads at submit), so a visitor's setup only
  // needs saving through the sign-up round trip.
  const guestFont = fontToDraft(brandFont);
  const guestSettings: SocialGuestSettings = {
    step,
    topic,
    language,
    persistentText,
    platform,
    format,
    slideCountMode,
    slideCountValue,
    designStyle,
    imagesMode,
    colors,
    fontMode: guestFont.fontMode,
    googleFamily: guestFont.googleFamily,
    uploadedFonts: guestFont.uploadedFonts,
  };
  const guestSettingsJson = JSON.stringify(guestSettings);
  useEffect(() => {
    if (!guest) return;
    const id = window.setTimeout(
      () => saveGuestSettings("social", JSON.parse(guestSettingsJson)),
      300,
    );
    return () => window.clearTimeout(id);
  }, [guest, guestSettingsJson]);
  useEffect(() => {
    if (!guest) return;
    void saveGuestFiles("social", {
      content: productFile,
      logo: logoFile,
      fonts: fontToDraft(brandFont).fontFiles,
    });
  }, [guest, productFile, logoFile, brandFont]);
  useEffect(() => {
    if (!guest) return;
    const flush = () => saveGuestSettings("social", JSON.parse(guestSettingsJson));
    window.addEventListener(GUEST_SAVE_EVENT, flush);
    return () => window.removeEventListener(GUEST_SAVE_EVENT, flush);
  }, [guest, guestSettingsJson]);

  const [guestSignupOpen, setGuestSignupOpen] = useState(false);
  const openGuestSignup = async () => {
    saveGuestSettings("social", guestSettings);
    await saveGuestFiles("social", {
      content: productFile,
      logo: logoFile,
      fonts: guestFont.fontFiles,
    });
    posthog.capture("create_guest_signup_prompt", { flow: "social", step });
    setGuestSignupOpen(true);
  };

  const [autoStart, setAutoStart] = useState(false);
  useEffect(() => {
    if (guest) return;
    const mode = readResumeMode();
    if (!mode) return;
    let aborted = false;
    (async () => {
      const draft = await loadGuestDraft<SocialGuestSettings>("social");
      const url = new URL(window.location.href);
      url.searchParams.delete("resume");
      window.history.replaceState(null, "", url.toString());
      if (aborted || !draft) return;
      const d = draft.settings;
      setTopic(d.topic ?? "");
      if (d.language === "ar" || d.language === "en") setLanguage(d.language);
      setPersistentText(d.persistentText ?? "");
      if (d.platform) setPlatform(d.platform as SocialPlatform);
      if (d.format) setFormat(d.format as SlideFormat);
      if (d.slideCountMode === "auto" || d.slideCountMode === "custom") {
        setSlideCountMode(d.slideCountMode);
      }
      if (typeof d.slideCountValue === "number") {
        setSlideCountValue(Math.max(SOCIAL_MIN_POSTS, d.slideCountValue));
      }
      setDesignStyle(d.designStyle ?? null);
      setImagesMode(!!d.imagesMode);
      setColors(Array.isArray(d.colors) ? d.colors.slice(0, MAX_PALETTE) : []);
      const font = fontFromDraft(d, draft.files);
      if (font) setBrandFont(font);
      if (draft.files.logo) {
        setLogoFile(draft.files.logo);
        setLoadedLogo(null);
      }
      if (draft.files.content) setProductPhoto(draft.files.content);
      setStep(mode === "generate" ? SOCIAL_LAST_STEP : Math.min(SOCIAL_LAST_STEP, Math.max(0, d.step)));
      void clearGuestDraft("social");
      posthog.capture("create_guest_resumed", { flow: "social", mode });
      if (draft.files.lost) {
        // The saved photo could not be read back: attach it again.
        setStep(0);
        setError(dict.flows.guestFileLost);
        posthog.capture("create_guest_file_lost", { flow: "social" });
        return;
      }
      if (mode === "generate" && (d.topic ?? "").trim()) setAutoStart(true);
    })();
    return () => {
      aborted = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on mount; dict is stable for this purpose
  }, [guest]);

  // ─── Wizard chrome (2026-10-07: /create's two-step layout) ─────
  // Step 1: the topic + product photo + persistent element (wide) and
  // platform / size / count / AI photos (narrow). Step 2: the social style (wide)
  // + brand (narrow), then Create.
  const stepTitles = [dict.flows.social.contentCard, dict.flows.design.card];
  const hasTopic = topic.trim().length > 0;
  const goToStep = (next: number) => {
    setStep(Math.max(0, Math.min(SOCIAL_LAST_STEP, next)));
    scrollWizardTop();
  };

  return (
    // `.tq-wizard-fit`: on a desktop viewport the page is exactly one viewport
    // tall and the stage takes the leftover height (globals.css).
    <div className="page-container tq-wizard-fit flex w-full justify-center" dir={dir}>
      <GuestSignupDialog
        flow="social"
        open={guestSignupOpen}
        onClose={() => setGuestSignupOpen(false)}
      />
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
      <div className="mt-[4vh] flex w-full flex-col items-center gap-5 px-4 desk:px-8 stage:mt-0 stage:min-h-0 stage-tight:gap-3">
        {/* Upfront plan notice when this flow isn't in the user's plan. */}
        <LockedFlowBanner flow="social" />
        <WizardHead
          tool="social"
          title={dict.flows.social.title}
          subtitle={dict.flows.social.subtitle}
          steps={stepTitles}
          step={step}
          onStep={goToStep}
          reachable={hasTopic ? SOCIAL_LAST_STEP : 0}
          rail={false}
        />

        <WizardStage>

        {/* ═══════════════════════════════════════════════════════
            STEP 1 · CONTENT (wide: the topic, an optional product photo,
            the persistent element) + POST SETTINGS (narrow: platform /
            size, count, AI photos).
            ═══════════════════════════════════════════════════════ */}
        <SplitStep visible={step === 0} label={dict.flows.social.contentCard}>
          <WizardCard
            title={dict.flows.social.contentCard}
            end={
              <SegmentedToggle
                options={LANGUAGE_OPTIONS}
                value={language}
                onChange={setLanguage}
                ariaLabel={dict.flows.language}
              />
            }
          >
            {/* Grows to fill the card on a viewport-fit stage. */}
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={dict.flows.social.topicPlaceholder}
              dir={language === "en" ? "ltr" : "rtl"}
              // Mirrors the server's content.text cap in /api/projects.
              maxLength={MAX_CONTENT_TEXT_CHARS}
              rows={6}
              disabled={submitting}
              className="input-dark min-h-[180px] resize-y text-sm leading-6 disabled:cursor-not-allowed disabled:opacity-50 stage:min-h-0 stage:flex-1 stage:resize-none"
            />
          {/* Product photo: the post is designed around it. Muted when the
              user turned AI photos back off (the photo won't be sent). */}
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
            {/* Persistent element: here, not in the settings card, so the
                settings fit the shortest viewport-fit stage (1280x640). */}
            <div className="border-t border-[var(--tq-border-hairline)] pt-4 stage:pt-3 stage-tight:pt-2">
              <PersistentRow
                text={persistentText}
                language={language}
                onText={setPersistentText}
              />
            </div>
          </WizardCard>

          <WizardCard title={dict.flows.social.settingsCard}>
          <SocialFormatFields
            platform={platform}
            onPlatform={setPlatform}
            format={format}
            onFormat={setFormat}
            twoColumns
          />
          <div className="border-t border-[var(--tq-border-hairline)] pt-4 stage:pt-3 stage-tight:pt-2">
            <div className="flex min-h-[24px] items-center justify-between gap-2">
              <span className="text-sm font-semibold text-foreground/80">
                {dict.flows.social.count}
              </span>
              {/* Same animated Auto/Custom + stepper as /create. */}
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
                        min={SOCIAL_MIN_POSTS}
                        max={slideCap}
                      />
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </motion.div>
            </div>
          </div>
          <div className="border-t border-[var(--tq-border-hairline)] pt-4 stage:pt-3 stage-tight:pt-2">
            <AIImagesPanel value={imagesMode} onChange={setImagesMode} disabled={submitting} />
          </div>
          </WizardCard>
        </SplitStep>

        {/* ═══════════════════════════════════════════════════════
            STEP 2 · DESIGN (wide: the social style) + BRAND (narrow),
            then Create.
            ═══════════════════════════════════════════════════════ */}
        <SplitStep visible={step === 1} label={dict.flows.design.card}>
          <WizardCard title={dict.flows.design.card}>
            <div className="flex min-h-0 flex-1 flex-col">
              <SocialStyleGrid
                fit
                value={designStyle}
                onChange={setDesignStyle}
                disabled={submitting}
              />
            </div>
          </WizardCard>
        <BrandCard
          kitOptions={kitOptions}
          onPickKit={handlePickKit}
          colors={colors}
          minPalette={MIN_PALETTE}
          maxPalette={MAX_PALETTE}
          onAutoColors={() => setColors([])}
          onUpdateColor={updateColor}
          onRemoveColor={removeColor}
          onAddColor={addColor}
          onPickPreset={setColors}
          brandFont={brandFont}
          onBrandFont={setBrandFont}
          sampleText={language === "en" ? HEADING_SAMPLE_LATIN : HEADING_SAMPLE_AR}
          logoFile={logoFile}
          logoPreviewUrl={loadedLogo?.displayUrl ?? null}
          onLogoSelect={(f) => {
            setLogoFile(f);
            setLoadedLogo(null);
          }}
          onLogoRemove={() => {
            setLogoFile(null);
            setLoadedLogo(null);
          }}
          saveBrandKit={saveBrandKit}
          onSaveBrandKit={setSaveBrandKit}
          disabled={submitting}
        />
        </SplitStep>
        </WizardStage>

        <WizardBar
          step={step}
          lastStep={SOCIAL_LAST_STEP}
          onStep={goToStep}
          nextDisabled={step === 0 && !hasTopic}
          nextLabel={dict.flows.wizard.nextLook}
          wide
          busy={submitting}
          generate={
            <GenerateSplitButton
              guest={guest}
              autoStart={autoStart}
              onGenerate={guest ? () => void openGuestSignup() : handleGenerate}
              quality={quality}
              onQualityChange={setQuality}
              slideCount={estimated.slides}
              slideCountUpTo={estimated.upTo}
              teaserVisible={SOCIAL_TEASER_VISIBLE}
              teaserDefaultTotal={SOCIAL_TEASER_DEFAULT_TOTAL}
              posts
              imagesMode={imagesMode}
              disabled={generateDisabled}
              loading={submitting}
            />
          }
        />

        {/* Rendered only with an error: an empty reserved line would cost the
            viewport-fit stage its height on every visit. */}
        {error ? (
          <p className="text-center text-sm text-red-400" role="alert" aria-live="polite">
            {error}
          </p>
        ) : null}
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
