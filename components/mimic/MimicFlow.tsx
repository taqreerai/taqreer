"use client";

// Phase 17.C - "Your own template" (internal name: mimic), a 3-step wizard.
//
//   1. CONTENT + REFERENCE card: the content (textarea XOR file) and the
//      design-reference file, each in its OWN framed panel with a title,
//      a one-line hint and its own icon, so the two uploads read as two
//      separate inputs ("one is for my content, the other for the look").
//   2. BRAND card: a 1:1 replica of /create's brand card (saved-kit
//      dropdown, palette, BrandFontPicker, logo, save-as-default).
//   3. SETTINGS card: slide size + slide count, the AI-images toggle and
//      the optional design instructions, then Generate.
//
// All cards share one grid cell at a fixed width (CARD_W_CLASS), so each
// takes the tallest card's height; one flex-1 element per card absorbs the
// spare height (content textarea / logo zone / instructions textarea).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import {
  CreditGateDialog,
  isCreditGatePayload,
  type CreditGatePayload,
} from "@/components/credits/CreditGateDialog";
import { useSlideCap } from "@/lib/credits/store";
import { displaySlideEstimate } from "@/lib/credits/cost";
import { localizedExtractError } from "@/lib/extract/error-codes";
import { GenerateSplitButton } from "@/components/create/GenerateSplitButton";
import { Tooltip } from "@/components/common/Tooltip";
import { AIImagesPanel } from "@/components/brand/AIImagesPanel";
import { BrandStep, WizardBar, WizardHead, scrollWizardTop } from "@/components/create/wizard";
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
  type MimicGuestSettings,
} from "@/lib/create/guest-draft";
import { type BrandKitOption } from "@/components/brand/BrandKitDropdown";
import {
  InlineStepper,
  SlideSizeFields,
  type SlideSize,
  type SlideCountMode,
} from "@/components/create/OutputCards";
import {
  SegmentedToggle,
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
import {
  clampChars,
  MAX_CONTENT_TEXT_CHARS,
  MAX_ENHANCE_INSTRUCTIONS_CHARS,
} from "@/lib/types/brief-limits";
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
import { LockedFlowBanner } from "@/components/billing/LockedFlowBanner";

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
  // Signed-out visitor on /mimic (2026-10-06): both files stay in the
  // browser; analysis, brand kits and generation wait for sign-in (the
  // draft carries the setup through it). Template mode needs an account.
  const guest = useIsGuest() && !isTemplate;
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
  // Shake controls for the content card — fired once when an uploaded
  // content deck is rejected for exceeding the tier page cap.
  const contentCardShake = useAnimationControls();

  // ─── Brand pickers — always shown. The "mimic branding" toggle was
  //     removed (2026-05-29): the branding card is now permanent, so
  //     the user always supplies their palette + fonts (pre-filled
  //     from the chosen template / default brand kit when available).
  const [colors, setColors] = useState<string[]>(DEFAULT_PALETTE);
  // Where the deck's colours come from (2026-10-03). "reference" (default)
  // keeps the uploaded design's OWN colours: the brief then carries no brand
  // colours and deck-generate has Claude read the palette off the reference
  // (REFERENCE_PALETTE_ADDENDUM). "custom" uses the swatches below. Picking
  // a saved brand kit switches to "custom".
  const [colorSource, setColorSource] = useState<"reference" | "custom">(
    "reference",
  );
  // Single brand font — one Google family (Claude varies weights) OR up
  // to 5 uploaded families (Claude pairs). Replaces the old heading +
  // body two-slot UI; mirrors /create's BrandFontPicker model.
  const [brandFont, setBrandFont] = useState<BrandFontState>(emptyBrandFont());
  // Saved brand kits for the in-card dropdown (last 5). `options` drives
  // the menu; `raw` maps the picked id → HydratedBrand on select.
  const [kitOptions, setKitOptions] = useState<BrandKitOption[]>([]);
  const kitRawRef = useRef<Map<string, unknown>>(new Map());
  const [saveBrandKit, setSaveBrandKit] = useState<boolean>(false);
  // GPT images — OFF by default since the Plus+ gate (2026-08,
  // lib/images/images-gating.ts). When ON, Claude recreates the reference
  // deck's imagery and fills empty placeholders with slide-relevant images
  // (deck-generate MIMIC_IMG_ADDENDUM).
  const [imagesMode, setImagesMode] = useState<boolean>(false);

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
    if (!raw) return;
    const hydrated = mapKitToHydrated(
      raw as Parameters<typeof mapKitToHydrated>[0],
    );
    applyBrand(hydrated);
    if (hydrated.colors.length > 0) setColorSource("custom");
  };

  // ─── Submit-level state ────────────────────────────────────────
  // Wizard step: 0 Content + design reference, 1 Brand, 2 Slide size +
  // count, AI images, instructions + Generate. Cards stay MOUNTED (single-cell
  // grid, `invisible` when inactive) so heights stay constant and both
  // extraction pipelines keep their live DOM across steps. Template mode
  // (/use-template) walks the same steps with the reference preset.
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // 402 credit-gate payload from POST /api/projects (billing Phase A).
  const [creditGate, setCreditGate] = useState<CreditGatePayload | null>(null);
  const [quality, setQuality] = useDefaultQuality();
  // Optional free-text design instructions forwarded to the model
  // (payload.enhance.instructions — the route clamps + whitelists).
  const [instructions, setInstructions] = useState("");

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
    setDesignStage(guest ? "ready" : "extracting");
    setError("");
  };
  const setContentFromInput = (next?: File | null) => {
    const valid = validateFile(next);
    if (!valid) return;
    setContentFile(valid);
    setContentExtracted(null);
    setContentText("");
    setContentStage(guest ? "ready" : "extracting");
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
    // Visitors: no upload before sign-in.
    if (!designFile || guest) return;
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
            ? localizedExtractError(dict.flows.extractErrors, err.message)
            : dict.flows.mimic.extractRefFailed,
        );
        setDesignStage("idle");
      }
    })();
    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [designFile, dict, guest]);

  // ─── Auto-extract: content file (only when a file is picked) ───
  // Stage("extracting") + error reset moved to setContentFromInput
  // (lint + stale-stage parity with the design effect above).
  useEffect(() => {
    if (!contentFile || guest) return;
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
            ? localizedExtractError(dict.flows.extractErrors, err.message)
            : dict.flows.mimic.extractContentFailed,
        );
        setContentStage("idle");
      }
    })();
    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [contentFile, dict, guest]);

  // ─── Derived page-level stage ──────────────────────────────────
  // A visitor's files are only kept in the browser (analysed after sign-in).
  const designReady = designStage === "ready" && (guest ? !!designFile : !!designExtracted);
  // An uploaded content deck with more pages than the tier cap is
  // REJECTED (not accepted): it would be silently clipped at generation,
  // so we block it here, shake the card, and surface the reason as a
  // tooltip on the chip. Only the CONTENT drives slide count; the design
  // reference's page count is irrelevant.
  const contentOverCap =
    contentStage === "ready" &&
    !!contentExtracted &&
    (contentExtracted.pageCount ?? 0) > slideCap;
  const overCapMessage = dict.flows.overCapWarning
    .replace("{pages}", String(contentExtracted?.pageCount ?? 0))
    .replace("{cap}", String(slideCap));
  const contentFileReady =
    contentStage === "ready" &&
    (guest ? !!contentFile : !!contentExtracted && !contentOverCap);
  const contentTextReady = contentText.trim().length > 0;
  const contentReady = contentFileReady || contentTextReady;
  // Shake the content card the moment an uploaded deck is rejected for
  // exceeding the page cap, so the "not accepted" outcome is unmistakable
  // (the chip tooltip carries the reason; Generate stays blocked).
  useEffect(() => {
    if (!contentOverCap) return;
    contentCardShake.start({
      x: [0, -9, 9, -7, 7, -4, 4, 0],
      transition: { duration: 0.45, ease: "easeInOut" },
    });
  }, [contentOverCap, contentCardShake]);
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

  // ─── Guest draft (2026-10-06) ──────────────────────────────────
  // Same model as /create and /enhance: saved as the visitor goes; back
  // signed in with ?resume=<mode> it is restored once, both files are
  // analysed, and "generate" presses Create by itself when they are ready.
  const guestFont = fontToDraft(brandFont);
  const guestSettings: MimicGuestSettings = {
    step,
    contentText,
    colorSource,
    colors,
    fontMode: guestFont.fontMode,
    googleFamily: guestFont.googleFamily,
    uploadedFonts: guestFont.uploadedFonts,
    slideSize,
    slideCountMode,
    slideCountValue,
    imagesMode,
    instructions,
  };
  const guestSettingsJson = JSON.stringify(guestSettings);
  useEffect(() => {
    if (!guest) return;
    const id = window.setTimeout(
      () => saveGuestSettings("mimic", JSON.parse(guestSettingsJson)),
      300,
    );
    return () => window.clearTimeout(id);
  }, [guest, guestSettingsJson]);
  useEffect(() => {
    if (!guest) return;
    void saveGuestFiles("mimic", {
      content: contentFile,
      design: designFile,
      logo: logoFile,
      fonts: fontToDraft(brandFont).fontFiles,
    });
  }, [guest, contentFile, designFile, logoFile, brandFont]);
  // The top bar's "Log in" asks for an immediate save before leaving.
  useEffect(() => {
    if (!guest) return;
    const flush = () => saveGuestSettings("mimic", JSON.parse(guestSettingsJson));
    window.addEventListener(GUEST_SAVE_EVENT, flush);
    return () => window.removeEventListener(GUEST_SAVE_EVENT, flush);
  }, [guest, guestSettingsJson]);

  const [guestSignupOpen, setGuestSignupOpen] = useState(false);
  const openGuestSignup = async () => {
    saveGuestSettings("mimic", guestSettings);
    await saveGuestFiles("mimic", {
      content: contentFile,
      design: designFile,
      logo: logoFile,
      fonts: guestFont.fontFiles,
    });
    posthog.capture("create_guest_signup_prompt", { flow: "mimic", step, hasFile: !!contentFile });
    setGuestSignupOpen(true);
  };

  const [autoStart, setAutoStart] = useState(false);
  useEffect(() => {
    if (guest || isTemplate) return;
    const mode = readResumeMode();
    if (!mode) return;
    let aborted = false;
    (async () => {
      const draft = await loadGuestDraft<MimicGuestSettings>("mimic");
      // Drop ?resume so a reload never replays it.
      const url = new URL(window.location.href);
      url.searchParams.delete("resume");
      window.history.replaceState(null, "", url.toString());
      if (aborted || !draft) return;
      const d = draft.settings;
      setContentText(d.contentText ?? "");
      setColorSource(d.colorSource === "custom" ? "custom" : "reference");
      if (Array.isArray(d.colors) && d.colors.length > 0) setColors(d.colors.slice(0, MAX_PALETTE));
      const font = fontFromDraft(d, draft.files);
      if (font) setBrandFont(font);
      if (draft.files.logo) {
        setLogoFile(draft.files.logo);
        setLoadedLogo(null);
      }
      if (d.slideSize === "16:9" || d.slideSize === "9:16") setSlideSize(d.slideSize);
      if (d.slideCountMode === "auto" || d.slideCountMode === "custom") {
        setSlideCountMode(d.slideCountMode);
      }
      if (typeof d.slideCountValue === "number") setSlideCountValue(d.slideCountValue);
      setImagesMode(!!d.imagesMode);
      setInstructions(d.instructions ?? "");
      // Starts both uploads + analyses, now signed in.
      if (draft.files.content) setContentFromInput(draft.files.content);
      if (draft.files.design) setDesignFromInput(draft.files.design);
      setStep(mode === "generate" ? 3 : Math.min(3, Math.max(0, d.step)));
      void clearGuestDraft("mimic");
      posthog.capture("create_guest_resumed", { flow: "mimic", mode, hasFile: !!draft.files.content });
      if (mode === "generate" && draft.files.design) setAutoStart(true);
    })();
    return () => {
      aborted = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on mount; the file setters are stable for this purpose
  }, [guest, isTemplate]);

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
        // Template colours: no brand colours, the generator reads them off
        // the design reference.
        colors: colorSource === "reference" ? [] : colors,
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
      // Clamp to the same cap the typed textarea enforces: this is
      // MACHINE-extracted text (PDF text layer), so silent truncation is
      // acceptable and beats /api/projects rejecting the oversized brief
      // after the user has configured everything (413 backstop there).
      const contentFileText = clampChars(
        contentExtracted?.fullText?.trim() ?? "",
        MAX_CONTENT_TEXT_CHARS,
      );
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
          // Optional user design instructions. Omitted when empty so an
          // instruction-less run's payload stays byte-for-byte unchanged.
          ...(instructions.trim()
            ? { enhance: { instructions: instructions.trim() } }
            : {}),
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

  // ─── Wizard chrome (2026-10-06: the shared /create wizard) ─────
  // Four steps: your content, the design reference (template mode: the
  // chosen template, locked), the brand, then size / count / AI photos /
  // instructions and Create.
  const MIMIC_LAST_STEP = 3;
  const stepTitles = [
    dict.flows.mimic.contentTitle,
    dict.flows.mimic.referenceTitle,
    dict.flows.brandCard,
    dict.flows.mimic.stepSettings,
  ];
  const stepHints = [
    dict.flows.wizard.hints.mimicContent,
    isTemplate ? dict.flows.wizard.hints.mimicTemplate : dict.flows.wizard.hints.mimicReference,
    dict.flows.wizard.hints.brand,
    dict.flows.wizard.hints.output,
  ];
  // Content gates step 2, a picked reference gates the rest (it may still
  // be extracting; Create waits for it).
  const hasReference = isTemplate || designStage !== "idle";
  const reachable = !contentReady ? 0 : hasReference ? MIMIC_LAST_STEP : 1;
  const goToStep = (next: number) => {
    setStep(Math.max(0, Math.min(MIMIC_LAST_STEP, next)));
    scrollWizardTop();
  };

  return (
    <div className="page-container flex w-full justify-center" dir={dir}>
      <GuestSignupDialog
        flow="mimic"
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
      <input
        ref={contentInputRef}
        type="file"
        accept=".pdf,.pptx,.ppt,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint"
        className="hidden"
        onChange={(event) => setContentFromInput(event.target.files?.[0])}
      />
      <input
        ref={designInputRef}
        type="file"
        accept=".pdf,.pptx,.ppt,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint"
        className="hidden"
        onChange={(event) => setDesignFromInput(event.target.files?.[0])}
      />
      <div className="mt-[4vh] flex w-full flex-col items-center gap-5 px-4 desk:px-8">
        {/* Upfront plan notice when this flow isn't in the user's plan. */}
        <LockedFlowBanner flow="mimic" />
        <WizardHead
          title={isTemplate ? dict.flows.mimic.titleTemplate : dict.flows.mimic.title}
          subtitle={isTemplate ? dict.flows.mimic.subtitleTemplate : dict.flows.mimic.subtitle}
          steps={stepTitles}
          hints={stepHints}
          step={step}
          onStep={goToStep}
          reachable={reachable}
        />

        {/* ═══════════════════════════════════════════════════════
            STEP 1 · YOUR CONTENT - text XOR a file. Shakes when an
            over-cap file is rejected.
            ═══════════════════════════════════════════════════════ */}
        <motion.section
          animate={contentCardShake}
          className={`${step === 0 ? "flex" : "hidden"} surface-card w-full max-w-3xl flex-col gap-3 rounded-2xl p-4 sm:p-6`}
        >
              <textarea
                value={contentText}
                onChange={(event) => {
                  const next = event.target.value;
                  setContentText(next);
                  if (next.length > 0 && contentFile) removeContentFile();
                }}
                placeholder={dict.flows.contentPlaceholder}
                rows={8}
                dir={detectStringLanguage(contentText) === "en" ? "ltr" : "rtl"}
                // Mirrors the server's content.text 400 cap in
                // /api/projects (brief-limits.ts).
                maxLength={MAX_CONTENT_TEXT_CHARS}
                disabled={submitting || !!contentFile}
                className="input-dark min-h-[220px] resize-y leading-6 disabled:cursor-not-allowed disabled:opacity-50"
              />
              {/* Dimmed + `inert` (not unmounted) while the textarea is in
                  use, so the card height stays constant and the dropzone
                  leaves the tab order. Gated on the same trimmed predicate
                  generation uses (contentTextReady). */}
              <div
                className={`flex flex-col gap-2 transition-opacity duration-200 ${
                  contentTextReady ? "opacity-40" : ""
                }`}
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
                  rejected={contentOverCap}
                  rejectedReason={overCapMessage}
                  emptyIcon="article"
                  emptyTitle={dict.flows.mimic.contentDrop}
                  horizontal
                />
              </div>
        </motion.section>

        {/* ═══════════════════════════════════════════════════════
            STEP 2 · DESIGN REFERENCE - the deck whose look we copy.
            ═══════════════════════════════════════════════════════ */}
        <section
          className={`${step === 1 ? "flex" : "hidden"} surface-card w-full max-w-3xl flex-col gap-3 rounded-2xl p-4 sm:p-6`}
        >
          {isTemplate ? (
            // Template mode: the reference is the chosen template (locked,
            // no upload).
            <div className="flex min-h-[120px] w-full items-center gap-4 rounded-xl border border-dashed border-foreground/20 bg-overlay-soft p-5 text-start">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--tq-surface)]">
                <span className="material-symbols-outlined text-emerald-300" style={{ fontSize: 22 }}>
                  check_circle
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold text-foreground">
                  {templateSeed!.title?.trim() || dict.flows.mimic.templateReady}
                </p>
                <p className="mt-0.5 truncate text-sm text-foreground/60">
                  {dict.flows.mimic.templateSelected}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex h-[280px] flex-col">
              <FileDropzone
                file={designFile}
                stage={designStage}
                submitting={submitting}
                dragging={designDragging}
                setDragging={setDesignDragging}
                onOpen={() => designInputRef.current?.click()}
                onDrop={(f) => setDesignFromInput(f)}
                onRemove={removeDesignFile}
                emptyIcon="auto_awesome"
                emptyTitle={dict.flows.mimic.referenceDrop}
              />
            </div>
          )}
          <p className="text-xs leading-5 text-foreground/55">{dict.flows.mimic.referenceHint}</p>
        </section>

        {/* STEP 3 · BRAND (shared). "Auto" here = the reference deck's own
            colours (colorSource "reference"); any pick switches to custom. */}
        <BrandStep
          visible={step === 2}
          kitOptions={kitOptions}
          onPickKit={handlePickKit}
          colors={colorSource === "custom" ? colors : []}
          minPalette={MIN_PALETTE}
          maxPalette={MAX_PALETTE}
          onAutoColors={() => setColorSource("reference")}
          onUpdateColor={updateColor}
          onRemoveColor={removeColor}
          onAddColor={() => {
            if (colorSource === "reference") setColorSource("custom");
            else addColor();
          }}
          onPickPreset={(next) => {
            setColors(next);
            setColorSource("custom");
          }}
          brandFont={brandFont}
          onBrandFont={setBrandFont}
          sampleText={contentExtracted?.language === "en" ? HEADING_SAMPLE_LATIN : HEADING_SAMPLE_AR}
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
          autoLabel={dict.flows.mimic.colorsReference}
          autoHint={dict.flows.mimic.colorsReferenceHint}
        />

        {/* ═══════════════════════════════════════════════════════
            STEP 4 · SETTINGS - size, count, AI photos, instructions.
            ═══════════════════════════════════════════════════════ */}
        <section
          className={`${step === 3 ? "flex" : "hidden"} surface-card w-full max-w-2xl flex-col gap-4 rounded-2xl p-4 sm:p-6`}
        >
          <SlideSizeFields slideSize={slideSize} onSlideSize={setSlideSize} />
          <div className="border-t border-[var(--tq-border-hairline)] pt-4">
            <div className="flex min-h-[24px] items-center justify-between gap-2">
              <span className="text-sm font-semibold text-foreground/80">
                {dict.flows.slideCount}
              </span>
              {/* Same animated layout as /create (the fixed 66 px width
                  avoids the framer-motion auto-to-numeric snap). */}
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
          <div className="border-t border-[var(--tq-border-hairline)] pt-4">
            <AIImagesPanel value={imagesMode} onChange={setImagesMode} disabled={submitting} />
          </div>
          {/* Optional free-text design instructions forwarded to the model
              (payload.enhance.instructions). */}
          <div className="border-t border-[var(--tq-border-hairline)] pt-4">
            <label
              htmlFor="mimic-instructions"
              className="mb-2 block text-sm font-semibold text-foreground/80"
            >
              {dict.flows.instructionsLabel}
            </label>
            <textarea
              id="mimic-instructions"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder={dict.flows.instructionsPlaceholder}
              maxLength={MAX_ENHANCE_INSTRUCTIONS_CHARS}
              rows={3}
              disabled={submitting}
              className="input-dark w-full resize-none text-sm leading-6 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
        </section>

        <WizardBar
          step={step}
          lastStep={MIMIC_LAST_STEP}
          onStep={goToStep}
          nextDisabled={step === 0 ? !contentReady : step === 1 ? !hasReference : false}
          busy={submitting}
          // An upload may still be analysing after its step; this explains
          // a disabled Create.
          status={extracting ? dict.flows.wizard.extracting : null}
          generate={
            <GenerateSplitButton
              guest={guest}
              autoStart={autoStart}
              onGenerate={guest ? () => void openGuestSignup() : handleGenerate}
              quality={quality}
              onQualityChange={setQuality}
              slideCount={estimatedSlideCount.slides}
              slideCountUpTo={estimatedSlideCount.upTo}
              imagesMode={imagesMode}
              disabled={generateDisabled}
              loading={generateLoading}
              label={generateLabel}
              loadingLabel={generateLoadingLabel}
            />
          }
        />

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
// id of the portalled tooltip that carries a rejected file's reason, wired
// to the dropzone button's aria-describedby so assistive tech associates them.
const REJECT_REASON_ID = "tq-content-reject-reason";

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
  // Rejected: the extracted file was refused (e.g. more pages than the
  // tier cap). The chip flips to a warn/error look and, when a reason is
  // given, wraps in a Tooltip so hovering surfaces WHY — kept out of the
  // card so it never reflows the layout.
  rejected = false,
  rejectedReason,
  // Empty-state glyph + title. /mimic's step 1 shows two dropzones on one
  // card, so each names its own file (content vs design reference) and
  // carries a distinct icon instead of the shared cloud_upload.
  emptyIcon = "cloud_upload",
  emptyTitle,
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
  rejected?: boolean;
  rejectedReason?: string;
  emptyIcon?: string;
  emptyTitle?: string;
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
  const chip = (
    <div className="relative w-full flex-1">
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
        aria-describedby={rejected ? REJECT_REASON_ID : undefined}
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
          ) : stage === "ready" && rejected ? (
            <span
              className="material-symbols-outlined text-[var(--tq-status-warn-text)]"
              style={{ fontSize: horizontal ? "18px" : "22px" }}
            >
              error
            </span>
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
              {emptyIcon}
            </span>
          )}
        </span>

        {/* Text block — wrapped in a single flex child so horizontal
            mode reads as one row (icon | text) instead of three
            stacked siblings. In horizontal we drop the "حتى 100
            ميجابايت" tagline (still shown in stacked modes since
            they have the vertical real estate). */}
        {file ? (
          <div className={`min-w-0 ${horizontal ? "flex-1 pe-8" : "w-full px-2"}`}>
            <p className="truncate text-sm font-semibold text-foreground">
              {readableFileName(file.name)}
            </p>
            <p className="mt-0.5 truncate text-xs text-foreground/60">
              {formatFileSize(file.size, dict.flows.unitKB, dict.flows.unitMB)}
              {stage === "extracting"
                ? ` · ${dict.flows.analyzing}`
                : stage === "ready"
                  ? rejected
                    ? ""
                    : ` · ${dict.flows.ready}`
                  : submitting
                    ? ` · ${dict.flows.generate.creating}`
                    : ""}
            </p>
          </div>
        ) : (
          <div className={`min-w-0 ${horizontal ? "flex-1" : ""}`}>
            <p className="truncate text-sm font-semibold text-foreground">
              {emptyTitle ??
                (horizontal
                  ? dict.flows.mimic.dragOrClick
                  : dict.flows.mimic.dragDrop)}
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
          className={`absolute z-10 flex h-7 w-7 items-center justify-center rounded-md bg-black/35 text-foreground/60 transition-colors hover:bg-foreground/10 hover:text-foreground ${
            horizontal ? "end-2 top-1/2 -translate-y-1/2" : "top-2 start-2"
          }`}
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
  // Rejected chip: surface the reason as a portalled tooltip that floats
  // above the card (never reflows it). `open` keeps it PERSISTENTLY visible
  // while the file is rejected — not hover-only, so touch users see it too —
  // and role="status" + the id wired to the button's aria-describedby make
  // it available to assistive tech.
  return rejected && rejectedReason ? (
    <Tooltip
      label={rejectedReason}
      placement="top"
      multiline
      open
      id={REJECT_REASON_ID}
      role="status"
      className="block w-full flex-1"
    >
      {chip}
    </Tooltip>
  ) : (
    chip
  );
}

