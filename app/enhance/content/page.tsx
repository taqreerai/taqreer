"use client";

// Phase 17.B-17 — /enhance/content overhaul.
//
// The single step of the Enhance flow. Three regions in one shell:
//
//   1. Source file (drop zone) — PDF or PPTX, ≤ 100 MB.
//      On submit: POST /api/extract → poll → seedFromExtraction
//      (pre-fills logo / palette below from the source).
//
//   2. Brand logo — SVG upload via /api/storage/upload. Persisted
//      to sessionStorage taqreer:create:brand.logo so summary +
//      deck-generate pick it up.
//
//   3. Brand palette — 5 swatches, each opens ColorPickerPopover.
//      Pre-filled by seedFromExtraction from Tier-1 PPTX theme
//      accents; user can edit any swatch.
//
// What's NOT here (per user direction 2026-05-25):
//   • No slide-size picker — auto-derived from PDF page aspect.
//   • No slide-count picker — auto-derived from PDF page count.
//   • No fonts picker — Claude reads the PDF + extracted-font
//     hints carry the typography baseline.
//   • No brand step — palette + logo absorbed into this page.
//
// On submit: writeSource is called BEFORE extraction polling
// completes (no), AFTER (yes). Polling first; on completion we
// call seedFromExtraction which writes the SourceMeta + pre-fills
// the brand keys WITHOUT overwriting what the user typed (manual
// edits win). Then the user clicks Next which navigates to
// /enhance/summary.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EnhanceShell } from "@/components/enhance/EnhanceShell";
import { PillButton } from "@/components/create/PillButton";
import { seedFromExtraction } from "@/lib/create/seed-from-extraction";
import type { ExtractedAsset } from "@/lib/types/source";

// sessionStorage keys (canonical create-flow keys; the enhance
// flow shares them so summary can read uniformly).
const CONTENT_KEY = "taqreer:create:content";
const BRAND_KEY = "taqreer:create:brand";
const OUTPUT_KEY = "taqreer:create:output";

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

type StoredLogo = {
  name: string;
  storageUrl: string;
};

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

export default function EnhanceContentPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const pollCancelledRef = useRef(false);

  // ─── Source file ─────────────────────────────────────────────
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<"idle" | "uploading" | "extracting">(
    "idle",
  );
  // Once extraction completes we have the result ready; clicking
  // Next just navigates. extractResultRef stores it across renders.
  const [extracted, setExtracted] = useState<
    ExtractCompletedResponse["result"] | null
  >(null);

  // ─── Brand ────────────────────────────────────────────────────
  // Palette UI dropped per 2026-05-25 user direction — Claude
  // picks brand colors from the PDF visually + the extracted
  // theme accents flow through sessionStorage as hints. Only the
  // logo is user-editable on this page.
  const [logo, setLogo] = useState<StoredLogo | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);

  const [error, setError] = useState("");

  // ─── Initial hydrate from sessionStorage ─────────────────────
  // The logo may be pre-filled by a prior visit (user bounced
  // back from summary). seedFromExtraction also writes here on
  // successful extraction.
  useEffect(() => {
    try {
      const rawBrand = sessionStorage.getItem(BRAND_KEY);
      if (rawBrand) {
        const parsed = JSON.parse(rawBrand) as { logo?: StoredLogo | null };
        if (parsed.logo) setLogo(parsed.logo);
      }
    } catch {
      /* corrupt blob — start fresh */
    }
  }, []);

  // ─── Persist logo changes to sessionStorage ───────────────────
  // Read-modify-write so we don't clobber `colors` / `fonts` /
  // `paletteMode` that seedFromExtraction wrote post-extraction.
  useEffect(() => {
    try {
      const existingRaw = sessionStorage.getItem(BRAND_KEY);
      const existing = existingRaw
        ? (JSON.parse(existingRaw) as Record<string, unknown>)
        : {};
      sessionStorage.setItem(
        BRAND_KEY,
        JSON.stringify({ ...existing, logo }),
      );
    } catch {
      /* best-effort */
    }
  }, [logo]);

  // ─── File pickers ────────────────────────────────────────────
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
    setExtracted(null);
    setError("");
  };

  const removeFile = () => {
    pollCancelledRef.current = true;
    setFile(null);
    setExtracted(null);
    setStage("idle");
    setError("");
  };

  const selectLogo = async (next?: File | null) => {
    if (!next) return;
    if (!next.name.toLowerCase().endsWith(".svg")) {
      setError("الشعار يجب أن يكون بصيغة SVG.");
      return;
    }
    setError("");
    setLogoUploading(true);
    try {
      const formData = new FormData();
      formData.append("bucket", "brand-assets");
      formData.append("folder", "logos");
      formData.append("file", next);
      const res = await fetch("/api/storage/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? "تعذر رفع الشعار");
      }
      const data = (await res.json()) as { name: string; storageUrl: string };
      setLogo({ name: data.name, storageUrl: data.storageUrl });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "تعذر رفع الشعار. حاول مرة أخرى.",
      );
    } finally {
      setLogoUploading(false);
    }
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

  // ─── Submit ──────────────────────────────────────────────────
  const handleNext = async () => {
    if (!file) {
      setError("اختر ملف PDF أو PowerPoint للمتابعة.");
      return;
    }
    setError("");
    pollCancelledRef.current = false;

    try {
      // If we haven't extracted yet, do it now. If we have (user
      // already extracted and just adjusted brand fields), skip
      // straight to the seed + navigate.
      let result = extracted;
      if (!result) {
        setStage("uploading");
        const formData = new FormData();
        formData.append("file", file);
        formData.append("kind", "enhance");
        // format param kept for the route's slideFormat default
        // (server uses it for inputJson metadata, not for raster
        // dimensions anymore). 16:9 default works regardless.
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

        setStage("extracting");
        result = await pollExtraction(jobId);
        setExtracted(result);
      }

      // Seed sessionStorage. seedFromExtraction merges with what's
      // already in BRAND_KEY (user's manual color/logo picks are
      // preserved) — well, it overwrites colors+format, but the
      // logo we wrote via the brand-key effect above stays.
      //
      // The format + pageCount land in OUTPUT_KEY so the summary
      // page picks up the slide size + slide count automatically.
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
          // No UI picker for colors anymore — pass through whatever
          // the server extracted (theme accents for PPTX, empty for
          // PDF). Claude treats them as a baseline brand hint and
          // augments / replaces from what he sees in the PDF.
          colors: result.colors,
          fonts: result.fonts,
          format: result.format,
        },
      });

      // Stamp the auto-derived slide count into output sessionStorage
      // so the summary page picks it up without a manual picker.
      try {
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

      // Make sure the brand sessionStorage carries the final logo
      // alongside whatever seedFromExtraction just wrote (colors +
      // fonts hints). Read-modify-write to merge cleanly.
      try {
        const existingRaw = sessionStorage.getItem(BRAND_KEY);
        const existing = existingRaw
          ? (JSON.parse(existingRaw) as Record<string, unknown>)
          : {};
        sessionStorage.setItem(
          BRAND_KEY,
          JSON.stringify({ ...existing, logo }),
        );
      } catch {
        /* best-effort */
      }

      // Mark step 1 done for the stepper.
      sessionStorage.setItem(
        CONTENT_KEY,
        JSON.stringify({ type: "source", fileName: file.name }),
      );

      router.push("/enhance/summary");
    } catch (err) {
      if (pollCancelledRef.current) {
        setStage("idle");
        return;
      }
      console.error("[enhance/content] extraction failed:", err);
      setError(
        err instanceof Error ? err.message : "تعذر تحليل الملف. حاول مرة أخرى.",
      );
      setStage("idle");
    }
  };

  const loading = stage !== "idle";

  return (
    <EnhanceShell
      currentStep="content"
      title="حسّن عرضك التقديمي"
      subtitle="ارفع ملف PDF أو PowerPoint وسنعيد بناءه بتصميم احترافي مع الحفاظ على محتواك بالضبط."
      fileName={file ? readableFileName(file.name) : undefined}
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
      {/* ─── Card 1 — Source file ──────────────────────────────── */}
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
          ref={fileInputRef}
          type="file"
          accept=".pdf,.pptx,.ppt,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint"
          className="hidden"
          onChange={(event) => selectFile(event.target.files?.[0])}
        />

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
            selectFile(event.dataTransfer.files?.[0]);
          }}
          disabled={loading}
          className={`flex min-h-[200px] w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-6 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
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
      </div>

      {/* ─── Card 2 — Brand logo (optional) ───────────────────────
          Palette UI dropped per user direction 2026-05-25 — Claude
          picks colors from the PDF directly. The extracted theme
          accents still flow through sessionStorage as hints. */}
      <div className="glass-card flex flex-1 flex-col gap-4 rounded-2xl p-5">
        <header className="flex items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <span
              className="material-symbols-outlined text-white"
              style={{ fontSize: "18px" }}
            >
              image
            </span>
            الشعار (SVG)
            <span className="text-xs font-normal text-white/40">
              (اختياري)
            </span>
          </h2>
        </header>

        <div className="flex flex-col gap-2">
          <input
            ref={logoInputRef}
            type="file"
            accept=".svg,image/svg+xml"
            className="hidden"
            onChange={(event) => selectLogo(event.target.files?.[0])}
          />
          {logo ? (
            <div
              className="flex items-center justify-between gap-3 rounded-xl border p-3"
              style={{
                background: "rgba(255, 255, 255, var(--glass-opacity))",
                borderColor: "rgba(255, 255, 255, var(--glass-border-opacity))",
              }}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">
                  {logo.name}
                </p>
                <p className="text-xs text-white/50">SVG</p>
              </div>
              <button
                type="button"
                onClick={() => setLogo(null)}
                aria-label="إزالة الشعار"
                className="flex h-7 w-7 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: "18px" }}
                >
                  close
                </span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              disabled={logoUploading}
              className="flex min-h-[64px] w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-black/20 text-sm text-white/60 transition-colors hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {logoUploading ? (
                <span className="spinner h-4 w-4 rounded-full border-2 border-white/20 border-t-white" />
              ) : (
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: "18px" }}
                >
                  add
                </span>
              )}
              {logoUploading ? "جارٍ الرفع..." : "اختر ملف SVG"}
            </button>
          )}
        </div>

      </div>
    </EnhanceShell>
  );
}
