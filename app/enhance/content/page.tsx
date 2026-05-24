"use client";

// Phase 17.B — Single-shot Enhance flow.
//
// The whole /enhance experience lives on this one page:
//
//   1. Drop a PDF or PPTX
//   2. Server extracts (LibreOffice → PDF → Anthropic Files API +
//      PPTX zip walk for assets/fonts/colors)
//   3. Generate button activates
//   4. Click Generate → POST /api/projects → /preview/{id}
//
// No stepper, no summary, no brand step — the source PDF IS the
// brand reference; Claude reads it via the document block. Matches
// the typical AI-app single-card pattern (Claude.ai, ChatGPT,
// v0.dev) — fewer steps, faster path to result.
//
// Layout: centered card max-w-2xl, vertically anchored toward
// top-center of the available height (not dead-center — feels too
// loose with that much vertical air). Dashboard chrome (sidebar +
// header) stays via the /enhance/layout.tsx DashboardShell wrapper.
//
// The brief assembly + POST logic mirrors /create/summary's
// handleGenerate so the server contract is identical for both flows
// — /api/projects validates a SourceMeta blob on the brief and
// branches deck-generate accordingly. Quality defaults to "medium"
// (no quality picker in this flow; user can override later via
// regen). Language is "ar" but deck-generate's source.kind="enhance"
// branch ignores the directive and tells Claude to follow the PDF.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GenerateSplitButton } from "@/components/create/GenerateSplitButton";
import { seedFromExtraction } from "@/lib/create/seed-from-extraction";
import { readSource, clearSource } from "@/lib/types/source";
import { DEFAULT_QUALITY, type Quality } from "@/lib/types/quality";
import type { ExtractedAsset } from "@/lib/types/source";

const POLL_INTERVAL_MS = 2_500;
const POLL_TIMEOUT_MS = 5 * 60 * 1_000; // 5 min ceiling
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

type ExtractCompletedResponse = {
  status: "completed";
  result: {
    anthropicFileId: string;
    embeddedAssets: Array<{
      url: string;
      slideIndices: number[];
      groupIds: string[];
    }>;
    fonts: string[];
    colors: string[];
    pageCount: number;
    format: "16:9" | "9:16";
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
//   idle        — no file selected
//   extracting  — file uploaded, polling /api/extract/[jobId]
//                 (also covers the brief upload-to-staging phase;
//                 from user perspective they're indistinguishable)
//   ready       — extraction complete, button enabled
//   submitting  — Generate clicked, POSTing /api/projects
type Stage = "idle" | "extracting" | "ready" | "submitting";

export default function EnhanceContentPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollCancelledRef = useRef(false);

  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  // Extraction result is cached so the Generate click can submit
  // without re-extracting. Cleared when the user removes the file.
  const [extracted, setExtracted] = useState<
    ExtractCompletedResponse["result"] | null
  >(null);
  const [error, setError] = useState("");
  // Quality preset — picked via the GenerateSplitButton's right
  // half (chevron dropdown). Mirrors /create/summary's preset
  // picker so the user can dial generation effort up/down.
  const [quality, setQuality] = useState<Quality>(DEFAULT_QUALITY);

  // ─── File selection ──────────────────────────────────────────
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
    setFile(next);
    setExtracted(null);
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
  const pollExtraction = async (
    jobId: string,
  ): Promise<ExtractCompletedResponse["result"]> => {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (pollCancelledRef.current) throw new Error("Cancelled");
      const res = await fetch(`/api/extract/${jobId}`);
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
  // The moment the user picks a file we kick off extraction so the
  // Generate button activates as soon as it's ready. No "start
  // extraction" button.
  useEffect(() => {
    if (!file) return;
    pollCancelledRef.current = false;
    setStage("extracting");
    setError("");

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
        });
        if (!startRes.ok) {
          const data = (await startRes.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(data?.error ?? `Upload failed (${startRes.status})`);
        }
        const { jobId } = (await startRes.json()) as { jobId: string };
        if (!jobId) throw new Error("No jobId returned from /api/extract");

        const result = await pollExtraction(jobId);
        if (!isCurrent) return;
        setExtracted(result);
        setStage("ready");

        // Seed sessionStorage immediately so the data is ready
        // when the user clicks Generate. Matches what /enhance/
        // summary used to read.
        const extractedAssets: ExtractedAsset[] = result.embeddedAssets.map(
          (a) => ({
            url: a.url,
            originalSlide: a.slideIndices[0] ?? -1,
            groupIds: a.groupIds ?? [],
          }),
        );

        seedFromExtraction({
          source: {
            kind: "enhance",
            anthropicFileId: result.anthropicFileId,
            extractedAssets,
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

        // Stamp the content key as well so any downstream code
        // that checks "step 1 done" sees it (defensive — nothing
        // in this single-shot flow actually reads it, but other
        // surfaces like the BellDropdown / RecentProjects may).
        sessionStorage.setItem(
          "taqreer:create:content",
          JSON.stringify({ type: "source", fileName: file.name }),
        );
      } catch (err) {
        if (!isCurrent || pollCancelledRef.current) {
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
    };
  }, [file]);

  // ─── Submit ──────────────────────────────────────────────────
  // Inlined from /create/summary's handleGenerate so /enhance can
  // skip the summary step entirely. Mirrors the brief-assembly
  // shape exactly so the server contract is identical.
  const handleGenerate = async () => {
    if (stage !== "ready" || !extracted || !file) return;
    setError("");
    setStage("submitting");
    try {
      const source = readSource();

      // Pull brand + output from sessionStorage. seedFromExtraction
      // (above, post-extraction) wrote the colors/fonts and the
      // detected slideSize + slideCount. No logo for enhance —
      // Claude finds it in the PDF.
      const rawBrand = sessionStorage.getItem("taqreer:create:brand");
      const rawOutput = sessionStorage.getItem("taqreer:create:output");
      const brand = rawBrand
        ? (JSON.parse(rawBrand) as {
            colors?: string[];
            paletteMode?: string;
            paletteScreenshotUrl?: string | null;
            fonts?: unknown;
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

      const mergedBrand = {
        colors: brand.colors ?? [],
        paletteMode: brand.paletteMode ?? "manual",
        paletteScreenshotUrl: brand.paletteScreenshotUrl ?? null,
        fonts: brand.fonts ?? null,
        logo: null,
        slideSize: output.slideSize ?? extracted.format ?? "16:9",
        slideCount: output.slideCount ?? { mode: "auto", value: null },
      };

      // Content stub — enhance flow has no text content; the source
      // file IS the content. /api/projects sanitizes "type: source"
      // as a no-op for the text path (Claude reads from the
      // document block via source.kind="enhance").
      const content = { type: "source" as const, fileName: file.name };

      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          brand: mergedBrand,
          rules: null,
          // Default to Arabic for the brief field, but
          // deck-generate's source.kind="enhance" branch tells
          // Claude to follow the PDF's language anyway.
          language: "ar",
          saveBrandKit: false,
          slideCount: resolvedSlideCount,
          // Quality is user-picked via the GenerateSplitButton's
          // preset dropdown. Falls back to DEFAULT_QUALITY if the
          // user never opened the menu.
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

      // Clean up sessionStorage — next /enhance visit starts fresh.
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

  // GenerateSplitButton drives label/loading from its own `loading`
  // prop (rendered as a spinner + label-swap). Submit + extraction
  // both contribute to the loading state — both should disable +
  // animate the button identically (user-perspective: "the model
  // is working"). Idle = no file yet, disabled but not spinning.
  const generateDisabled = stage === "idle";
  const generateLoading = stage === "extracting" || stage === "submitting";
  const generateLabel =
    stage === "extracting" ? "جارٍ التحليل..." : "إنشاء";
  const generateLoadingLabel =
    stage === "extracting" ? "جارٍ التحليل..." : "جارٍ الإنشاء...";

  return (
    // Centered single-shot card. Anchored toward the top-third of
    // the viewport via mt-[10vh] — dead-center feels too loose with
    // the sidebar present, and pushes the action area below the
    // fold on shorter screens. The card itself is max-w-2xl so it
    // matches the visual weight of AI-app prompt areas without
    // running edge-to-edge on wide monitors.
    <div className="flex w-full justify-center" dir="rtl">
      <div className="mt-[8vh] flex w-full max-w-2xl flex-col items-center gap-6">
        <header className="text-center">
          <h1 className="tq-h1">حسّن عرضك التقديمي</h1>
          <p className="tq-subhead mt-2">
            ارفع ملف PDF أو PowerPoint وسنعيد بناءه بتصميم احترافي مع الحفاظ
            على محتواك بالضبط.
          </p>
        </header>

        <div className="glass-card flex w-full flex-col gap-4 rounded-2xl p-5">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.pptx,.ppt,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint"
            className="hidden"
            onChange={(event) =>
              validateAndSetFile(event.target.files?.[0])
            }
          />

          {/* Drop zone — fixed min height ~200 px (was flex-1 inside
              a stretched shell; now we're in a centered card, no
              need to stretch). */}
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
            className={`flex min-h-[220px] w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-6 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              dragging
                ? "border-white/40 bg-white/[0.04]"
                : "border-white/20 bg-black/20 hover:border-white/30"
            }`}
          >
            <span
              className="flex h-14 w-14 items-center justify-center rounded-full"
              style={{
                background: "rgba(255, 255, 255, var(--glass-opacity))",
              }}
            >
              {stage === "extracting" ? (
                <span className="spinner h-6 w-6 rounded-full border-2 border-white/20 border-t-white" />
              ) : stage === "ready" ? (
                <span
                  className="material-symbols-outlined text-emerald-300"
                  style={{ fontSize: "28px" }}
                >
                  check_circle
                </span>
              ) : (
                <span
                  className="material-symbols-outlined text-white/80"
                  style={{ fontSize: "28px" }}
                >
                  cloud_upload
                </span>
              )}
            </span>
            {stage === "extracting" ? (
              <div>
                <p className="text-base font-semibold text-white">
                  جارٍ تحليل المحتوى وإعداد الشرائح
                </p>
                <p className="mt-1 text-sm text-white/60">قد يستغرق 30-60 ثانية</p>
              </div>
            ) : stage === "ready" ? (
              <div>
                <p className="text-base font-semibold text-white">
                  جاهز للإنشاء
                </p>
                <p className="mt-1 text-sm text-white/60">
                  انقر "إنشاء العرض" للمتابعة
                </p>
              </div>
            ) : (
              <>
                <div>
                  <p className="text-base font-semibold text-white">
                    اسحب وأفلت الملف هنا
                  </p>
                  <p className="mt-1 text-sm text-white/60">
                    أو انقر لاختيار ملف
                  </p>
                </div>
                <p className="text-xs text-white/40">
                  PDF أو PowerPoint (.pptx, .ppt) — حتى 100 ميجابايت
                </p>
              </>
            )}
          </button>

          {/* File chip — visible whenever a file is selected.
              Shows name + size; close button to remove. */}
          {file ? (
            <div
              className="flex items-center justify-between gap-3 rounded-xl border p-3"
              style={{
                background: "rgba(255, 255, 255, var(--glass-opacity))",
                borderColor: "rgba(255, 255, 255, var(--glass-border-opacity))",
              }}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">
                  {readableFileName(file.name)}
                </p>
                <p className="text-xs text-white/50">
                  {formatFileSize(file.size)}
                </p>
              </div>
              <button
                type="button"
                onClick={removeFile}
                aria-label="إزالة الملف"
                disabled={stage === "submitting"}
                className="flex h-7 w-7 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: "18px" }}
                >
                  close
                </span>
              </button>
            </div>
          ) : null}

        </div>

        {/* Generate split-button — sits OUTSIDE the upload card,
            centered horizontally below it. Same chrome + size as
            /create/summary's CTA (canonical animated mesh-stroke
            pill, h-11). Disabled until extraction finishes; loading
            state during extraction AND the final POST so the user
            sees continuous progress through both phases. Preset
            menu (right half of the split) lets the user pick a
            generation quality. */}
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

        {/* Error message — reserved space so the layout doesn't
            jump when an error appears. Rendered AFTER the button
            since this is a single-shot page (no bottom bar). */}
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
