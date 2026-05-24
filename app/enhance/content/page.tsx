"use client";

// Step 1 of the Enhance flow — file upload + extraction. Mirrors
// /create/content/page.tsx but with a single card (no free-text
// alternative; Enhance is file-only) and a different submit path:
//
//   /create/content  → /api/extract-text → text in sessionStorage
//                       → /create/brand
//
//   /enhance/content → /api/extract       → jobId
//                       → poll /api/extract/[jobId]
//                       → seedFromExtraction({ kind:"enhance", … })
//                       → /enhance/brand (pre-filled palette + fonts)
//
// Reuses every shared chrome primitive (CreateShell, CreateStepper
// via the shell, PillButton, OutputCards.SlideSizeFields, controls
// — same drag-drop interaction grammar from /create/content). The
// only logic unique to this page is the polling state machine.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CreateShell } from "@/components/create/CreateShell";
import { PillButton } from "@/components/create/PillButton";
import {
  SlideSizeFields,
  type SlideSize,
} from "@/components/create/OutputCards";
import { seedFromExtraction } from "@/lib/create/seed-from-extraction";
import type { ExtractedAsset } from "@/lib/types/source";

// sessionStorage key for slide size + dummy "content done" flag. We
// don't actually persist a content blob the way /create/content
// does — for Enhance, "content" IS the uploaded source, and that
// rides in `taqreer:create:source` (written by seedFromExtraction
// once extraction completes). But the stepper reads
// `taqreer:create:content` to mark step 1 done, so we drop a
// minimal { type: "source" } stub there post-extraction.
const CONTENT_KEY = "taqreer:create:content";
const OUTPUT_KEY = "taqreer:create:output";

const POLL_INTERVAL_MS = 2_500;
const POLL_TIMEOUT_MS = 5 * 60 * 1_000; // 5 min ceiling
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

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

// Shape of the response from GET /api/extract/[jobId] when status
// is "completed". Mirrors what extract-source.ts writes to
// Job.outputJson on success (see ExtractCompletedOutput there).
//
// Phase 17.B-7: response carries `anthropicFileId` (file_id from
// Anthropic Files API) instead of `slideImageUrls`. Claude reads
// the PDF directly via a `document` block in deck-generate.
type ExtractCompletedResponse = {
  status: "completed";
  result: {
    anthropicFileId: string;
    embeddedAssets: Array<{ url: string; slideIndices: number[] }>;
    fonts: string[];
    colors: string[];
  };
  fileName?: string;
  flowKind?: string;
};

type ExtractStatusResponse =
  | { status: "queued" | "processing"; fileName?: string }
  | { status: "failed"; error: string; fileName?: string }
  | ExtractCompletedResponse;

export default function EnhanceContentPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  // Cancel any in-flight poll if the user navigates away or removes
  // the file mid-extraction. The poller checks the ref before each
  // iteration to bail cleanly.
  const pollCancelledRef = useRef(false);

  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [slideSize, setSlideSize] = useState<SlideSize>("16:9");
  const [error, setError] = useState("");
  // Loading state machine — drives the disabled state on the
  // submit button + the progress copy shown below the drop zone.
  //   idle       → fresh page or file removed
  //   uploading  → POST /api/extract is in flight
  //   extracting → polling /api/extract/[jobId]
  const [stage, setStage] = useState<"idle" | "uploading" | "extracting">(
    "idle",
  );

  // Hydrate previously-picked slide size from output sessionStorage
  // (mirrors /create/content's hydrate behavior so the user's
  // preference persists across reloads / back-nav).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(OUTPUT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { slideSize?: SlideSize };
      if (parsed.slideSize === "16:9" || parsed.slideSize === "9:16") {
        setSlideSize(parsed.slideSize);
      }
    } catch {
      /* corrupt blob — ignore */
    }
  }, []);

  // Persist slide size as soon as it changes so reloads + back-nav
  // see the same pick. Same key /create/content writes to.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(OUTPUT_KEY);
      const existing = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      sessionStorage.setItem(
        OUTPUT_KEY,
        JSON.stringify({ ...existing, slideSize }),
      );
    } catch {
      /* best-effort */
    }
  }, [slideSize]);

  const selectFile = (next?: File | null) => {
    if (!next) return;
    const lower = next.name.toLowerCase();
    const extOk =
      lower.endsWith(".pdf") ||
      lower.endsWith(".pptx") ||
      lower.endsWith(".ppt");
    if (!extOk) {
      setError("الرجاء رفع ملف PDF أو PowerPoint (.pptx, .ppt).");
      return;
    }
    if (next.size > MAX_FILE_SIZE_BYTES) {
      setError(
        `الملف يتجاوز الحد الأقصى 100 ميجابايت (${(next.size / 1024 / 1024).toFixed(1)} م.ب).`,
      );
      return;
    }
    setFile(next);
    setError("");
  };

  const removeFile = () => {
    pollCancelledRef.current = true;
    setFile(null);
    setStage("idle");
    setError("");
  };

  // Poll /api/extract/[jobId] every POLL_INTERVAL_MS until status
  // is "completed" or "failed", or until POLL_TIMEOUT_MS elapses.
  // Returns the completed result or throws on failure / timeout.
  const pollExtraction = async (
    jobId: string,
  ): Promise<ExtractCompletedResponse["result"]> => {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (pollCancelledRef.current) {
        throw new Error("Cancelled");
      }
      const res = await fetch(`/api/extract/${jobId}`);
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? `Status ${res.status}`);
      }
      const body = (await res.json()) as ExtractStatusResponse;
      if (body.status === "completed") {
        return body.result;
      }
      if (body.status === "failed") {
        throw new Error(body.error ?? "Extraction failed");
      }
      // queued | processing — wait + iterate
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error("Extraction timed out. Try a smaller file or try again.");
  };

  const handleNext = async () => {
    if (!file) {
      setError("اختر ملف PDF أو PowerPoint للمتابعة.");
      return;
    }
    setError("");
    pollCancelledRef.current = false;
    setStage("uploading");

    try {
      // ─── Step 1: kick off extraction (POST /api/extract) ─────────
      const formData = new FormData();
      formData.append("file", file);
      formData.append("format", slideSize);
      formData.append("kind", "enhance");

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

      // ─── Step 2: poll until done ─────────────────────────────────
      setStage("extracting");
      const result = await pollExtraction(jobId);

      // ─── Step 3: seed sessionStorage + navigate ──────────────────
      // SourceMeta carries the Anthropic file_id (not slide PNG
      // URLs anymore — Phase 17.B-7 pivot). The brand fields are
      // hints; user can edit on /enhance/brand. Server returns
      // assets with slideIndices[]; SourceMeta keeps a single
      // originalSlide (first index) — multi-slide reuse is metadata
      // we may surface later but doesn't drive prompt branching.
      const extractedAssets: ExtractedAsset[] = result.embeddedAssets.map(
        (a) => ({
          url: a.url,
          originalSlide: a.slideIndices[0] ?? -1,
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
          format: slideSize,
        },
      });

      // Mark step 1 as done for the stepper (it reads CONTENT_KEY
      // presence to flip the dot to ✓). The "type:source" stub is
      // a no-op for downstream consumers — server-side /api/projects
      // reads `source` for the enhance branch, not `content`.
      sessionStorage.setItem(
        CONTENT_KEY,
        JSON.stringify({ type: "source", fileName: file.name }),
      );

      router.push("/enhance/brand");
    } catch (err) {
      if (pollCancelledRef.current) {
        // User clicked Remove while we were waiting — silent reset.
        setStage("idle");
        return;
      }
      console.error("[enhance/content] extraction failed:", err);
      setError(
        err instanceof Error
          ? err.message
          : "تعذر تحليل الملف. حاول مرة أخرى.",
      );
      setStage("idle");
    }
  };

  const loading = stage !== "idle";

  return (
    <CreateShell
      currentStep="content"
      title="حسّن عرضك التقديمي"
      subtitle="ارفع ملف PDF أو PowerPoint وسنعيد بناءه بتصميم احترافي مع الحفاظ على محتواك."
      bottomBar={
        <div className="flex items-center justify-between gap-4">
          <p
            className="min-h-5 text-sm text-red-400"
            role={error ? "alert" : undefined}
            aria-live={error ? "polite" : undefined}
          >
            {error || " "}
          </p>
          <PillButton
            variant="primary"
            onClick={handleNext}
            disabled={loading}
            loading={loading}
            icon="arrow_back"
          >
            الخطوة التالية
          </PillButton>
        </div>
      }
    >
      <div className="glass-card flex flex-col gap-3 rounded-2xl p-5">
        <header className="flex items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <span
              className="material-symbols-outlined text-white"
              style={{ fontSize: "18px" }}
            >
              cloud_upload
            </span>
            رفع الملف المصدر
          </h2>
        </header>

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.pptx,.ppt,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint"
          className="hidden"
          onChange={(event) => selectFile(event.target.files?.[0])}
        />

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            selectFile(event.dataTransfer.files?.[0]);
          }}
          disabled={loading}
          // Same border vocabulary as /create/content's file card.
          // 1 px dashed, hover lifts the border to white/30.
          className={`flex min-h-[280px] w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-6 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
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
            ) : (
              <span
                className="material-symbols-outlined text-white/80"
                style={{ fontSize: "28px" }}
              >
                cloud_upload
              </span>
            )}
          </span>
          {/* The drop-zone copy doubles as the progress indicator
              during upload + extraction — replaces the "drag and
              drop" text in place so the user's eye stays focused
              on the same surface rather than tracking a separate
              status block below. ALL numerals in copy are Latin
              digits (0-9), never Arabic-Indic (٠-٩) — design rule
              locked 2026-05-24. */}
          {loading ? (
            <div>
              <p className="text-base font-semibold text-white">
                {stage === "uploading"
                  ? "جارٍ رفع الملف..."
                  : "جارٍ تحليل المحتوى وإعداد الشرائح"}
              </p>
              {stage === "extracting" ? (
                <p className="mt-1 text-sm text-white/60">
                  قد يستغرق 30-60 ثانية
                </p>
              ) : null}
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
              disabled={loading && stage !== "extracting"}
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

        {/* Slide size picker on row 1 — same placement as
            /create/content, so step heights match. */}
        <div className="border-t border-white/[0.08] pt-3">
          <SlideSizeFields slideSize={slideSize} onSlideSize={setSlideSize} />
        </div>
      </div>
    </CreateShell>
  );
}
