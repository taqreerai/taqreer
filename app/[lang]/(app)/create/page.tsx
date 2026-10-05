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
// Phase 19 (2026-10-02, user direction): step 2 is now ONE "Design" step -
// templates, design styles, colour templates, font and logo together. A
// picked TEMPLATE turns the run into a template generation (the Mimic engine
// reuses the template deck's design with this content; source kind "mimic");
// a template and a design style are mutually exclusive. The gallery's "Use
// this template" now lands here with ?template=<id> preselected. Brand kits
// still hydrate from sessionStorage or the user's default.

import { DesignStyleGrid } from "@/components/create/DesignStylePicker";
import {
  TemplatePickerGrid,
  type PickedTemplate,
} from "@/components/create/TemplatePickerGrid";
import { PalettePresetGrid } from "@/components/brand/PalettePresets";
import { PickerExpandButton, PickerExpandModal } from "@/components/create/PickerExpandModal";
import { PALETTE_PRESETS, samePalette } from "@/lib/brand/palette-presets";
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
import { isPaidPlan } from "@/lib/plan";
import { displaySlideEstimate } from "@/lib/credits/cost";
import { localizedHref } from "@/lib/i18n/navigation";
import { localizedExtractError } from "@/lib/extract/error-codes";
import { AnimatePresence, motion } from "framer-motion";
import { GenerateSplitButton } from "@/components/create/GenerateSplitButton";
import { PillButton } from "@/components/create/PillButton";
import { WizardStepRail } from "@/components/create/WizardChrome";
import { BrandFontPicker } from "@/components/brand/BrandFontPicker";
import { LogoRow } from "@/components/brand/LogoRow";
import { PersistentRow } from "@/components/brand/PersistentRow";
import { AIImagesPanel } from "@/components/brand/AIImagesPanel";
import {
  BrandKitDropdown,
  type BrandKitOption,
} from "@/components/brand/BrandKitDropdown";
import {
  InlineStepper,
  SlideSizeFields,
  STYLE_REQUIRES_IMAGES,
  type SlideSize,
  type SlideCountMode,
} from "@/components/create/OutputCards";
import {
  CardHeader,
  InlinePaletteSwatch,
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
import { SlideCapHint } from "@/components/billing/SlideCapHint";
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
const DEFAULT_PALETTE = ["#000000", "#FFFFFF"];

// Cards use a responsive grid with `auto-fit` + `minmax(280px, 1fr)`
// instead of fixed widths. Math at common viewports:
//   • 1440 viewport, ~1184 content row → 4 cards at ~284 px each
//   • 1100 → 2×2, each card ~530 px
//   • 760  → 2×2 at ~360 px
//   • 540  → 1 column at 280 px floor
// Cards stretch to fill row when fewer than 4 fit, capping at 1fr
// share so they never leave gutters on either edge. /enhance + /mimic
// keep their fixed-width 360 px cards (fewer of them per row).
const CARD_MIN_H_CLASS = "min-h-[440px]";

// Steps 1-2 share one grid cell and the inactive card stays `invisible` (keeps
// its height) so the frame doesn't jump between them. Step 3 is much shorter
// and must hug its content (user direction 2026-10-04: no dead space), so on
// step 3 the other two cards leave layout entirely.
// Desktop (1180px+, 2026-10-05: was xl/1280, which missed a 4K screen at 300% scaling): all three cards show side by side
// in reading order with Generate below; the `desk:` overrides on each card undo
// the wizard stacking, and the rail + Next button hide. Below 1180px it stays the
// one-card-at-a-time wizard.
function stackedCardVisibility(card: 0 | 1, step: number): string {
  if (step === card) return "flex";
  return step === 2 ? "hidden" : "invisible flex";
}

// SLIDE_COUNT_OPTIONS + LANGUAGE_OPTIONS are built inside the component so their
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
  const { locale } = useLocale();
  const t = dict.flows;
  const SLIDE_COUNT_OPTIONS = [
    { value: "auto" as const, label: t.auto },
    { value: "custom" as const, label: t.custom },
  ];
  const LANGUAGE_OPTIONS: { value: LanguageCode; label: string }[] = [
    { value: "ar", label: t.langArabic },
    { value: "en", label: t.langEnglish },
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
  // Slide size now lives in the OUTPUT card (alongside slide count
  // + pagination + persistent overlay). Language stays close to the
  // textarea since it modulates the typed content directly.
  const [slideSize, setSlideSize] = useState<SlideSize>("16:9");
  const [language, setLanguage] = useState<LanguageCode>("ar");

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

  // Fetch the user's saved kits (last 5) for the in-card brand dropdown.
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
        /* best-effort — dropdown just stays empty */
      }
    })();
    return () => {
      aborted = true;
    };
  }, []);

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
    plan: creditsForImages?.plan ?? null,
    isAdmin: creditsForImages?.isAdmin ?? false,
  });
  // Images default ON for free accounts (their images cost 0 credits, owner
  // decision 2026-10-04: the first deck shows the product at its best) and
  // OFF for paid plans. Derived until the user touches the toggle, so the
  // default follows /api/credits once it resolves without a mount effect.
  const [imagesChoice, setImagesMode] = useState<boolean | null>(null);
  const imagesMode =
    imagesChoice ??
    (creditsForImages !== null &&
      !creditsForImages.isAdmin &&
      !isPaidPlan(creditsForImages.plan));
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
  const onDesignStyle = useCallback(
    (style: string | null) => {
      setDesignStyle(style);
      setTemplate(null);
      // Image-leaning styles auto-enable images mode — overridable: we only
      // flip it ON, never force it off, so the user keeps control (Duotone/
      // Editorial/Minimal/Playful per STYLE_REQUIRES_IMAGES). Unlocked users
      // only — see imagesUnlocked above.
      if (style && STYLE_REQUIRES_IMAGES.has(style) && imagesUnlocked) {
        setImagesMode(true);
      }
    },
    [imagesUnlocked],
  );
  const [persistentText, setPersistentText] = useState<string>("");

  // ─── Template (Design step) ────────────────────────────────────
  // A picked template: its minted design reference + format. Null = design
  // from scratch (optionally steered by designStyle). Mutually exclusive with
  // a design style: picking one clears the other.
  const [lookTab, setLookTab] = useState<"templates" | "styles">("templates");
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
  // /create?template=<id> - the gallery's "Use this template" lands here with
  // the template preselected (the gallery already resolved + cached it).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("template");
    if (!id) return;
    let aborted = false;
    (async () => {
      try {
        let use = readCachedUse("template", id);
        if (!use) {
          use = await fetchUse("template", id);
          writeCachedUse("template", id, use);
        }
        if (aborted) return;
        setTemplate({ id, designAnthropicFileId: use.designAnthropicFileId });
        setDesignStyle(null);
        applyTemplateUse(use);
      } catch {
        /* gated / gone: the user just starts without it */
      }
    })();
    return () => {
      aborted = true;
    };
  }, [applyTemplateUse]);

  // ─── Wizard step (2026-08-30, user direction) ─────────────────
  // The three cards present one at a time: 0 Content, 1 Brand,
  // 2 Output + Generate. Pure presentation - every card stays
  // MOUNTED (display-toggled) so the hidden file input, logo blob
  // URLs and fixed-position popovers survive step changes, and the
  // /api/extract poll keeps running while the user moves on.
  const [step, setStep] = useState(0);
  // Design card "show all" modal for the colour templates (the template
  // picker owns its own, see TemplatePickerGrid).
  const [palettesExpanded, setPalettesExpanded] = useState(false);

  // ─── Submit-level state ────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // 402 credit-gate payload from POST /api/projects (billing Phase A).
  const [creditGate, setCreditGate] = useState<CreditGatePayload | null>(null);
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
  const contentReady = hasText || fileReady;
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
  const generateDisabled =
    !contentReady || submitting || fileExtracting;
  const generateLoading = submitting || fileExtracting;

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
    // Reset extraction state on every new pick so the polling
    // effect below restarts cleanly. setStage("extracting") at the
    // call site (not inside the useEffect) keeps the lint rule
    // react-hooks/set-state-in-effect quiet — same pattern as
    // /enhance + /mimic.
    setContentAnthropicFileId(null);
    setContentFileStage("extracting");
    setError("");
  };
  const removeContentFile = () => {
    setContentFile(null);
    setContentAnthropicFileId(null);
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
    if (!contentFile) return;
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
          const data = (await startRes.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(
            data?.error ?? `Upload failed (${startRes.status})`,
          );
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
            const data = (await res.json().catch(() => null)) as
              | { error?: string }
              | null;
            throw new Error(data?.error ?? `Status ${res.status}`);
          }
          const body = (await res.json()) as
            | { status: "queued" | "processing" }
            | { status: "failed"; error: string }
            | { status: "completed"; result: { anthropicFileId: string } };
          if (body.status === "completed") {
            if (!isCurrent) return;
            setContentAnthropicFileId(body.result.anthropicFileId);
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
          err instanceof Error
            ? localizedExtractError(dict.flows.extractErrors, err.message)
            : t.parseFailed,
        );
        setContentFileStage("idle");
      }
    })();
    return () => {
      isCurrent = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t.parseFailed is a stable i18n string used only in the error path; re-running on locale change is unwanted
  }, [contentFile]);

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
          saveBrandKit,
          slideCount:
            reducedSlideCount ??
            (slideCountMode === "custom" ? slideCountValue : null),
          quality,
          imagesMode,
          ...(source ? { source } : {}),
          // Lets the server honour a free-plan template (it re-mints the
          // design reference itself for those).
          ...(template ? { templateId: template.id } : {}),
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
        throw new Error(data?.error ?? t.createFailed);
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
        caughtError instanceof Error
          ? caughtError.message
          : t.startFailed,
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="page-container flex w-full justify-center">
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
          <h1 className="tq-h1">{t.create.title}</h1>
          <p className="tq-subhead mt-2">{t.create.subtitle}</p>
        </header>

        {/* Step rail - labelled with the existing card titles, Latin
            numerals; completed steps are click-to-jump, forward travel
            goes through Next so gating stays in one place. */}
        <div className="desk:hidden">
          <WizardStepRail
            steps={[t.contentCard, t.design.card, t.outputCard]}
            active={step}
            onJump={setStep}
          />
        </div>

        {/* Wizard column: ONE card visible per step (was a 3-across
            wrapping row until 2026-08-30, user direction - three dense
            cards at once read as overwhelming). All three stay mounted;
            the inactive ones swap `flex` for `hidden`. Width is capped
            per-card (not full-bleed) so the flex-1 textarea / logo zones
            keep their designed proportions inside min-h-[440px]. */}
        <div className="flex w-full flex-col items-center gap-4">
          {/* Single-cell grid: all three cards occupy the SAME cell
              (col/row-start-1) and the inactive ones are `invisible`
              (visibility, not display) - they keep participating in
              layout, so the stack's height is the TALLEST card at
              steps 1-2 and the frame never jumps between them
              (user direction 2026-08-30). Step 3 hugs its content
              (stackedCardVisibility, 2026-10-04). */}
          <div className="grid w-full justify-items-center desk:w-auto desk:grid-cols-[repeat(3,minmax(0,430px))] desk:gap-6">
          {/* ═══════════════════════════════════════════════════════
              CONTENT CARD (step 1)
              ═══════════════════════════════════════════════════════ */}
          <div
            className={`surface-card ${stackedCardVisibility(0, step)} col-start-1 row-start-1 w-full sm:w-[430px] ${CARD_MIN_H_CLASS} flex-col desk:visible desk:col-start-auto desk:row-start-auto desk:flex desk:w-full desk:min-w-0 gap-4 rounded-2xl p-4`}
          >
            <CardHeader icon="subject" title={t.contentCard} />

            <input
              ref={contentInputRef}
              type="file"
              accept=".pdf,.pptx,.ppt,.docx"
              className="hidden"
              onChange={(event) => setContentFromInput(event.target.files?.[0])}
            />

            {/* Language label-row + textarea grouped into ONE section
                so the gap between them is the same 6 px (space-y-1.5)
                used in the fonts card's "خط العناوين → input slot"
                pattern. Without this wrapper they were two separate
                top-level card children separated by the card's
                gap-4 (16 px). flex-1 on the wrapper + flex-1 on the
                textarea keeps the textarea growing to fill the
                card's leftover vertical space. */}
            <div className="flex flex-1 flex-col space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground/70">
                  {t.language}
                </span>
                <SegmentedToggle
                  options={LANGUAGE_OPTIONS}
                  value={language}
                  onChange={setLanguage}
                  ariaLabel={t.contentLanguageAria}
                />
              </div>

              <textarea
                value={contentText}
                onChange={(event) => {
                  const next = event.target.value;
                  setContentText(next);
                  if (next.length > 0 && contentFile) removeContentFile();
                }}
                placeholder={t.contentPlaceholder}
                rows={2}
                dir={language === "en" ? "ltr" : "rtl"}
                // Mirrors the server's content.text 400 cap in
                // /api/projects (brief-limits.ts) so the limit is felt
                // here, not as a failed submit.
                maxLength={MAX_CONTENT_TEXT_CHARS}
                disabled={submitting || hasFile}
                className="input-dark min-h-[60px] flex-1 resize-none text-sm leading-5 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            {/* Dropzone — always rendered, dimmed when text typed.
                `inert` (not pointer-events-none/aria-hidden) when text is
                present: it also pulls the inner button out of the tab
                order so keyboard / AT users can't open the picker while
                the text path is active — `aria-hidden` alone left it
                focusable. Mirrors /mimic's content dropzone fix. */}
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

            {/* Persistent footer element — text input only (position
                picker removed 2026-06-02; Claude places it). No cover/
                closing exclude — it's on every slide by definition. */}
            <div className="border-t border-[var(--tq-border-hairline)] pt-3">
              <PersistentRow
                text={persistentText}
                language={language}
                onText={setPersistentText}
              />
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════
              DESIGN CARD (step 2) — template OR style, colour
              templates + palette, one font, logo. Same size as the other
              two cards (user direction 2026-10-02); the template grid
              scrolls inside it.
              ═══════════════════════════════════════════════════════ */}
          <div
            className={`surface-card ${stackedCardVisibility(1, step)} col-start-1 row-start-1 w-full sm:w-[430px] ${CARD_MIN_H_CLASS} flex-col desk:visible desk:col-start-auto desk:row-start-auto desk:flex desk:w-full desk:min-w-0 gap-4 rounded-2xl p-4`}
          >
            {/* Mirrors CardHeader exactly (icon + title + pb-4 hairline) so
                the separator and title sit at the same heights as the other
                cards. z-30 lifts the whole header — and the saved-kit menu
                that drops out of it — above the later palette/font/logo rows,
                which would otherwise paint on top of the open menu. */}
            <header className="relative z-30 border-b border-foreground/[0.08] pb-4">
              {/* The title row is the positioning context for the saved-kit
                  pill, so the pill centres on the TITLE (top-1/2 of this row),
                  not the full header — keeping it level with the title while
                  pb-4 holds the separator below. The pill is absolute so it
                  never grows the row or shifts the separator off the others. */}
              <div className="relative flex items-center gap-2">
                <span
                  className="material-symbols-outlined text-foreground"
                  style={{ fontSize: 18 }}
                >
                  palette
                </span>
                <h3 className="text-sm font-semibold text-foreground">
                  {t.design.card}
                </h3>
                {kitOptions.length > 0 ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.2 }}
                    className="absolute end-0 top-1/2 -translate-y-1/2"
                  >
                    <BrandKitDropdown
                      kits={kitOptions}
                      onSelect={handlePickKit}
                    />
                  </motion.div>
                ) : null}
              </div>
            </header>

            {/* The deck's look: a ready-made template (template
                generation) OR a design style (from scratch). Both grids stay
                mounted so the template list isn't refetched per tab flip. */}
            <div className="flex flex-col gap-2.5">
              <div role="tablist" aria-label={t.design.card} className="design-tabs">
                {(["templates", "styles"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={lookTab === tab}
                    onClick={() => setLookTab(tab)}
                    className={`design-tab ${lookTab === tab ? "is-active" : ""}`}
                  >
                    {tab === "templates" ? t.design.tabTemplates : t.design.tabStyles}
                  </button>
                ))}
              </div>
              <div className={lookTab === "templates" ? "" : "hidden"}>
                <TemplatePickerGrid
                  selectedId={template?.id ?? null}
                  onSelect={pickTemplate}
                  onClear={() => setTemplate(null)}
                  disabled={submitting}
                />
              </div>
              <div className={lookTab === "styles" ? "" : "hidden"}>
                {/* A picked template outranks the style grid: no tile reads
                    as active (not even Auto) while one is set. */}
                <DesignStyleGrid
                  value={template ? "__template__" : designStyle}
                  onChange={onDesignStyle}
                  disabled={submitting}
                />
              </div>
              {template ? (
                <p className="text-[11px] leading-4 text-foreground/55">
                  {t.design.templateNote}
                </p>
              ) : null}
            </div>

            {/* Colours: Auto / custom swatches on the first row, the
                one-click colour templates under it. */}
            <div className="flex flex-col gap-2 border-t border-[var(--tq-border-hairline)] pt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-foreground/70">
                {t.colors}
              </span>
              <div className="flex items-center gap-1.5">
                {/* Auto pill — active (solid stroke) when no colors are
                    picked; in manual mode it becomes the way back to Auto. */}
                <button
                  type="button"
                  onClick={() => setColors([])}
                  disabled={colors.length === 0}
                  aria-pressed={colors.length === 0}
                  title={t.autoColorsHint}
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
                  {t.autoColors}
                </button>
                {colors.map((color, index) => (
                  <InlinePaletteSwatch
                    key={index}
                    value={color}
                    index={index}
                    removable={colors.length > MIN_PALETTE}
                    onChange={(next) => updateColor(index, next)}
                    onRemove={() => removeColor(index)}
                  />
                ))}
                {colors.length < MAX_PALETTE ? (
                  <button
                    type="button"
                    onClick={addColor}
                    aria-label={t.addColor}
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
            <PalettePresetGrid
              activeId={
                PALETTE_PRESETS.find((p) => samePalette(colors, p.colors))?.id ??
                null
              }
              onPick={(p) => setColors([...p.colors])}
              disabled={submitting}
              className="palette-scroll grid grid-cols-6 gap-1.5"
            />
            <PickerExpandButton
              onClick={() => setPalettesExpanded(true)}
              disabled={submitting}
            />
            <PickerExpandModal
              open={palettesExpanded}
              title={t.design.allColorTemplates}
              onClose={() => setPalettesExpanded(false)}
            >
              <PalettePresetGrid
                activeId={
                  PALETTE_PRESETS.find((p) => samePalette(colors, p.colors))?.id ??
                  null
                }
                onPick={(p) => {
                  setColors([...p.colors]);
                  setPalettesExpanded(false);
                }}
                labels
                className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6"
              />
            </PickerExpandModal>
            </div>

            {/* Single brand font — one Google family (Claude varies
                weights) OR up to 5 uploaded families (Claude pairs). */}
            <div className="border-t border-[var(--tq-border-hairline)] pt-3">
              <BrandFontPicker
                compact
                value={brandFont}
                onChange={setBrandFont}
                sampleText={
                  language === "en" ? HEADING_SAMPLE_LATIN : HEADING_SAMPLE_AR
                }
              />
            </div>

            {/* Logo — compact fixed-height zone (the Design card shares its
                size with the other two steps). Free plan: crowned lock. */}
            <div className="flex flex-col gap-2 border-t border-[var(--tq-border-hairline)] pt-3">
              <span className="block text-xs font-semibold text-foreground/70">
                {t.logo}
              </span>
              <LogoRow
                compact
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

            {/* Save brand kit — present on BOTH branding cards
                (fonts+colors AND logo), backed by the same state,
                so the user can flip the toggle from either card. */}
            <div className="flex items-center justify-between gap-2 border-t border-[var(--tq-border-hairline)] pt-2">
              <span className="text-xs font-semibold text-foreground/70">
                {t.saveAsDefault}
              </span>
              <Toggle
                ariaLabel={t.saveAsDefault}
                value={saveBrandKit}
                onChange={setSaveBrandKit}
              />
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════
              EXPORT SETTINGS CARD (step 3)
              ═══════════════════════════════════════════════════════ */}
          <div
            className={`surface-card ${step === 2 ? "" : "invisible"} col-start-1 row-start-1 flex w-full sm:w-[430px] flex-col desk:visible desk:col-start-auto desk:row-start-auto desk:flex desk:w-full desk:min-w-0 gap-4 rounded-2xl p-4`}
          >
            <CardHeader icon="settings" title={t.outputCard} />

            {/* Each section wrapped in space-y-1.5 (label-to-content
                gap consistent with the branding card). Sections
                separated by `border-t pt-3` for visible breathing
                room between distinct knob groups. */}
            {/* stacked (full-width rows, not columns): refills the vertical
                space the AI-images panel freed when it moved to the content
                card (2026-08-03). 3:4 منشور removed 2026-08-03: the /social
                flow owns post formats now. */}
            <SlideSizeFields
              slideSize={slideSize}
              onSlideSize={setSlideSize}
              stacked
            />

            <div className="border-t border-[var(--tq-border-hairline)] pt-3">
              <div className="flex min-h-[24px] items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground/70">
                  {t.slideCount}
                </span>
                {/* `layout` on the controls container so the
                    SegmentedToggle slides smoothly when the stepper
                    mounts/unmounts (toggle's anchor inside the group
                    shifts as the stepper's width animates in/out).
                    AnimatePresence wraps the stepper to give it a
                    width-+-opacity grow/shrink animation matching
                    the existing toggle spring (stiffness 500,
                    damping 35) so the whole row reads as one smooth
                    transition rather than a pop-in. */}
                <motion.div
                  // `layout` on the parent FLIPs the SegmentedToggle's
                  // position when the stepper appears/disappears so
                  // the toggle slides smoothly over to make room.
                  // Inner motion.div does NOT use `layout` (would
                  // conflict with the parent's layout pass and cause
                  // a snap at the end of the animation). It only
                  // animates its own width + opacity instead.
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
                        // Fixed width (66 px = stepper natural size:
                        // 20 + 24 + 20 + 2 px border) avoids the
                        // framer-motion `auto`-to-numeric jump that
                        // shows up as a 1-frame snap at the end of
                        // the spring. Also bake in `-mr-1.5` on exit
                        // to absorb the parent's gap-1.5 between the
                        // toggle and the stepper as the stepper
                        // collapses — otherwise the gap stays put
                        // until unmount and pops the toggle 6 px at
                        // the very end.
                        initial={{ width: 0, opacity: 0, marginInlineStart: -6 }}
                        animate={{ width: 66, opacity: 1, marginInlineStart: 0 }}
                        exit={{ width: 0, opacity: 0, marginInlineStart: -6 }}
                        transition={{
                          type: "spring",
                          stiffness: 500,
                          damping: 35,
                        }}
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
              {/* Free plan: the slide cap stated up front, not a silent clamp. */}
              <SlideCapHint className="mt-1.5" />
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-[var(--tq-border-hairline)] pt-3">
              <span className="text-xs font-semibold text-foreground/70">
                {t.slideNumbering}
              </span>
              <Toggle
                ariaLabel={t.slideNumbering}
                value={pagination}
                onChange={setPagination}
              />
            </div>

            {/* Generate-images toggle - in the settings card (owner direction
                2026-10-04; was in the content card since 2026-08-03). Plus+
                gated inside the panel itself; free users get the crown +
                UpgradeModal. */}
            <div className="border-t border-[var(--tq-border-hairline)] pt-3">
              <AIImagesPanel
                value={imagesMode}
                onChange={setImagesMode}
                disabled={submitting}
              />
            </div>

          </div>

          </div>

          {/* Wizard nav - Next only (`.btn-gradient` CTA via PillButton
              primary, the /brand PATTERN 2 button). Going BACK happens by
              clicking a completed step in the rail (user direction
              2026-08-30 - no dedicated back button). The last step swaps
              Next for the GenerateSplitButton below. Width matches the
              card so the button hugs its end edge; logical flex only, so
              RTL mirrors free. */}
          {step < 2 && (
            <div className="flex w-full justify-end sm:w-[430px] desk:hidden">
              <PillButton
                variant="primary"
                onClick={() => setStep((s) => Math.min(2, s + 1))}
                disabled={submitting || (step === 0 && !(hasText || hasFile))}
              >
                {t.wizard.next}
              </PillButton>
            </div>
          )}

          {/* Extraction status - the file poll keeps running while the
              user moves past step 1; without this chip the disabled
              Generate on the last step would reflect a state the user
              can no longer see. */}
          {fileExtracting && step > 0 && (
            <p className="flex items-center gap-2 text-xs desk:hidden text-[var(--tq-text-muted)]">
              <span className="spinner h-3.5 w-3.5 rounded-full border-2 border-foreground/30 border-t-foreground" />
              {t.wizard.extracting}
            </p>
          )}
        </div>

        {/* Always shown on desktop (all cards visible); last step only below xl. */}
        <div className={`${step === 2 ? "flex" : "hidden desk:flex"} justify-center`}>
          <GenerateSplitButton
            onGenerate={handleGenerate}
            quality={quality}
            onQualityChange={setQuality}
            slideCount={estimatedSlideCount.slides}
            slideCountUpTo={estimatedSlideCount.upTo}
            imagesMode={imagesMode}
            disabled={generateDisabled}
            loading={generateLoading}
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
