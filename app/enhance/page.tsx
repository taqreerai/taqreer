"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} ك.ب`;
  return `${(size / (1024 * 1024)).toFixed(1)} م.ب`;
}

export default function EnhancePage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [keepColors, setKeepColors] = useState(false);
  const [keepFonts, setKeepFonts] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [progressStep, setProgressStep] = useState<1 | 2 | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selectFile = (nextFile?: File) => {
    if (!nextFile) return;
    if (!nextFile.name.toLowerCase().endsWith(".pptx")) {
      setError("يرجى اختيار ملف PPTX فقط.");
      return;
    }
    setFile(nextFile);
    setError("");
  };

  const handleNext = async () => {
    setError("");

    if (!file) {
      setError("اختر ملف PowerPoint للمتابعة.");
      return;
    }

    setLoading(true);

    try {
      setProgressStep(1);
      await new Promise((resolve) => setTimeout(resolve, 450));
      setProgressStep(2);

      const formData = new FormData();
      formData.append("bucket", "source-files");
      formData.append("folder", "enhance");
      formData.append("file", file);

      const uploadResponse = await fetch("/api/storage/upload", {
        method: "POST",
        body: formData,
      });

      if (!uploadResponse.ok) {
        const data = (await uploadResponse.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Upload failed");
      }

      const uploaded = (await uploadResponse.json()) as { storageUrl: string };

      sessionStorage.setItem(
        "taqreer:enhance:upload",
        JSON.stringify({
          fileName: file.name,
          fileSize: file.size,
          storageUrl: uploaded.storageUrl,
          keepColors,
          keepFonts,
          instructions: instructions.trim(),
        })
      );

      router.push("/enhance/review");
    } catch (caughtError) {
      console.error("Enhance upload error:", caughtError);
      setError(
        caughtError instanceof Error
          ? `تعذر حفظ الملف: ${caughtError.message}`
          : "تعذر حفظ الملف. حاول مرة أخرى."
      );
      setLoading(false);
      setProgressStep(null);
    }
  };

  return (
    <section className="space-y-6" dir="rtl">
      <div>
        <h1 className="font-headline-lg text-[36px] font-bold text-white">حسّن عرضك التقديمي</h1>
        <p className="mt-2 text-muted">
          ارفع ملف PowerPoint وسيعيد تقرير تصميمه بالكامل مع الحفاظ على محتواك
        </p>
      </div>

      <div className="glass-card rounded-xl p-6">
        <div className="space-y-4">
          <input
            ref={inputRef}
            type="file"
            accept=".pptx"
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
            // Border width unified to 1px across every upload area
            // in the app (was `border-2` — 2 px read as heavy chrome
            // against the page; 1 px matches the rest of the input
            // border vocabulary).
            className={`flex min-h-[240px] w-full flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center transition-colors ${
              dragging
                ? "border-[var(--tq-violet)] bg-[var(--tq-violet)]/10"
                : "border-[var(--tq-blue)]/60 bg-[var(--tq-bg)]/40 hover:border-[var(--tq-violet)]"
            }`}
          >
            <span className="material-symbols-outlined mb-3 text-[42px] text-[var(--tq-violet)]">upload_file</span>
            <span className="text-lg font-semibold text-white">اسحب ملف PowerPoint هنا أو انقر للاختيار</span>
            <span className="mt-3 text-sm text-muted">PPTX فقط</span>
          </button>

          {file ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[var(--glass-border-opacity)] bg-[var(--tq-bg)]/50 px-4 py-3">
              <div>
                <p className="font-semibold text-white">{file.name}</p>
                <p className="text-sm text-muted">{formatFileSize(file.size)}</p>
              </div>
              <button
                type="button"
                onClick={() => setFile(null)}
                className="badge-purple flex items-center gap-1"
              >
                <span className="text-base leading-none">×</span>
                إزالة
              </button>
            </div>
          ) : null}
        </div>

        <div className="mt-6 rounded-xl border border-white/[var(--glass-border-opacity)]">
          <button
            type="button"
            onClick={() => setAdvancedOpen((current) => !current)}
            className="flex w-full items-center justify-between px-4 py-3 text-right text-white"
          >
            <span className="font-semibold">خيارات متقدمة</span>
            <span className={`material-symbols-outlined text-[20px] text-muted transition-transform ${advancedOpen ? "rotate-180" : ""}`}>
              expand_more
            </span>
          </button>
          <div className={`overflow-hidden transition-all duration-300 ${advancedOpen ? "max-h-96" : "max-h-0"}`}>
            <div className="space-y-4 px-4 pb-4">
              <label className="flex items-center gap-3 text-sm text-white">
                <input
                  type="checkbox"
                  checked={keepColors}
                  onChange={(event) => setKeepColors(event.target.checked)}
                  className="h-4 w-4 accent-[var(--tq-blue)]"
                />
                الحفاظ على الألوان الأصلية
              </label>
              <label className="flex items-center gap-3 text-sm text-white">
                <input
                  type="checkbox"
                  checked={keepFonts}
                  onChange={(event) => setKeepFonts(event.target.checked)}
                  className="h-4 w-4 accent-[var(--tq-blue)]"
                />
                الحفاظ على الخطوط الأصلية
              </label>
              <textarea
                className="input-dark min-h-[104px] resize-y leading-7"
                rows={3}
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                placeholder="أي تعليمات خاصة للتحسين... مثلاً: اجعل التصميم أكثر احترافية"
              />
            </div>
          </div>
        </div>

        {loading && file ? (
          <div className="mt-6 space-y-3 rounded-xl border border-white/[var(--glass-border-opacity)] bg-[var(--tq-bg)]/40 p-4">
            {[
              { step: 1, label: "جارٍ قراءة الملف..." },
              { step: 2, label: "جارٍ تحليل المحتوى..." },
            ].map((item) => (
              <div key={item.step} className="flex items-center gap-3 text-sm text-white">
                {progressStep === item.step ? (
                  <span className="spinner h-4 w-4 rounded-full border-2 border-white/20 border-t-white" />
                ) : (
                  <span className="material-symbols-outlined text-[18px] text-muted">check_circle</span>
                )}
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        ) : null}

        {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={handleNext}
            disabled={loading}
            className="btn-gradient inline-flex items-center gap-2 px-6 py-3 disabled:opacity-60"
          >
            التالي ←
          </button>
        </div>
      </div>
    </section>
  );
}
