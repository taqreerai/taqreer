"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type ContentState = {
  type: "file" | "text";
  fileName?: string;
  fileSize?: number;
  storageUrl?: string;
  text?: string;
  keepVerbatim?: boolean;
};

// The brand step now stores everything we need for /api/projects, including
// the generation rules. This page just lets the user verify the content,
// edit it inline, and submit.
type StoredBrand = Record<string, unknown> | null;

function formatFileSize(size?: number) {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} ك.ب`;
  return `${(size / (1024 * 1024)).toFixed(1)} م.ب`;
}

// Some file pickers hand back URL-percent-encoded names. Decode for display.
function readableFileName(raw: string | undefined): string {
  if (!raw) return "";
  if (!/%[0-9A-Fa-f]{2}/.test(raw)) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default function CreateSummaryPage() {
  const router = useRouter();
  const [content, setContent] = useState<ContentState | null>(null);
  const [brand, setBrand] = useState<StoredBrand>(null);
  const [editingContent, setEditingContent] = useState(false);
  const [contentDraft, setContentDraft] = useState("");
  const [loadingMode, setLoadingMode] = useState<"create" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const rawContent = sessionStorage.getItem("taqreer:create:content");
    const rawBrand = sessionStorage.getItem("taqreer:create:brand");

    if (!rawContent || !rawBrand) {
      router.replace("/create/content");
      return;
    }

    setContent(JSON.parse(rawContent) as ContentState);
    setBrand(JSON.parse(rawBrand) as StoredBrand);
  }, [router]);

  const startEditContent = () => {
    setContentDraft(content?.text ?? "");
    setEditingContent(true);
  };

  const saveEditContent = () => {
    if (!content) return;
    const next: ContentState = { ...content, text: contentDraft };
    setContent(next);
    sessionStorage.setItem("taqreer:create:content", JSON.stringify(next));
    setEditingContent(false);
  };

  const cancelEditContent = () => {
    setEditingContent(false);
    setContentDraft("");
  };

  // Mirror the brand step's slide-count interpretation for display.
  const slideCount = (brand?.slideCount ?? null) as { mode?: string; value?: number | null } | null;
  const displaySlideCount =
    slideCount?.mode === "custom" && slideCount?.value
      ? String(slideCount.value)
      : slideCount?.mode === "match"
        ? "يطابق الملف"
        : "تلقائي";
  const resolvedSlideCount =
    slideCount?.mode === "custom" && slideCount?.value ? slideCount.value : null;

  // Brand step stores rules inside the brand blob — extract for the API.
  const rules = (brand?.rules ?? null) as Record<string, unknown> | null;

  // Single "generate" path — brand-kit saving moved to the brand page's
  // "save as brand" button (POST /api/brand-kits). This page only kicks
  // off the project generation; saveBrandKit is always false here.
  const handleGenerate = async () => {
    if (!content || !brand) return;
    setError("");
    setLoadingMode("create");

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          brand,
          rules,
          saveBrandKit: false,
          slideCount: resolvedSlideCount,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "تعذر إنشاء المشروع");
      }

      const data = (await response.json()) as { projectId: string };
      // The create-flow is now done — clear sessionStorage so the next
      // "create new" starts fresh. Otherwise stale brand/content data
      // would block the /create/brand auto-load of the saved BrandKit.
      sessionStorage.removeItem("taqreer:create:content");
      sessionStorage.removeItem("taqreer:create:brand");
      sessionStorage.removeItem("taqreer:create:brand:savedSnapshot");
      router.push(`/preview/${data.projectId}`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "تعذر بدء الإنشاء. حاول مرة أخرى.");
      setLoadingMode(null);
    }
  };

  return (
    <section dir="rtl" className="space-y-6">
      <div>
        <h1 className="font-headline-lg text-[36px] font-bold text-white">راجع محتواك</h1>
        <p className="mt-2 text-[#9A94A8]">
          هذه هي آخر مراجعة قبل بدء التصميم — عدّل النص إن احتجت، أو ارجع لتغيير الألوان والخطوط.
        </p>
      </div>

      <div className="glass-card rounded-xl p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-[22px] font-bold text-white">محتوى العرض</h2>
          <div className="flex items-center gap-2">
            {/* Edit + Generate share the same shape: h-9, px-4, text-sm,
                gap-1.5, material-symbol at text-[16px]. Edit uses a glass
                outline; Generate carries the mesh-gradient CTA treatment. */}
            {content?.type === "text" && !editingContent ? (
              <button
                type="button"
                onClick={startEditContent}
                aria-label="تعديل المحتوى"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[rgba(42,36,59,0.8)] bg-[#03030D]/40 px-4 text-sm text-white transition-colors hover:bg-white/5"
              >
                <span className="material-symbols-outlined text-[16px]">edit</span>
                تعديل
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleGenerate}
              disabled={loadingMode !== null}
              className="btn-gradient-anim inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-semibold disabled:opacity-60"
            >
              {loadingMode === "create" ? (
                <span className="spinner h-4 w-4 rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <span className="material-symbols-outlined text-[16px]">
                  auto_awesome
                </span>
              )}
              {loadingMode === "create" ? "جارٍ الإنشاء..." : "إنشاء"}
            </button>
          </div>
        </div>

        <div className="mb-5 space-y-3">
          {content?.type === "file" ? (
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-[#7D2DFF]">description</span>
              <div>
                <p className="font-semibold text-white">{readableFileName(content.fileName)}</p>
                <p className="text-sm text-muted">{formatFileSize(content.fileSize)}</p>
              </div>
            </div>
          ) : editingContent ? (
            <>
              <textarea
                value={contentDraft}
                onChange={(event) => setContentDraft(event.target.value)}
                rows={14}
                className="input-dark w-full resize-y leading-7"
                dir="rtl"
                placeholder="اكتب أو الصق محتوى عرضك هنا..."
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={saveEditContent}
                  className="btn-gradient inline-flex items-center gap-1 px-4 py-2 text-sm"
                >
                  <span className="material-symbols-outlined text-base">check</span>
                  حفظ
                </button>
                <button
                  type="button"
                  onClick={cancelEditContent}
                  className="btn-outline-dark px-4 py-2 text-sm"
                >
                  إلغاء
                </button>
              </div>
            </>
          ) : (
            <div className="max-h-[480px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-[rgba(42,36,59,0.8)] bg-[#03030D]/30 p-4 text-sm leading-7 text-white">
              {content?.text || <span className="text-muted">لا يوجد محتوى</span>}
            </div>
          )}
        </div>

        <p className="text-sm text-muted">عدد الشرائح: {displaySlideCount}</p>
      </div>

      <div>
        <button
          className="btn-outline-dark inline-flex items-center justify-center gap-2 px-6 py-3"
          onClick={() => router.push("/create/brand")}
        >
          → رجوع لتعديل الهوية البصرية
        </button>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </section>
  );
}
