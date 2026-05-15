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
  presentationId: string | null;
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

// Cosmetic rotating captions for the generating screen. They rotate
// independently of the real per-slide progress (which now lives on the
// current placeholder card), giving the user a sense of momentum even when
// Claude pauses between slides.
const FAKE_FEEDBACK = [
  "إعداد نظام الألوان...",
  "البحث في تصاميم التخطيط...",
  "تحسين بنية العرض...",
  "تنسيق المحتوى مع الهوية البصرية...",
  "اختيار الخطوط المناسبة...",
  "ضبط التباين والحدود...",
  "ترتيب العناصر على الشبكة...",
  "تجهيز الشرائح...",
];

// Map the streaming progress to a 0..100 % bar. Thinking gets a small head
// start so the bar never sits at 0 while Claude warms up. Designing fills the
// long middle (5–90 %). Validating/saving cover the tail.
function progressPercent(progress: Progress | null): number {
  if (!progress) return 5;
  switch (progress.stage) {
    case "thinking":
      return 5;
    case "designing": {
      if (progress.estimatedTotal <= 0) return 10;
      const ratio = Math.min(progress.currentSlide / progress.estimatedTotal, 1);
      return Math.round(5 + ratio * 85);
    }
    case "validating":
      return 92;
    case "saving":
      return 98;
    default:
      return 5;
  }
}

// Slides render at 0.3× of the 1920×1080 canvas → 576×324 cell. Sized so
// two cells fit side-by-side inside the dashboard's max-w-[1280px] wrap
// (with px-8 padding and a 20 px gap). Placeholder cards reuse the same
// dimensions so the cascade fades into the exact slots the shimmer just
// left.
const SLIDE_SCALE = 0.3;
const SLIDE_CELL_W = 576;
const SLIDE_CELL_H = 324;

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
  presentationId,
  initialProjectStatus,
  initialVersionStatus,
  initialManifest,
  initialSlideCount,
}: Props) {
  const router = useRouter();
  // Initial state seeds from server props. The parent (re)keys this component
  // on status transitions, so a remount reseeds — no in-effect prop sync.
  const [manifest, setManifest] = useState<SlideManifest | null>(initialManifest);
  const [projectStatus] = useState(initialProjectStatus);
  const [versionStatus, setVersionStatus] = useState<string | null>(initialVersionStatus);
  const [slideCount, setSlideCount] = useState(initialSlideCount);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  // Polling sets this when it sees a failed status arrive after mount.
  const [polledFailure, setPolledFailure] = useState(false);
  // Rotating fake-feedback caption shown under the page title while
  // generating. `fakeIdx` advances on a 2.5 s timer; `fakeVisible` drives a
  // 300 ms opacity crossfade between messages.
  const [fakeIdx, setFakeIdx] = useState(0);
  const [fakeVisible, setFakeVisible] = useState(true);

  // Stuck-detection state. We track when the generating state started and when
  // progress.currentSlide last advanced. Two thresholds:
  //   - SLOW (6 min total)              → soft "taking longer than usual" hint
  //   - STUCK (12 min total OR 3 min    → action banner with a retry button
  //     since slide last advanced)
  // `nowTick` increments every 10 s so the derived elapsed / stale times
  // recompute even when the polling effect doesn't fire (e.g. progress stops
  // changing). All times are wall-clock ms — `useState(() => Date.now())` so
  // the initial value isn't `Date.now()` on every re-render.
  const [genStartedAt, setGenStartedAt] = useState<number | null>(null);
  const [lastProgressAt, setLastProgressAt] = useState<number | null>(null);
  const [lastSlideSeen, setLastSlideSeen] = useState(0);
  const [lastStageSeen, setLastStageSeen] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const status: DerivedStatus = polledFailure || isFailed(projectStatus, versionStatus)
    ? "failed"
    : manifest && isCompleted(projectStatus, versionStatus)
      ? "completed"
      : "generating";

  // Realtime — Inngest writes the version → Supabase emits → we parse + render.
  // Scoped to this presentation via a server-side filter so other projects'
  // updates can't overwrite our local state.
  useEffect(() => {
    if (status !== "generating") return;
    if (!presentationId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`presentation:${presentationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "presentation_versions",
          filter: `presentation_id=eq.${presentationId}`,
        },
        (payload) => {
          const record = payload.new as {
            presentation_id?: string;
            presentationId?: string;
            status?: string;
            slide_json?: unknown;
            slideJson?: unknown;
          } | null;
          if (!record) return;
          // Defense-in-depth: if the row isn't ours, ignore even if the
          // server-side filter is misconfigured.
          const rowPresentationId = record.presentation_id ?? record.presentationId;
          if (rowPresentationId && rowPresentationId !== presentationId) return;
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
  }, [presentationId, status]);

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
          setPolledFailure(true);
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

  // Drive the rotating fake-feedback caption while generating. Each cycle
  // fades the current message out (300 ms), swaps the index, and fades the
  // next one in.
  useEffect(() => {
    if (status !== "generating") return;
    const id = window.setInterval(() => {
      setFakeVisible(false);
      window.setTimeout(() => {
        setFakeIdx((current) => (current + 1) % FAKE_FEEDBACK.length);
        setFakeVisible(true);
      }, 300);
    }, 2500);
    return () => window.clearInterval(id);
  }, [status]);

  // Start the generation clock when we first enter `generating`. Don't reset
  // on subsequent renders — only on the transition INTO generating.
  // setState-in-effect is intentional: we're deriving a client-only wall-clock
  // timestamp that can't be computed during render (would re-run each render)
  // or SSR (no Date.now() parity with the client).
  useEffect(() => {
    if (status !== "generating") return;
    if (genStartedAt !== null) return;
    const now = Date.now();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGenStartedAt(now);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLastProgressAt(now);
  }, [status, genStartedAt]);

  // Advance lastProgressAt whenever the streamed slide number ticks up OR
  // the pipeline stage changes (e.g. `content` → `validating` → `saving`).
  // Without the stage check, the validating/saving phases — which can take
  // 30–60s with no slide-number movement — falsely trip STUCK_STALE_MS.
  // Same setState-in-effect reasoning: wall-clock derived from streamed prop.
  useEffect(() => {
    if (status !== "generating") return;
    const slide = progress?.currentSlide ?? 0;
    const stage = progress?.stage ?? null;
    const slideAdvanced = slide > lastSlideSeen;
    const stageChanged = stage !== null && stage !== lastStageSeen;
    if (slideAdvanced || stageChanged) {
      if (slideAdvanced) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLastSlideSeen(slide);
      }
      if (stageChanged) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLastStageSeen(stage);
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLastProgressAt(Date.now());
    }
  }, [progress, status, lastSlideSeen, lastStageSeen]);

  // Re-render every 10 s so the elapsed / stale times stay current even when
  // no other state changes (i.e. when the generation actually IS stuck and
  // polling brings back identical progress responses).
  useEffect(() => {
    if (status !== "generating") return;
    const id = window.setInterval(() => setNowTick(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, [status]);

  // Stuck thresholds. SLOW just nudges copy; STUCK surfaces a retry CTA.
  const SLOW_WARN_MS = 6 * 60 * 1000;
  const STUCK_TOTAL_MS = 12 * 60 * 1000;
  const STUCK_STALE_MS = 3 * 60 * 1000;
  const elapsedMs = genStartedAt ? nowTick - genStartedAt : 0;
  const staleMs = lastProgressAt ? nowTick - lastProgressAt : 0;
  const isStuck =
    status === "generating" &&
    !!genStartedAt &&
    (elapsedMs > STUCK_TOTAL_MS || staleMs > STUCK_STALE_MS);
  const isSlow =
    status === "generating" &&
    !!genStartedAt &&
    !isStuck &&
    elapsedMs > SLOW_WARN_MS;

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    setRetryError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/retry`, { method: "POST" });
      if (!res.ok) throw new Error("تعذر إعادة المحاولة الآن");
      // Let the server re-render the parent with the queued status; parent
      // keys DeckView so this component remounts back into "generating".
      router.refresh();
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "تعذر إعادة المحاولة الآن");
    } finally {
      setRetrying(false);
    }
  }, [projectId, router]);

  const placeholders = useMemo(
    () => Array.from({ length: Math.max(slideCount, 1) }),
    [slideCount],
  );

  const fontLinks = useMemo(() => {
    if (!manifest) return [] as string[];
    // Schema validates the host allowlist (lib/schema/slide.ts —
    // ALLOWED_FONT_HOSTS), so any URL we see here has already passed that
    // check. Just dedupe and emit; matches html-document.ts's behaviour for
    // preview ↔ exported-HTML parity.
    return [manifest.theme.fontHeading.url, manifest.theme.fontBody.url].filter(
      (url, idx, all): url is string =>
        typeof url === "string" && all.indexOf(url) === idx,
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

    const percent = progressPercent(progress);
    const total = placeholders.length;
    return (
      <section dir="rtl" className="page-container space-y-6">
        <header className="text-center">
          <h1 className="font-headline-lg text-[36px] font-bold text-white">
            جارٍ تصميم عرضك...
          </h1>
          <div className="text-muted mt-3 flex items-center justify-center gap-3 text-sm">
            <span className="spinner h-4 w-4 rounded-full border-2 border-white/20 border-t-white" />
            <span
              className={`transition-opacity duration-300 ${fakeVisible ? "opacity-100" : "opacity-0"}`}
            >
              {FAKE_FEEDBACK[fakeIdx]}
            </span>
          </div>
          <div className="mx-auto mt-4 max-w-md">
            <div className="progress-track" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
              <div className="progress-bar" style={{ width: `${percent}%` }} />
            </div>
            <p className="text-muted mt-2 text-xs">{percent}%</p>
          </div>

          {isSlow && (
            <p className="text-muted mt-4 text-xs">
              يستغرق هذا وقتًا أطول من المعتاد. لا داعي للقلق — يحدث أحيانًا مع المحتوى الطويل.
            </p>
          )}

          {isStuck && (
            <div
              role="alert"
              className="mx-auto mt-5 max-w-md rounded-xl border border-orange-500/40 bg-orange-500/10 p-4 text-right"
            >
              <p className="mb-3 text-sm font-semibold text-orange-200">
                يبدو أن عملية التصميم متوقفة.
              </p>
              <p className="text-muted mb-4 text-xs leading-relaxed">
                {staleMs > STUCK_STALE_MS && elapsedMs <= STUCK_TOTAL_MS
                  ? "لم يحدث أي تقدم منذ أكثر من 3 دقائق."
                  : "العملية تستغرق وقتًا أطول من المعتاد بكثير."}
                {" "}يمكنك إعادة المحاولة أو الانتظار قليلًا.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleRetry}
                  disabled={retrying}
                  className="btn-gradient inline-flex items-center justify-center gap-2 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {retrying ? (
                    <span className="spinner h-3 w-3 rounded-full border-2 border-white/20 border-t-white" />
                  ) : null}
                  حاول مرة أخرى
                </button>
              </div>
              {retryError && (
                <p className="status-error mt-3 text-xs">{retryError}</p>
              )}
            </div>
          )}
        </header>

        <div className="grid grid-cols-1 justify-center gap-5 md:grid-cols-2">
          {placeholders.map((_, idx) => {
            const state = cardStatus(idx);
            return (
              <div
                key={idx}
                style={{ width: SLIDE_CELL_W, height: SLIDE_CELL_H }}
                className={`glass-card relative mx-auto overflow-hidden rounded-xl ${
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
                    <span className="text-sm" dir="rtl">
                      جارٍ تصميم الشريحة {idx + 1} من {total}
                    </span>
                  </div>
                ) : null}
              </div>
            );
          })}
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
        <PreviewActionBar
          projectId={projectId}
          projectTitle={projectTitle}
          manifest={manifest!}
        />
      </motion.div>

      <motion.div
        variants={slideListVariants}
        initial="hidden"
        animate="visible"
        className="grid justify-center gap-5"
        style={{
          // Auto-wrap: 2+ columns when the viewport can fit 576px cells side
          // by side (so the page-container at typical desktop width shows 2),
          // single column on narrower screens. No fixed Tailwind breakpoint
          // because page-container is width:100% and SLIDE_CELL_W is fixed.
          gridTemplateColumns: `repeat(auto-fit, minmax(${SLIDE_CELL_W}px, 1fr))`,
        }}
      >
        {manifest!.slides.map((slide) => (
          <motion.div
            key={slide.slideId}
            variants={slideCardVariants}
            style={{ width: SLIDE_CELL_W, height: SLIDE_CELL_H }}
            className="glass-card mx-auto overflow-hidden rounded-xl"
          >
            <SlideRenderer
              slide={slide}
              theme={manifest!.theme}
              direction={manifest!.direction}
              language={manifest!.language}
              scale={SLIDE_SCALE}
            />
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
