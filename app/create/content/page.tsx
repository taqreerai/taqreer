"use client";

// Step 1 — Content. Two side-by-side cards (file upload + free
// text) instead of the previous tabbed single-card layout. The card
// the user STARTS interacting with becomes the active mode; the
// other dims to half opacity so it's obvious only one will submit.
// Verbatim toggle lives on the text card (only meaningful for text).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CreateShell } from "@/components/create/CreateShell";
import { PillButton } from "@/components/create/PillButton";
import { Toggle } from "@/components/create/controls";
import { notifyCreateStateChange } from "@/components/create/CreateStepper";

// sessionStorage key for the content blob. Same key used by the
// stepper to detect "step 1 done" + by the brand page's navigation
// guard. Hoisted to a constant so auto-save / hydrate / handleNext
// all reference the same value.
const CONTENT_KEY = "taqreer:create:content";

type StoredContent =
  | { type: "text"; text: string; keepVerbatim?: boolean }
  | {
      type: "file";
      fileName: string;
      fileSize: number;
      storageUrl: string;
      keepVerbatim?: boolean;
    };

type Tab = "file" | "text";

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} ك.ب`;
  return `${(size / (1024 * 1024)).toFixed(1)} م.ب`;
}

// Some upload sources (drag-from-browser, certain file pickers) hand
// back file.name already URL-percent-encoded. Decode for display +
// storage so the Arabic name shows as "قوة الذكاء.pptx" not
// "%D9%82%D9%88%D8%A9...".
function readableFileName(raw: string): string {
  if (!/%[0-9A-Fa-f]{2}/.test(raw)) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default function CreateContentPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>("file");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [progressStep, setProgressStep] = useState<1 | 2 | null>(null);
  // Default OFF: surface the user's content verbatim (no invented
  // headings or grouping). When the user flips this on, we let
  // Claude reorganize freely.
  const [letUsHandle, setLetUsHandle] = useState(false);
  // Restored file metadata — when the user uploaded a file on a
  // previous visit and clicked Next, we get back the fileName +
  // storageUrl from sessionStorage. The File object itself can't
  // be serialised, so this is the equivalent storage-side
  // reference. Mirrors brand-page's `loadedLogoMeta` pattern.
  const [loadedFileMeta, setLoadedFileMeta] = useState<{
    fileName: string;
    fileSize: number;
    storageUrl: string;
  } | null>(null);
  // Hydration guard — `mounted=true` AFTER the useLayoutEffect that
  // restores state. Until then we suppress the auto-save effect so
  // an initial default-value render doesn't blow away the saved
  // blob between Render 1 and Render 2.
  const [mounted, setMounted] = useState(false);

  // Hydrate from sessionStorage post-render but BEFORE paint, so
  // the user never sees an empty textarea flash if they're coming
  // back to the page with content in storage.
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(CONTENT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredContent;
        if (parsed.type === "text") {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setText(parsed.text ?? "");
          if (parsed.text?.trim()) setTab("text");
        } else if (parsed.type === "file") {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setLoadedFileMeta({
            fileName: parsed.fileName,
            fileSize: parsed.fileSize,
            storageUrl: parsed.storageUrl,
          });
          setTab("file");
        }
        if (parsed.keepVerbatim != null) {
          // `letUsHandle` is the inverse of `keepVerbatim` (toggle
          // ON = let us reorganise = NOT verbatim).
          setLetUsHandle(!parsed.keepVerbatim);
        }
      }
    } catch {
      /* corrupt blob — leave defaults */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // Auto-save text drafts as the user types. Skips when not yet
  // mounted (avoid clobbering during hydration) and when typing into
  // an empty textarea (don't overwrite an existing file blob with an
  // empty text blob — leaves the saved file in place until the user
  // actually starts typing).
  useEffect(() => {
    if (!mounted) return;
    if (typeof window === "undefined") return;
    if (!text.trim()) {
      // If the user clears the textarea AND there's a saved text
      // blob (not a file), strip it so coming back lands on the
      // default empty state instead of restoring stale text.
      const existing = window.sessionStorage.getItem(CONTENT_KEY);
      if (existing) {
        try {
          const parsed = JSON.parse(existing) as StoredContent;
          if (parsed.type === "text") {
            window.sessionStorage.removeItem(CONTENT_KEY);
            notifyCreateStateChange();
          }
        } catch {
          /* corrupt blob — leave */
        }
      }
      return;
    }
    window.sessionStorage.setItem(
      CONTENT_KEY,
      JSON.stringify({
        type: "text",
        text,
        keepVerbatim: !letUsHandle,
      }),
    );
    notifyCreateStateChange();
  }, [text, letUsHandle, mounted]);

  const selectFile = (nextFile?: File) => {
    if (!nextFile) return;
    setFile(nextFile);
    // A fresh File supersedes any previously-uploaded one — the user
    // explicitly re-picked, so drop the loaded-meta and re-upload on
    // Next.
    setLoadedFileMeta(null);
    setTab("file");
    setError("");
  };

  const removeFile = () => {
    setFile(null);
    setLoadedFileMeta(null);
    // Reset the native input so re-selecting the SAME file fires onChange
    // again. Without this, the input's `value` still points at the removed
    // file and the browser de-dupes — the user clicks "select" again,
    // picks the same file, and nothing happens.
    if (inputRef.current) inputRef.current.value = "";
    if (typeof window !== "undefined") {
      const existing = window.sessionStorage.getItem(CONTENT_KEY);
      if (existing) {
        try {
          const parsed = JSON.parse(existing) as StoredContent;
          if (parsed.type === "file") {
            window.sessionStorage.removeItem(CONTENT_KEY);
            notifyCreateStateChange();
          }
        } catch {
          /* corrupt — leave */
        }
      }
    }
  };

  const onTextChange = (next: string) => {
    setText(next);
    if (next.trim().length > 0) setTab("text");
    setError("");
  };

  const handleNext = async () => {
    setError("");
    const hasFreshFile = tab === "file" && file;
    const hasLoadedFile = tab === "file" && !file && loadedFileMeta;
    const hasText = tab === "text" && text.trim().length > 0;

    if (!hasFreshFile && !hasLoadedFile && !hasText) {
      setError("اختر ملفاً أو أدخل نصاً للمتابعة.");
      return;
    }

    setLoading(true);
    try {
      if (file && tab === "file") {
        setProgressStep(1);
        await new Promise((resolve) => setTimeout(resolve, 450));
        setProgressStep(2);

        const formData = new FormData();
        formData.append("bucket", "source-files");
        formData.append("folder", "content");
        formData.append("file", file);

        const uploadResponse = await fetch("/api/storage/upload", {
          method: "POST",
          body: formData,
        });
        if (!uploadResponse.ok) {
          const data = (await uploadResponse.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(data?.error ?? "Upload failed");
        }
        const uploaded = (await uploadResponse.json()) as { storageUrl: string };

        sessionStorage.setItem(
          CONTENT_KEY,
          JSON.stringify({
            type: "file",
            fileName: readableFileName(file.name),
            fileSize: file.size,
            storageUrl: uploaded.storageUrl,
            keepVerbatim: !letUsHandle,
          }),
        );
      } else if (loadedFileMeta && tab === "file") {
        // Previously-uploaded file, no fresh File picked — forward
        // the same storage URL + metadata. No re-upload.
        sessionStorage.setItem(
          CONTENT_KEY,
          JSON.stringify({
            type: "file",
            fileName: loadedFileMeta.fileName,
            fileSize: loadedFileMeta.fileSize,
            storageUrl: loadedFileMeta.storageUrl,
            keepVerbatim: !letUsHandle,
          }),
        );
      } else {
        sessionStorage.setItem(
          CONTENT_KEY,
          JSON.stringify({
            type: "text",
            text: text.trim(),
            keepVerbatim: !letUsHandle,
          }),
        );
      }

      notifyCreateStateChange();
      router.push("/create/brand");
    } catch (caughtError) {
      console.error("Create content upload error:", caughtError);
      setError(
        caughtError instanceof Error
          ? `تعذر حفظ المحتوى: ${caughtError.message}`
          : "تعذر حفظ المحتوى. حاول مرة أخرى.",
      );
      setLoading(false);
      setProgressStep(null);
    }
  };

  // Active card glows; the other dims to half opacity. Picking up
  // interaction (drop a file / type) sets the active card.
  const fileActive = tab === "file";
  const textActive = tab === "text";

  return (
    <CreateShell
      currentStep="content"
      title="ما هو موضوع عرضك التقديمي؟"
      subtitle="قم بتزويد الذكاء الاصطناعي بالمحتوى الأساسي. ارفع ملفاً أو الصق نصاً وسنقوم نحن بالباقي."
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* File upload card — visual right in RTL since it's first
            in DOM order and the row inherits dir="rtl". */}
        <div
          className={`glass-card flex flex-col gap-3 rounded-2xl p-5 transition-opacity ${
            !file && !loadedFileMeta && text.trim().length > 0 ? "opacity-60" : ""
          }`}
        >
          <header className="flex items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <span
                className="material-symbols-outlined text-white"
                style={{ fontSize: "18px" }}
              >
                cloud_upload
              </span>
              رفع ملفات السياق
            </h2>
          </header>
          <input
            ref={inputRef}
            type="file"
            accept=".pptx,.pdf,.docx,.txt,.png,.jpg,.jpeg"
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
            className={`flex min-h-[200px] w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
              dragging
                ? "border-[var(--tq-violet)]/60 bg-[var(--tq-violet)]/10"
                : fileActive
                  ? "border-white/30 bg-black/20 hover:border-white/50"
                  : "border-white/15 bg-black/20 hover:border-white/30"
            }`}
          >
            <span
              className="flex h-12 w-12 items-center justify-center rounded-full"
              style={{ background: "rgba(255, 255, 255, var(--glass-opacity))" }}
            >
              <span
                className="material-symbols-outlined text-white/80"
                style={{ fontSize: "24px" }}
              >
                cloud_upload
              </span>
            </span>
            <div>
              <p className="text-sm font-semibold text-white">اسحب وأفلت الملفات هنا</p>
              <p className="mt-1 text-xs text-white/60">أو انقر لتصفح جهازك</p>
            </div>
            <p className="text-[10px] text-white/40">ندعم صيغ PPTX, PDF, DOCX</p>
          </button>

          {/* Chip shows EITHER the freshly-picked File OR the
              previously-uploaded loadedFileMeta — never both. */}
          {file || loadedFileMeta ? (
            <div
              className="flex items-center justify-between gap-3 rounded-xl border p-3"
              style={{
                background: "rgba(255, 255, 255, var(--glass-opacity))",
                borderColor: "rgba(255, 255, 255, var(--glass-border-opacity))",
              }}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">
                  {file
                    ? readableFileName(file.name)
                    : (loadedFileMeta?.fileName ?? "")}
                </p>
                <p className="text-xs text-white/50">
                  {formatFileSize(
                    file ? file.size : (loadedFileMeta?.fileSize ?? 0),
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={removeFile}
                aria-label="إزالة الملف"
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
          ) : null}

          {loading && file ? (
            <div
              className="space-y-2 rounded-xl border p-3"
              style={{
                background: "rgba(255, 255, 255, var(--glass-opacity))",
                borderColor: "rgba(255, 255, 255, var(--glass-border-opacity))",
              }}
            >
              {[
                { step: 1, label: "جارٍ قراءة المحتوى..." },
                { step: 2, label: "جارٍ تحليل الهيكل..." },
              ].map((item) => (
                <div key={item.step} className="flex items-center gap-2 text-xs text-white">
                  {progressStep === item.step ? (
                    <span className="spinner h-3 w-3 rounded-full border-2 border-white/20 border-t-white" />
                  ) : (
                    <span
                      className="material-symbols-outlined text-emerald-400"
                      style={{ fontSize: "14px" }}
                    >
                      check_circle
                    </span>
                  )}
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Free-text card */}
        <div
          className={`glass-card flex flex-col gap-3 rounded-2xl p-5 transition-opacity ${
            (file || loadedFileMeta) && text.trim().length === 0 ? "opacity-60" : ""
          }`}
        >
          <header className="flex items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <span
                className="material-symbols-outlined text-white"
                style={{ fontSize: "18px" }}
              >
                edit_note
              </span>
              إدخال نص حر
            </h2>
            <span
              className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none text-white/70"
              style={{
                background: "rgba(255, 255, 255, var(--glass-opacity))",
                borderColor: "rgba(255, 255, 255, var(--glass-border-opacity))",
              }}
            >
              موصى به للسرعة
            </span>
          </header>
          <textarea
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
            className="input-dark min-h-[200px] flex-1 resize-none leading-7"
            placeholder="اكتب أو الصق أفكارك، النقاط الرئيسية، أو المقال الذي تريد تحويله إلى عرض تقديمي هنا..."
            maxLength={5000}
          />
          <div className="flex items-center justify-between text-xs">
            <span className="text-white/40">
              {text.length.toLocaleString("en-US")} / 5000 حرف
            </span>
          </div>
          {textActive ? (
            <Toggle
              label="نظّم وأعد صياغة المحتوى"
              value={letUsHandle}
              onChange={setLetUsHandle}
            />
          ) : null}
        </div>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <div className="flex items-center justify-end pt-2">
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
    </CreateShell>
  );
}
