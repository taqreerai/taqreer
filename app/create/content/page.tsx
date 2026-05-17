"use client";

// Step 1 — Content. Two side-by-side cards (file upload + free
// text) instead of the previous tabbed single-card layout. The card
// the user STARTS interacting with becomes the active mode; the
// other dims to half opacity so it's obvious only one will submit.
// Verbatim toggle lives on the text card (only meaningful for text).

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CreateShell } from "@/components/create/CreateShell";
import { PillButton } from "@/components/create/PillButton";
import { Toggle } from "@/components/create/controls";
import { notifyCreateStateChange } from "@/components/create/CreateStepper";

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

  const selectFile = (nextFile?: File) => {
    if (!nextFile) return;
    setFile(nextFile);
    setTab("file");
    setError("");
  };

  const onTextChange = (next: string) => {
    setText(next);
    if (next.trim().length > 0) setTab("text");
    setError("");
  };

  const handleNext = async () => {
    setError("");
    const hasFile = tab === "file" && file;
    const hasText = tab === "text" && text.trim().length > 0;

    if (!hasFile && !hasText) {
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
          "taqreer:create:content",
          JSON.stringify({
            type: "file",
            fileName: readableFileName(file.name),
            fileSize: file.size,
            storageUrl: uploaded.storageUrl,
            keepVerbatim: !letUsHandle,
          }),
        );
      } else {
        sessionStorage.setItem(
          "taqreer:create:content",
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
            !file && text.trim().length > 0 ? "opacity-60" : ""
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
                <p className="text-xs text-white/50">{formatFileSize(file.size)}</p>
              </div>
              <button
                type="button"
                onClick={() => setFile(null)}
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
            file && text.trim().length === 0 ? "opacity-60" : ""
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
