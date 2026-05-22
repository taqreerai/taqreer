"use client";

// Step 1 of the "create from template" flow.
//
// Forked from /create/content/page.tsx (2026-05-22, Phase D) so the
// normal 3-step create flow stays untouched. Differences from the
// fork base:
//
//   • Wrapped in CreateFromTemplateShell (2-step stepper + the
//     "from template" pill rendered above the cards column).
//   • Adds a row-3 logo card with SVG-only upload + LogoPositionFields
//     — the template's brand snapshot deliberately omits a logo
//     (see lib/template/derive-brand.ts), so the user supplies one
//     here on every fresh use.
//   • handleNext routes to /create-from-template/summary instead of
//     /create/brand (the brand step is skipped — the template supplies
//     colours + fonts already).
//   • If `taqreer:create:templateSeed` is missing from sessionStorage
//     on mount, redirects to /create/content. Reaching this page
//     without a seed is always an accident (deep link, stale tab) and
//     the normal flow is the right fallback.
//
// Reuses the SAME sessionStorage keys as the normal flow
// (`taqreer:create:content`, `taqreer:create:output`,
// `taqreer:create:brand`) so the summary downstream of either flow
// reads identical shapes — no parallel-key universe to track.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PillButton } from "@/components/create/PillButton";
import {
  CORNER_POSITIONS,
  LanguagePills,
  Toggle,
  type CornerPosition,
  type LanguageCode,
} from "@/components/create/controls";
import { notifyCreateStateChange } from "@/components/create/CreateStepper";
import RosetteDiscountCheckIcon from "@/components/icons/rosette-discount-check-icon";
import {
  CanvasCard,
  LogoPositionFields,
  OutputContentCard,
  SlideSizeFields,
  type SlideSize,
  type SlideCountMode,
  type StoredOutput,
  type PersistentPosition,
} from "@/components/create/OutputCards";
import { CreateFromTemplateShell } from "@/components/create-from-template/CreateFromTemplateShell";
import { readTemplateSeed } from "@/lib/create/seed-from-template";

const CONTENT_KEY = "taqreer:create:content";
const OUTPUT_KEY = "taqreer:create:output";
const BRAND_KEY = "taqreer:create:brand";

type StoredContent = {
  type: "text";
  text: string;
  keepVerbatim?: boolean;
};

type Tab = "file" | "text";

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

export default function CreateFromTemplateContentPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const extractRequestIdRef = useRef(0);

  // Template seed — drives the pill at the top of the shell. Null
  // means we shouldn't be on this page; the effect below redirects.
  const [templateTitle, setTemplateTitle] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("file");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const keepVerbatim = true;

  const [slideSize, setSlideSize] = useState<SlideSize>("16:9");
  const [slideCountMode, setSlideCountMode] = useState<SlideCountMode>("auto");
  const [slideCountValue, setSlideCountValue] = useState<number>(10);
  const [designStyle, setDesignStyle] = useState<string | null>(null);
  const [language, setLanguage] = useState<LanguageCode>("ar");
  const [pagination, setPagination] = useState<boolean>(true);
  const [persistentText, setPersistentText] = useState<string>("");
  const [persistentPosition, setPersistentPosition] =
    useState<PersistentPosition>("bottom-center");
  const [persistentExcludeCover, setPersistentExcludeCover] = useState<boolean>(false);
  const [persistentExcludeClosing, setPersistentExcludeClosing] = useState<boolean>(false);

  // Logo state — exclusive to this flow. The brand-page logo card in
  // /create/brand has the same shape but its state lives there; we
  // don't share. Both write to the same sessionStorage slot
  // (`taqreer:create:brand.logo`) so the summary reads either path.
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string>("");
  const [logoStorageUrl, setLogoStorageUrl] = useState<string | null>(null);
  const [logoName, setLogoName] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoPosition, setLogoPosition] =
    useState<CornerPosition>("top-right");
  const [logoExcludeCover, setLogoExcludeCover] = useState<boolean>(false);
  const [logoExcludeClosing, setLogoExcludeClosing] = useState<boolean>(false);

  const [mounted, setMounted] = useState(false);

  // Hydrate template seed + sessionStorage state. Layout effect so
  // the swap happens BEFORE paint (no flash of empty inputs / default
  // slide size if the user navigated back from summary).
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;

    // Seed check first — if absent, redirect to the normal create
    // flow. This page only makes sense as the second step of "use
    // template" (the lightbox / menu CTAs seed sessionStorage then
    // navigate here).
    const seed = readTemplateSeed();
    if (!seed) {
      router.replace("/create/content");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTemplateTitle(seed.title);

    // Content + output hydrate — same shape as /create/content. Cross-
    // flow compatibility means the user can bounce between the normal
    // flow and the template flow without losing their typed content.
    try {
      const raw = window.sessionStorage.getItem(CONTENT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredContent;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setText(parsed.text ?? "");
        if (parsed.text?.trim()) setTab("text");
      }
    } catch {
      /* corrupt blob — leave defaults */
    }
    try {
      const rawOut = window.sessionStorage.getItem(OUTPUT_KEY);
      if (rawOut) {
        const out = JSON.parse(rawOut) as StoredOutput;
        if (out.slideSize) setSlideSize(out.slideSize);
        if (out.slideCount?.mode === "custom" || out.slideCount?.mode === "auto") {
          setSlideCountMode(out.slideCount.mode);
        }
        if (typeof out.slideCount?.value === "number") {
          setSlideCountValue(out.slideCount.value);
        }
        if (out.rules?.designStyle !== undefined) setDesignStyle(out.rules.designStyle);
        if (out.language === "ar" || out.language === "en") {
          setLanguage(out.language);
        }
        if (typeof out.rules?.pagination === "boolean") setPagination(out.rules.pagination);
        if (out.rules?.persistent?.text) setPersistentText(out.rules.persistent.text);
        if (out.rules?.persistent?.position) {
          setPersistentPosition(out.rules.persistent.position);
        }
        if (typeof out.rules?.persistent?.excludeCover === "boolean") {
          setPersistentExcludeCover(out.rules.persistent.excludeCover);
        }
        if (typeof out.rules?.persistent?.excludeClosing === "boolean") {
          setPersistentExcludeClosing(out.rules.persistent.excludeClosing);
        }
        // Logo position — read with the same reserved-corner check as
        // the brand page: if the persistent text claims a corner, the
        // logo bumps to the next free corner.
        const storedLogoPos = out.logo?.position as CornerPosition | undefined;
        const persistentTrim = out.rules?.persistent?.text?.trim() ?? "";
        const claimed = persistentTrim
          ? (out.rules?.persistent?.position as CornerPosition | undefined) ??
            null
          : null;
        const desired = storedLogoPos ?? "top-right";
        if (claimed && desired === claimed) {
          const fallback =
            CORNER_POSITIONS.find((c) => c !== claimed) ?? "top-right";
          setLogoPosition(fallback);
        } else {
          setLogoPosition(desired);
        }
        if (typeof out.logo?.excludeCover === "boolean") {
          setLogoExcludeCover(out.logo.excludeCover);
        }
        if (typeof out.logo?.excludeClosing === "boolean") {
          setLogoExcludeClosing(out.logo.excludeClosing);
        }
      }
    } catch {
      /* corrupt blob — leave defaults */
    }

    // Logo upload metadata hydrate (from brand blob — same slot the
    // brand page writes to).
    try {
      const rawBrand = window.sessionStorage.getItem(BRAND_KEY);
      if (rawBrand) {
        const brand = JSON.parse(rawBrand) as {
          logo?: {
            name?: string | null;
            storageUrl?: string | null;
            previewDataUrl?: string | null;
          } | null;
        };
        if (brand.logo?.storageUrl || brand.logo?.previewDataUrl) {
          setLogoStorageUrl(brand.logo.storageUrl ?? null);
          setLogoName(brand.logo.name ?? "logo");
          setLogoPreview(brand.logo.previewDataUrl ?? brand.logo.storageUrl ?? "");
        }
      }
    } catch {
      /* corrupt — leave logo empty */
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, [router]);

  // Auto-save the output blob. Diverges from the normal flow here:
  // this page OWNS logo placement (since /create/brand isn't on this
  // flow's path), so we always overwrite the logo slot from local
  // state instead of preserving an existingLogo from sessionStorage.
  useEffect(() => {
    if (!mounted) return;
    if (typeof window === "undefined") return;
    const payload: StoredOutput = {
      slideSize,
      slideCount: {
        mode: slideCountMode,
        value: slideCountMode === "custom" ? slideCountValue : null,
      },
      language,
      logo: {
        position: logoPosition,
        excludeCover: logoExcludeCover,
        excludeClosing: logoExcludeClosing,
      },
      rules: {
        designStyle,
        pagination,
        persistent: persistentText.trim()
          ? {
              text: persistentText.trim(),
              position: persistentPosition,
              excludeCover: persistentExcludeCover,
              excludeClosing: persistentExcludeClosing,
            }
          : null,
      },
    };
    try {
      window.sessionStorage.setItem(OUTPUT_KEY, JSON.stringify(payload));
      notifyCreateStateChange();
    } catch {
      /* quota — best-effort persistence */
    }
  }, [
    mounted,
    slideSize,
    slideCountMode,
    slideCountValue,
    designStyle,
    language,
    pagination,
    persistentText,
    persistentPosition,
    persistentExcludeCover,
    persistentExcludeClosing,
    logoPosition,
    logoExcludeCover,
    logoExcludeClosing,
  ]);

  // Auto-save text drafts.
  useEffect(() => {
    if (!mounted) return;
    if (typeof window === "undefined") return;
    if (!text.trim()) {
      if (window.sessionStorage.getItem(CONTENT_KEY)) {
        window.sessionStorage.removeItem(CONTENT_KEY);
        notifyCreateStateChange();
      }
      return;
    }
    window.sessionStorage.setItem(
      CONTENT_KEY,
      JSON.stringify({ type: "text", text, keepVerbatim }),
    );
    notifyCreateStateChange();
  }, [text, mounted, keepVerbatim]);

  const selectFile = (nextFile?: File) => {
    if (!nextFile) return;
    const requestId = ++extractRequestIdRef.current;
    setText("");
    setFile(nextFile);
    setTab("file");
    setError("");
    void extractFile(nextFile, requestId);
  };

  const extractFile = async (target: File, requestId: number) => {
    setExtracting("loading");
    try {
      const formData = new FormData();
      formData.append("file", target);
      const res = await fetch("/api/content/extract", {
        method: "POST",
        body: formData,
      });
      if (requestId !== extractRequestIdRef.current) return;
      const body = (await res.json().catch(() => null)) as
        | { text?: string; truncated?: boolean; error?: string }
        | null;
      if (!res.ok || !body?.text) {
        throw new Error(body?.error ?? "تعذر قراءة الملف");
      }
      setText(body.text);
      setExtracting("success");
      if (body.truncated) {
        setError("تم اقتطاع جزء من النص بسبب الحجم — راجع المحتوى قبل المتابعة.");
      } else {
        setError("");
      }
    } catch (caughtError) {
      if (requestId !== extractRequestIdRef.current) return;
      console.error("extract failed", caughtError);
      setExtracting("error");
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "تعذر قراءة الملف. حاول مرة أخرى.",
      );
      setFile(null);
      setText("");
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const removeFile = () => {
    extractRequestIdRef.current += 1;
    setFile(null);
    setExtracting("idle");
    setText("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const onTextChange = (next: string) => {
    setText(next);
    if (next.trim().length > 0) setTab("text");
    setError("");
  };

  // Logo pick — validates SVG-only (raster can't be recoloured per
  // slide; same policy as the brand page). Uploads on pick so
  // handleNext stays trivial.
  const handleLogoPick = async (next: File) => {
    const isSvgMime = next.type === "image/svg+xml";
    const isSvgExt = next.name.toLowerCase().endsWith(".svg");
    if (!isSvgMime && !isSvgExt) {
      setLogoError(
        "الشعار يجب أن يكون بصيغة SVG فقط — لضمان جودة الألوان والتباين على كل شريحة.",
      );
      return;
    }
    setLogoError(null);
    setLogoFile(next);
    setLogoName(next.name);
    const objectUrl = URL.createObjectURL(next);
    setLogoPreview(objectUrl);
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
      const asset = (await res.json()) as { storageUrl: string };
      setLogoStorageUrl(asset.storageUrl);

      // Read-modify-write the brand slot so colours + fonts (seeded
      // by the template) survive.
      try {
        const raw = window.sessionStorage.getItem(BRAND_KEY);
        const brand = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        brand.logo = {
          name: next.name,
          storageUrl: asset.storageUrl,
          previewDataUrl: null,
        };
        window.sessionStorage.setItem(BRAND_KEY, JSON.stringify(brand));
        notifyCreateStateChange();
      } catch {
        /* quota — best effort */
      }
    } catch (err) {
      setLogoError(
        err instanceof Error ? err.message : "تعذر رفع الشعار. حاول مرة أخرى.",
      );
      URL.revokeObjectURL(objectUrl);
      setLogoFile(null);
      setLogoName(null);
      setLogoPreview("");
      setLogoStorageUrl(null);
    } finally {
      setLogoUploading(false);
    }
  };

  const handleLogoRemove = () => {
    setLogoFile(null);
    setLogoName(null);
    setLogoStorageUrl(null);
    setLogoPreview("");
    setLogoError(null);
    try {
      const raw = window.sessionStorage.getItem(BRAND_KEY);
      if (!raw) return;
      const brand = JSON.parse(raw) as Record<string, unknown>;
      brand.logo = null;
      window.sessionStorage.setItem(BRAND_KEY, JSON.stringify(brand));
      notifyCreateStateChange();
    } catch {
      /* corrupt — leave */
    }
  };

  const reservedLogoCorners: CornerPosition[] =
    persistentText.trim() && persistentPosition
      ? [persistentPosition as CornerPosition]
      : [];

  const handleNext = async () => {
    setError("");
    if (text.trim().length === 0) {
      setError(
        extracting === "loading"
          ? "جارٍ استخراج النص — انتظر حتى يكتمل."
          : "اختر ملفاً أو أدخل نصاً للمتابعة.",
      );
      return;
    }
    if (logoUploading) {
      setError("جارٍ رفع الشعار — انتظر حتى يكتمل.");
      return;
    }
    setLoading(true);
    try {
      sessionStorage.setItem(
        CONTENT_KEY,
        JSON.stringify({ type: "text", text: text.trim(), keepVerbatim }),
      );
      notifyCreateStateChange();
      router.push("/create-from-template/summary");
    } catch (caughtError) {
      console.error("Create-from-template content save error:", caughtError);
      setError("تعذر حفظ المحتوى. حاول مرة أخرى.");
      setLoading(false);
    }
  };

  const fileActive = tab === "file";

  // Render nothing while we're checking the seed — avoids a flash of
  // the pill with an empty title before the redirect fires.
  if (templateTitle === null) {
    return null;
  }

  // Suppress unused-var warning for logoFile — kept in state so React
  // tracks its identity for the object-URL revoke cleanup that would
  // ship if we ever add a second-pick flow. Today the URL is revoked
  // inline in handleLogoPick's catch.
  void logoFile;

  return (
    <CreateFromTemplateShell
      currentStep="content"
      title="ما هو موضوع عرضك التقديمي؟"
      subtitle="قم بتزويد الذكاء الاصطناعي بالمحتوى الأساسي. ارفع ملفاً أو الصق نصاً وسنقوم نحن بالباقي."
      templateTitle={templateTitle}
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
      {/* Rows 1 + 2 — single grid with the free-text card spanning
          BOTH rows on the visual-left, and the file-upload + logo
          cards stacked on the visual-right.
          DOM order (CSS-Grid auto-flow in RTL): first child → col 1
          (visual-right, row 1) → file upload; second child →
          col 2 (visual-left) with row-span 2 → free text; third
          child → col 1 (visual-right), row 2 → logo card. Same
          column width for upload + logo (the user's "الشعار same
          width as الشريحة" ask). */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* File upload card. Identical to /create/content's. */}
        <div className="glass-card flex flex-col gap-3 rounded-2xl p-5">
          <div
            className={`flex flex-col gap-3 transition-opacity ${
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
              accept=".docx,.pptx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation"
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
              className={`flex min-h-[120px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center transition-colors ${
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
                {extracting === "success" ? (
                  <RosetteDiscountCheckIcon
                    key="extract-success"
                    size={24}
                    color="rgb(52, 211, 153)"
                    strokeWidth={1}
                    playOnMount
                  />
                ) : extracting === "loading" ? (
                  <span className="spinner h-5 w-5 rounded-full border-2 border-white/20 border-t-white" />
                ) : (
                  <span
                    className="material-symbols-outlined text-white/80"
                    style={{ fontSize: "24px" }}
                  >
                    cloud_upload
                  </span>
                )}
              </span>
              <div>
                <p className="text-sm font-semibold text-white">اسحب وأفلت الملفات هنا</p>
                <p className="mt-1 text-xs text-white/60">أو انقر لتصفح جهازك</p>
              </div>
              <p className="text-[10px] text-white/40">ندعم صيغ DOCX و PPTX</p>
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
          </div>

          <div className="border-t border-white/[0.08] pt-3">
            <SlideSizeFields slideSize={slideSize} onSlideSize={setSlideSize} />
          </div>
        </div>

        {/* Free-text card. Identical to /create/content's BUT spans
            both grid rows (lg:row-span-2) so it sits as a tall card
            opposite the file-upload + logo stack on the right
            column. */}
        <div className="glass-card flex flex-col gap-3 rounded-2xl p-5 lg:row-span-2">
          <div
            className={`flex flex-1 flex-col gap-3 transition-opacity ${
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
              dir={language === "en" ? "ltr" : "rtl"}
              className="input-dark min-h-[120px] flex-1 resize-none leading-7"
              placeholder="اكتب أو الصق أفكارك، النقاط الرئيسية، أو المقال الذي تريد تحويله إلى عرض تقديمي هنا..."
              maxLength={5000}
            />
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/40">
                {text.length.toLocaleString("en-US")} / 5000 حرف
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] pt-3">
            <Toggle label="ترقيم الشرائح" value={pagination} onChange={setPagination} />
            <LanguagePills value={language} onChange={setLanguage} />
          </div>
        </div>

        {/* Logo card — third grid child. Auto-places into col 1
            (RTL: visual-right), row 2. The free-text card above has
            row-span-2 so it sits opposite the file-upload + logo
            stack as a single tall card. SVG-only validation + the
            same LogoPositionFields the brand page uses; summary +
            API stitcher need no changes. */}
        <div className="glass-card flex flex-col gap-3 rounded-2xl p-5">
        <header className="flex items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <span
              className="material-symbols-outlined text-white"
              style={{ fontSize: "18px" }}
            >
              image
            </span>
            الشعار (اختياري)
          </h2>
          <span className="text-[10px] text-white/40">SVG فقط</span>
        </header>

        {logoPreview || logoStorageUrl ? (
          <div
            className="flex items-center justify-between gap-3 rounded-xl border p-3"
            style={{
              background: "rgba(255, 255, 255, var(--glass-opacity))",
              borderColor: "rgba(255, 255, 255, var(--glass-border-opacity))",
            }}
          >
            <div className="flex min-w-0 items-center gap-3">
              {logoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoPreview}
                  alt=""
                  className="h-10 w-10 rounded-md bg-white/[0.04] object-contain p-1"
                />
              ) : (
                <span
                  className="material-symbols-outlined h-10 w-10 rounded-md bg-white/[0.04] p-2 text-white/80"
                  style={{ fontSize: 24 }}
                  aria-hidden
                >
                  image
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">
                  {logoName ?? "logo"}
                </p>
                {logoUploading ? (
                  <p className="text-xs text-white/60">جارٍ الرفع…</p>
                ) : logoStorageUrl ? (
                  <p className="text-xs text-emerald-300">تم الرفع</p>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogoRemove}
              disabled={logoUploading}
              aria-label="إزالة الشعار"
              className="flex h-7 w-7 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
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
          <LogoUploadZone onPick={handleLogoPick} />
        )}

        {logoError ? (
          <p className="text-xs text-red-400" role="alert">
            {logoError}
          </p>
        ) : null}

        <LogoPositionFields
          position={logoPosition}
          excludeCover={logoExcludeCover}
          excludeClosing={logoExcludeClosing}
          onPosition={setLogoPosition}
          onExcludeCover={setLogoExcludeCover}
          onExcludeClosing={setLogoExcludeClosing}
          disabled={!logoStorageUrl && !logoPreview}
          reservedPositions={reservedLogoCorners}
        />
        </div>
      </div>

      {/* Row 3 — CanvasCard + OutputContentCard. Same 2-col grid as
          the normal flow's content step; unchanged on purpose so the
          two flows feel structurally familiar after the first row. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CanvasCard
          persistentText={persistentText}
          persistentPosition={persistentPosition}
          persistentExcludeCover={persistentExcludeCover}
          persistentExcludeClosing={persistentExcludeClosing}
          language={language}
          onPersistentText={setPersistentText}
          onPersistentPosition={setPersistentPosition}
          onPersistentExcludeCover={setPersistentExcludeCover}
          onPersistentExcludeClosing={setPersistentExcludeClosing}
        />
        <OutputContentCard
          slideCountMode={slideCountMode}
          slideCountValue={slideCountValue}
          designStyle={designStyle}
          onSlideCountMode={setSlideCountMode}
          onSlideCountValue={setSlideCountValue}
          onDesignStyle={setDesignStyle}
        />
      </div>
    </CreateFromTemplateShell>
  );
}

// ─── LogoUploadZone (template-flow only) ─────────────────────────────
//
// Slim SVG dropzone for the logo card. Mirrors the normal flow's
// brand-page CompactUploadZone visually + behaviourally but inlined
// here so the brand page stays untouched.
function LogoUploadZone({ onPick }: { onPick: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".svg,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.currentTarget.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onPick(f);
        }}
        className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-black/20 p-4 text-center transition-colors ${
          dragging
            ? "border-[var(--tq-violet)]/60 bg-[var(--tq-violet)]/10"
            : "border-white/15 hover:border-white/30"
        }`}
        style={{ minHeight: 100 }}
      >
        <span
          className="flex h-10 w-10 items-center justify-center rounded-full"
          style={{ background: "rgba(255, 255, 255, var(--glass-opacity))" }}
        >
          <span
            className="material-symbols-outlined text-white/80"
            style={{ fontSize: 22 }}
          >
            upload
          </span>
        </span>
        <span className="text-sm font-semibold text-white">ارفع الشعار</span>
        <span className="text-[10px] text-white/40">SVG فقط — للحفاظ على الجودة عند التلوين</span>
      </button>
    </div>
  );
}
