"use client";

// Phase 17.B — Single-shot Enhance flow.
//
// The whole /enhance experience lives on this one page:
//
//   1. Drop a PDF or PPTX  (top of the source-+-logo card)
//   2. Server extracts (LibreOffice → PDF → Anthropic Files API +
//      PPTX zip walk for fonts/colors). Asset extraction removed
//      2026-05-25 — Claude reads visuals from the PDF document block.
//   3. Optionally upload a logo  (below the file dropzone, same card)
//   4. Optionally pick heading + body fonts (file or Google)  (fonts card)
//   5. Generate button activates as soon as extraction finishes
//   6. Click Generate → upload logo/fonts (if any) → POST /api/projects
//      → /preview/{id}
//
// Layout: two equal-width glass cards side-by-side under a brief
// header. The source/logo card stacks the PDF dropzone above the logo
// dropzone (file is primary, logo is the same-card secondary). The
// fonts card holds the two slots (heading + body). Both cards are
// flex-1 so they read as a balanced pair; items-stretch makes them
// share the row's natural height. Container caps at max-w-3xl so the
// cards stay readable on wide monitors instead of stretching to the
// full sidebar-adjusted width.
//
// Brand picks (logo + fonts) are OPTIONAL on this flow. Empty cards =
// Claude reads the brand identity from the PDF visually. Filled cards
// = user's pick wins (matches the create flow's brand shape on the
// brief).
//
// Components: CompactUploadZone, FontUploadSlot, GoogleFontSlot are
// the same primitives /create/brand uses — extracted to
// components/brand/ 2026-05-25 per "reuse > extend > fork > build new".

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GenerateSplitButton } from "@/components/create/GenerateSplitButton";
import { CompactUploadZone } from "@/components/brand/CompactUploadZone";
import { FontUploadSlot } from "@/components/brand/FontUploadSlot";
import { GoogleFontSlot } from "@/components/brand/GoogleFontSlot";
import {
  CardHeader,
  SegmentedToggle,
} from "@/components/create/controls";
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
import { seedFromExtraction } from "@/lib/create/seed-from-extraction";
import { readSource, clearSource } from "@/lib/types/source";
import { DEFAULT_QUALITY, type Quality } from "@/lib/types/quality";

const POLL_INTERVAL_MS = 2_500;
const POLL_TIMEOUT_MS = 5 * 60 * 1_000; // 5 min ceiling
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

// Segmented-toggle option list — declared once so the SegmentedToggle
// stays stable across re-renders (matches /create + /mimic pattern).
const FONT_MODE_OPTIONS = [
  { value: "upload" as const, label: "ملف" },
  { value: "google" as const, label: "Google" },
];

type ExtractCompletedResponse = {
  status: "completed";
  result: {
    anthropicFileId: string;
    fonts: string[];
    colors: string[];
    pageCount: number;
    format: "16:9" | "9:16";
    // PPTX-detected dominant language ("ar" | "en"); null for PDF
    // inputs OR PPTX with too little text to decide. Threaded into
    // the brief so the preview SlideNavSidebar opens in the right
    // direction from the first paint instead of flipping mid-stream.
    language: "ar" | "en" | null;
  };
  fileName?: string;
  flowKind?: string;
};

type ExtractStatusResponse =
  | { status: "queued" | "processing"; fileName?: string }
  | { status: "failed"; error: string; fileName?: string }
  | ExtractCompletedResponse;

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

// State machine — drives the Generate button label + disabled state.
// idle        — no file selected yet
// extracting  — file uploaded, polling /api/extract/[jobId]
// ready       — extraction completed, Generate active
// submitting  — Generate clicked, POSTing /api/projects
type Stage = "idle" | "extracting" | "ready" | "submitting";

// Resolved brand-font shape we POST to /api/projects. Mirrors the
// shape /create/brand writes via its handleNext path so the server
// contract is identical between flows. Either field is null when
// the slot is empty (user didn't pick anything).
type ResolvedFontField = {
  name: string;
  url: string | null;
  storageUrl: string | null;
  family: string;
} | null;

// Translate a FontSlotState into the brand.fonts.{heading|body}
// shape /api/projects expects. Upload mode needs an already-uploaded
// storageUrl; the caller uploads via uploadAsset first and passes
// the result here. Google mode just packs the family + canonical CSS
// URL.
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
  // Upload mode. Need the bytes already in storage. If the user
  // selected a file but the upload hasn't been kicked off yet
  // (we only upload on Generate click), uploadedStorageUrl is null
  // here from the caller — return null and let the brief skip
  // the slot rather than send a half-resolved entry.
  if (!slot.uploadFile || !uploadedStorageUrl) return null;
  return {
    name: slot.uploadName ?? slot.uploadFile.name,
    url: null,
    storageUrl: uploadedStorageUrl,
    family: slot.uploadFamily || slot.uploadFile.name.replace(/\.[^.]+$/, ""),
  };
}

export default function EnhanceContentPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollCancelledRef = useRef(false);

  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [extracted, setExtracted] = useState<
    ExtractCompletedResponse["result"] | null
  >(null);
  const [error, setError] = useState("");
  const [quality, setQuality] = useState<Quality>(DEFAULT_QUALITY);

  // Brand picks — optional. Empty = Claude reads the brand identity
  // from the PDF visually. Filled = user's pick wins on the brief.
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [headingFontSlot, setHeadingFontSlot] = useState<FontSlotState>(
    emptyFontSlot(),
  );
  const [bodyFontSlot, setBodyFontSlot] = useState<FontSlotState>(
    emptyFontSlot(),
  );

  // ─── File selection (source PDF/PPTX) ────────────────────────
  // setStage("extracting") + setError("") moved here from the
  // useEffect body (2026-05-26, CR finding) — calling setState
  // synchronously inside an effect tripped the
  // react-hooks/set-state-in-effect lint rule and could cause
  // a cascading-render warning. Setting them at the file-pick
  // call site instead is the canonical pattern: the effect
  // then only owns the external work (upload + poll).
  const validateAndSetFile = (next?: File | null): File | null => {
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
    pollCancelledRef.current = false;
    setFile(next);
    setExtracted(null);
    setStage("extracting");
    setError("");
    return next;
  };

  const removeFile = () => {
    pollCancelledRef.current = true;
    setFile(null);
    setExtracted(null);
    setStage("idle");
    setError("");
  };

  // ─── Polling helper ──────────────────────────────────────────
  // Takes an AbortSignal so an in-flight `fetch` actually aborts on
  // unmount / file-swap. Pre-fix (CR #36, 2026-05-25) we only set a
  // `pollCancelledRef` flag — the flag was checked at the top of each
  // loop iteration, but the fetch ITSELF kept running its full
  // round-trip even after the component unmounted, holding a request
  // slot open and arriving with `setExtracted` calls into a torn-down
  // tree (the `isCurrent` guard at the call site dropped the result,
  // but the network work was wasted). With AbortController + signal,
  // a pending fetch is cancelled the moment the effect cleanup fires.
  const pollExtraction = async (
    jobId: string,
    signal: AbortSignal,
  ): Promise<ExtractCompletedResponse["result"]> => {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (signal.aborted || pollCancelledRef.current) {
        throw new Error("Cancelled");
      }
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

  // ─── Auto-start extraction on file selection ─────────────────
  // Stage/error/cancel-flag setters live in `validateAndSetFile` so
  // this effect body only owns external work (POST + poll) — keeps
  // the react-hooks/set-state-in-effect lint clean.
  useEffect(() => {
    if (!file) return;

    // One controller per file selection — aborts the in-flight POST
    // /api/extract AND the polling fetch when the effect cleans up
    // (file swap, unmount, navigation away). Pre-fix the network
    // work continued past unmount; now it terminates cleanly.
    const controller = new AbortController();

    let isCurrent = true;
    (async () => {
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("kind", "enhance");
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
        setExtracted(result);
        setStage("ready");

        // Seed sessionStorage with extraction's brand pre-fill (colors,
        // fonts hint, format). Logo + user-picked fonts come from local
        // state on submit, so they're NOT seeded here — they're
        // intentionally separate from the extracted defaults.
        seedFromExtraction({
          source: {
            kind: "enhance",
            anthropicFileId: result.anthropicFileId,
            fonts: result.fonts,
          },
          brand: {
            colors: result.colors,
            fonts: result.fonts,
            format: result.format,
          },
        });

        // Stamp slide count + size into output sessionStorage —
        // /api/projects reads these for the brief's slideCount /
        // slideSize fields.
        try {
          const OUTPUT_KEY = "taqreer:create:output";
          const existing = sessionStorage.getItem(OUTPUT_KEY);
          const obj = existing ? JSON.parse(existing) : {};
          sessionStorage.setItem(
            OUTPUT_KEY,
            JSON.stringify({
              ...obj,
              slideSize: result.format,
              slideCount: {
                mode: "custom",
                value: result.pageCount > 0 ? result.pageCount : null,
              },
            }),
          );
        } catch {
          /* best-effort */
        }

        sessionStorage.setItem(
          "taqreer:create:content",
          JSON.stringify({ type: "source", fileName: file.name }),
        );
      } catch (err) {
        // AbortError is the expected outcome when the effect cleanup
        // aborts the controller (file swap / unmount / navigation).
        // Treat it the same as the explicit pollCancelledRef path —
        // silently reset to idle, no error toast.
        const isAbort =
          err instanceof DOMException && err.name === "AbortError";
        if (!isCurrent || pollCancelledRef.current || isAbort) {
          setStage("idle");
          return;
        }
        console.error("[enhance] extraction failed:", err);
        setError(
          err instanceof Error
            ? err.message
            : "تعذر تحليل الملف. حاول مرة أخرى.",
        );
        setStage("idle");
      }
    })();

    return () => {
      isCurrent = false;
      pollCancelledRef.current = true;
      controller.abort();
    };
  }, [file]);

  // ─── Submit ──────────────────────────────────────────────────
  // 1. Upload optional logo + font files (parallel) to brand-assets
  // 2. Resolve font slots into the brand.fonts shape
  // 3. POST /api/projects with the merged brief
  const handleGenerate = async () => {
    if (stage !== "ready" || !extracted || !file) return;
    setError("");
    setStage("submitting");
    try {
      // Step 1: upload any optional brand files in parallel. uploadAsset
      // returns null when the input file is null, so passing through
      // a not-picked slot is a no-op.
      const [logoUploaded, headingUploaded, bodyUploaded] = await Promise.all([
        uploadAsset("brand-assets", "logos", logoFile),
        uploadAsset(
          "brand-assets",
          "fonts",
          headingFontSlot.mode === "upload" ? headingFontSlot.uploadFile : null,
        ),
        uploadAsset(
          "brand-assets",
          "fonts",
          bodyFontSlot.mode === "upload" ? bodyFontSlot.uploadFile : null,
        ),
      ]);

      const headingFont = resolveFontSlot(
        headingFontSlot,
        headingUploaded?.storageUrl ?? null,
      );
      const bodyFont = resolveFontSlot(
        bodyFontSlot,
        bodyUploaded?.storageUrl ?? null,
      );

      const source = readSource();

      // Pull the seeded extraction colors from sessionStorage so the
      // brief still carries them — extraction's palette is the
      // suggestion until we add a palette picker to this page.
      const rawBrand = sessionStorage.getItem("taqreer:create:brand");
      const rawOutput = sessionStorage.getItem("taqreer:create:output");
      const seededBrand = rawBrand
        ? (JSON.parse(rawBrand) as {
            colors?: string[];
            paletteMode?: string;
            paletteScreenshotUrl?: string | null;
          })
        : {};
      const output = rawOutput
        ? (JSON.parse(rawOutput) as {
            slideSize?: "16:9" | "9:16";
            slideCount?: { mode?: string; value?: number | null };
          })
        : {};

      const resolvedSlideCount =
        output?.slideCount?.mode === "custom" && output.slideCount.value
          ? output.slideCount.value
          : null;

      // Brand object on the brief. User picks (logo + fonts) win;
      // colors come from extraction (no UI for them on this page yet).
      // Logo position defaults to top-end (top-left in LTR/EN, top-right
      // in RTL/AR); the cover/closing exclude list is empty so Claude
      // places it on every slide.
      const mergedBrand = {
        colors: seededBrand.colors ?? [],
        paletteMode: seededBrand.paletteMode ?? "manual",
        paletteScreenshotUrl: seededBrand.paletteScreenshotUrl ?? null,
        fonts: {
          heading: headingFont,
          body: bodyFont,
        },
        logo: logoUploaded
          ? {
              storageUrl: logoUploaded.storageUrl,
              position: "top-right" as const,
              exclude: [] as ("cover" | "closing")[],
            }
          : null,
        slideSize: output.slideSize ?? extracted.format ?? "16:9",
        slideCount: output.slideCount ?? { mode: "auto", value: null },
      };

      // Content stub — enhance flow has no text content; the source
      // file IS the content.
      const content = { type: "source" as const, fileName: file.name };

      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          brand: mergedBrand,
          rules: null,
          // Use the language detected from the source PPTX/PDF
          // during extraction. Falls back to "ar" when detection
          // returned null (PDF inputs, empty PPTX text, or genuine
          // ambiguity) — same default we had before detection.
          // The detected value flows into deck-generate's brief →
          // streaming preview's `streamingLanguage`, so the
          // SlideNavSidebar renders in the right direction from
          // first paint instead of flipping mid-stream.
          language: extracted.language ?? "ar",
          saveBrandKit: false,
          slideCount: resolvedSlideCount,
          quality,
          ...(source ? { source } : {}),
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? "تعذر إنشاء المشروع");
      }

      const data = (await response.json()) as { projectId: string };

      sessionStorage.removeItem("taqreer:create:content");
      sessionStorage.removeItem("taqreer:create:brand");
      sessionStorage.removeItem("taqreer:create:brand:savedSnapshot");
      sessionStorage.removeItem("taqreer:create:output");
      clearSource();

      router.push(`/preview/${data.projectId}`);
    } catch (err) {
      console.error("[enhance] generate failed:", err);
      setError(
        err instanceof Error ? err.message : "تعذر إنشاء المشروع. حاول مرة أخرى.",
      );
      setStage("ready");
    }
  };

  const generateDisabled = stage === "idle";
  const generateLoading = stage === "extracting" || stage === "submitting";
  const generateLabel =
    stage === "extracting" ? "جارٍ التحليل..." : "إنشاء";
  const generateLoadingLabel =
    stage === "extracting" ? "جارٍ التحليل..." : "جارٍ الإنشاء...";

  // Heading / body font-mode toggles. Switching modes preserves the
  // OTHER mode's state (the user might toggle back) — only flips
  // `mode`. Matches /create/brand's setFontMode behaviour.
  const setHeadingMode = (mode: "upload" | "google") =>
    setHeadingFontSlot((s) => ({ ...s, mode }));
  const setBodyMode = (mode: "upload" | "google") =>
    setBodyFontSlot((s) => ({ ...s, mode }));

  return (
    // Outer wrapper centered horizontally. Anchored toward top-third
    // so the 3-card row sits in the visual sweet-spot instead of
    // dead-center where it'd float low on tall screens.
    <div className="page-container flex w-full justify-center" dir="rtl">
      <div className="mt-[6vh] flex w-full max-w-3xl flex-col items-center gap-6 px-4">
        <header className="text-center">
          <h1 className="tq-h1">حسّن عرضك التقديمي</h1>
          <p className="tq-subhead mt-2">
            ارفع ملف PDF أو PowerPoint وسنعيد بناءه بتصميم احترافي مع الحفاظ
            على محتواك بالضبط.
          </p>
        </header>

        {/* 2-card horizontal row. RTL flow: source/logo (start, visual
            right) → fonts (end, visual left). Both cards flex-1 so
            they share the row width equally; items-stretch makes the
            fonts card grow to match the source card's height (which
            is taller — dropzone + logo stacked + file chip). */}
        {/* flex-wrap so the row collapses gracefully on narrow
            viewports — same responsive pattern /create + /mimic use.
            Cards keep flex-1 to share row width but each carries a
            min-w so they wrap (rather than infinitely shrink) when
            the container can't fit both side-by-side. */}
        <div className="flex w-full flex-wrap items-stretch gap-4">
          {/* ─── Source + Logo card ──────────────────────────
              File dropzone on top (primary action), logo dropzone
              underneath (optional brand asset). One card because
              the two sub-cards looked unbalanced at equal width —
              the file area needs much more vertical real estate.
              p-4 + gap-4 deliberately tighter than the create-flow
              cards so the row reads compact, not airy. */}
          <div className="glass-card flex min-h-[387px] min-w-[320px] flex-1 flex-col gap-4 rounded-2xl p-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.pptx,.ppt,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint"
              className="hidden"
              onChange={(event) =>
                validateAndSetFile(event.target.files?.[0])
              }
            />

            <CardHeader icon="subject" title="الملف الأصلي" />

            {/* File dropzone — primary action of the page.
                When a file IS selected, the dropzone CONTENT swaps to
                show the file's name + size + a stage caption (instead
                of pushing a separate file-chip below the dropzone,
                which made the card much taller). A small remove
                button absolutely positions at the visual start corner
                so the user can clear the pick without re-triggering
                the file picker — `stopPropagation` keeps the button's
                click from bubbling up to the dropzone parent.
                flex-1 on the inner wrapper + h-full on the relative
                container makes the dropzone consume all remaining
                vertical space inside the card (CARD_MIN_H = 387 px
                pins the card at /create + /mimic's baseline). */}
            <div className="flex flex-1 flex-col gap-2">
              <div className="relative h-full">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    validateAndSetFile(event.dataTransfer.files?.[0]);
                  }}
                  disabled={stage === "extracting" || stage === "submitting"}
                  className={`flex h-full min-h-[160px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    dragging
                      ? "border-white/40 bg-white/[0.04]"
                      : "border-white/20 bg-black/20 hover:border-white/30"
                  }`}
                >
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--tq-bg-glass)]"
                  >
                    {stage === "extracting" ? (
                      <span className="spinner h-5 w-5 rounded-full border-2 border-white/20 border-t-white" />
                    ) : stage === "ready" ? (
                      <span
                        className="material-symbols-outlined text-emerald-300"
                        style={{ fontSize: "22px" }}
                      >
                        check_circle
                      </span>
                    ) : file ? (
                      <span
                        className="material-symbols-outlined text-white/80"
                        style={{ fontSize: "22px" }}
                      >
                        description
                      </span>
                    ) : (
                      <span
                        className="material-symbols-outlined text-white/80"
                        style={{ fontSize: "22px" }}
                      >
                        cloud_upload
                      </span>
                    )}
                  </span>

                  {file ? (
                    // File picked — show name + size + stage caption.
                    // Replaces the drop-prompt entirely so the dropzone
                    // doubles as a file chip without pushing extra height.
                    <div className="w-full px-2">
                      <p className="truncate text-sm font-semibold text-white">
                        {readableFileName(file.name)}
                      </p>
                      <p className="mt-0.5 text-xs text-white/60">
                        {formatFileSize(file.size)}
                        {stage === "extracting"
                          ? " · جارٍ التحليل..."
                          : stage === "ready"
                            ? " · جاهز للإنشاء"
                            : stage === "submitting"
                              ? " · جارٍ الإنشاء..."
                              : ""}
                      </p>
                    </div>
                  ) : (
                    // No file — drop prompt.
                    <>
                      <div>
                        <p className="text-sm font-semibold text-white">
                          اسحب وأفلت الملف هنا
                        </p>
                        <p className="mt-0.5 text-xs text-white/60">
                          أو انقر لاختيار ملف
                        </p>
                      </div>
                      <p className="text-[10px] text-white/40">
                        PDF أو PowerPoint (.pptx, .ppt) — حتى 100 ميجابايت
                      </p>
                    </>
                  )}
                </button>

                {/* Remove button — overlays at the visual start corner
                    when a file is picked. Sibling (not child) of the
                    dropzone button so we don't nest <button>s.
                    stopPropagation ensures clicking it doesn't also
                    open the file picker. Hidden during extraction /
                    submission since cancelling mid-flight wasn't
                    designed for (the poller would resolve into an
                    already-removed state and surface confusing errors). */}
                {file && stage !== "extracting" && stage !== "submitting" ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeFile();
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
            </div>

          </div>

          {/* ─── Fonts card (optional) ────────────────────────
              Same padding + gap rhythm as the source card so the
              two cards visually balance (items-stretch on the row
              already equalizes heights, but matching internal rhythm
              prevents the inner content from feeling differently
              spaced). */}
          <div className="glass-card flex min-h-[387px] min-w-[320px] flex-1 flex-col gap-4 rounded-2xl p-4">
            <CardHeader icon="palette" title="الهوية البصرية" />

            {/* Heading font — same recipe as /create + /mimic:
                inline label-row with SegmentedToggle on the visual
                left, compact font slot below with sample text hidden
                (alignStart pins remaining preview to the RTL edge
                when the slot opts back in). */}
            <div className="space-y-1.5">
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
                  compact
                  hideSample
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
                  compact
                  hideSample
                  onSelect={(family) =>
                    setHeadingFontSlot((s) => ({ ...s, googleFamily: family }))
                  }
                />
              )}
            </div>

            {/* Body font — separator (border-t pt-3) sets it apart
                from the heading section above; matches /create. */}
            <div className="space-y-1.5 border-t border-[var(--tq-border-glass)] pt-3">
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
                  compact
                  hideSample
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
                  compact
                  hideSample
                  onSelect={(family) =>
                    setBodyFontSlot((s) => ({ ...s, googleFamily: family }))
                  }
                />
              )}
            </div>

            {/* Logo sub-section — same compact CompactUploadZone +
                hideFilename + absolute × overlay pattern /create's
                logo card uses. Sits under the fonts inside the
                "الهوية البصرية" card so all brand picks (fonts +
                logo) live together. */}
            <div className="space-y-1.5 border-t border-[var(--tq-border-glass)] pt-3">
              <span className="block text-xs font-semibold text-white/70">
                الشعار
              </span>
              <div className="relative">
                <CompactUploadZone
                  label={
                    logoFile ? readableFileName(logoFile.name) : "شعار SVG فقط"
                  }
                  accept=".svg,image/svg+xml"
                  file={logoFile}
                  onSelect={setLogoFile}
                  compact
                  hideFilename
                  muted={!logoFile}
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
            </div>
          </div>
        </div>

        {/* Generate split-button — sits OUTSIDE the cards, centered
            horizontally below. Same chrome + size as /create/summary's
            CTA. Disabled until extraction finishes; loading state
            during extraction AND the final POST so the user sees
            continuous progress through both phases. Preset menu
            (right half of the split) lets the user pick a generation
            quality. */}
        <div className="flex justify-center">
          <GenerateSplitButton
            onGenerate={handleGenerate}
            quality={quality}
            onQualityChange={setQuality}
            slideCount={extracted?.pageCount ?? undefined}
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

