"use client";

// Phase 17.D — Single-shot /create flow (replaces /create/content +
// /create/brand + /create/summary + the stepper chrome).
//
// Mirrors /mimic + /enhance's pattern: 3 cards in a row, generate
// split-button below, no per-step routing.
//
// What got dropped (explicit user direction 2026-05-25):
//   • Design-style pills (إبداعي / بسيط / احترافي / مرح / صحفي / جريء)
//
// What got combined:
//   • Heading font + body font sit side-by-side in one row (each
//     half-width inside the branding card)
//   • Logo upload uses CompactUploadZone's horizontal mode (icon
//     right + label left + sub-text)
//   • Persistent text: input on row 1, position picker + exclude
//     cover/closing toggles on row 2 (matches the legacy /create
//     output card layout)
//   • Language pills sit inline with the textarea (label right,
//     pills left)
// Phase 18 (2026-08-30, user direction): the three cards now present as
// a 3-STEP WIZARD (Content -> Brand -> Output+Generate) with a step
// rail - the single-shot all-cards-at-once layout read as overwhelming.
// Cards stay mounted (display-toggled); state, submit and gating are
// unchanged. The "no stepper chrome" note below predates this.
//   • Ratio (16:9 / 9:16) sits in the OUTPUT card alongside slide
//     count + pagination + persistent overlay
//
// What got migrated to the SegmentedToggle primitive:
//   • Font slot mode (ملف / Google)
//   • Slide count mode (تلقائي / مخصص)
//
// Card titles all carry an icon + bottom hairline separator (same
// pattern the legacy CardShell used) so the cards read as a
// labelled cluster, not a wall of inputs.
//
// 2026-10-06 (owner direction): a 4-step wizard on EVERY screen size (the
// desktop 3-cards-across layout is gone): Content, Design (templates / styles
// full width, hover flips a template's slides), Brand (colours, font, logo),
// Output + Generate, with a sticky Back / Next bar. All steps stay mounted.
// Phase 19 (2026-10-02, user direction): step 2 is now ONE "Design" step -
// templates, design styles, colour templates, font and logo together. A
// picked TEMPLATE turns the run into a template generation (the Mimic engine
// reuses the template deck's design with this content; source kind "mimic");
// a template and a design style are mutually exclusive. The gallery's "Use
// this template" now lands here with ?template=<id> preselected. Brand kits
// still hydrate from sessionStorage or the user's default.

import { DeckLanguagePicker } from "@/components/create/DeckLanguagePicker";
import { detectLanguage, isRtlLanguage, WRITING_LANGUAGES } from "@/lib/language/detect";
import { type PickedTemplate } from "@/components/create/TemplatePickerGrid";
import { uploadDesignReference } from "@/lib/extract/design-upload";
import {
  fetchUse,
  readCachedUse,
  writeCachedUse,
  type MimicTemplateUse,
} from "@/lib/mimic/template-seed";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import {
  CreditGateDialog,
  isCreditGatePayload,
  type CreditGatePayload,
} from "@/components/credits/CreditGateDialog";
import { useSlideCap, useCreditBalance } from "@/lib/credits/store";
import { isImagesLocked } from "@/lib/images/images-gating";
import { displaySlideEstimate } from "@/lib/credits/cost";
import { localizedHref } from "@/lib/i18n/navigation";
import { ApiError, apiError, useErrorText } from "@/lib/api/error-message";
import { DECK_STYLES } from "@/lib/design-styles";
import { AnimatePresence, motion } from "framer-motion";
import { GenerateSplitButton } from "@/components/create/GenerateSplitButton";
import { PersistentRow } from "@/components/brand/PersistentRow";
import { AIImagesPanel } from "@/components/brand/AIImagesPanel";
import { mentionsPictures } from "@/lib/images/mentions-pictures";
import { type BrandKitOption } from "@/components/brand/BrandKitDropdown";
import {
  InlineStepper,
  SlideSizeFields,
  STYLE_REQUIRES_IMAGES,
  type SlideSize,
  type SlideCountMode,
} from "@/components/create/OutputCards";
import {
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
import posthog from "posthog-js";
import { useIsGuest } from "@/components/app/GuestContext";
import { GuestSignupDialog } from "@/components/create/GuestSignupDialog";
import {
  BrandCard,
  DesignCard,
  SplitStep,
  WizardBar,
  WizardCard,
  WizardHead,
  WizardStage,
  scrollWizardTop,
} from "@/components/create/wizard";
import type { PickerTemplate } from "@/app/api/templates/route";
import {
  GUEST_SAVE_EVENT,
  clearGuestDraft,
  loadGuestDraft,
  saveGuestFiles,
  saveGuestSettings,
  type GuestDraftFiles,
  type GuestDraftSettings,
  readResumeMode,
} from "@/lib/create/guest-draft";
import { MAX_CONTENT_TEXT_CHARS } from "@/lib/types/brief-limits";
import {
  readBrandFromSession,
  fetchDefaultBrandKit,
  mapKitToHydrated,
  CREATE_BRAND_KEY,
  type HydratedBrand,
} from "@/lib/create/hydrate-brand-from-session";

// ─── Constants ────────────────────────────────────────────────────
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
// Extraction polling — file uploads on /create route through the
// shared /api/extract pipeline (Anthropic Files API upload), just
// like /enhance + /mimic. Pre-fix the file was selected but never
// posted to extract: the Generate call sent { type: "source",
// fileName, fileSize } with no actual document bytes, so the
// upload path was a no-op (CR critical 2026-05-26). Polling shape
// + intervals mirror /enhance for consistency.
const POLL_INTERVAL_MS = 2_500;
const POLL_TIMEOUT_MS = 5 * 60 * 1_000;
const MIN_PALETTE = 2;
const MAX_PALETTE = 6;
// Sentinel `template.id` for an uploaded design reference ("Upload your own").
const DESIGN_UPLOAD_ID = "upload";
const DEFAULT_PALETTE = ["#000000", "#FFFFFF"];

// Wizard steps (2026-10-06 redesign, owner direction: the three side-by-side
// cards read as crammed): 0 Content, 1 Design, 2 Brand, 3 Output + Generate,
// one focused screen per step on every screen size.
const LAST_STEP = 1;
// A settings row under the slide-size tiles: hairline above, one step tighter
// on the viewport-fit stage (and tighter again on its shortest viewports).
const SETTINGS_ROW =
  "border-t border-[var(--tq-border-hairline)] pt-4 stage:pt-3 stage-tight:pt-2";

// SLIDE_COUNT_OPTIONS is built inside the component so their
// labels can come from the active-locale dictionary.

// ─── Helpers ──────────────────────────────────────────────────────
// Trim a brand-kit title to its first few words for the compact dropdown
// menu — full titles can be long; a few words read cleanly in the pill list.
function fewWords(s: string, max = 3): string {
  const parts = s.trim().split(/\s+/).filter(Boolean);
  return parts.length <= max ? s.trim() : `${parts.slice(0, max).join(" ")}…`;
}

function formatFileSize(size: number, kb: string, mb: string) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} ${kb}`;
  return `${(size / (1024 * 1024)).toFixed(1)} ${mb}`;
}

function readableFileName(raw: string): string {
  if (!/%[0-9A-Fa-f]{2}/.test(raw)) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// One resolved font field as the /api/projects payload expects it. The
// redesigned single-font model produces ONE field used for BOTH heading +
// body (one family, Claude varies weights / pairs uploads). Built inline in
// handleGenerate from the BrandFontState.
type ResolvedFontField = {
  name: string;
  url: string | null;
  storageUrl: string | null;
  family: string;
} | null;

export default function CreatePage() {
  const router = useRouter();
  const contentInputRef = useRef<HTMLInputElement>(null);
  const dict = useDict();
  const errorText = useErrorText();
  const { locale } = useLocale();
  const t = dict.flows;
  // Signed-out visitor (2026-10-06): everything that needs an account
  // (extraction, template setup, brand kits, generation) waits for sign-in.
  const guest = useIsGuest();
  const SLIDE_COUNT_OPTIONS = [
    { value: "auto" as const, label: t.auto },
    { value: "custom" as const, label: t.custom },
  ];

  // ─── Content state ─────────────────────────────────────────────
  const [contentText, setContentText] = useState<string>("");
  const [contentFile, setContentFile] = useState<File | null>(null);
  const [contentDragging, setContentDragging] = useState(false);
  // File-upload extraction state. When the user picks a content
  // file we POST to /api/extract → poll until "completed" → save
  // the anthropicFileId for the brief. Mirrors /enhance + /mimic.
  type ContentFileStage = "idle" | "extracting" | "ready";
  const [contentFileStage, setContentFileStage] =
    useState<ContentFileStage>("idle");
  const [contentAnthropicFileId, setContentAnthropicFileId] = useState<
    string | null
  >(null);
  // The uploaded file's text layer (from the extract result), for the style
  // suggestions on the Design step.
  const [contentFileText, setContentFileText] = useState("");
  // Slide size now lives in the OUTPUT card (alongside slide count
  // + pagination + persistent overlay). Language stays close to the
  // textarea since it modulates the typed content directly.
  const [slideSize, setSlideSize] = useState<SlideSize>("16:9");
  // The deck's language: the user's pick, or the upload's own (see writingLanguage).
  const [pickedLanguage, setPickedLanguage] = useState<string | null>(null);
  const [fileLanguage, setFileLanguage] = useState<string | null>(null);

  // ─── Branding state ────────────────────────────────────────────
  // [] = palette "Auto": Claude picks a content-matched palette at
  // generation time (deck-generate AUTO_PALETTE_ADDENDUM). A brand kit
  // with colors, or any manual pick, switches to manual. addColor seeds
  // DEFAULT_PALETTE so the first manual edit starts from real swatches.
  const [colors, setColors] = useState<string[]>([]);
  // Single brand-font model: ONE Google family (Claude varies weights) OR
  // up to 5 uploaded families (Claude pairs). Replaces the old heading +
  // body two-slot UI.
  const [brandFont, setBrandFont] = useState<BrandFontState>(emptyBrandFont());
  // Saved brand kits for the in-card dropdown (last 5). `options` drives the
  // menu; `raw` is kept to map → HydratedBrand on select.
  const [kitOptions, setKitOptions] = useState<BrandKitOption[]>([]);
  const kitRawRef = useRef<Map<string, unknown>>(new Map());
  const [logoFile, setLogoFile] = useState<File | null>(null);
  // Pre-loaded logo from a brand kit (or default kit). When set,
  // the LogoUploadSlot shows the remote SVG via `previewUrl`; the
  // submit pipeline passes the storageUrl through without
  // re-uploading. Cleared if the user picks a fresh file via the
  // logo's onRemove → onSelect cycle.
  const [loadedLogo, setLoadedLogo] = useState<HydratedBrand["logo"]>(null);
  const [saveBrandKit, setSaveBrandKit] = useState<boolean>(false);

  // Apply a resolved brand (sessionStorage, default kit, or a picked saved
  // kit) to the card state. Maps the heading font slot → the single
  // brandFont model (Google family OR one uploaded family); colours + logo
  // apply directly. Logo cover/closing excludes are intentionally dropped —
  // Claude now decides per slide. Shared by mount hydration + the in-card
  // brand-kit dropdown.
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
      // A saved kit stores ONE url per slot — hydrate it as a single 400
      // face. Fresh multi-weight uploads (300/400/700 of one family) come in
      // via the picker, not here.
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

  // ─── Brand-kit hydration (on first mount) ──────────────────────
  // Read sessionStorage first (the brand-kits "use" flow writes here). If
  // nothing's there, fall back to the user's default brand kit. Single-shot;
  // clear the sessionStorage key after applying so refresh doesn't re-hydrate.
  useEffect(() => {
    // Guests have no kits; a resumed draft carries its own brand.
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

  // Fetch the user's saved kits (last 5) for the in-card brand dropdown.
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
        /* best-effort — dropdown just stays empty */
      }
    })();
    return () => {
      aborted = true;
    };
  }, [guest]);

  // Apply a picked saved kit (overwrites colours / font / logo).
  const handlePickKit = (id: string) => {
    const raw = kitRawRef.current.get(id);
    if (raw) applyBrand(mapKitToHydrated(raw as Parameters<typeof mapKitToHydrated>[0]));
  };

  // ─── Output / rules state ──────────────────────────────────────
  const [slideCountMode, setSlideCountMode] = useState<SlideCountMode>("auto");
  const [slideCountValue, setSlideCountValue] = useState<number>(8);
  // Cap the custom slide count at the user's tier ceiling (free = 10). Preflight
  // rejects an over-cap run server-side; this stops the user picking one. The
  // render-phase clamp also covers a mid-session downgrade lowering the cap.
  const slideCap = useSlideCap();
  if (slideCountValue > slideCap) setSlideCountValue(slideCap);
  const [pagination, setPagination] = useState<boolean>(true);
  // context/images.md — "images deck". OFF by default (opt-in) since the
  // Plus+ gate (2026-08, lib/images/images-gating.ts): free users can't
  // enable it, and paying users choose it deliberately. On → deck-generate
  // uses the photography-led system prompt + reserves generated-image boxes.
  // Whether generated images are unlocked for this user (all plans since
  // 2026-10-04, see lib/images/images-gating). Also gates the design-style
  // auto-enable below. The panel's own toggle gate (AIImagesPanel) covers the
  // direct path.
  const creditsForImages = useCreditBalance();
  const imagesUnlocked = !isImagesLocked({
    regionLimited: !!creditsForImages?.regionPreset,
    isAdmin: creditsForImages?.isAdmin ?? false,
  });
  // Images default OFF for every plan (owner decision 2026-10-05); the user
  // opts in with the toggle.
  const [imagesMode, setImagesMode] = useState<boolean>(false);
  // Picked template (Design step, declared here so the style handler below
  // can clear it): its minted design reference. Null = from scratch.
  const [template, setTemplate] = useState<{
    id: string;
    designAnthropicFileId: string;
  } | null>(null);
  // Design style (Part B.3) — the chosen create-flow style, or null. Drives the
  // deck-generate DESIGN_STYLE_DIRECTIVES injection (the directive leads the
  // user message). UI-only picker for now; polished modal UX lands later.
  const [designStyle, setDesignStyle] = useState<string | null>(null);
  // Styles suggested for the content (2026-10-19, best first) and who chose the
  // current style: a suggested tile or the user. The first suggestion is applied
  // until the user picks something themselves.
  const [suggestedStyles, setSuggestedStyles] = useState<string[]>([]);
  const [designStyleSource, setDesignStyleSource] = useState<"manual" | "suggested" | null>(null);
  const styleTouchedRef = useRef(false);
  const onDesignStyle = useCallback(
    (style: string | null) => {
      const rank = style ? suggestedStyles.indexOf(style) : -1;
      styleTouchedRef.current = true;
      setDesignStyle(style);
      setDesignStyleSource(style ? (rank >= 0 ? "suggested" : "manual") : null);
      posthog.capture("design_style_picked", {
        flow: "create",
        style: style ?? "auto",
        suggestedRank: rank >= 0 ? rank + 1 : null,
      });
      setTemplate(null);
      // Image-leaning styles auto-enable images mode — overridable: we only
      // flip it ON, never force it off, so the user keeps control (Duotone/
      // Editorial/Minimal/Playful per STYLE_REQUIRES_IMAGES). Unlocked users
      // only — see imagesUnlocked above.
      if (style && STYLE_REQUIRES_IMAGES.has(style) && imagesUnlocked) {
        setImagesMode(true);
      }
    },
    [imagesUnlocked, suggestedStyles],
  );
  const [persistentText, setPersistentText] = useState<string>("");

  // ─── Template (Design step) ────────────────────────────────────
  // A picked template: its minted design reference + format. Null = design
  // from scratch (optionally steered by designStyle). Mutually exclusive with
  // a design style: picking one clears the other.
  // Styles open first (2026-10-19): they are on every plan and change the
  // whole deck's look.
  const [lookTab, setLookTab] = useState<"templates" | "styles">("styles");
  // The template's colours + font pre-fill the brand rows (the user can still
  // change them; the deck is recoloured to whatever is set at Generate).
  const applyTemplateUse = useCallback((use: MimicTemplateUse) => {
    if (use.brand.palette.length > 0) {
      setColors(use.brand.palette.slice(0, MAX_PALETTE));
    }
    if (use.brand.fontHeading.url) {
      setBrandFont({
        mode: "google",
        googleFamily: use.brand.fontHeading.name,
        uploaded: [],
      });
    }
    setSlideSize(use.format);
  }, []);
  const pickTemplate = useCallback(
    ({ template: tpl, use }: PickedTemplate) => {
      setTemplate({ id: tpl.id, designAnthropicFileId: use.designAnthropicFileId });
      setDesignStyle(null);
      applyTemplateUse(use);
    },
    [applyTemplateUse],
  );
  // A visitor's pick is only remembered (empty design reference = "set up
  // after sign-in"); its palette + format pre-fill like a resolved one.
  const pickGuestTemplate = useCallback((tpl: PickerTemplate) => {
    setTemplate({ id: tpl.id, designAnthropicFileId: "" });
    setDesignStyle(null);
    if (tpl.palette.length > 0) setColors(tpl.palette.slice(0, MAX_PALETTE));
    setSlideSize(tpl.format);
  }, []);
  // Resolve a template id to its design reference (cached per id). Returns
  // the use, or null when gated / gone.
  const resolveTemplateUse = useCallback(async (id: string) => {
    try {
      let use = readCachedUse("template", id);
      if (!use) {
        use = await fetchUse("template", id);
        writeCachedUse("template", id, use);
      }
      return use;
    } catch {
      return null;
    }
  }, []);
  // /create?template=<id> - the gallery's "Use this template" lands here with
  // the template preselected (the gallery already resolved + cached it).
  // A visitor only gets the pick remembered (resolved after sign-in).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("template");
    if (!id) return;
    let aborted = false;
    (async () => {
      if (guest) {
        if (aborted) return;
        setTemplate({ id, designAnthropicFileId: "" });
        setDesignStyle(null);
        return;
      }
      const use = await resolveTemplateUse(id);
      // gated / gone: the user just starts without it
      if (aborted || !use) return;
      setTemplate({ id, designAnthropicFileId: use.designAnthropicFileId });
      setDesignStyle(null);
      applyTemplateUse(use);
    })();
    return () => {
      aborted = true;
    };
  }, [applyTemplateUse, resolveTemplateUse, guest]);

  // /create?style=<key> - the landing's style tiles land here with that style
  // preselected (a manual pick, so content suggestions never replace it).
  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get("style");
    const style = DECK_STYLES.find((s) => s.key === key);
    if (!style) return;
    styleTouchedRef.current = true;
    queueMicrotask(() => {
      setLookTab("styles");
      setDesignStyle(style.label);
      setDesignStyleSource("manual");
    });
  }, []);

  // ─── Wizard step (2026-08-30, user direction) ─────────────────
  // The three cards present one at a time: 0 Content, 1 Brand,
  // 2 Output + Generate. Pure presentation - every card stays
  // MOUNTED (display-toggled) so the hidden file input, logo blob
  // URLs and fixed-position popovers survive step changes, and the
  // /api/extract poll keeps running while the user moves on.
  const [step, setStep] = useState(0);

  // ─── Submit-level state ────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // 402 credit-gate payload from POST /api/projects (billing Phase A).
  const [creditGate, setCreditGate] = useState<CreditGatePayload | null>(null);
  // "Upload your own" (2026-10-15, replaces the separate /mimic section): a
  // presentation the user likes the look of becomes the design reference. It rides
  // the `template` state under a sentinel id so every template rule (mutually
  // exclusive with a style, pending spinner, reset) applies; the server gets a
  // mimic source with the extracted design file and NO templateId.
  const [designUploadName, setDesignUploadName] = useState<string | null>(null);
  const designUploadAbort = useRef<AbortController | null>(null);
  // A visitor's pick stays in the browser (the draft store); it is analysed after
  // sign-up, when Generate is pressed, like their content file.
  const [designUploadFile, setDesignUploadFile] = useState<File | null>(null);
  const onUploadDesign = useCallback(
    async (file: File): Promise<boolean> => {
      designUploadAbort.current?.abort();
      const controller = new AbortController();
      designUploadAbort.current = controller;
      setError("");
      setDesignUploadName(file.name);
      setTemplate({ id: DESIGN_UPLOAD_ID, designAnthropicFileId: "" });
      setDesignStyle(null);
      try {
        const result = await uploadDesignReference(file, controller.signal);
        if (controller.signal.aborted) return false;
        setTemplate({ id: DESIGN_UPLOAD_ID, designAnthropicFileId: result.anthropicFileId });
        setSlideSize(result.format);
        return true;
      } catch (err) {
        if (controller.signal.aborted) return false;
        setTemplate(null);
        setDesignUploadName(null);
        setError(
          errorText(err, true),
        );
        return false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dict/t are stable i18n objects; the handler only reads them on the error path
    [],
  );
  // The "Upload your own" tile: a member's file is analysed at once; a visitor's
  // is only remembered (no sign-in until they press Generate).
  const onPickDesignFile = (file: File) => {
    if (!guest) {
      void onUploadDesign(file);
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(
        t.fileTooLarge.replace("{size}", `${(file.size / 1024 / 1024).toFixed(1)} ${t.unitMB}`),
      );
      return;
    }
    setError("");
    setDesignUploadFile(file);
    setDesignUploadName(file.name);
    setTemplate({ id: DESIGN_UPLOAD_ID, designAnthropicFileId: "" });
    setDesignStyle(null);
  };
  // Dropping the upload as the design reference (a template, a style or the
  // "Automatic" tile was picked) cancels an analysis that is still running.
  useEffect(() => {
    if (template?.id !== DESIGN_UPLOAD_ID) designUploadAbort.current?.abort();
  }, [template]);
  const [quality, setQuality] = useDefaultQuality();

  // ─── Derived flags ─────────────────────────────────────────────
  const hasText = contentText.trim().length > 0;
  const hasFile = contentFile !== null;
  // File path is "ready" only AFTER extraction completes. Text path
  // is always ready when non-empty. Gating Generate on the file
  // being fully extracted prevents POSTing /api/projects with a
  // dangling fileName before the document is available to Claude.
  const fileReady = hasFile && contentFileStage === "ready" && !!contentAnthropicFileId;
  const fileExtracting = hasFile && contentFileStage === "extracting";
  // A visitor's file is only kept in the browser (extracted after sign-in),
  // so for them a picked file is enough.
  const contentReady = hasText || (guest ? hasFile : fileReady);
  // Split-button credit estimate. Custom = the exact pick. Auto = the MODEL
  // decides the count (owner ruling 2026-07-18) - the display is the held
  // CEILING (tier cap, admin 75) rendered as "up to", matching the server's
  // hold exactly.
  const estimatedSlideCount = useMemo(
    () =>
      displaySlideEstimate(
        slideCountMode === "custom"
          ? { kind: "fixed", count: slideCountValue }
          : { kind: "text", text: hasFile ? "" : contentText },
        slideCap,
      ),
    [slideCountMode, slideCountValue, hasFile, contentText, slideCap],
  );
  // An upload follows its file; a typed prompt must choose, and so must a file
  // whose language could not be read.
  const writingLanguage = hasFile ? (fileLanguage ?? pickedLanguage) : pickedLanguage;
  const language: LanguageCode = writingLanguage && !isRtlLanguage(writingLanguage) ? "en" : "ar";
  const languageMissing = !writingLanguage && !fileExtracting;
  const suggestedLanguage = useMemo(() => detectLanguage(contentText).lang, [contentText]);
  const generateDisabled =
    !contentReady || submitting || fileExtracting || !writingLanguage;
  // A remembered-but-unresolved template (a visitor's pick, or one being
  // set up right after sign-in): generating must wait for its reference.
  const templatePending = !!template && !template.designAnthropicFileId;
  const designUploadActive = template?.id === DESIGN_UPLOAD_ID;
  const generateLoading = submitting || fileExtracting || (!guest && templatePending);

  // ─── File validation ───────────────────────────────────────────
  const validateFile = (next?: File | null): File | null => {
    if (!next) return null;
    const lower = next.name.toLowerCase();
    const extOk =
      lower.endsWith(".pdf") ||
      lower.endsWith(".pptx") ||
      lower.endsWith(".ppt") ||
      lower.endsWith(".docx");
    if (!extOk) {
      setError(t.fileTypeError);
      return null;
    }
    if (next.size > MAX_FILE_SIZE_BYTES) {
      setError(
        t.fileTooLarge.replace("{size}", `${(next.size / 1024 / 1024).toFixed(1)} ${t.unitMB}`),
      );
      return null;
    }
    setError("");
    return next;
  };
  const setContentFromInput = (next?: File | null) => {
    const valid = validateFile(next);
    if (!valid) return;
    setContentFile(valid);
    setContentText("");
    setContentFileText("");
    // Reset extraction state on every new pick so the polling
    // effect below restarts cleanly. setStage("extracting") at the
    // call site (not inside the useEffect) keeps the lint rule
    // react-hooks/set-state-in-effect quiet — same pattern as
    // /enhance + /mimic.
    setContentAnthropicFileId(null);
    setFileLanguage(null);
    setContentFileStage(guest ? "idle" : "extracting");
    setError("");
  };
  const removeContentFile = () => {
    setContentFile(null);
    setContentAnthropicFileId(null);
    setContentFileText("");
    setContentFileStage("idle");
    setError("");
  };

  // ─── Auto-extract: content file ────────────────────────────────
  // Mirrors /enhance + /mimic's polling effect. The result's
  // anthropicFileId is what we send as `source.anthropicFileId` on
  // submit — the actual document the LLM reads via the document
  // block in deck-generate.ts. Without this effect the file picker
  // was decorative (CR critical 2026-05-26).
  useEffect(() => {
    // Visitors: no upload before sign-in (the draft keeps the file).
    if (!contentFile || guest) return;
    const controller = new AbortController();
    let isCurrent = true;
    (async () => {
      try {
        const formData = new FormData();
        formData.append("file", contentFile);
        formData.append("kind", "create");
        formData.append("format", "16:9");
        const startRes = await fetch("/api/extract", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });
        if (!startRes.ok) {
          throw await apiError(startRes, `Upload failed (${startRes.status})`);
        }
        const { jobId } = (await startRes.json()) as { jobId: string };
        if (!jobId) throw new Error("No jobId returned from /api/extract");

        // Poll until the extract job lands at "completed" / "failed"
        // or the abort signal fires. Same interval + timeout as the
        // other flows (2.5 s / 5 min).
        const deadline = Date.now() + POLL_TIMEOUT_MS;
        while (Date.now() < deadline) {
          if (controller.signal.aborted) throw new Error("Cancelled");
          const res = await fetch(`/api/extract/${jobId}`, {
            signal: controller.signal,
          });
          if (!res.ok) {
            throw await apiError(res, `Status ${res.status}`);
          }
          const body = (await res.json()) as
            | { status: "queued" | "processing" }
            | { status: "failed"; error: string }
            | {
                status: "completed";
                result: { anthropicFileId: string; fullText?: string; textPerSlide?: string[]; contentLang?: string | null };
              };
          if (body.status === "completed") {
            if (!isCurrent) return;
            setContentAnthropicFileId(body.result.anthropicFileId);
            setFileLanguage(body.result.contentLang ?? null);
            setContentFileText(
              (body.result.fullText?.trim()
                ? body.result.fullText
                : (body.result.textPerSlide ?? []).join("\n")
              ).slice(0, 1200),
            );
            setContentFileStage("ready");
            return;
          }
          if (body.status === "failed") {
            throw new Error(body.error ?? "Extraction failed");
          }
          await new Promise((resolve) =>
            setTimeout(resolve, POLL_INTERVAL_MS),
          );
        }
        throw new Error("Extraction timed out. Try a smaller file.");
      } catch (err) {
        const isAbort =
          err instanceof DOMException && err.name === "AbortError";
        if (!isCurrent) return;
        if (isAbort) {
          setContentFileStage("idle");
          return;
        }
        console.error("[create] content extraction failed:", err);
        setError(
          errorText(err, true),
        );
        setContentFileStage("idle");
      }
    })();
    return () => {
      isCurrent = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t.parseFailed is a stable i18n string used only in the error path; re-running on locale change is unwanted
  }, [contentFile, guest]);

  // ─── Palette handlers ──────────────────────────────────────────
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

  // ─── Guest draft (2026-10-06) ──────────────────────────────────
  // A visitor's setup is saved as they go (settings debounced, files on
  // change) so the sign-up round trip never loses it; back here signed in
  // with ?resume=<mode>, it is restored once and cleared.
  const guestSettings = useMemo<GuestDraftSettings>(
    () => ({
      step,
      contentText,
      language: pickedLanguage ?? "",
      persistentText,
      templateId: template && template.id !== DESIGN_UPLOAD_ID ? template.id : null,
      designStyle,
      designStyleSource,
      lookTab,
      colors,
      fontMode: brandFont.mode,
      googleFamily: brandFont.googleFamily,
      uploadedFonts: brandFont.uploaded.map((f) => ({
        name: f.name,
        weights: f.faces.map((face) => face.weight),
      })),
      slideSize,
      slideCountMode,
      slideCountValue,
      pagination,
      imagesMode,
    }),
    [
      step,
      contentText,
      pickedLanguage,
      persistentText,
      template,
      designStyle,
      designStyleSource,
      lookTab,
      colors,
      brandFont,
      slideSize,
      slideCountMode,
      slideCountValue,
      pagination,
      imagesMode,
    ],
  );
  const guestFiles = useMemo<GuestDraftFiles>(() => {
    const fonts: Record<string, File> = {};
    brandFont.uploaded.forEach((family, fi) =>
      family.faces.forEach((face, ci) => {
        if (face.file) fonts[`${fi}:${ci}`] = face.file;
      }),
    );
    return {
      content: contentFile,
      design: designUploadActive ? designUploadFile : null,
      logo: logoFile,
      fonts,
    };
  }, [brandFont, contentFile, logoFile, designUploadActive, designUploadFile]);

  // A visitor who comes back still signed out (Back from Google's page, a
  // closed sign-up window, a reload) gets their draft back too (2026-10-09:
  // they landed on an empty first step and typed it all again, in a loop).
  // Saving waits until that restore has run, or the empty first render
  // would overwrite the draft.
  const [guestDraftReady, setGuestDraftReady] = useState(false);
  useEffect(() => {
    if (!guest || !guestDraftReady) return;
    const id = window.setTimeout(() => saveGuestSettings("create", guestSettings), 300);
    return () => window.clearTimeout(id);
  }, [guest, guestDraftReady, guestSettings]);
  useEffect(() => {
    if (!guest || !guestDraftReady) return;
    void saveGuestFiles("create", guestFiles);
  }, [guest, guestDraftReady, guestFiles]);
  // The top bar's "Log in" asks for an immediate save before leaving.
  useEffect(() => {
    if (!guest || !guestDraftReady) return;
    const flush = () => saveGuestSettings("create", guestSettings);
    window.addEventListener(GUEST_SAVE_EVENT, flush);
    return () => window.removeEventListener(GUEST_SAVE_EVENT, flush);
  }, [guest, guestDraftReady, guestSettings]);

  const [guestSignupOpen, setGuestSignupOpen] = useState(false);
  const openGuestSignup = async () => {
    saveGuestSettings("create", guestSettings);
    await saveGuestFiles("create", guestFiles);
    posthog.capture("create_guest_signup_prompt", { step, hasFile, template: !!template });
    setGuestSignupOpen(true);
  };

  // Restore after sign-up. "generate" also presses Create by itself (the
  // free-trial pop-up still shows first for a free account) once the file
  // is extracted and the template resolved. A visitor still signed out gets
  // a plain restore: same setup and step, the draft kept, nothing starts.
  // A gallery pick (?template=) or a landing style pick (?style=) is a fresh
  // start and skips it.
  const [autoStart, setAutoStart] = useState(false);
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const freshPick = search.has("template") || search.has("style");
    const mode = guest ? (freshPick ? null : "restore") : readResumeMode();
    if (!mode) {
      if (guest) queueMicrotask(() => setGuestDraftReady(true));
      return;
    }
    let aborted = false;
    (async () => {
      const draft = await loadGuestDraft<GuestDraftSettings>("create");
      if (aborted) return;
      if (!guest) {
        // Drop ?resume so a reload never replays it.
        const url = new URL(window.location.href);
        url.searchParams.delete("resume");
        window.history.replaceState(null, "", url.toString());
      }
      if (!draft) {
        setGuestDraftReady(true);
        return;
      }
      const d = draft.settings;
      setContentText(d.contentText ?? "");
      if (d.language && WRITING_LANGUAGES.includes(d.language)) setPickedLanguage(d.language);
      setPersistentText(d.persistentText ?? "");
      setLookTab(d.lookTab === "templates" ? "templates" : "styles");
      setDesignStyle(d.designStyle ?? null);
      if (d.designStyle) {
        styleTouchedRef.current = true;
        setDesignStyleSource(d.designStyleSource === "suggested" ? "suggested" : "manual");
      }
      setColors(Array.isArray(d.colors) ? d.colors.slice(0, MAX_PALETTE) : []);
      if (d.fontMode === "upload" && d.uploadedFonts.length > 0) {
        setBrandFont({
          mode: "upload",
          googleFamily: null,
          uploaded: d.uploadedFonts
            .map((family, fi) => ({
              name: family.name,
              faces: family.weights
                .map((weight, ci) => ({
                  weight,
                  file: draft.files.fonts[`${fi}:${ci}`] ?? null,
                  storageUrl: null,
                }))
                .filter((face) => face.file),
            }))
            .filter((family) => family.faces.length > 0),
        });
      } else if (d.googleFamily) {
        setBrandFont({ mode: "google", googleFamily: d.googleFamily, uploaded: [] });
      }
      if (draft.files.logo) {
        setLogoFile(draft.files.logo);
        setLoadedLogo(null);
      }
      if (d.slideSize === "16:9" || d.slideSize === "9:16") setSlideSize(d.slideSize);
      if (d.slideCountMode === "auto" || d.slideCountMode === "custom") {
        setSlideCountMode(d.slideCountMode);
      }
      if (typeof d.slideCountValue === "number") setSlideCountValue(d.slideCountValue);
      setPagination(d.pagination !== false);
      setImagesMode(!!d.imagesMode);
      if (draft.files.content) setContentFromInput(draft.files.content);
      const designFile = draft.files.design ?? null;
      if (designFile && guest) {
        setDesignUploadFile(designFile);
        setDesignUploadName(designFile.name);
        setTemplate({ id: DESIGN_UPLOAD_ID, designAnthropicFileId: "" });
      }
      setStep(mode === "generate" ? LAST_STEP : Math.min(LAST_STEP, Math.max(0, d.step)));
      setGuestDraftReady(true);
      if (guest) {
        // The template stays a remembered pick until sign-in.
        if (d.templateId) setTemplate({ id: d.templateId, designAnthropicFileId: "" });
        if (draft.files.lost) {
          setStep(0);
          setError(t.guestFileLost);
        }
        posthog.capture("create_guest_draft_restored", { flow: "create", step: d.step, hasFile: !!draft.files.content });
        return;
      }
      void clearGuestDraft("create");
      posthog.capture("create_guest_resumed", { mode, hasFile: !!draft.files.content });

      if (designFile) {
        // The visitor's uploaded design reference is analysed now that they are
        // signed in; auto-start below waits for it (templatePending).
        const ok = await onUploadDesign(designFile);
        if (aborted) return;
        if (!ok) {
          // Unreadable: back to the Design step, nothing generates.
          setStep(1);
          return;
        }
      }

      if (d.templateId) {
        setTemplate({ id: d.templateId, designAnthropicFileId: "" });
        const use = await resolveTemplateUse(d.templateId);
        if (aborted) return;
        if (!use) {
          // Gated or gone: back to the Design step, nothing generates.
          setTemplate(null);
          setStep(1);
          setError(t.design.failed);
          return;
        }
        setTemplate({ id: d.templateId, designAnthropicFileId: use.designAnthropicFileId });
        applyTemplateUse(use);
        // The draft's colours outrank the template's (the visitor may have
        // changed them after picking).
        setColors(Array.isArray(d.colors) ? d.colors.slice(0, MAX_PALETTE) : []);
      }
      if (draft.files.lost) {
        // The saved file could not be read back: no auto-start; back to
        // the content step to attach it again.
        setStep(0);
        setError(t.guestFileLost);
        posthog.capture("create_guest_file_lost", { flow: "create" });
        return;
      }
      if (mode === "generate") setAutoStart(true);
    })();
    return () => {
      aborted = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on mount; setContentFromInput / t are stable for this purpose
  }, [guest]);

  // ─── Submit ────────────────────────────────────────────────────
  const handleGenerate = async (overrideSlideCount?: number) => {
    // onClick={handleGenerate} passes the click EVENT as the first arg -
    // only a real number (the dialog's reduce offer) counts as an
    // override.
    const reducedSlideCount =
      typeof overrideSlideCount === "number" ? overrideSlideCount : null;
    if (!contentReady) return;
    setError("");
    setCreditGate(null);
    setSubmitting(true);
    try {
      const logoUploaded = await uploadAsset(
        "brand-assets",
        "logos",
        logoFile,
      );

      const content = hasFile
        ? {
            // "file" (NOT "source") matches the server's content union
            // ("file" | "text"); buildProjectTitle keys off it to derive
            // the project title from the filename. The uploaded document
            // itself reaches Claude via `source.anthropicFileId` below,
            // independent of this field.
            type: "file" as const,
            fileName: contentFile!.name,
            fileSize: contentFile!.size,
          }
        : {
            type: "text" as const,
            text: contentText.trim(),
          };

      // Resolve the single brand font → ONE field reused for heading + body
      // (one family, Claude varies weights / pairs uploads). Upload mode now
      // carries EVERY picked family with ALL its weight faces; the deck
      // defaults heading/body to the first family's name and Claude pairs.
      let fontField: ResolvedFontField = null;
      // Every resolved uploaded family (name + weight faces) — forwarded so
      // Claude pairs them to heading/body; deck-generate signs each face file.
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

      // Resolve the logo's storageUrl: a freshly uploaded file wins, else a
      // hydrated kit's storageUrl. The server re-signs the path itself.
      const resolvedLogoStorageUrl =
        logoUploaded?.storageUrl ?? loadedLogo?.storageUrl ?? null;

      // Logo + persistent cover/closing excludes are gone — Claude decides
      // logo presence per slide; the persistent footer is on every slide.
      const noExclude: ("cover" | "closing")[] = [];

      const brand = {
        colors,
        // Empty colors = Auto: deck-generate keys off the empty array; the
        // mode string just keeps the stored brief honest.
        paletteMode: colors.length > 0 ? ("manual" as const) : ("auto" as const),
        paletteScreenshotUrl: null,
        fonts: {
          heading: fontField,
          body: fontField,
          ...(uploadedFontFields.length > 0
            ? { uploaded: uploadedFontFields }
            : {}),
        },
        logo: resolvedLogoStorageUrl
          ? {
              storageUrl: resolvedLogoStorageUrl,
              exclude: noExclude,
            }
          : null,
        slideSize,
        slideCount: {
          mode: slideCountMode,
          value: slideCountMode === "custom" ? slideCountValue : null,
        },
      };

      const rules = {
        designStyle: template ? null : designStyle,
        designStyleSource: template || !designStyle ? null : designStyleSource,
        fixTypos: false,
        pagination,
        persistent: persistentText.trim()
          ? {
              text: persistentText.trim(),
              exclude: noExclude,
            }
          : null,
      };

      // When the user picked a content file, attach the extracted
      // anthropicFileId as a scratch-with-source. Empty / text-only
      // submits omit `source` entirely so the server reverts to the
      // legacy scratch path. Pre-fix the file selection was thrown
      // away on submit (CR critical 2026-05-26).
      // A picked template = a template generation (Mimic engine): the
      // template deck is the design reference, the content rides as the
      // typed text or the uploaded file.
      const source = template
        ? hasFile && contentAnthropicFileId
          ? {
              kind: "mimic" as const,
              uglyAnthropicFileId: contentAnthropicFileId,
              designAnthropicFileId: template.designAnthropicFileId,
              fonts: [],
            }
          : {
              kind: "mimic" as const,
              userContent: contentText.trim(),
              designAnthropicFileId: template.designAnthropicFileId,
              fonts: [],
            }
        : hasFile && contentAnthropicFileId
          ? { kind: "scratch" as const, anthropicFileId: contentAnthropicFileId }
          : null;

      // TQ-FLOW-TRACKER — TEMPORARY (remove after testing; grep TQ-FLOW-TRACKER)
      console.log(
        "%c[flow]%c EVENT create:POST /api/projects",
        "background:#370BF4;color:#fff;padding:1px 6px;border-radius:4px;font-weight:700",
        "color:#370BF4;font-weight:600",
        JSON.parse(
          JSON.stringify({
            language,
            slideCount: slideCountMode === "custom" ? slideCountValue : "auto",
            quality,
            imagesMode,
            hasSource: !!source,
          }),
        ),
      );
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          brand,
          rules,
          language,
          writingLanguage,
          saveBrandKit,
          slideCount:
            reducedSlideCount ??
            (slideCountMode === "custom" ? slideCountValue : null),
          quality,
          imagesMode,
          ...(source ? { source } : {}),
          // Lets the server honour a free-plan template (it re-mints the
          // design reference itself for those).
          ...(template && template.id !== DESIGN_UPLOAD_ID ? { templateId: template.id } : {}),
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string; code?: string }
          | null;
        if (response.status === 402 && isCreditGatePayload(data)) {
          setCreditGate(data);
          setSubmitting(false);
          return;
        }
        throw new ApiError(data?.error ?? t.createFailed, data?.code, response.status);
      }

      const data = (await response.json()) as { projectId: string };
      // TQ-FLOW-TRACKER — TEMPORARY (remove after testing)
      console.log(
        `%c[flow]%c EVENT create:handoff → /project/${data.projectId}`,
        "background:#370BF4;color:#fff;padding:1px 6px;border-radius:4px;font-weight:700",
        "color:#370BF4;font-weight:600",
        { projectId: data.projectId },
      );
      router.push(localizedHref(`/project/${data.projectId}`, locale));
    } catch (caughtError) {
      console.error("[create] generate failed:", caughtError);
      setError(
        errorText(caughtError),
      );
      setSubmitting(false);
    }
  };

  // ─── Wizard chrome (2026-10-06 redesign) ───────────────────────
  // Two steps (2026-10-07): content + settings, then design + brand.
  const stepTitles = [t.contentCard, t.design.card];
  const hasContent = hasText || hasFile;
  const goToStep = (next: number) => {
    if (next === 1 && step !== 1) {
      posthog.capture("design_step_viewed", { flow: "create", tab: lookTab });
    }
    setStep(Math.max(0, Math.min(LAST_STEP, next)));
    scrollWizardTop();
  };

  // Style suggestions (2026-10-19): on the Design step, ask once per content
  // which styles fit it; the first one is applied unless the user already chose
  // a style or a template (the refs keep the async reply from overriding that).
  const templatePickedRef = useRef(false);
  useEffect(() => {
    templatePickedRef.current = template !== null;
  }, [template]);
  const suggestKeyRef = useRef("");
  const styleSample = (hasFile ? contentFileText : contentText).trim().slice(0, 1200);
  useEffect(() => {
    if (step !== 1 || !styleSample) return;
    const key = `${imagesMode ? 1 : 0}:${styleSample}`;
    if (key === suggestKeyRef.current) return;
    suggestKeyRef.current = key;
    let alive = true;
    let done = false;
    fetch("/api/style-suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: styleSample, imagesMode }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { styles?: unknown } | null) => {
        done = true;
        if (!alive) return;
        const styles = (Array.isArray(data?.styles) ? data.styles : []).filter(
          (s): s is string => typeof s === "string" && DECK_STYLES.some((d) => d.label === s),
        );
        setSuggestedStyles(styles);
        const apply = !!styles[0] && !styleTouchedRef.current && !templatePickedRef.current;
        if (apply) {
          setDesignStyle(styles[0]);
          setDesignStyleSource("suggested");
        }
        posthog.capture("design_styles_suggested", {
          flow: "create",
          styles,
          applied: apply,
          fromFile: hasFile,
        });
      })
      .catch(() => {
        done = true;
      });
    return () => {
      alive = false;
      // Interrupted before the reply: ask again next time.
      if (!done) suggestKeyRef.current = "";
    };
  }, [step, styleSample, imagesMode, hasFile]);

  return (
    // `.tq-wizard-fit`: on a desktop viewport the page is exactly one viewport
    // tall and the stage takes the leftover height (globals.css).
    <div className="page-container tq-wizard-fit flex w-full justify-center">
      <GuestSignupDialog
        flow="create"
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
      <div className="mt-[4vh] flex w-full flex-col items-center gap-5 px-4 desk:px-8 stage:mt-0 stage:min-h-0 stage-tight:gap-3">
        <WizardHead
          tool="create"
          title={t.create.title}
          subtitle={t.create.subtitle}
          steps={stepTitles}
          step={step}
          onStep={goToStep}
          reachable={hasContent ? LAST_STEP : 0}
          rail={false}
        />

        <WizardStage>
          {/* ═══════════════════════════════════════════════════════
              STEP 1 · CONTENT (wide) + PRESENTATION SETTINGS (narrow)
              ═══════════════════════════════════════════════════════ */}
          <SplitStep visible={step === 0} label={t.contentCard}>
            <WizardCard
              title={t.contentCard}
            >
              <div className="mb-3">
                <DeckLanguagePicker
                  value={pickedLanguage}
                  fileLanguage={hasFile ? fileLanguage : null}
                  suggested={suggestedLanguage}
                  missing={hasContent && languageMissing}
                  onChange={setPickedLanguage}
                  disabled={submitting}
                />
              </div>
              <input
                ref={contentInputRef}
                type="file"
                accept=".pdf,.pptx,.ppt,.docx"
                className="hidden"
                onChange={(event) => setContentFromInput(event.target.files?.[0])}
              />
              {/* Grows to fill the card on a viewport-fit stage; a
                  comfortable fixed minimum on phones / short viewports. */}
              <textarea
                value={contentText}
                onChange={(event) => {
                  const next = event.target.value;
                  setContentText(next);
                  if (next.length > 0 && contentFile) removeContentFile();
                }}
                placeholder={t.contentPlaceholder}
                rows={8}
                dir={writingLanguage ? (language === "en" ? "ltr" : "rtl") : "auto"}
                // Mirrors the server's content.text 400 cap in /api/projects
                // (brief-limits.ts) so the limit is felt here, not as a
                // failed submit.
                maxLength={MAX_CONTENT_TEXT_CHARS}
                disabled={submitting || hasFile}
                className="input-dark min-h-[220px] resize-y text-sm leading-6 disabled:cursor-not-allowed disabled:opacity-50 stage:min-h-0 stage:flex-1 stage:resize-none"
              />

              {/* Dropzone - dimmed + `inert` while text is typed (also pulls the
                  button out of the tab order). Mirrors /mimic's dropzone. */}
              <div
                className={`flex flex-col gap-2.5 transition-opacity duration-200 ${
                  hasText ? "opacity-40" : ""
                }`}
                inert={hasText}
              >
                <div className="flex items-center gap-2 text-[11px] text-foreground/40">
                  <div className="h-px flex-1 bg-[var(--tq-border-hairline)]" />
                  <span>{t.or}</span>
                  <div className="h-px flex-1 bg-[var(--tq-border-hairline)]" />
                </div>
                <ContentDropzone
                  file={contentFile}
                  submitting={submitting}
                  dragging={contentDragging}
                  setDragging={setContentDragging}
                  onOpen={() => contentInputRef.current?.click()}
                  onDrop={(f) => setContentFromInput(f)}
                  onRemove={removeContentFile}
                />
              </div>
            </WizardCard>

            <WizardCard title={t.outputCard}>
              {/* Slide size as two picture tiles that take the card's spare
                  height; the other settings are compact rows below. */}
              <div className="stage:min-h-0 stage:flex-1">
                <SlideSizeFields slideSize={slideSize} onSlideSize={setSlideSize} big />
              </div>

              <div className={SETTINGS_ROW}>
                <div className="flex min-h-[24px] items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground/80">
                    {t.slideCount}
                  </span>
                  {/* `layout` on the parent FLIPs the toggle when the stepper
                      appears; the inner motion.div only animates its own
                      width + opacity (a fixed 66 px avoids the auto-width
                      snap) and absorbs the gap on exit. */}
                  <motion.div
                    layout
                    transition={{ type: "spring", stiffness: 500, damping: 35 }}
                    className="flex items-center gap-1.5"
                  >
                    <SegmentedToggle
                      options={SLIDE_COUNT_OPTIONS}
                      value={slideCountMode}
                      onChange={setSlideCountMode}
                      ariaLabel={t.slideCount}
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

              <div className={`flex items-center justify-between gap-2 ${SETTINGS_ROW}`}>
                <span className="text-sm font-semibold text-foreground/80">
                  {t.slideNumbering}
                </span>
                <Toggle
                  ariaLabel={t.slideNumbering}
                  value={pagination}
                  onChange={setPagination}
                />
              </div>

              {/* AI images: Plus+ gated inside the panel itself; free users get
                  the crown + UpgradeModal. */}
              <div className={SETTINGS_ROW}>
                <AIImagesPanel
                  value={imagesMode}
                  onChange={setImagesMode}
                  disabled={submitting}
                  hint={mentionsPictures(contentText)}
                />
              </div>

              {/* Persistent element (Claude places it on every slide): a deck
                  setting, so it lives here rather than with the content. */}
              <div className={SETTINGS_ROW}>
                <PersistentRow
                  text={persistentText}
                  language={language}
                  onText={setPersistentText}
                />
              </div>
            </WizardCard>
          </SplitStep>

          {/* ═══════════════════════════════════════════════════════
              STEP 2 · DESIGN (wide) + BRAND (narrow), then Generate.
              ═══════════════════════════════════════════════════════ */}
          <SplitStep visible={step === 1} label={t.design.card}>
            <DesignCard
              tab={lookTab}
              onTab={(next) => {
                setLookTab(next);
                posthog.capture("design_tab_switched", { flow: "create", tab: next });
              }}
              stylesFirst
              suggestedStyles={suggestedStyles}
              templateId={template?.id ?? null}
              onPickTemplate={pickTemplate}
              onGuestPickTemplate={guest ? pickGuestTemplate : undefined}
              onClearTemplate={() => setTemplate(null)}
              designStyle={designStyle}
              onDesignStyle={onDesignStyle}
              templateNote={designUploadActive ? t.design.uploadNote : t.design.templateNote}
              upload={{
                active: designUploadActive,
                name: designUploadName,
                stage:
                  !designUploadActive
                    ? "idle"
                    : guest || template?.designAnthropicFileId
                      ? "ready"
                      : "extracting",
                onFile: onPickDesignFile,
              }}
              disabled={submitting}
            />
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
          lastStep={LAST_STEP}
          onStep={goToStep}
          nextDisabled={step === 0 && (!hasContent || languageMissing)}
          nextLabel={t.wizard.nextLook}
          wide
          busy={submitting}
          // The file poll keeps running after step 1; this explains a
          // disabled Generate the user can no longer see the cause of.
          status={fileExtracting ? t.wizard.extracting : hasContent && languageMissing ? t.chooseDeckLanguage : null}
          generate={
            <GenerateSplitButton
              guest={guest}
              autoStart={autoStart && !templatePending}
              onGenerate={guest ? () => void openGuestSignup() : handleGenerate}
              quality={quality}
              onQualityChange={setQuality}
              slideCount={estimatedSlideCount.slides}
              slideCountUpTo={estimatedSlideCount.upTo}
              imagesMode={imagesMode}
              disabled={generateDisabled}
              loading={generateLoading}
            />
          }
        />

        {/* Rendered only with an error: an empty reserved line would cost the
            viewport-fit stage 40px on every visit. */}
        {error ? (
          <p className="text-center text-sm text-red-400" role="alert" aria-live="polite">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// ContentDropzone — horizontal compact dropzone for the content
// card. Same shape as /mimic's FileDropzone in horizontal mode.
// ───────────────────────────────────────────────────────────────────
function ContentDropzone({
  file,
  submitting,
  dragging,
  setDragging,
  onOpen,
  onDrop,
  onRemove,
}: {
  file: File | null;
  submitting: boolean;
  dragging: boolean;
  setDragging: (d: boolean) => void;
  onOpen: () => void;
  onDrop: (f?: File | null) => void;
  onRemove: () => void;
}) {
  const t = useDict().flows;
  return (
    <div className="relative flex-1">
      <button
        type="button"
        onClick={onOpen}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          onDrop(event.dataTransfer.files?.[0]);
        }}
        disabled={submitting}
        className={`flex w-full items-center gap-3 rounded-xl border border-dashed p-2.5 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          dragging
            ? "border-foreground/40 bg-foreground/[0.04]"
            : "border-foreground/20 bg-overlay-soft hover:border-foreground/30"
        } min-h-[44px]`}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--tq-surface)]">
          <span
            className="material-symbols-outlined text-foreground/80"
            style={{ fontSize: 18 }}
          >
            {file ? "description" : "cloud_upload"}
          </span>
        </span>

        {file ? (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">
              {readableFileName(file.name)}
            </p>
            <p className="mt-0.5 truncate text-xs text-foreground/60">
              {formatFileSize(file.size, t.unitKB, t.unitMB)}
            </p>
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">
              {t.dropTitle}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-foreground/40">
              {t.dropSubtitle}
            </p>
          </div>
        )}
      </button>

      {file && !submitting ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          aria-label={t.removeFile}
          className="absolute top-2 start-2 flex h-7 w-7 items-center justify-center rounded-md bg-black/35 text-foreground/60 transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: "16px" }}
          >
            close
          </span>
        </button>
      ) : null}
    </div>
  );
}
