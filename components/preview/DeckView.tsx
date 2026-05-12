"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, type Variants } from "framer-motion";
import { SlideManifestSchema, type SlideManifest } from "@/lib/schema/slide";
import { SlideRenderer } from "@/components/slides/SlideRenderer";
import { PreviewActionBar } from "@/components/slides/PreviewActionBar";
import { createClient } from "@/lib/supabase/client";

type Props = {
  projectId: string;
  projectTitle: string;
  initialProjectStatus: string;
  initialVersionStatus: string | null;
  initialManifest: SlideManifest | null;
  initialSlideCount: number;
};

type DerivedStatus = "generating" | "completed" | "failed";

type ProgressStage = "thinking" | "designing" | "validating" | "saving";
type Progress = {
  stage: ProgressStage;
  currentSlide: number;
  estimatedTotal: number;
};

function isProgress(value: unknown): value is Progress {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.stage === "string" &&
    typeof v.currentSlide === "number" &&
    typeof v.estimatedTotal === "number"
  );
}

function progressCaption(progress: Progress | null): string {
  if (!progress) return "جارٍ تصميم الشريحة...";
  switch (progress.stage) {
    case "thinking":
      return "كلود يفكّر في التصميم...";
    case "designing":
      return progress.currentSlide > 0
        ? `جارٍ تصميم الشريحة ${progress.currentSlide} من ${progress.estimatedTotal}...`
        : "جارٍ تصميم الشرائح...";
    case "validating":
      return "جارٍ التحقق من المخرجات...";
    case "saving":
      return "جارٍ الحفظ...";
    default:
      return "جارٍ تصميم الشريحة...";
  }
}

// Each slide renders at 1/3 of the 1920×1080 canvas → 640×360 cell.
// Placeholder cards use the same dimensions so the cascade fades into the
// exact slots the shimmer just left.
const SLIDE_SCALE = 1 / 3;

function isCompleted(projectStatus: string, versionStatus: string | null): boolean {
  return (
    projectStatus === "completed" ||
    projectStatus === "complete" ||
    versionStatus === "completed"
  );
}

function isFailed(projectStatus: string, versionStatus: string | null): boolean {
  return projectStatus === "failed" || versionStatus === "failed";
}

// Slide grid cascades in first, then the toolbar slides in from screen-left
// like a Photoshop tool palette. Action-bar delay is constant (1s) regardless
// of deck size so big decks don't make users wait — toolbar arrives while the
// final slides are still landing.
const slideListVariants: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.1, delayChildren: 0.2 },
  },
};

// Opacity-only reveal — no motion, slower fade. Each card breathes in
// gently rather than slides up; the wave is purely a brightness ladder.
const slideCardVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.7, ease: "easeOut" },
  },
};

// y: "-50%" keeps the toolbar vertically centered against `top: 50%` — Framer
// owns the transform, so we can't rely on a separate `translateY(-50%)` CSS
// rule (it would be overwritten by the motion x/y animation).
const actionBarVariants: Variants = {
  hidden: { opacity: 0, x: -100, y: "-50%" },
  visible: {
    opacity: 1,
    x: 0,
    y: "-50%",
    transition: { duration: 0.5, ease: "easeOut", delay: 1.0 },
  },
};

export function DeckView({
  projectId,
  projectTitle,
  initialProjectStatus,
  initialVersionStatus,
  initialManifest,
  initialSlideCount,
}: Props) {
  const router = useRouter();
  const [manifest, setManifest] = useState<SlideManifest | null>(initialManifest);
  const [projectStatus, setProjectStatus] = useState(initialProjectStatus);
  const [versionStatus, setVersionStatus] = useState<string | null>(initialVersionStatus);
  const [slideCount, setSlideCount] = useState(initialSlideCount);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");

  const status: DerivedStatus = isFailed(projectStatus, versionStatus)
    ? "failed"
    : manifest && isCompleted(projectStatus, versionStatus)
      ? "completed"
      : "generating";

  // Sync server-driven props into local state when `router.refresh()` runs.
  // Two transitions need handling:
  //  - Generating → Completed: pull the fresh manifest into state so the
  //    derived status flips from "generating" to "completed" and stops the
  //    polling loop.
  //  - Completed → Generating: the user kicked off a regenerate, server now
  //    reports a queued version with no manifest. Clear the cached manifest
  //    so the UI returns to placeholders + spinner.
  useEffect(() => {
    if (initialManifest && !manifest) {
      setManifest(initialManifest);
      setProjectStatus(initialProjectStatus);
      setVersionStatus(initialVersionStatus);
      return;
    }
    if (!isCompleted(initialProjectStatus, initialVersionStatus) && manifest) {
      setManifest(null);
      setProjectStatus(initialProjectStatus);
      setVersionStatus(initialVersionStatus);
    }
  }, [initialManifest, initialProjectStatus, initialVersionStatus, manifest]);

  // Realtime — Inngest writes the version → Supabase emits → we parse + render.
  useEffect(() => {
    if (status !== "generating") return;
    const supabase = createClient();
    const channel = supabase
      .channel(`presentation:${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "presentation_versions" },
        (payload) => {
          const record = payload.new as {
            status?: string;
            slide_json?: unknown;
            slideJson?: unknown;
          } | null;
          if (!record) return;
          if (record.status) setVersionStatus(record.status);
          const slideJson = record.slide_json ?? record.slideJson;
          if (slideJson && typeof slideJson === "object") {
            const slides = (slideJson as { slides?: unknown[] }).slides;
            if (Array.isArray(slides) && slides.length > 0) {
              setSlideCount(slides.length);
            }
            const incomingProgress = (slideJson as { progress?: unknown }).progress;
            if (isProgress(incomingProgress)) {
              setProgress(incomingProgress);
              if (incomingProgress.estimatedTotal > 0) {
                setSlideCount(incomingProgress.estimatedTotal);
              }
            }
            if (record.status === "completed") {
              const parsed = SlideManifestSchema.safeParse(slideJson);
              if (parsed.success) {
                setManifest(parsed.data);
                setProgress(null);
              }
            }
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [projectId, status]);

  // Polling — primary feedback channel for progress while Claude streams.
  // Tighter cadence (1.5 s) so the per-slide progress UI updates close to
  // real time. Also doubles as the completion detector if Realtime is asleep.
  useEffect(() => {
    if (status !== "generating") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/status`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          status: string;
          slideCount: number;
          progress: Progress | null;
        };
        if (data.progress && isProgress(data.progress)) {
          setProgress(data.progress);
          if (data.progress.estimatedTotal > 0) {
            setSlideCount(data.progress.estimatedTotal);
          }
        } else if (data.slideCount > 0) {
          setSlideCount(data.slideCount);
        }
        if (data.status === "failed") {
          setProjectStatus("failed");
          return;
        }
        if (data.status === "completed" || data.status === "complete") {
          router.refresh();
        }
      } catch {
        /* network blip */
      }
    };
    void tick();
    const interval = window.setInterval(tick, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [projectId, status, router]);

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    setRetryError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/retry`, { method: "POST" });
      if (!res.ok) throw new Error("تعذر إعادة المحاولة الآن");
      setProjectStatus("queued");
      setVersionStatus("queued");
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "تعذر إعادة المحاولة الآن");
    } finally {
      setRetrying(false);
    }
  }, [projectId]);

  const placeholders = useMemo(
    () => Array.from({ length: Math.max(slideCount, 1) }),
    [slideCount],
  );

  const fontLinks = useMemo(() => {
    if (!manifest) return [] as string[];
    return [manifest.fonts.heading.url, manifest.fonts.body.url].filter(
      (url, idx, all): url is string =>
        !!url && url.includes("fonts.googleapis.com") && all.indexOf(url) === idx,
    );
  }, [manifest]);

  // ─── Failed ────────────────────────────────────────────────────────────────
  if (status === "failed") {
    return (
      <section dir="rtl" className="page-container">
        <div className="glass-card-danger mx-auto max-w-xl rounded-xl p-8 text-center">
          <span className="material-symbols-outlined mb-4 block text-[42px] text-red-400">
            warning
          </span>
          <h1 className="mb-2 text-[26px] font-bold text-white">تعذر إنشاء العرض</h1>
          <p className="text-muted mb-6">
            {retryError || "حدث خطأ أثناء تصميم الشرائح."}
          </p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={handleRetry}
              disabled={retrying}
              className="btn-gradient inline-flex items-center justify-center gap-2 px-6 py-3 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {retrying ? (
                <span className="spinner h-4 w-4 rounded-full border-2 border-white/20 border-t-white" />
              ) : null}
              حاول مرة أخرى
            </button>
            <Link href="/dashboard" className="btn-outline-dark px-6 py-3 no-underline">
              العودة للرئيسية
            </Link>
          </div>
        </div>
      </section>
    );
  }

  // ─── Generating ────────────────────────────────────────────────────────────
  if (status === "generating") {
    // Card state machine — drives the per-slot UI in the cascade:
    //   done    → green checkmark, card no longer pulses
    //   current → spinner + label, card pulses
    //   pending → empty pulse
    // When stage is validating/saving, all visible slides count as done.
    const cardStatus = (idx: number): "done" | "current" | "pending" => {
      if (!progress) return "pending";
      if (progress.stage === "validating" || progress.stage === "saving") return "done";
      if (progress.currentSlide === 0) return "pending";
      if (idx + 1 < progress.currentSlide) return "done";
      if (idx + 1 === progress.currentSlide) return "current";
      return "pending";
    };

    return (
      <section dir="rtl" className="page-container space-y-6">
        <header className="text-center">
          <h1 className="font-headline-lg text-[36px] font-bold text-white">
            جارٍ تصميم عرضك...
          </h1>
          <p className="text-muted mt-2 text-sm">
            يعمل تقرير على إنشاء شرائحك — سيستغرق ذلك بضع دقائق
          </p>
        </header>

        <div className="grid grid-cols-[repeat(auto-fit,640px)] justify-center gap-5">
          {placeholders.map((_, idx) => {
            const state = cardStatus(idx);
            return (
              <div
                key={idx}
                className={`glass-card relative h-[360px] w-[640px] overflow-hidden rounded-xl ${
                  state === "pending" || state === "current" ? "animate-pulse" : ""
                }`}
                aria-label={`الشريحة ${idx + 1} — ${
                  state === "done" ? "اكتملت" : state === "current" ? "قيد التصميم" : "بانتظار الدور"
                }`}
              >
                <div
                  className={`h-full w-full ${
                    state === "done" ? "bg-emerald-500/5" : "bg-white/5"
                  }`}
                />
                {state === "done" ? (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <span className="material-symbols-outlined text-[80px] text-emerald-400">
                      check_circle
                    </span>
                  </div>
                ) : null}
                {state === "current" ? (
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-white">
                    <span className="spinner h-6 w-6 rounded-full border-2 border-white/20 border-t-white" />
                    <span className="text-sm">جارٍ التصميم...</span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="text-muted flex items-center justify-center gap-3">
          <span className="spinner h-4 w-4 rounded-full border-2 border-white/20 border-t-white" />
          <span>{progressCaption(progress)}</span>
        </div>
      </section>
    );
  }

  // ─── Completed ─────────────────────────────────────────────────────────────
  return (
    <section dir={manifest!.direction} className="page-container space-y-6">
      {fontLinks.map((url) => (
        // eslint-disable-next-line @next/next/no-css-tags
        <link key={url} rel="stylesheet" href={url} />
      ))}

      <header className="text-center">
        <p className="text-muted text-xs tracking-widest">
          {manifest!.slides.length} SLIDES
        </p>
        <h1 className="mt-2 text-3xl font-bold text-white">{manifest!.title}</h1>
      </header>

      {/* Fixed vertical toolbar — slides in from the left after the cascade */}
      <motion.div
        variants={actionBarVariants}
        initial="hidden"
        animate="visible"
        className="fixed z-30"
        style={{ left: "16px", top: "50%" }}
      >
        <PreviewActionBar projectId={projectId} projectTitle={projectTitle} />
      </motion.div>

      <motion.div
        variants={slideListVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-[repeat(auto-fit,640px)] justify-center gap-5"
      >
        {manifest!.slides.map((slide) => (
          <motion.div
            key={slide.slideId}
            variants={slideCardVariants}
            className="glass-card h-[360px] w-[640px] overflow-hidden rounded-xl"
          >
            <SlideRenderer slide={slide} scale={SLIDE_SCALE} />
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
