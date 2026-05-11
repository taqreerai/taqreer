"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Tab = "file" | "text";

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} ك.ب`;
  return `${(size / (1024 * 1024)).toFixed(1)} م.ب`;
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

  const selectFile = (nextFile?: File) => {
    if (!nextFile) return;
    setFile(nextFile);
    setError("");
  };

  const handleNext = async () => {
    setError("");
    const hasFile = tab === "file" && file;
    const hasText = tab === "text" && text.trim().length > 0;

    if (!hasFile && !hasText) {
      setError(tab === "file" ? "اختر ملفاً للمتابعة." : "أدخل نصاً للمتابعة.");
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
          const data = (await uploadResponse.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? "Upload failed");
        }

        const uploaded = (await uploadResponse.json()) as { storageUrl: string };

        sessionStorage.setItem(
          "taqreer:create:content",
          JSON.stringify({
            type: "file",
            fileName: file.name,
            fileSize: file.size,
            storageUrl: uploaded.storageUrl,
          })
        );
      } else {
        sessionStorage.setItem(
          "taqreer:create:content",
          JSON.stringify({ type: "text", text: text.trim() })
        );
      }

      router.push("/create/brand");
    } catch (caughtError) {
      console.error("Create content upload error:", caughtError);
      setError(
        caughtError instanceof Error
          ? `تعذر حفظ المحتوى: ${caughtError.message}`
          : "تعذر حفظ المحتوى. حاول مرة أخرى."
      );
      setLoading(false);
      setProgressStep(null);
    }
  };

  return (
    <section className="space-y-6" dir="rtl">
      <div>
        <h1 className="font-headline-lg text-[36px] font-bold text-white">أدخل محتواك</h1>
        <p className="mt-2 text-[#9A94A8]">
          ارفع ملفاً أو الصق النص الذي تريد تحويله إلى عرض تقديمي
        </p>
      </div>

      <div className="glass-card rounded-xl p-6">
        <div className="mb-6 inline-flex rounded-xl border border-[rgba(42,36,59,0.8)] p-1">
          {[
            { value: "file", label: "رفع ملف" },
            { value: "text", label: "نص مباشر" },
          ].map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                setTab(item.value as Tab);
                setError("");
              }}
              className={`rounded-lg px-5 py-2 text-sm font-semibold transition-colors ${
                tab === item.value ? "bg-[#370BF4] text-white" : "text-[#9A94A8] hover:text-white"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === "file" ? (
          <div className="space-y-4">
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
              className={`flex min-h-[240px] w-full flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
                dragging
                  ? "border-[#7D2DFF] bg-[#7D2DFF]/10"
                  : "border-[#370BF4]/60 bg-[#03030D]/40 hover:border-[#7D2DFF]"
              }`}
            >
              <span className="material-symbols-outlined mb-3 text-[42px] text-[#7D2DFF]">upload_file</span>
              <span className="text-lg font-semibold text-white">اسحب ملفك هنا أو انقر للاختيار</span>
              <span className="mt-3 text-sm text-[#9A94A8]">PPTX · PDF · DOCX · TXT · صور</span>
            </button>

            {file ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[rgba(42,36,59,0.8)] bg-[#03030D]/50 px-4 py-3">
                <div>
                  <p className="font-semibold text-white">{file.name}</p>
                  <p className="text-sm text-[#9A94A8]">{formatFileSize(file.size)}</p>
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
        ) : (
          <div className="space-y-2">
            <textarea
              className="input-dark min-h-[240px] resize-y leading-8"
              rows={8}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setError("");
              }}
              placeholder="الصق محتواك هنا — مقالة، تقرير، ملاحظات، أي شيء..."
            />
            <p className="text-left text-sm text-[#9A94A8]">{text.length.toLocaleString("ar-SA")} حرف</p>
          </div>
        )}

        {loading && file ? (
          <div className="mt-6 space-y-3 rounded-xl border border-[rgba(42,36,59,0.8)] bg-[#03030D]/40 p-4">
            {[
              { step: 1, label: "جارٍ قراءة المحتوى..." },
              { step: 2, label: "جارٍ تحليل الهيكل..." },
            ].map((item) => (
              <div key={item.step} className="flex items-center gap-3 text-sm text-white">
                {progressStep === item.step ? (
                  <span className="spinner h-4 w-4 rounded-full border-2 border-white/20 border-t-white" />
                ) : (
                  <span className="material-symbols-outlined text-[18px] text-[#9A94A8]">check_circle</span>
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
            className="btn-gradient inline-flex items-center gap-2 px-6 py-3 disabled:cursor-not-allowed disabled:opacity-60"
          >
            التالي
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          </button>
        </div>
      </div>
    </section>
  );
}
