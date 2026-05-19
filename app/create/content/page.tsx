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
import RosetteDiscountCheckIcon from "@/components/icons/rosette-discount-check-icon";
import {
  CanvasCard,
  OutputContentCard,
  SlideSizeFields,
  type SlideSize,
  type SlideCountMode,
  type StoredOutput,
  type PersistentPosition,
} from "@/components/create/OutputCards";

// sessionStorage key for the content blob. Same key used by the
// stepper to detect "step 1 done" + by the brand page's navigation
// guard. Hoisted to a constant so auto-save / hydrate / handleNext
// all reference the same value.
const CONTENT_KEY = "taqreer:create:content";
// Output-settings blob — auto-saved from the bottom-row cards (slide
// size + count + rules + persistent overlay). Same key the summary
// page reads, same key the brand page writes logo placement into.
const OUTPUT_KEY = "taqreer:create:output";

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
  // Monotonic request id for file extraction. Bumped on every new
  // selection and on file removal so a slow earlier extract can't
  // overwrite text/state set by a later pick. The async extractFile
  // captures the id at call-time and bails if `current` has moved on.
  const extractRequestIdRef = useRef(0);
  const [tab, setTab] = useState<Tab>("file");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // File → text extraction state. The file picker fires the extract
  // call immediately on select; on success the extracted text drops
  // into the free-text textarea and we never upload the binary —
  // submission downstream is always `{ type: "text", text }`. That
  // keeps the token bill predictable (PDF document blocks would
  // multiply per-page tokens) and skips the storage round-trip.
  const [extracting, setExtracting] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  // Verbatim by default — we removed the "نظّم وأعد صياغة المحتوى"
  // toggle from the free-text card on 2026-05-19 (replaced by the
  // generation-rule toggles) so there's no UI to flip this. If the
  // rephrase mode comes back, surface it as another row-1 toggle.
  const keepVerbatim = true;

  // Output settings — moved here from the removed `/create/output`
  // step (2026-05-19). Stored under `taqreer:create:output` so the
  // summary page + the API stitcher keep their existing readers.
  // Logo placement (the third group from the old output page) now
  // lives on the brand page's logo card.
  const [slideSize, setSlideSize] = useState<SlideSize>("16:9");
  const [slideCountMode, setSlideCountMode] = useState<SlideCountMode>("auto");
  const [slideCountValue, setSlideCountValue] = useState<number>(10);
  const [designStyle, setDesignStyle] = useState<string | null>(null);
  const [fixTypos, setFixTypos] = useState<boolean>(false);
  const [pagination, setPagination] = useState<boolean>(true);
  const [persistentText, setPersistentText] = useState<string>("");
  const [persistentPosition, setPersistentPosition] =
    useState<PersistentPosition>("bottom-center");
  const [persistentExcludeCover, setPersistentExcludeCover] = useState<boolean>(false);
  const [persistentExcludeClosing, setPersistentExcludeClosing] = useState<boolean>(false);

  // Hydration guard — `mounted=true` AFTER the useLayoutEffect that
  // restores state. Until then we suppress the auto-save effect so
  // an initial default-value render doesn't blow away the saved
  // blob between Render 1 and Render 2.
  const [mounted, setMounted] = useState(false);

  // Hydrate from sessionStorage post-render but BEFORE paint, so
  // the user never sees an empty textarea flash if they're coming
  // back to the page with content in storage. Both the content blob
  // and the output blob hydrate here; output-card state defaults
  // match the server render so the swap is paint-free.
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(CONTENT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredContent;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setText(parsed.text ?? "");
        if (parsed.text?.trim()) setTab("text");
        // `keepVerbatim` is now hardcoded — the rephrase toggle was
        // removed on 2026-05-19. Stored value is ignored.
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
        if (typeof out.rules?.fixTypos === "boolean") setFixTypos(out.rules.fixTypos);
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
      }
    } catch {
      /* corrupt blob — leave defaults */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // Auto-save the output blob whenever any of its fields change.
  // Reads the existing blob first so we PRESERVE `logo.*` fields
  // (logo position lives in the same blob and is written from the
  // brand page; this page never sets it).
  useEffect(() => {
    if (!mounted) return;
    if (typeof window === "undefined") return;
    let existingLogo: StoredOutput["logo"] | undefined;
    try {
      const prev = window.sessionStorage.getItem(OUTPUT_KEY);
      if (prev) existingLogo = (JSON.parse(prev) as StoredOutput).logo;
    } catch {
      /* corrupt — fall through with no logo carry-over */
    }
    const payload: StoredOutput = {
      slideSize,
      slideCount: {
        mode: slideCountMode,
        value: slideCountMode === "custom" ? slideCountValue : null,
      },
      logo: existingLogo,
      rules: {
        designStyle,
        fixTypos,
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
    fixTypos,
    pagination,
    persistentText,
    persistentPosition,
    persistentExcludeCover,
    persistentExcludeClosing,
  ]);

  // Auto-save text drafts as the user types. Skips when not yet
  // mounted (avoid clobbering during hydration) and when typing into
  // an empty textarea (don't overwrite an existing file blob with an
  // empty text blob — leaves the saved file in place until the user
  // actually starts typing).
  useEffect(() => {
    if (!mounted) return;
    if (typeof window === "undefined") return;
    if (!text.trim()) {
      // Empty textarea → drop the stored blob so re-entering the
      // page lands on the default empty state instead of restoring
      // stale text.
      if (window.sessionStorage.getItem(CONTENT_KEY)) {
        window.sessionStorage.removeItem(CONTENT_KEY);
        notifyCreateStateChange();
      }
      return;
    }
    window.sessionStorage.setItem(
      CONTENT_KEY,
      JSON.stringify({
        type: "text",
        text,
        keepVerbatim,
      }),
    );
    notifyCreateStateChange();
  }, [text, mounted, keepVerbatim]);

  const selectFile = (nextFile?: File) => {
    if (!nextFile) return;
    // New pick supersedes whatever extraction was in flight + any
    // text from the previous file. Without this clear, a slow
    // earlier extract can finish AFTER the new pick and overwrite
    // its text, OR (if the new pick fails) we'd leave stale text
    // in the textarea and let the user proceed with content that
    // doesn't match their current file.
    const requestId = ++extractRequestIdRef.current;
    setText("");
    setFile(nextFile);
    setTab("file");
    setError("");
    void extractFile(nextFile, requestId);
  };

  // Posts the file to the extract route, drops the returned text
  // into the free-text textarea on success. Failure rolls the file
  // chip back so the user knows the file wasn't accepted.
  const extractFile = async (target: File, requestId: number) => {
    setExtracting("loading");
    try {
      const formData = new FormData();
      formData.append("file", target);
      const res = await fetch("/api/content/extract", {
        method: "POST",
        body: formData,
      });
      // Drop the response on the floor if a newer pick (or a removal)
      // has bumped the counter while this fetch was in flight.
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
        // Surface the truncation as a soft warning — text is still
        // valid for submission, just clipped to the 30k-char cap.
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
      // Also clear `text` from any prior successful extract — handleNext
      // gates Continue on `text.trim().length > 0`, so leaving stale
      // text in place would let the user proceed with content from an
      // earlier file even though their CURRENT pick failed.
      setText("");
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const removeFile = () => {
    // Bump the counter so any in-flight extract for the now-removed
    // file becomes a no-op when it resolves.
    extractRequestIdRef.current += 1;
    setFile(null);
    setExtracting("idle");
    setText("");
    // Reset the native input so re-selecting the SAME file fires onChange
    // again. Without this, the input's `value` still points at the removed
    // file and the browser de-dupes — the user clicks "select" again,
    // picks the same file, and nothing happens.
    if (inputRef.current) inputRef.current.value = "";
  };

  const onTextChange = (next: string) => {
    setText(next);
    if (next.trim().length > 0) setTab("text");
    setError("");
  };

  const handleNext = async () => {
    setError("");
    // Extraction happens at file-pick time and writes into `text`;
    // any other path also writes there. So Continue only needs a
    // non-empty `text`. The `file` chip is purely cosmetic post-
    // extraction — submission is always text.
    if (text.trim().length === 0) {
      setError(
        extracting === "loading"
          ? "جارٍ استخراج النص — انتظر حتى يكتمل."
          : "اختر ملفاً أو أدخل نصاً للمتابعة.",
      );
      return;
    }
    setLoading(true);
    try {
      sessionStorage.setItem(
        CONTENT_KEY,
        JSON.stringify({
          type: "text",
          text: text.trim(),
          keepVerbatim,
        }),
      );
      notifyCreateStateChange();
      router.push("/create/brand");
    } catch (caughtError) {
      console.error("Create content save error:", caughtError);
      setError("تعذر حفظ المحتوى. حاول مرة أخرى.");
      setLoading(false);
    }
  };

  // Active card glows; the other dims to half opacity. Picking up
  // interaction (drop a file / type) sets the active card.
  const fileActive = tab === "file";

  return (
    <CreateShell
      currentStep="content"
      title="ما هو موضوع عرضك التقديمي؟"
      subtitle="قم بتزويد الذكاء الاصطناعي بالمحتوى الأساسي. ارفع ملفاً أو الصق نصاً وسنقوم نحن بالباقي."
      bottomBar={
        <div className="flex items-center justify-end">
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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
            className={`flex min-h-[120px] w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 text-center transition-colors ${
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
                // Animated rosette plays its in-animation once on mount
                // (state-driven, not hover). Tabler stroke-width=1
                // matches the rest of our outline-icon vocabulary.
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

          {/* Slide size lives here on row 1 — moved 2026-05-19 from
              row 2's CanvasCard so step 1's total height matches
              step 2's. CanvasCard now only carries the persistent
              overlay. */}
          <div className="border-t border-white/[0.08] pt-3">
            <SlideSizeFields slideSize={slideSize} onSlideSize={setSlideSize} />
          </div>
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
            className="input-dark min-h-[120px] flex-1 resize-none leading-7"
            placeholder="اكتب أو الصق أفكارك، النقاط الرئيسية، أو المقال الذي تريد تحويله إلى عرض تقديمي هنا..."
            maxLength={5000}
          />
          <div className="flex items-center justify-between text-xs">
            <span className="text-white/40">
              {text.length.toLocaleString("en-US")} / 5000 حرف
            </span>
          </div>
          {/* Generation-rule toggles live HERE on row 1's free-text
              card (since 2026-05-19). They used to be on row 2's
              المحتوى card; moving them up balances row 1's height
              with the file-upload card on the left and lets row 2
              drop a bit. Two-column flex so both toggles fit on a
              single line without wrapping at default breakpoints. */}
          <div className="grid grid-cols-2 gap-3 border-t border-white/[0.08] pt-3">
            <Toggle label="تصحيح الأخطاء" value={fixTypos} onChange={setFixTypos} />
            <Toggle label="ترقيم الشرائح" value={pagination} onChange={setPagination} />
          </div>
        </div>
      </div>

      {/* Row 2 — output-settings cards. Absorbed the deleted
          `/create/output` step (2026-05-19). `flex-1` makes this
          row absorb the min-h slack so the page naturally fills
          810 px (matching step 2). Cards inside grid-stretch to
          row height — no `mt-auto` on the button bar means the
          gap between row 2 and buttons is the standard `gap-4`,
          identical to step 2's row→button spacing. */}
      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        <CanvasCard
          persistentText={persistentText}
          persistentPosition={persistentPosition}
          persistentExcludeCover={persistentExcludeCover}
          persistentExcludeClosing={persistentExcludeClosing}
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

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </CreateShell>
  );
}
