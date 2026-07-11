"use client";

// Phase 17.C — Single-shot Mimic flow (3-card redesign 2026-05-25).
//
// Layout (RTL — DOM-first appears visual-right):
//   1. CONTENT card (visual right): textarea XOR file dropzone +
//      the slide-size (ratio) picker. The logo moved to the branding
//      card (2026-06-01); the ratio moved here from the branding card
//      so the branding card matches the other flows' height.
//   2. BRANDING card (visual middle): a 1:1 replica of /create's
//      consolidated brand card — saved-kit dropdown in the header,
//      palette swatches (compact ColorPickerPopover), a single
//      BrandFontPicker (one family, Claude varies weights), the logo
//      row (logo + position), and a save-as-default toggle. Always
//      shown — the old "mimic branding" toggle was removed (2026-05-29)
//      so users always supply their own brand (pre-filled from the
//      chosen template / default brand kit when available).
//   3. WHAT TO MIMIC card (visual left): drop-zone for the design
//      reference file. Wrapped in `.canvas-gradient-border` with
//      `data-active="true"` so it carries the animated mesh halo
//      (visual cue: "this is the file whose design we're copying").
//
// Card sizing:
//   • Each card uses a fixed width (CARD_W_CLASS, 360 px) to match
//     /enhance's card width; the row is always 3 × that width.
//   • Row uses `justify-center` to keep the trio centered and
//     `items-stretch` to equalize the three cards to the tallest.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import {
  CreditGateDialog,
  isCreditGatePayload,
  type CreditGatePayload,
} from "@/components/credits/CreditGateDialog";
import { useSlideCap } from "@/lib/credits/store";
import { displaySlideEstimate } from "@/lib/credits/cost";
import { GenerateSplitButton } from "@/components/create/GenerateSplitButton";
import { BrandFontPicker } from "@/components/brand/BrandFontPicker";
import { AIImagesPanel } from "@/components/brand/AIImagesPanel";
import { LogoRow } from "@/components/brand/LogoRow";
import {
  BrandKitDropdown,
  type BrandKitOption,
} from "@/components/brand/BrandKitDropdown";
import { ColorPickerPopover } from "@/components/create/ColorPickerPopover";
import {
  InlineStepper,
  SlideSizeFields,
  type SlideSize,
  type SlideCountMode,
} from "@/components/create/OutputCards";
import {
  CardHeader,
  SegmentedToggle,
  Toggle,
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
import type { SourceMeta } from "@/lib/types/source";
import { detectStringLanguage } from "@/lib/extract/language-text";
import {
  readBrandFromSession,
  fetchDefaultBrandKit,
  mapKitToHydrated,
  CREATE_BRAND_KEY,
  type HydratedBrand,
} from "@/lib/create/hydrate-brand-from-session";
import type { MimicTemplateSeed } from "@/lib/mimic/template-seed";

const POLL_INTERVAL_MS = 2_500;
const POLL_TIMEOUT_MS = 5 * 60 * 1_000;
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const MIN_PALETTE = 2;
const MAX_PALETTE = 6;
// Neutral monochrome defaults — black + white. The Taqreer brand
// colors (#370BF4, #E036B8, #7D2DFF) used to seed this list, but
// auto-inheriting our brand for a fresh deck was confusing: users
// got purple/pink decks "for free" and had to edit colors out before
// even starting. Black + white is the canonical neutral palette;
// the user picks their own brand from there. Mirrors /create's
// DEFAULT_COLORS post-2026-05-25 so the two flows stay consistent.
const DEFAULT_PALETTE = ["#000000", "#FFFFFF"];

// Fixed card width — matches /enhance's per-card width inside its
// max-w-3xl container (768 px - 32 px padding - 16 px gap) / 2 ≈ 360 px.
// Inline arbitrary value so the value is local to this file; if we
// later promote a shared "flow card" primitive we can hoist this.
// Full-width single column on phones; fixed 360px at sm+ so the desktop
// wrapping row is preserved (see the card-row flex-col→flex-row switch below).
const CARD_W_CLASS = "w-full sm:w-[360px]";
// Fixed card height — pinned to /enhance's empty-state card height
// measured live (2026-05-25, after /enhance content page polish):
// 387 px. The static-math estimate from the section breakdown
// (~367 px) under-counted line-heights + the logo block's actual
// rendered height vs the 72-px minHeight floor. Using the measured
// value keeps the two flows visually identical.
//
// items-stretch on the row already equalizes across siblings; min-h
// pins them all to the /enhance baseline so when the branding card
// is hidden the remaining 2 cards keep that exact height.
const CARD_MIN_H_CLASS = "min-h-[440px]";

// Segmented-toggle option values — the labels are resolved at render
// from the dictionary (dict.flows.auto / dict.flows.custom) and mapped
// onto these stable value tokens inside the component.
const SLIDE_COUNT_VALUES = ["auto", "custom"] as const;

type ExtractCompletedResult = {
  anthropicFileId: string;
  fonts: string[];
  colors: string[];
  pageCount: number;
  format: "16:9" | "9:16";
  language: "ar" | "en" | null;
  // The content PDF's extracted text layer (2026-07-11). Present +
  // non-empty for a normal text PDF; absent/empty for a scanned PDF.
  // When present, /mimic sends the content as TEXT (userContent) instead
  // of a vision document block, so Claude reads FACTS not the document's
  // own layout. Empty → fall back to the vision block.
  fullText?: string;
};

type ExtractStatusResponse =
  | { status: "queued" | "processing"; fileName?: string }
  | { status: "failed"; error: string; fileName?: string }
  | {
      status: "completed";
      result: ExtractCompletedResult;
      fileName?: string;
      flowKind?: string;
    };

type FileStage = "idle" | "extracting" | "ready";

function formatFileSize(size: number, unitKB: string, unitMB: string) {
  if (size < 1024 * 1024)
    return `${Math.max(1, Math.round(size / 1024))} ${unitKB}`;
  return `${(size / (1024 * 1024)).toFixed(1)} ${unitMB}`;
}

function readableFileName(raw: string): string {
  if (!/%[0-9A-Fa-f]{2}/.test(raw)) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

type ResolvedFontField = {
  name: string;
  url: string | null;
  storageUrl: string | null;
  family: string;
} | null;

// Trim a brand-kit title to its first few words for the compact
// saved-kit dropdown menu (mirrors /create's helper).
function fewWords(s: string, max = 3): string {
  const parts = s.trim().split(/\s+/).filter(Boolean);
  return parts.length <= max ? s.trim() : `${parts.slice(0, max).join(" ")}…`;
}

export default function MimicFlow({
  mode = "standalone",
  templateSeed = null,
}: {
  // "standalone" = /mimic (upload your own design reference).
  // "template"   = /use-template/[id] (design reference + branding are
  //                preset from a chosen template; header reads
  //                "استخدام كقالب"). Same generation engine either way.
  mode?: "standalone" | "template";
  templateSeed?: MimicTemplateSeed | null;
} = {}) {
  const isTemplate = mode === "template" && !!templateSeed;
  const dict = useDict();
  const { dir } = useLocale();
  // Resolve the segmented-toggle labels from the dictionary, mapped onto
  // the stable value tokens (SLIDE_COUNT_VALUES).
  const slideCountLabels: Record<(typeof SLIDE_COUNT_VALUES)[number], string> =
    { auto: dict.flows.auto, custom: dict.flows.custom };
  const slideCountOptions = SLIDE_COUNT_VALUES.map((value) => ({
    value,
    label: slideCountLabels[value],
  }));
  const router = useRouter();
  const designInputRef = useRef<HTMLInputElement>(null);
  const contentInputRef = useRef<HTMLInputElement>(null);

  // ─── Design ref state (always required) ────────────────────────
  // Template mode presets the design reference from the chosen
  // template: the Anthropic file_id is already minted (by the
  // /use-template page via the use route), so the reference is "ready"
  // on first paint with no upload/extract step.
  const [designFile, setDesignFile] = useState<File | null>(null);
  const [designStage, setDesignStage] = useState<FileStage>(
    isTemplate ? "ready" : "idle",
  );
  const [designExtracted, setDesignExtracted] =
    useState<ExtractCompletedResult | null>(
      isTemplate
        ? {
            anthropicFileId: templateSeed!.designAnthropicFileId,
            fonts: [],
            colors: [],
            pageCount: 0,
            format: templateSeed!.format,
            language: null,
          }
        : null,
    );
  const [designDragging, setDesignDragging] = useState(false);

  // ─── Content state (file OR text — either works) ───────────────
  const [contentFile, setContentFile] = useState<File | null>(null);
  const [contentStage, setContentStage] = useState<FileStage>("idle");
  const [contentExtracted, setContentExtracted] =
    useState<ExtractCompletedResult | null>(null);
  const [contentDragging, setContentDragging] = useState(false);
  const [contentText, setContentText] = useState("");

  // ─── User-picked output settings ───────────────────────────────
  const [slideSize, setSlideSize] = useState<SlideSize>(
    isTemplate ? templateSeed!.format : "16:9",
  );
  // Slide count — defaults to "auto" so Claude picks based on content
  // (8 fallback in the prompt). When "custom" the user enters an explicit
  // number up to their tier cap (slideCap below); we forward that as the
  // brief's slideCount override (same shape /create uses). Matches /create's default.
  const [slideCountMode, setSlideCountMode] = useState<SlideCountMode>("auto");
  const [slideCountValue, setSlideCountValue] = useState<number>(8);
  // Cap the custom slide count at the user's tier ceiling (free = 10). Preflight
  // rejects an over-cap run server-side; this stops the user picking one. The
  // render-phase clamp also covers a mid-session downgrade lowering the cap.
  const slideCap = useSlideCap();
  if (slideCountValue > slideCap) setSlideCountValue(slideCap);

  // ─── Brand pickers — always shown. The "mimic branding" toggle was
  //     removed (2026-05-29): the branding card is now permanent, so
  //     the user always supplies their palette + fonts (pre-filled
  //     from the chosen template / default brand kit when available).
  const [colors, setColors] = useState<string[]>(DEFAULT_PALETTE);
  // Single brand font — one Google family (Claude varies weights) OR up
  // to 5 uploaded families (Claude pairs). Replaces the old heading +
  // body two-slot UI; mirrors /create's BrandFontPicker model.
  const [brandFont, setBrandFont] = useState<BrandFontState>(emptyBrandFont());
  // Saved brand kits for the in-card dropdown (last 5). `options` drives
  // the menu; `raw` maps the picked id → HydratedBrand on select.
  const [kitOptions, setKitOptions] = useState<BrandKitOption[]>([]);
  const kitRawRef = useRef<Map<string, unknown>>(new Map());
  const [saveBrandKit, setSaveBrandKit] = useState<boolean>(false);
  // GPT images (ON by default, opt-out): when ON, Claude recreates the
  // reference deck's imagery and fills empty placeholders with slide-relevant
  // images (deck-generate MIMIC_IMG_ADDENDUM).
  const [imagesMode, setImagesMode] = useState<boolean>(true);

  // ─── Logo (always available — own logo can ride on mimicked brand)
  const [logoFile, setLogoFile] = useState<File | null>(null);
  // Pre-loaded logo from a brand kit (or default kit). See /create's
  // companion state for the rationale — same pattern repeated here
  // so the LogoRow can show the remote SVG without forcing the user
  // to re-upload.
  const [loadedLogo, setLoadedLogo] = useState<HydratedBrand["logo"]>(null);
  // Logo placement corner — mirrors /create's PositionDropdown.
  // Defaults to top-right; restored from a hydrated brand kit's saved
  // position when it's one of our 6 known corners.

  // Apply a resolved brand (sessionStorage, default kit, or a picked
  // saved kit) to the card state. Maps the heading font slot → the
  // single brandFont model (Google family OR one uploaded family);
  // colours + logo + position apply directly. Shared by mount
  // hydration + the in-card brand-kit dropdown. Mirrors /create.
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

  // ─── Brand-kit hydration on first mount ────────────────────────
  // Read taqreer:create:brand sessionStorage (written by the
  // brand-kits "use" flow / template-use seed). If absent, fall back
  // to the user's default brand kit. Either path applies palette +
  // font + logo, then clears the key so a refresh doesn't re-hydrate.
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
    if (raw)
      applyBrand(
        mapKitToHydrated(raw as Parameters<typeof mapKitToHydrated>[0]),
      );
  };

  // ─── Submit-level state ────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // 402 credit-gate payload from POST /api/projects (billing Phase A).
  const [creditGate, setCreditGate] = useState<CreditGatePayload | null>(null);
  const [quality, setQuality] = useState<Quality>(DEFAULT_QUALITY);

  // ─── File validation ───────────────────────────────────────────
  const validateFile = (next?: File | null): File | null => {
    if (!next) return null;
    const lower = next.name.toLowerCase();
    const extOk =
      lower.endsWith(".pdf") ||
      lower.endsWith(".pptx") ||
      lower.endsWith(".ppt");
    if (!extOk) {
      setError(dict.flows.enhance.fileTypeError);
      return null;
    }
    if (next.size > MAX_FILE_SIZE_BYTES) {
      setError(
        dict.flows.enhance.fileTooLarge.replace(
          "{size}",
          `${(next.size / 1024 / 1024).toFixed(1)} ${dict.flows.unitMB}`,
        ),
      );
      return null;
    }
    setError("");
    return next;
  };

  // Stage setters live at the call site (not inside the extraction
  // useEffects) so react-hooks/set-state-in-effect stays clean —
  // setState inside an effect body triggers cascading-render
  // warnings. The effects below now only own the network work.
  const setDesignFromInput = (next?: File | null) => {
    const valid = validateFile(next);
    if (!valid) return;
    setDesignFile(valid);
    setDesignExtracted(null);
    setDesignStage("extracting");
    setError("");
  };
  const setContentFromInput = (next?: File | null) => {
    const valid = validateFile(next);
    if (!valid) return;
    setContentFile(valid);
    setContentExtracted(null);
    setContentText("");
    setContentStage("extracting");
    setError("");
  };

  const removeDesignFile = () => {
    setDesignFile(null);
    setDesignExtracted(null);
    setDesignStage("idle");
    setError("");
    // Clear the input element so re-selecting the SAME file re-fires change.
    if (designInputRef.current) designInputRef.current.value = "";
  };
  const removeContentFile = () => {
    setContentFile(null);
    setContentExtracted(null);
    setContentStage("idle");
    setError("");
    if (contentInputRef.current) contentInputRef.current.value = "";
  };

  // ─── Shared poller ─────────────────────────────────────────────
  const pollExtraction = async (
    jobId: string,
    signal: AbortSignal,
  ): Promise<ExtractCompletedResult> => {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (signal.aborted) throw new Error("Cancelled");
      const res = await fetch(`/api/extract/${jobId}`, { signal });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? `Status ${res.status}`);
      }
      const body = (await res.json()) as ExtractStatusResponse;
      if (body.status === "completed") return body.result;
      if (body.status === "failed") {
        throw new Error(body.error ?? "Extraction failed");
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error("Extraction timed out. Try a smaller file.");
  };

  // ─── Auto-extract: design reference ────────────────────────────
  // Stage("extracting") + error reset moved to setDesignFromInput
  // (lint: react-hooks/set-state-in-effect). The effect body now
  // only owns the POST + poll cycle and the abort-handler branch.
  useEffect(() => {
    if (!designFile) return;
    const controller = new AbortController();
    let isCurrent = true;
    (async () => {
      try {
        const formData = new FormData();
        formData.append("file", designFile);
        formData.append("kind", "mimic");
        formData.append("mimicRole", "design");
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
          throw new Error(data?.error ?? `Upload failed (${startRes.status})`);
        }
        const { jobId } = (await startRes.json()) as { jobId: string };
        if (!jobId) throw new Error("No jobId returned from /api/extract");
        const result = await pollExtraction(jobId, controller.signal);
        if (!isCurrent) return;
        setDesignExtracted(result);
        setDesignStage("ready");
      } catch (err) {
        const isAbort =
          err instanceof DOMException && err.name === "AbortError";
        // Stale-effect guard (CR finding 2026-05-26): when `isCurrent`
        // is false, a NEWER effect is already in flight with its own
        // setDesignStage("extracting") call queued from
        // setDesignFromInput. Resetting to "idle" here would clobber
        // that newer state and desync the Generate button. Only
        // reset to idle for the OWN-effect error path.
        if (!isCurrent) return;
        if (isAbort) {
          setDesignStage("idle");
          return;
        }
        console.error("[mimic] design extraction failed:", err);
        setError(
          err instanceof Error
            ? err.message
            : dict.flows.mimic.extractRefFailed,
        );
        setDesignStage("idle");
      }
    })();
    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [designFile, dict]);

  // ─── Auto-extract: content file (only when a file is picked) ───
  // Stage("extracting") + error reset moved to setContentFromInput
  // (lint + stale-stage parity with the design effect above).
  useEffect(() => {
    if (!contentFile) return;
    const controller = new AbortController();
    let isCurrent = true;
    (async () => {
      try {
        const formData = new FormData();
        formData.append("file", contentFile);
        formData.append("kind", "mimic");
        formData.append("mimicRole", "content");
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
          throw new Error(data?.error ?? `Upload failed (${startRes.status})`);
        }
        const { jobId } = (await startRes.json()) as { jobId: string };
        if (!jobId) throw new Error("No jobId returned from /api/extract");
        const result = await pollExtraction(jobId, controller.signal);
        if (!isCurrent) return;
        setContentExtracted(result);
        setContentStage("ready");
      } catch (err) {
        const isAbort =
          err instanceof DOMException && err.name === "AbortError";
        // Stale-effect guard — see the matching comment on the
        // design effect above. Newer effect's setContentStage(
        // "extracting") would otherwise be clobbered to "idle".
        if (!isCurrent) return;
        if (isAbort) {
          setContentStage("idle");
          return;
        }
        console.error("[mimic] content extraction failed:", err);
        setError(
          err instanceof Error
            ? err.message
            : dict.flows.mimic.extractContentFailed,
        );
        setContentStage("idle");
      }
    })();
    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [contentFile, dict]);

  // ─── Derived page-level stage ──────────────────────────────────
  const designReady = designStage === "ready" && !!designExtracted;
  const contentFileReady = contentStage === "ready" && !!contentExtracted;
  const contentTextReady = contentText.trim().length > 0;
  const contentReady = contentFileReady || contentTextReady;
  // Split-button credit estimate: dynamic by the brief content (auto) or the
  // manual count (custom), via the same estimateSlides the server holds on (it
  // keys off the brief text, NOT the reference design's page count), capped at
  // the tier limit. A content file's text isn't counted client-side -> unknown.
  const estimatedSlideCount = useMemo(
    () =>
      displaySlideEstimate(
        slideCountMode === "custom"
          ? { kind: "fixed", count: slideCountValue }
          : {
              kind: "mimic",
              briefText: contentTextReady ? contentText.trim() : null,
            },
        slideCap,
      ),
    [slideCountMode, slideCountValue, contentTextReady, contentText, slideCap],
  );
  const extracting =
    designStage === "extracting" || contentStage === "extracting";

  type Stage = "idle" | "extracting" | "ready" | "submitting";
  let stage: Stage;
  if (submitting) stage = "submitting";
  else if (designReady && contentReady) stage = "ready";
  else if (extracting) stage = "extracting";
  else stage = "idle";

  // ─── Palette handlers ──────────────────────────────────────────
  const updateColor = (index: number, next: string) =>
    setColors((c) => c.map((v, i) => (i === index ? next : v)));
  const addColor = () =>
    setColors((c) => (c.length >= MAX_PALETTE ? c : [...c, "#FFFFFF"]));
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
    // Template mode has no designFile (the reference is a preset
    // file_id), so the guard checks designExtracted only.
    if (stage !== "ready" || !designExtracted) return;
    if (!contentFileReady && !contentTextReady) return;

    setError("");
    setSubmitting(true);
    try {
      const logoUploaded = await uploadAsset(
        "brand-assets",
        "logos",
        logoFile,
      );

      // Resolve the single brand font → ONE field reused for heading +
      // body (one family, Claude varies weights / pairs uploads). Upload
      // mode now carries every picked family with ALL its weight faces;
      // heading/body default to the first family's name. Mirrors /create.
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

      // Resolve the logo's storageUrl in priority order: fresh
      // upload first, then the hydrated kit's path. Server re-signs
      // either path, so no client trust is assumed.
      const resolvedLogoStorageUrl =
        logoUploaded?.storageUrl ?? loadedLogo?.storageUrl ?? null;

      const brand = {
        colors,
        paletteMode: "manual" as const,
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
              exclude: [] as ("cover" | "closing")[],
            }
          : null,
        slideSize,
        slideCount: {
          mode: slideCountMode,
          value: slideCountMode === "custom" ? slideCountValue : null,
        },
      };

      // Content file: PREFER its extracted TEXT (2026-07-11). When the
      // content PDF has a text layer, send it as `userContent` and drop
      // `uglyAnthropicFileId` — the content then rides the text path (no
      // vision document block), so Claude reads the FACTS and cannot
      // reproduce the source document's own boxes/layout as content, and
      // keeps its ORIGINAL LANGUAGE. Scanned/image-only PDFs extract no
      // text → fall back to the vision-block path (uglyAnthropicFileId).
      const contentFileText = contentExtracted?.fullText?.trim() ?? "";
      const contentFonts = [
        ...designExtracted.fonts,
        ...(contentExtracted?.fonts ?? []),
      ];
      const source: SourceMeta = contentFileReady
        ? contentFileText
          ? {
              kind: "mimic",
              userContent: contentFileText,
              designAnthropicFileId: designExtracted.anthropicFileId,
              fonts: contentFonts,
            }
          : {
              kind: "mimic",
              uglyAnthropicFileId: contentExtracted!.anthropicFileId,
              designAnthropicFileId: designExtracted.anthropicFileId,
              fonts: contentFonts,
            }
        : {
            kind: "mimic",
            userContent: contentText.trim(),
            designAnthropicFileId: designExtracted.anthropicFileId,
            fonts: designExtracted.fonts,
          };

      const content = contentFileReady
        ? { type: "source" as const, fileName: contentFile!.name }
        : { type: "text" as const, text: contentText.trim() };

      // Language detection — parity with /enhance:
      //   • File path: lift the server-side detection result
      //     (detectPptxLanguage / detectPdfLanguage in extract-source).
      //   • Text path: run the same heuristic on the typed string
      //     here on the client. Without this, typing English into the
      //     textarea would default to "ar" and the SlideNavSidebar
      //     would render RTL during generation before flipping LTR
      //     mid-stream when Claude's manifest set the language —
      //     same flicker we fixed for /enhance file uploads.
      //   • Either side: fall back to "ar" when detection is silent
      //     (under-threshold signal or no dominance), matching the
      //     default the rest of the create pipeline applies.
      const detectedFromText = contentTextReady
        ? detectStringLanguage(contentText)
        : null;
      const language: "ar" | "en" = contentFileReady
        ? (contentExtracted?.language ?? "ar")
        : (detectedFromText ?? "ar");

      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          brand,
          rules: null,
          language,
          saveBrandKit,
          slideCount:
            reducedSlideCount ??
            (slideCountMode === "custom" ? slideCountValue : null),
          quality,
          source,
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
      router.push(`/project/${data.projectId}`);
    } catch (err) {
      console.error("[mimic] generate failed:", err);
      setError(
        err instanceof Error ? err.message : dict.flows.startFailed,
      );
      setSubmitting(false);
    }
  };

  const generateDisabled = stage === "idle" || stage === "extracting";
  const generateLoading = stage === "extracting" || stage === "submitting";
  const generateLabel =
    stage === "extracting" ? dict.flows.analyzing : dict.flows.generate.create;
  const generateLoadingLabel =
    stage === "extracting"
      ? dict.flows.analyzing
      : dict.flows.generate.creating;

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
          <h1 className="tq-h1">
            {isTemplate ? dict.flows.mimic.titleTemplate : dict.flows.mimic.title}
          </h1>
          <p className="tq-subhead mt-2">
            {isTemplate
              ? dict.flows.mimic.subtitleTemplate
              : dict.flows.mimic.subtitle}
          </p>
        </header>

        {/* Row: 3 fixed-width cards centered, always all three.
            items-stretch lets the cards share the tallest card's
            height (the branding card, carrying palette + fonts +
            ratio, is the tallest and pulls the row to its height). */}
        {/* flex-wrap so the row collapses gracefully as the viewport
            narrows. Same responsive pattern /create + /enhance use:
            cards wrap into multiple rows when total width exceeds
            container; items-stretch still equalizes per-row heights. */}
        <div className="flex w-full flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-stretch sm:justify-center">
          {/* ═══════════════════════════════════════════════════════
              CONTENT CARD (DOM 1st, visual right)
              ═══════════════════════════════════════════════════════ */}
          <motion.div
            layout
            transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
            className={`surface-card flex ${CARD_W_CLASS} ${CARD_MIN_H_CLASS} flex-col gap-4 rounded-2xl p-4`}
          >
            <input
              ref={contentInputRef}
              type="file"
              accept=".pdf,.pptx,.ppt,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint"
              className="hidden"
              onChange={(event) => setContentFromInput(event.target.files?.[0])}
            />

            <CardHeader icon="subject" title={dict.flows.contentCard} />

            {/* Verbatim promise: the content is used as-is in its own
                language; the design file governs only the look. Sets the
                expectation that mimic never translates or reflows the
                content into the reference's structure (owner direction
                2026-07-11). */}
            <p className="text-muted -mt-1 mb-1 text-[11px] leading-snug">
              {dict.flows.mimicVerbatimNote}
            </p>

            {/* Textarea — primary content input. Disabled while a
                file is picked; the two are mutually exclusive.
                Direction follows the same rule /create uses (default
                RTL since the Arabic-first product expects Arabic by
                default, flip to LTR for English). /create binds this
                to its explicit LanguagePills pick; /mimic has no
                picker, so we drive it from the live `detectString
                Language(contentText)` heuristic — typing Arabic keeps
                it RTL, typing English flips to LTR, empty / weak
                signal falls back to RTL. Same `.input-dark` class as
                /create so the field reads as part of the same family
                across flows. */}
            <textarea
              value={contentText}
              onChange={(event) => {
                const next = event.target.value;
                setContentText(next);
                if (next.length > 0 && contentFile) removeContentFile();
              }}
              placeholder={dict.flows.contentPlaceholder}
              rows={2}
              dir={detectStringLanguage(contentText) === "en" ? "ltr" : "rtl"}
              disabled={submitting || !!contentFile}
              // flex-1 grows the textarea into whatever vertical space
              // is left over once the dropzone area and bottom row
              // claim their natural heights. With CARD_MIN_H = 387 px
              // pinning the card, the leftover (≈100 px in empty
              // state) becomes usable typing area instead of dead
              // whitespace below the textarea.
              className="input-dark min-h-[60px] flex-1 resize-none leading-6 disabled:cursor-not-allowed disabled:opacity-50"
            />

            {/* File dropzone — always rendered. Conditionally dimmed
                (not hidden) when the textarea has content so the
                card height stays constant. Unmounting the dropzone
                shrank the card on text entry, which triggered the
                `layout` motion on the flanking cards and produced a
                sympathetic re-layout animation on every keystroke
                that crossed the empty/non-empty boundary. Dimming +
                pointer-events:none keeps the silhouette stable while
                still communicating "locked" — the textarea is the
                active input now. `aria-hidden` keeps the dropzone
                out of the assistive-tech tab order when locked. */}
            <div
              className={`flex flex-col gap-3 transition-opacity duration-200 ${
                contentTextReady ? "opacity-40" : ""
              }`}
              // `inert` (not just aria-hidden) when the textarea is in use:
              // removes the dropzone's focusable controls from the tab order
              // AND blocks pointer events AND hides it from AT — aria-hidden
              // alone left the inner button keyboard-focusable. Gate on the
              // SAME trimmed predicate generation uses (contentTextReady), so
              // whitespace-only input doesn't lock a dropzone that submit
              // still treats as empty.
              inert={contentTextReady}
            >
              <div className="flex items-center gap-2 text-[11px] text-foreground/40">
                <div className="h-px flex-1 bg-[var(--tq-border-hairline)]" />
                <span>{dict.flows.or}</span>
                <div className="h-px flex-1 bg-[var(--tq-border-hairline)]" />
              </div>
              <FileDropzone
                file={contentFile}
                stage={contentStage}
                submitting={submitting}
                dragging={contentDragging}
                setDragging={setContentDragging}
                onOpen={() => contentInputRef.current?.click()}
                onDrop={(f) => setContentFromInput(f)}
                onRemove={removeContentFile}
                horizontal
              />
            </div>

            {/* Slide size (ratio) — lives in the content card so the
                branding card matches the other flows' height. */}
            <div className="border-t border-[var(--tq-border-hairline)] pt-3">
              <SlideSizeFields
                slideSize={slideSize}
                onSlideSize={setSlideSize}
              />
            </div>
          </motion.div>

          {/* ═══════════════════════════════════════════════════════
              BRANDING CARD (DOM 2nd, visual middle — always shown)
              ═══════════════════════════════════════════════════════ */}
          <motion.div
            layout
            transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
            className={`${CARD_W_CLASS} ${CARD_MIN_H_CLASS}`}
          >
                <div className={`surface-card flex h-full ${CARD_W_CLASS} ${CARD_MIN_H_CLASS} flex-col gap-4 rounded-2xl p-4`}>
                  {/* Inline header (not CardHeader) so the saved-kit pill
                      can overlay the title row. Mirrors /create's branding
                      header: pb-4 balances the card's p-4 top padding so the
                      title sits centred in the strip; z-30 lifts the open
                      menu above the later rows. */}
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
                          <BrandKitDropdown
                            kits={kitOptions}
                            onSelect={handlePickKit}
                          />
                        </motion.div>
                      ) : null}
                    </div>
                  </header>

                  {/* Palette row — label on the visual right,
                      swatches + add tile on the visual left as a
                      single horizontal cluster (matches /create). */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground/70">
                      {dict.flows.colors}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {colors.map((color, index) => (
                        <PaletteSwatch
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

                  {/* Single brand font — one Google family (Claude varies
                      weights) OR up to 5 uploaded families (Claude pairs).
                      Replaces the heading + body two-slot UI; identical to
                      /create's BrandFontPicker. */}
                  <div className="border-t border-[var(--tq-border-hairline)] pt-3">
                    <BrandFontPicker
                      value={brandFont}
                      onChange={setBrandFont}
                      sampleText={
                        contentExtracted?.language === "en"
                          ? HEADING_SAMPLE_LATIN
                          : HEADING_SAMPLE_AR
                      }
                    />
                  </div>

                  {/* Logo — flex-1 so the dropzone grows to fill the card's
                      leftover height (matches /create); gap-4 unifies the
                      title→zone gap with الخطوط. */}
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

                  {/* Save brand kit — the logo section's flex-1 pushes this
                      to the bottom, so no mt-auto (it would eat the slack
                      and stop the logo zone from growing). */}
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
          </motion.div>

          {/* ═══════════════════════════════════════════════════════
              WHAT TO MIMIC CARD (DOM 3rd, visual left)
              Animated gradient halo around the design-reference drop.
              ═══════════════════════════════════════════════════════ */}
          <motion.div
            layout
            transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
            className={`${CARD_W_CLASS} ${CARD_MIN_H_CLASS}`}
          >
            <div
              className="canvas-gradient-border gradient-ring-2xl surface-card flex h-full w-full flex-col gap-4 rounded-2xl p-4"
              data-active="true"
            >
              <input
                ref={designInputRef}
                type="file"
                accept=".pdf,.pptx,.ppt,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint"
                className="hidden"
                onChange={(event) =>
                  setDesignFromInput(event.target.files?.[0])
                }
              />

              <CardHeader icon="auto_awesome" title={dict.flows.mimic.whatToMimic} />

              {/* Slide count — unified with /create's animated layout
                  (2026-05-26, user direction "use the one at create
                  on mimic, same animation and layout"):
                    • Label pinned to the right edge (DOM-first in
                      RTL via justify-between).
                    • Controls cluster on the left: SegmentedToggle
                      + AnimatePresence-wrapped InlineStepper.
                    • `layout` on the controls container FLIPs the
                      SegmentedToggle's position when the stepper
                      mounts/unmounts so the toggle slides smoothly
                      to make room — no pop-in.
                    • Inner motion.div animates width + opacity +
                      marginInlineStart with a spring (stiffness 500,
                      damping 35) matching the SegmentedToggle's
                      indicator spring. */}
              <div className="flex min-h-[24px] items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground/70">
                  {dict.flows.slideCount}
                </span>
                <motion.div
                  layout
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  className="flex items-center gap-1.5"
                >
                  <SegmentedToggle
                    options={slideCountOptions}
                    value={slideCountMode}
                    onChange={setSlideCountMode}
                    ariaLabel={dict.flows.slideCount}
                  />
                  <AnimatePresence initial={false}>
                    {slideCountMode === "custom" ? (
                      <motion.div
                        key="slide-count-stepper"
                        // Fixed width (66 px = stepper natural size:
                        // 20 + 24 + 20 + 2 px border) avoids the
                        // framer-motion `auto`-to-numeric jump that
                        // shows up as a 1-frame snap at the end of
                        // the spring. marginInlineStart absorbs the
                        // parent gap-1.5 on exit so the toggle
                        // doesn't pop 6 px at unmount.
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

              {/* Design-ref dropzone — wrapped in a flex-1 div with
                  border-t separator so the dropzone reads as its own
                  section (matches /create's section-separator
                  rhythm). The dropzone itself is `compact` + h-full
                  so it claims whatever vertical space is left after
                  the header + toggle + slide-count rows. */}
              <div className="flex flex-1 flex-col border-t border-[var(--tq-border-hairline)] pt-3">
                {isTemplate ? (
                  // Template mode — the design reference is the chosen
                  // template (locked, no upload). Reuses the dropzone's
                  // "ready" visual vocabulary, non-interactive.
                  <div className="flex h-full min-h-[140px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-foreground/20 bg-overlay-soft p-4 text-center">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--tq-surface)]">
                      <span
                        className="material-symbols-outlined text-emerald-300"
                        style={{ fontSize: "22px" }}
                      >
                        check_circle
                      </span>
                    </span>
                    <p className="truncate px-2 text-sm font-semibold text-foreground">
                      {templateSeed!.title?.trim() || dict.flows.mimic.templateReady}
                    </p>
                    <p className="text-xs text-foreground/60">
                      {dict.flows.mimic.templateSelected}
                    </p>
                  </div>
                ) : (
                  <FileDropzone
                    file={designFile}
                    stage={designStage}
                    submitting={submitting}
                    dragging={designDragging}
                    setDragging={setDesignDragging}
                    onOpen={() => designInputRef.current?.click()}
                    onDrop={(f) => setDesignFromInput(f)}
                    onRemove={removeDesignFile}
                    compact
                  />
                )}
              </div>
              {/* AI images (opt-in): recreate the reference's imagery. The
                  flex-1 dropzone above shrinks so the card height stays the same. */}
              <div className="border-t border-[var(--tq-border-hairline)] pt-3">
                <AIImagesPanel
                  value={imagesMode}
                  onChange={setImagesMode}
                  disabled={submitting}
                />
              </div>
            </div>
          </motion.div>
        </div>

        <div className="flex justify-center">
          <GenerateSplitButton
            onGenerate={handleGenerate}
            quality={quality}
            onQualityChange={setQuality}
            slideCount={estimatedSlideCount}
            imagesMode={imagesMode}
            disabled={generateDisabled}
            loading={generateLoading}
            label={generateLabel}
            loadingLabel={generateLoadingLabel}
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
// PaletteSwatch — h-7 w-7 fixed-square swatch matching /create's
// InlinePaletteSwatch byte-for-byte. The palette row uses inline-flex
// (not grid) so the swatches sit beside the "الألوان" label as one
// horizontal cluster — same vocabulary across /create + /mimic.
// ───────────────────────────────────────────────────────────────────
function PaletteSwatch({
  value,
  index,
  removable,
  onChange,
  onRemove,
}: {
  value: string;
  index: number;
  removable: boolean;
  onChange: (next: string) => void;
  onRemove: () => void;
}) {
  const dict = useDict();
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
        className="absolute -top-1 -end-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--tq-bg-dim)] text-foreground transition-opacity hover:bg-overlay-strong disabled:cursor-not-allowed disabled:opacity-0"
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

// ───────────────────────────────────────────────────────────────────
// FileDropzone — used twice (content + design ref). Compact mode
// shrinks min-height for the content card (where it sits below an
// OR separator below a textarea).
// ───────────────────────────────────────────────────────────────────
function FileDropzone({
  file,
  stage,
  submitting,
  dragging,
  setDragging,
  onOpen,
  onDrop,
  onRemove,
  compact = false,
  // Horizontal layout: icon on the start side (visual right in RTL),
  // text on the end side (visual left), all in one row. Used by
  // /mimic's content card to shrink the dropzone's vertical
  // footprint from a 72-px stacked tile down to a single 44-px row
  // — same affordances (drop / click / extract states), just
  // re-flowed. Implies `compact`; the prop only changes axis.
  horizontal = false,
}: {
  file: File | null;
  stage: FileStage;
  submitting: boolean;
  dragging: boolean;
  setDragging: (d: boolean) => void;
  onOpen: () => void;
  onDrop: (f?: File | null) => void;
  onRemove: () => void;
  compact?: boolean;
  horizontal?: boolean;
}) {
  const dict = useDict();
  const disabled = stage === "extracting" || submitting;
  // Axis + min-height per mode:
  //   • horizontal — icon + text on one row, short pill height
  //   • compact    — stacked, short tile (used pre-redesign)
  //   • default    — stacked, tall tile (mimic ref + /enhance)
  const axis = horizontal
    ? "flex-row items-center gap-3 p-2.5 text-start"
    : "flex-col items-center justify-center gap-2 p-4 text-center";
  // Compact stacked mode also gets h-full now — the design-ref
  // dropzone on the what-to-mimic card sits below a toggle + a
  // slide-count row and needs to claim the rest of the card's
  // vertical space, not just its 72-px floor. h-full makes it
  // grow into whatever the flex-1 wrapper allocates.
  const heightCls = horizontal
    ? "min-h-[44px]"
    : compact
      ? "h-full min-h-[72px]"
      : "h-full min-h-[140px]";
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
        disabled={disabled}
        className={`flex w-full rounded-xl border border-dashed transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${axis} ${
          dragging
            ? "border-foreground/40 bg-foreground/[0.04]"
            : "border-foreground/20 bg-overlay-soft hover:border-foreground/30"
        } ${heightCls}`}
      >
        {/* Icon container — slightly smaller in horizontal mode so
            the row stays close to the 44 px target height. Same
            stage-aware glyph swap as before (extracting spinner /
            ready check / picked file icon / empty cloud_upload). */}
        <span
          className={`flex shrink-0 items-center justify-center rounded-full bg-[var(--tq-surface)] ${
            horizontal ? "h-8 w-8" : "h-10 w-10"
          }`}
        >
          {stage === "extracting" ? (
            <span className="spinner h-5 w-5 rounded-full border-2 border-foreground/20 border-t-foreground" />
          ) : stage === "ready" ? (
            <span
              className="material-symbols-outlined text-emerald-300"
              style={{ fontSize: horizontal ? "18px" : "22px" }}
            >
              check_circle
            </span>
          ) : file ? (
            <span
              className="material-symbols-outlined text-foreground/80"
              style={{ fontSize: horizontal ? "18px" : "22px" }}
            >
              description
            </span>
          ) : (
            <span
              className="material-symbols-outlined text-foreground/80"
              style={{ fontSize: horizontal ? "18px" : "22px" }}
            >
              cloud_upload
            </span>
          )}
        </span>

        {/* Text block — wrapped in a single flex child so horizontal
            mode reads as one row (icon | text) instead of three
            stacked siblings. In horizontal we drop the "حتى 100
            ميجابايت" tagline (still shown in stacked modes since
            they have the vertical real estate). */}
        {file ? (
          <div className={`min-w-0 ${horizontal ? "flex-1" : "w-full px-2"}`}>
            <p className="truncate text-sm font-semibold text-foreground">
              {readableFileName(file.name)}
            </p>
            <p className="mt-0.5 truncate text-xs text-foreground/60">
              {formatFileSize(file.size, dict.flows.unitKB, dict.flows.unitMB)}
              {stage === "extracting"
                ? ` · ${dict.flows.analyzing}`
                : stage === "ready"
                  ? ` · ${dict.flows.ready}`
                  : submitting
                    ? ` · ${dict.flows.generate.creating}`
                    : ""}
            </p>
          </div>
        ) : (
          <div className={`min-w-0 ${horizontal ? "flex-1" : ""}`}>
            <p className="truncate text-sm font-semibold text-foreground">
              {horizontal
                ? dict.flows.mimic.dragOrClick
                : dict.flows.mimic.dragDrop}
            </p>
            {/* Muted second line — compatible-file hint + size cap.
                Shown in BOTH horizontal and stacked empty states now
                that the card has the vertical room (CARD_MIN_H = 387);
                stacked also keeps its longer "أو انقر" caption above
                it for the larger ref-file dropzone. */}
            {horizontal ? (
              <p className="mt-0.5 truncate text-[11px] text-foreground/40">
                {dict.flows.mimic.fileHint}
              </p>
            ) : (
              <>
                <p className="mt-0.5 text-xs text-foreground/60">
                  {dict.flows.mimic.clickToSelect}
                </p>
                <p className="mt-1 text-[10px] text-foreground/40">
                  {dict.flows.mimic.fileHint}
                </p>
              </>
            )}
          </div>
        )}
      </button>

      {file && stage !== "extracting" && !submitting ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          aria-label={dict.flows.removeFile}
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

