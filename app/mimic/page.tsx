"use client";

// Phase 17.C — Single-shot Mimic flow (3-card redesign 2026-05-25).
//
// Layout (RTL — DOM-first appears visual-right):
//   1. CONTENT card (visual right): textarea XOR file dropzone +
//      a horizontal row holding the logo slot (visual right) and the
//      slide-size picker stacked vertically (visual left). The row
//      splits the card's bottom half in two so the card stays close
//      to /enhance's height instead of growing tall.
//   2. BRANDING card (visual middle, CONDITIONAL): palette swatches
//      (compact ColorPickerPopover, same as /create) + heading +
//      body font slots. Hidden by default — animates in when the
//      "mimic branding" toggle in the WHAT-TO-MIMIC card is flipped
//      OFF (user wants their own brand on top of a mimicked design).
//   3. WHAT TO MIMIC card (visual left): drop-zone for the design
//      reference file. Wrapped in `.canvas-gradient-border` with
//      `data-active="true"` so it carries the animated mesh halo
//      (visual cue: "this is the file whose design we're copying").
//      Houses the "mimic branding" toggle in its header — ON by
//      default (also mimic palette + fonts → no branding card);
//      OFF reveals the branding card.
//
// Card sizing + animation:
//   • Each card uses a fixed width (W_CARD_PX, currently 360 px) to
//     match /enhance's card width. That makes the row total either
//     2 × W_CARD (branding hidden, default) or 3 × W_CARD.
//   • Row uses `justify-center` so when the branding card unmounts
//     the row recenters automatically — the flanking cards visually
//     slide inward to the page center.
//   • Each card carries `layout` from framer-motion so the FLIP
//     animation tweens position changes when the row width shifts.
//     Combined with AnimatePresence's mount/unmount on the branding
//     card, both transitions read as a single coordinated motion.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { GenerateSplitButton } from "@/components/create/GenerateSplitButton";
import { CompactUploadZone } from "@/components/brand/CompactUploadZone";
import { FontUploadSlot } from "@/components/brand/FontUploadSlot";
import { GoogleFontSlot } from "@/components/brand/GoogleFontSlot";
import { ColorPickerPopover } from "@/components/create/ColorPickerPopover";
import {
  InlineStepper,
  SlideSizeFields,
  type SlideSize,
  type SlideCountMode,
} from "@/components/create/OutputCards";
import { SegmentedToggle, Toggle } from "@/components/create/controls";
import {
  emptyFontSlot,
  googleFontUrl,
  isLatinOnlyGoogleFont,
  HEADING_SAMPLE_AR,
  HEADING_SAMPLE_LATIN,
  BODY_SAMPLE_AR,
  BODY_SAMPLE_LATIN,
  type FontSlotState,
} from "@/lib/brand/fonts";
import { uploadAsset } from "@/lib/brand/upload";
import { DEFAULT_QUALITY, type Quality } from "@/lib/types/quality";
import type { SourceMeta } from "@/lib/types/source";
import { detectStringLanguage } from "@/lib/extract/language-text";

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
const W_CARD_PX = 360;
const CARD_W_CLASS = "w-[360px]";
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
const CARD_MIN_H_CLASS = "min-h-[387px]";

// Segmented-toggle option lists — declared once so the SegmentedToggle
// stays stable across re-renders (option-array identity is part of
// the visual contract: a new array each render would still work but
// would unnecessarily churn the radio child keys).
const FONT_MODE_OPTIONS = [
  { value: "upload" as const, label: "ملف" },
  { value: "google" as const, label: "Google" },
];
const SLIDE_COUNT_OPTIONS = [
  { value: "auto" as const, label: "تلقائي" },
  { value: "custom" as const, label: "مخصص" },
];

type ExtractCompletedResult = {
  anthropicFileId: string;
  fonts: string[];
  colors: string[];
  pageCount: number;
  format: "16:9" | "9:16";
  language: "ar" | "en" | null;
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

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} ك.ب`;
  return `${(size / (1024 * 1024)).toFixed(1)} م.ب`;
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

function resolveFontSlot(
  slot: FontSlotState,
  uploadedStorageUrl: string | null,
): ResolvedFontField {
  if (slot.mode === "google") {
    if (!slot.googleFamily) return null;
    return {
      name: slot.googleFamily,
      url: googleFontUrl(slot.googleFamily),
      storageUrl: null,
      family: slot.googleFamily,
    };
  }
  if (!slot.uploadFile || !uploadedStorageUrl) return null;
  return {
    name: slot.uploadName ?? slot.uploadFile.name,
    url: null,
    storageUrl: uploadedStorageUrl,
    family: slot.uploadFamily || slot.uploadFile.name.replace(/\.[^.]+$/, ""),
  };
}

export default function MimicContentPage() {
  const router = useRouter();
  const designInputRef = useRef<HTMLInputElement>(null);
  const contentInputRef = useRef<HTMLInputElement>(null);

  // ─── Design ref state (always required) ────────────────────────
  const [designFile, setDesignFile] = useState<File | null>(null);
  const [designStage, setDesignStage] = useState<FileStage>("idle");
  const [designExtracted, setDesignExtracted] =
    useState<ExtractCompletedResult | null>(null);
  const [designDragging, setDesignDragging] = useState(false);

  // ─── Content state (file OR text — either works) ───────────────
  const [contentFile, setContentFile] = useState<File | null>(null);
  const [contentStage, setContentStage] = useState<FileStage>("idle");
  const [contentExtracted, setContentExtracted] =
    useState<ExtractCompletedResult | null>(null);
  const [contentDragging, setContentDragging] = useState(false);
  const [contentText, setContentText] = useState("");

  // ─── User-picked output settings ───────────────────────────────
  const [slideSize, setSlideSize] = useState<SlideSize>("16:9");
  // Slide count — defaults to "auto" so Claude picks based on content
  // (8 fallback in the prompt). When "custom" the user enters an
  // explicit number 1..20; we forward that as the brief's slideCount
  // override (same shape /create uses). Matches /create's default.
  const [slideCountMode, setSlideCountMode] = useState<SlideCountMode>("auto");
  const [slideCountValue, setSlideCountValue] = useState<number>(8);

  // ─── Brand pickers (only consulted when toggle is OFF) ─────────
  const [brandingMimicked, setBrandingMimicked] = useState(true);
  const [colors, setColors] = useState<string[]>(DEFAULT_PALETTE);
  const [headingFontSlot, setHeadingFontSlot] = useState<FontSlotState>(
    emptyFontSlot(),
  );
  const [bodyFontSlot, setBodyFontSlot] = useState<FontSlotState>(
    emptyFontSlot(),
  );

  // ─── Logo (always available — own logo can ride on mimicked brand)
  const [logoFile, setLogoFile] = useState<File | null>(null);

  // ─── Submit-level state ────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
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
      setError("الرجاء رفع ملف PDF أو PowerPoint (.pptx, .ppt).");
      return null;
    }
    if (next.size > MAX_FILE_SIZE_BYTES) {
      setError(
        `الملف يتجاوز الحد الأقصى 100 ميجابايت (${(next.size / 1024 / 1024).toFixed(1)} م.ب).`,
      );
      return null;
    }
    setError("");
    return next;
  };

  const setDesignFromInput = (next?: File | null) => {
    const valid = validateFile(next);
    if (!valid) return;
    setDesignFile(valid);
    setDesignExtracted(null);
  };
  const setContentFromInput = (next?: File | null) => {
    const valid = validateFile(next);
    if (!valid) return;
    setContentFile(valid);
    setContentExtracted(null);
    setContentText("");
  };

  const removeDesignFile = () => {
    setDesignFile(null);
    setDesignExtracted(null);
    setDesignStage("idle");
    setError("");
  };
  const removeContentFile = () => {
    setContentFile(null);
    setContentExtracted(null);
    setContentStage("idle");
    setError("");
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
  useEffect(() => {
    if (!designFile) return;
    setDesignStage("extracting");
    setError("");
    const controller = new AbortController();
    let isCurrent = true;
    (async () => {
      try {
        const formData = new FormData();
        formData.append("file", designFile);
        formData.append("kind", "mimic");
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
        if (!isCurrent || isAbort) {
          setDesignStage("idle");
          return;
        }
        console.error("[mimic] design extraction failed:", err);
        setError(
          err instanceof Error
            ? err.message
            : "تعذر تحليل الملف المرجعي. حاول مرة أخرى.",
        );
        setDesignStage("idle");
      }
    })();
    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [designFile]);

  // ─── Auto-extract: content file (only when a file is picked) ───
  useEffect(() => {
    if (!contentFile) return;
    setContentStage("extracting");
    setError("");
    const controller = new AbortController();
    let isCurrent = true;
    (async () => {
      try {
        const formData = new FormData();
        formData.append("file", contentFile);
        formData.append("kind", "mimic");
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
        if (!isCurrent || isAbort) {
          setContentStage("idle");
          return;
        }
        console.error("[mimic] content extraction failed:", err);
        setError(
          err instanceof Error
            ? err.message
            : "تعذر تحليل ملف المحتوى. حاول مرة أخرى.",
        );
        setContentStage("idle");
      }
    })();
    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [contentFile]);

  // ─── Derived page-level stage ──────────────────────────────────
  const designReady = designStage === "ready" && !!designExtracted;
  const contentFileReady = contentStage === "ready" && !!contentExtracted;
  const contentTextReady = contentText.trim().length > 0;
  const contentReady = contentFileReady || contentTextReady;
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
  const handleGenerate = async () => {
    if (stage !== "ready" || !designExtracted || !designFile) return;
    if (!contentFileReady && !contentTextReady) return;

    setError("");
    setSubmitting(true);
    try {
      const [logoUploaded, headingUploaded, bodyUploaded] = await Promise.all([
        uploadAsset("brand-assets", "logos", logoFile),
        brandingMimicked
          ? null
          : uploadAsset(
              "brand-assets",
              "fonts",
              headingFontSlot.mode === "upload"
                ? headingFontSlot.uploadFile
                : null,
            ),
        brandingMimicked
          ? null
          : uploadAsset(
              "brand-assets",
              "fonts",
              bodyFontSlot.mode === "upload" ? bodyFontSlot.uploadFile : null,
            ),
      ]);

      const headingFont = brandingMimicked
        ? null
        : resolveFontSlot(
            headingFontSlot,
            headingUploaded?.storageUrl ?? null,
          );
      const bodyFont = brandingMimicked
        ? null
        : resolveFontSlot(bodyFontSlot, bodyUploaded?.storageUrl ?? null);

      const brand = {
        colors: brandingMimicked ? [] : colors,
        paletteMode: "manual" as const,
        paletteScreenshotUrl: null,
        fonts: { heading: headingFont, body: bodyFont },
        logo: logoUploaded
          ? {
              storageUrl: logoUploaded.storageUrl,
              position: "top-right" as const,
              exclude: [] as ("cover" | "closing")[],
            }
          : null,
        slideSize,
        slideCount: {
          mode: slideCountMode,
          value: slideCountMode === "custom" ? slideCountValue : null,
        },
      };

      const source: SourceMeta = contentFileReady
        ? {
            kind: "mimic",
            uglyAnthropicFileId: contentExtracted!.anthropicFileId,
            designAnthropicFileId: designExtracted.anthropicFileId,
            fonts: brandingMimicked
              ? designExtracted.fonts
              : [
                  ...designExtracted.fonts,
                  ...(contentExtracted?.fonts ?? []),
                ],
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
          saveBrandKit: false,
          slideCount:
            slideCountMode === "custom" ? slideCountValue : null,
          quality,
          source,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? "تعذر إنشاء المشروع");
      }

      const data = (await response.json()) as { projectId: string };
      router.push(`/preview/${data.projectId}`);
    } catch (err) {
      console.error("[mimic] generate failed:", err);
      setError(
        err instanceof Error
          ? err.message
          : "تعذر إنشاء المشروع. حاول مرة أخرى.",
      );
      setSubmitting(false);
    }
  };

  const generateDisabled = stage === "idle" || stage === "extracting";
  const generateLoading = stage === "extracting" || stage === "submitting";
  const generateLabel = stage === "extracting" ? "جارٍ التحليل..." : "إنشاء";
  const generateLoadingLabel =
    stage === "extracting" ? "جارٍ التحليل..." : "جارٍ الإنشاء...";

  const setHeadingMode = (mode: "upload" | "google") =>
    setHeadingFontSlot((s) => ({ ...s, mode }));
  const setBodyMode = (mode: "upload" | "google") =>
    setBodyFontSlot((s) => ({ ...s, mode }));

  return (
    <div className="flex w-full justify-center" dir="rtl">
      <div className="mt-[6vh] flex w-full flex-col items-center gap-6 px-4">
        <header className="text-center">
          <h1 className="tq-h1">حاكِ تصميم عرض آخر</h1>
          <p className="tq-subhead mt-2">
            اختر عرضاً مرجعياً للتصميم، أضف محتواك، وسنبني عرضاً جديداً يحاكي
            أسلوب المرجع ويحافظ على محتواك حرفياً.
          </p>
        </header>

        {/* Row: 3 fixed-width cards centered. The branding card uses
            AnimatePresence — when it unmounts, `layout` on the
            content + mimic cards interpolates their new positions so
            they translate inward to the new row center. items-stretch
            lets the cards share the tallest card's height (branding
            grows the row when present). */}
        {/* flex-wrap so the row collapses gracefully as the viewport
            narrows. Same responsive pattern /create + /enhance use:
            cards wrap into multiple rows when total width exceeds
            container; items-stretch still equalizes per-row heights. */}
        <div className="flex flex-wrap items-stretch justify-center gap-4">
          {/* ═══════════════════════════════════════════════════════
              CONTENT CARD (DOM 1st, visual right)
              ═══════════════════════════════════════════════════════ */}
          <motion.div
            layout
            transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
            className={`glass-card flex ${CARD_W_CLASS} ${CARD_MIN_H_CLASS} flex-col gap-2.5 rounded-2xl p-3`}
          >
            <input
              ref={contentInputRef}
              type="file"
              accept=".pdf,.pptx,.ppt,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint"
              className="hidden"
              onChange={(event) => setContentFromInput(event.target.files?.[0])}
            />

            <h3 className="text-sm font-semibold text-white">المحتوى</h3>

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
              placeholder="اكتب محتوى عرضك هنا..."
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
                contentText.length > 0 ? "pointer-events-none opacity-40" : ""
              }`}
              aria-hidden={contentText.length > 0}
            >
              <div className="flex items-center gap-2 text-[11px] text-white/40">
                <div className="h-px flex-1 bg-[var(--tq-border-glass)]" />
                <span>أو</span>
                <div className="h-px flex-1 bg-[var(--tq-border-glass)]" />
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

            <div className="border-t border-[var(--tq-border-glass)]" />

            {/* Bottom row: logo (visual right = DOM 1st) + ratios
                (visual left = DOM 2nd, stacked). Section labels
                live INSIDE each side so the row stays a single
                horizontal band of equal height — no extra label
                row above. Logo uses hideFilename to keep its tile
                height stable when a file lands; an absolute × in
                the corner replaces the "إزالة" text row that used
                to sit underneath and grow the card. */}
            <div className="flex gap-3">
              {/* Logo — half-width. Wrapped in `relative` so the
                  remove × can overlay the tile's start corner. */}
              <div className="relative flex-1">
                <CompactUploadZone
                  label={logoFile ? "تم رفع الشعار" : "ارفع الشعار"}
                  accept=".svg,.png,image/svg+xml,image/png"
                  file={logoFile}
                  onSelect={setLogoFile}
                  compact
                  hideFilename
                  fillHeight
                />
                {logoFile ? (
                  <button
                    type="button"
                    onClick={() => setLogoFile(null)}
                    aria-label="إزالة الشعار"
                    className="absolute top-1.5 start-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-black/40 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 14 }}
                    >
                      close
                    </span>
                  </button>
                ) : null}
              </div>

              {/* Ratios — half-width, stacked vertically. Reuses the
                  /create flow's SlideSizeFields with the `stacked`
                  prop (grid-cols-1). Same SizeChoice tiles, same
                  a11y + active state — no fork. */}
              <div className="flex flex-1 flex-col">
                <SlideSizeFields
                  slideSize={slideSize}
                  onSlideSize={setSlideSize}
                  stacked
                  hideLabel
                />
              </div>
            </div>
          </motion.div>

          {/* ═══════════════════════════════════════════════════════
              BRANDING CARD (DOM 2nd, visual middle — CONDITIONAL)
              ═══════════════════════════════════════════════════════ */}
          <AnimatePresence initial={false}>
            {!brandingMimicked ? (
              <motion.div
                key="branding-card"
                layout
                // Width animation: motion-wrapper grows from 0 to
                // W_CARD_PX (the card's natural width). The inner
                // card itself is still `w-[360px]` so during the
                // transition the wrapper's overflow:hidden clips
                // it cleanly. Opacity fades in/out separately so
                // the card appears to materialize, not just expand.
                initial={{ width: 0, opacity: 0, marginInlineStart: -16 }}
                animate={{ width: W_CARD_PX, opacity: 1, marginInlineStart: 0 }}
                exit={{ width: 0, opacity: 0, marginInlineStart: -16 }}
                transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
                style={{ overflow: "hidden" }}
              >
                <div className={`glass-card flex h-full ${CARD_W_CLASS} ${CARD_MIN_H_CLASS} flex-col gap-2.5 rounded-2xl p-3`}>
                  <h3 className="text-sm font-semibold text-white">
                    الهوية البصرية
                  </h3>

                  <div>
                    <span className="text-xs font-semibold text-white/70">
                      الألوان
                    </span>
                    {/* Single-row grid: MAX_PALETTE (6) swatches +
                        optional "add" tile must fit in one line so
                        adding a 4th/5th/6th colour never wraps and
                        grows the card beyond CARD_MIN_H. Card usable
                        width is 360 − p-3 (24) = 336 px; with
                        gap-1.5 (6 px × 5 gaps = 30) → ~51 px per
                        cell. Smaller swatch (h-8) since the column
                        is now narrow. When colours.length === MAX,
                        the add tile drops, swatches expand to fill. */}
                    <div className="mt-2 grid grid-cols-6 gap-1.5">
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
                          aria-label="إضافة لون"
                          className="flex h-8 w-full items-center justify-center rounded-lg border border-dashed border-white/20 text-white/60 transition-colors hover:border-white/40 hover:text-white"
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

                  <div className="border-t border-[var(--tq-border-glass)]" />

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white/70">
                        خط العناوين
                      </span>
                      <SegmentedToggle
                        options={FONT_MODE_OPTIONS}
                        value={headingFontSlot.mode}
                        onChange={setHeadingMode}
                        ariaLabel="مصدر خط العناوين"
                      />
                    </div>
                    {headingFontSlot.mode === "upload" ? (
                      <FontUploadSlot
                        label="ارفع خط العناوين"
                        file={headingFontSlot.uploadFile}
                        family=""
                        sampleText={HEADING_SAMPLE_AR}
                        sampleSizeClass="text-base"
                        alignStart
                        onSelect={(f) =>
                          setHeadingFontSlot((s) => ({
                            ...s,
                            uploadFile: f,
                            uploadName: f.name,
                          }))
                        }
                        onRemove={() =>
                          setHeadingFontSlot((s) => ({
                            ...s,
                            uploadFile: null,
                            uploadName: null,
                          }))
                        }
                      />
                    ) : (
                      <GoogleFontSlot
                        selected={headingFontSlot.googleFamily}
                        sampleText={
                          isLatinOnlyGoogleFont(headingFontSlot.googleFamily)
                            ? HEADING_SAMPLE_LATIN
                            : HEADING_SAMPLE_AR
                        }
                        sampleSizeClass="text-base"
                        alignStart
                        onSelect={(family) =>
                          setHeadingFontSlot((s) => ({
                            ...s,
                            googleFamily: family,
                          }))
                        }
                      />
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white/70">
                        خط النص
                      </span>
                      <SegmentedToggle
                        options={FONT_MODE_OPTIONS}
                        value={bodyFontSlot.mode}
                        onChange={setBodyMode}
                        ariaLabel="مصدر خط النص"
                      />
                    </div>
                    {bodyFontSlot.mode === "upload" ? (
                      <FontUploadSlot
                        label="ارفع خط النص"
                        file={bodyFontSlot.uploadFile}
                        family=""
                        sampleText={BODY_SAMPLE_AR}
                        sampleSizeClass="text-sm"
                        alignStart
                        onSelect={(f) =>
                          setBodyFontSlot((s) => ({
                            ...s,
                            uploadFile: f,
                            uploadName: f.name,
                          }))
                        }
                        onRemove={() =>
                          setBodyFontSlot((s) => ({
                            ...s,
                            uploadFile: null,
                            uploadName: null,
                          }))
                        }
                      />
                    ) : (
                      <GoogleFontSlot
                        selected={bodyFontSlot.googleFamily}
                        sampleText={
                          isLatinOnlyGoogleFont(bodyFontSlot.googleFamily)
                            ? BODY_SAMPLE_LATIN
                            : BODY_SAMPLE_AR
                        }
                        sampleSizeClass="text-sm"
                        alignStart
                        onSelect={(family) =>
                          setBodyFontSlot((s) => ({
                            ...s,
                            googleFamily: family,
                          }))
                        }
                      />
                    )}
                  </div>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {/* ═══════════════════════════════════════════════════════
              WHAT TO MIMIC CARD (DOM 3rd, visual left)
              Animated gradient halo + branding toggle in header.
              ═══════════════════════════════════════════════════════ */}
          <motion.div
            layout
            transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
            className={`${CARD_W_CLASS} ${CARD_MIN_H_CLASS}`}
          >
            <div
              className="canvas-gradient-border glass-card flex h-full w-full flex-col gap-2.5 rounded-2xl p-3"
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

              <h3 className="text-sm font-semibold text-white">
                ما الذي نُحاكيه
              </h3>

              {/* Shared Toggle from /create/controls — RTL-aware
                  thumb travel (right-0.5 off → right-[22px] on),
                  uses --tq-blue for the active fill. Same look + a11y
                  semantics as every other toggle in the app
                  (SaveAsTemplateDialog, rule toggles on /create). */}
              <Toggle
                label="مُحاكاة الهوية البصرية"
                value={brandingMimicked}
                onChange={setBrandingMimicked}
              />

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
                <span className="text-xs font-semibold text-white/70">
                  عدد الشرائح
                </span>
                <motion.div
                  layout
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  className="flex items-center gap-1.5"
                >
                  <SegmentedToggle
                    options={SLIDE_COUNT_OPTIONS}
                    value={slideCountMode}
                    onChange={setSlideCountMode}
                    ariaLabel="عدد الشرائح"
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
                          max={20}
                        />
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </motion.div>
              </div>

              {/* Design-ref dropzone — shrunk via `compact` so the
                  card stays at CARD_MIN_H while the new SlideCount
                  row claims its share. The h-full + flex-1 wrapper
                  lets the (shorter) dropzone still fill whatever
                  vertical space is left after the toggle + slide
                  count claim theirs. */}
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
            </div>
          </motion.div>
        </div>

        <div className="flex justify-center">
          <GenerateSplitButton
            onGenerate={handleGenerate}
            quality={quality}
            onQualityChange={setQuality}
            slideCount={designExtracted?.pageCount ?? undefined}
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
// PaletteSwatch — compact version of /create's BrandColorRow. Same
// ColorPickerPopover, smaller swatch (h-10) to fit the branding card.
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
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setPickerOpen((v) => !v)}
        className="block h-8 w-full rounded-lg border border-white/15 transition-shadow hover:shadow-md"
        style={{ backgroundColor: value }}
        aria-label={`اللون ${index + 1}`}
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={!removable}
        aria-label="إزالة اللون"
        className="absolute top-0 right-0 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-black/60 text-white transition-opacity hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-0"
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
            ? "border-white/40 bg-white/[0.04]"
            : "border-white/20 bg-black/20 hover:border-white/30"
        } ${heightCls}`}
      >
        {/* Icon container — slightly smaller in horizontal mode so
            the row stays close to the 44 px target height. Same
            stage-aware glyph swap as before (extracting spinner /
            ready check / picked file icon / empty cloud_upload). */}
        <span
          className={`flex shrink-0 items-center justify-center rounded-full bg-[var(--tq-bg-glass)] ${
            horizontal ? "h-8 w-8" : "h-10 w-10"
          }`}
        >
          {stage === "extracting" ? (
            <span className="spinner h-5 w-5 rounded-full border-2 border-white/20 border-t-white" />
          ) : stage === "ready" ? (
            <span
              className="material-symbols-outlined text-emerald-300"
              style={{ fontSize: horizontal ? "18px" : "22px" }}
            >
              check_circle
            </span>
          ) : file ? (
            <span
              className="material-symbols-outlined text-white/80"
              style={{ fontSize: horizontal ? "18px" : "22px" }}
            >
              description
            </span>
          ) : (
            <span
              className="material-symbols-outlined text-white/80"
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
            <p className="truncate text-sm font-semibold text-white">
              {readableFileName(file.name)}
            </p>
            <p className="mt-0.5 truncate text-xs text-white/60">
              {formatFileSize(file.size)}
              {stage === "extracting"
                ? " · جارٍ التحليل..."
                : stage === "ready"
                  ? " · جاهز"
                  : submitting
                    ? " · جارٍ الإنشاء..."
                    : ""}
            </p>
          </div>
        ) : (
          <div className={`min-w-0 ${horizontal ? "flex-1" : ""}`}>
            <p className="truncate text-sm font-semibold text-white">
              {horizontal
                ? "اسحب أو انقر لاختيار ملف"
                : "اسحب وأفلت الملف هنا"}
            </p>
            {/* Muted second line — compatible-file hint + size cap.
                Shown in BOTH horizontal and stacked empty states now
                that the card has the vertical room (CARD_MIN_H = 387);
                stacked also keeps its longer "أو انقر" caption above
                it for the larger ref-file dropzone. */}
            {horizontal ? (
              <p className="mt-0.5 truncate text-[11px] text-white/40">
                PDF أو PowerPoint — حتى 100 ميجابايت
              </p>
            ) : (
              <>
                <p className="mt-0.5 text-xs text-white/60">
                  أو انقر لاختيار ملف
                </p>
                <p className="mt-1 text-[10px] text-white/40">
                  PDF أو PowerPoint — حتى 100 ميجابايت
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
          aria-label="إزالة الملف"
          className="absolute top-2 start-2 flex h-7 w-7 items-center justify-center rounded-md bg-black/35 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
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

