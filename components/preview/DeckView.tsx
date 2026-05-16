"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { motion, type Variants } from "framer-motion";
import { SlideManifestSchema, type SlideManifest } from "@/lib/schema/slide";
import { SlideRenderer } from "@/components/slides/SlideRenderer";
import { PreviewActionBar } from "@/components/slides/PreviewActionBar";
import { SlideLightbox } from "@/components/preview/SlideLightbox";
import { createClient } from "@/lib/supabase/client";
import type { CommentRow, CommentBounds } from "@/lib/types/comment";
import { notificationStore } from "@/lib/notifications/store";

type Props = {
  projectId: string;
  projectTitle: string;
  presentationId: string | null;
  initialProjectStatus: string;
  initialVersionStatus: string | null;
  // Used by the parent page only — included here so the `{...data}` spread
  // doesn't trigger an extra-prop TS error. DeckView itself doesn't read
  // this prop; remount on version change is driven by the parent's `key`.
  initialVersionId?: string | null;
  initialManifest: SlideManifest | null;
  initialSlideCount: number;
};

type DerivedStatus = "generating" | "completed" | "failed";

type ProgressStage = "thinking" | "designing" | "validating" | "saving";
type Progress = {
  stage: ProgressStage;
  currentSlide: number;
  estimatedTotal: number;
  // ISO timestamp captured server-side at job start. Optional because
  // older in-flight runs (pre-deploy) won't have it; in that case the
  // client falls back to mount-time `Date.now()` as before.
  genStartedAt?: string;
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

// Slides + placeholders use a responsive grid: 1 col on mobile, 2 on
// small, 3 on medium, 4 on wide. Each cell is `aspect-ratio: 16/9` so it
// never overlaps a neighbour when the column shrinks. The internal
// SlideRenderer scale tracks the cell's actual width via a ResizeObserver.
const SLIDE_W = 1920;
// Fallback scale used while ResizeObserver is wiring up + for the
// non-responsive placeholder fallback.
const FALLBACK_SCALE = 0.18;

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

// Slide-card hover overlay — dim fades in, zoom-in icon pops up. Driven
// via parent's whileHover so all child motion.divs sync on enter/leave.
const slideHoverVariants: Variants = {
  rest: { opacity: 0, backgroundColor: "rgba(0,0,0,0)" },
  hover: { opacity: 1, backgroundColor: "rgba(0,0,0,0.35)" },
};
const slideHoverIconVariants: Variants = {
  rest: { scale: 0.8, opacity: 0 },
  hover: { scale: 1, opacity: 1 },
};

// Toolbar physics. The outer wrapper springs between page-edge (left: 16)
// and lightbox position (computed from viewport size) — this is the
// horizontal "slide from page to slide-right" morph. The inner motion
// remounts via `key` flip on every state change, firing the scale pulse
// (0.88 → 1) that gives the "lift off, land" 3d feel.
const TOOLBAR_POSITION_SPRING = { type: "spring" as const, stiffness: 180, damping: 24 };
const TOOLBAR_SCALE_SPRING = { type: "spring" as const, stiffness: 280, damping: 14 };

// Must match SlideLightbox's stage width clamp `min(calc(90vw - 220px), …)`
// so the toolbar lands exactly at the stage's left edge minus a gap. The
// 220px stage reservation is split evenly on both sides because the stage
// is centered in the viewport — plenty of room for the toolbar at ~80px
// wide plus the 24px gap on either side.
const TOOLBAR_RESERVE_PX = 220;
const TOOLBAR_STAGE_GAP_PX = 24;
// Approximate physical width of <PreviewActionBar> — 44px button column +
// 2 × 8px glass-card padding + 1px borders = ~62px, rounded up so the
// toolbar always lands clear of the stage edge.
const TOOLBAR_WIDTH_PX = 80;

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

  // Lightbox — null when closed, otherwise the slide index being shown.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Responsive slide grid — Tailwind `grid-cols-1/2/3/4` at breakpoints.
  // Each cell uses `aspect-ratio: 16/9` + `w-full` so columns shrink to
  // fit the viewport without overlap. SlideRenderer renders at a 1920-wide
  // canvas internally; we feed it a `scale` derived from the actual cell
  // width so the slide content fills the cell at any breakpoint. One
  // ResizeObserver on the grid container measures, then computes the
  // resolved column count + gap from getComputedStyle.
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridScale, setGridScale] = useState(FALLBACK_SCALE);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const recompute = () => {
      const styles = getComputedStyle(el);
      const cols = styles.gridTemplateColumns.split(" ").filter(Boolean).length;
      const gapPx = parseFloat(styles.columnGap) || 0;
      const w = el.clientWidth;
      if (w <= 0 || cols <= 0) return;
      const cellW = (w - (cols - 1) * gapPx) / cols;
      if (cellW > 0) {
        setGridScale(cellW / SLIDE_W);
      }
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [manifest]);

  // Comment-feature state (Steps 2-4 of context/plan-comments.md).
  //
  //   commentMode: drives the toolbar toggle + the dim-0-comment-slides
  //                affordance in the grid + the drag-box overlay in the
  //                lightbox.
  //   comments:    DRAFT comments for the current version. Fetched on
  //                first render in `completed` state. Server keeps the
  //                authoritative list; we keep an optimistic local copy.
  //   applying:    set when POST /regenerate-partial is in flight or the
  //                new version is queued and not yet `completed`. While
  //                set, the targetSlideIds get a per-slide "regenerating"
  //                overlay and toolbar buttons disable.
  const [commentMode, setCommentMode] = useState(false);
  const [comments, setComments] = useState<CommentRow[]>([]);
  // `commentsArmed` is a CLIENT-ONLY UX flag: the user clicked "Apply"
  // (locked in the drafts), but Claude hasn't been called yet. While
  // armed, the apply cell is hidden and the regen icon shows a check —
  // clicking the regen button is what actually fires the partial regen.
  // Resets to false when applying completes (or fails).
  const [commentsArmed, setCommentsArmed] = useState(false);
  const [applying, setApplying] = useState<{
    versionId: string;
    targetSlideIds: string[];
  } | null>(null);

  // Viewport size — needed to compute the toolbar's lightbox-position
  // landing point (left edge of stage minus gap). Updated on resize so
  // the toolbar tracks viewport changes (rotate, sidebar toggle, etc.).
  // SSR default = a desktop-ish 1440×900 so the first render produces a
  // sensible toolbarLightboxLeft; replaced on mount before any interaction.
  const [viewport, setViewport] = useState({ w: 1440, h: 900 });
  useEffect(() => {
    const sync = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  // Toolbar is portal'd to document.body so its z-[1050] is in the same
  // stacking context as the lightbox portal (z-[1000]). Without this,
  // any ancestor of <section> that creates a stacking context (transform,
  // filter, isolation, opacity != 1, etc.) traps the toolbar's z-index
  // beneath the body-level lightbox. `bodyMounted` gates the createPortal
  // call so we don't touch document during SSR.
  const [bodyMounted, setBodyMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBodyMounted(true);
  }, []);

  // Stage width formula must mirror SlideLightbox's CSS clamp:
  //   `min(calc(90vw - TOOLBAR_RESERVE_PX), calc((100vh - 160) * 16/9))`
  // — the same min() of width-based and height-based candidates. The
  // toolbar lands just to the LEFT of the stage: its right edge sits at
  // `stage_left - gap`, so its `left` is `stage_left - gap - width`.
  const stageW = Math.min(
    viewport.w * 0.9 - TOOLBAR_RESERVE_PX,
    ((viewport.h - 160) * 16) / 9
  );
  const stageLeftEdge = (viewport.w - stageW) / 2;
  const toolbarLightboxLeft =
    stageLeftEdge - TOOLBAR_STAGE_GAP_PX - TOOLBAR_WIDTH_PX;

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

  // Start the generation clock when we first enter `generating`. Prefer the
  // server-persisted `progress.genStartedAt` (ISO from the Inngest job) over
  // local mount time so a mid-generation tab reload doesn't reset the clock
  // to 0 — without this, refreshing a stuck deck would silently re-arm the
  // stuck-detection thresholds and the user would never see the banner.
  // Fall back to Date.now() for older in-flight runs that didn't write the
  // timestamp yet. setState-in-effect is intentional (client-only wall clock).
  useEffect(() => {
    if (status !== "generating") return;
    if (genStartedAt !== null) return;
    const serverStartIso = progress?.genStartedAt;
    const serverStartMs = serverStartIso ? Date.parse(serverStartIso) : NaN;
    const start = Number.isFinite(serverStartMs) ? serverStartMs : Date.now();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGenStartedAt(start);
    setLastProgressAt(Date.now());
  }, [status, genStartedAt, progress]);

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
      if (stageChanged) setLastStageSeen(stage);
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

  // Surface a single "stuck" notification to the bell when the deck first
  // crosses the STUCK threshold. We push exactly once per stuck-window via
  // a ref-tracked latch so the user doesn't see the same alert repeated
  // every 10 s (the nowTick interval re-evaluates isStuck constantly).
  // The notification carries the project's preview href so clicking
  // returns the user here.
  const stuckNotifiedRef = useRef(false);
  useEffect(() => {
    if (!isStuck) {
      // Reset the latch when stuck clears (retry succeeded, etc.) so a
      // future stuck window will fire a fresh notification.
      stuckNotifiedRef.current = false;
      return;
    }
    if (stuckNotifiedRef.current) return;
    stuckNotifiedRef.current = true;
    notificationStore.push({
      kind: "warning",
      title: "تصميم العرض متوقف",
      desc: `${projectTitle} — يبدو أن العملية متوقفة. جرّب إعادة المحاولة.`,
      // Route to the summary page so the user lands on the "Generate"
      // CTA — their content + brand data is preserved in sessionStorage
      // from the create flow, so a single click re-fires generation.
      href: `/create/summary`,
    });
  }, [isStuck, projectId, projectTitle]);

  // Fetch draft comments once on completed mount. The server filters by the
  // presentation's currentVersionId, so refetching on manifest swap (after
  // a partial regen completes) brings up the new version's drafts (zero,
  // since drafts get applied during regen and the new version starts clean).
  useEffect(() => {
    if (status !== "completed") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/comments`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { comments: CommentRow[] };
        if (!cancelled && Array.isArray(data.comments)) {
          // Only DRAFT comments are actionable in the UI — applied ones
          // are historical and shouldn't pile pins onto the new version.
          setComments(data.comments.filter((c) => c.status === "draft"));
        }
      } catch {
        /* network blip — comments stay empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, status, manifest?.presentationId]);

  // While applying, poll project status. Apply is "done" only when the
  // LATEST version's id matches the applying state's versionId AND its
  // status is "completed" — otherwise we'd false-positive immediately on
  // the source version (still "completed" at apply-time before the new
  // version is allocated). Once done: clear applying state, drop applied
  // drafts from local state, exit comment mode, refresh server-render.
  useEffect(() => {
    if (!applying) return;
    let cancelled = false;
    const tick = async () => {
      try {
        // Pin the poll to the EXACT target version once known. Two close
        // partial regens otherwise let the status route return the newer
        // version's row, leaving this poller stuck. Pre-apply (sentinel
        // versionId), fall back to default (latest version).
        const versionParam =
          applying.versionId && applying.versionId !== "__pending__"
            ? `?versionId=${encodeURIComponent(applying.versionId)}`
            : "";
        const res = await fetch(
          `/api/projects/${projectId}/status${versionParam}`,
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          status: string;
          versionId: string | null;
          versionStatus: string | null;
        };
        // Optimistic mode: applying.versionId starts as "__pending__".
        // Until the apply POST returns and we replace it with the real
        // versionId, no completion can be declared (real id can never
        // equal the sentinel).
        if (
          data.versionId &&
          data.versionId === applying.versionId &&
          data.versionStatus === "completed"
        ) {
          setApplying(null);
          setComments([]);
          setCommentMode(false);
          setCommentsArmed(false);
          router.refresh();
        }
      } catch {
        /* network blip */
      }
    };
    void tick();
    const id = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [applying, projectId, router]);

  const handleCreateComment = useCallback(
    async (input: { slideId: string; bounds: CommentBounds; content: string }) => {
      const res = await fetch(`/api/projects/${projectId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slideId: input.slideId,
          boundsJson: input.bounds,
          content: input.content,
        }),
      });
      if (!res.ok) throw new Error("Failed to save comment");
      const data = (await res.json()) as { comment: CommentRow };
      setComments((prev) => [...prev, data.comment]);
    },
    [projectId],
  );

  const handleUpdateComment = useCallback(
    async (input: {
      commentId: string;
      content?: string;
      bounds?: CommentBounds;
    }) => {
      const body: Record<string, unknown> = {};
      if (input.content !== undefined) body.content = input.content;
      if (input.bounds !== undefined) body.boundsJson = input.bounds;
      const res = await fetch(
        `/api/projects/${projectId}/comments/${input.commentId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) throw new Error("Failed to update comment");
      const data = (await res.json()) as { comment: CommentRow };
      setComments((prev) =>
        prev.map((c) => (c.id === input.commentId ? data.comment : c)),
      );
    },
    [projectId],
  );

  const handleDeleteComment = useCallback(
    async (commentId: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/comments/${commentId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Failed to delete comment");
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    },
    [projectId],
  );

  // Apply button = "lock in the drafts and prep the regen button to fire".
  // This handler is INTENTIONALLY local-only: no fetch, no Claude call.
  // Drafts stay as `status="draft"` in the DB. The regen button is what
  // actually fires the partial regen (see handleFirePartialRegen below).
  const handleApplyComments = useCallback(() => {
    if (comments.length === 0) return;
    if (applying) return;
    setCommentsArmed(true);
  }, [comments.length, applying]);

  // Triggered by the regen button when it's in its "armed" (check-icon)
  // state. THIS is the call that hits Claude — POST to /regenerate-partial
  // dispatches the Inngest job. Optimistic applying state surfaces the
  // per-slide overlay within one frame; authoritative versionId arrives
  // when the API resolves. Lightbox closes so the user watches the grid.
  const handleFirePartialRegen = useCallback(async () => {
    if (applying) return;
    if (comments.length === 0) return;
    const optimisticTargetIds = Array.from(
      new Set(comments.map((c) => c.slideId)),
    );
    setLightboxIndex(null);
    setApplying({ versionId: "__pending__", targetSlideIds: optimisticTargetIds });
    try {
      const res = await fetch(
        `/api/projects/${projectId}/regenerate-partial`,
        { method: "POST" },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Failed to fire partial regen");
      }
      const data = (await res.json()) as {
        versionId: string;
        targetSlideIds: string[];
      };
      setApplying({
        versionId: data.versionId,
        targetSlideIds: data.targetSlideIds,
      });
    } catch (err) {
      console.error(err);
      setApplying(null);
      // Disarm so the regen button drops the check icon and the user can
      // retry (re-arm via Apply, fire again). Without this the button is
      // stuck showing a check that does nothing.
      setCommentsArmed(false);
    }
  }, [applying, comments, projectId]);

  const handleToggleCommentMode = useCallback(() => {
    setCommentMode((v) => !v);
  }, []);

  // Esc handler — when comment mode is on AND the lightbox is closed, Esc
  // exits comment mode. (When the lightbox is open, the lightbox's own Esc
  // handler runs first: 1st press closes the editor or the lightbox; this
  // DeckView-level handler picks up the 2nd press to exit comment mode.)
  useEffect(() => {
    if (!commentMode || lightboxIndex !== null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setCommentMode(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [commentMode, lightboxIndex]);

  // Auto-disarm if the user deletes all drafts while armed — armed without
  // any comments makes no sense (the regen button as check would fire an
  // empty regen). setState-in-effect is intentional (derived state).
  useEffect(() => {
    if (commentsArmed && comments.length === 0 && !applying) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCommentsArmed(false);
    }
  }, [commentsArmed, comments.length, applying]);

  // Per-slide draft comment counts. Drives the dim affordance in the grid
  // and the Apply button badge.
  const commentsBySlideId = useMemo(() => {
    const map = new Map<string, CommentRow[]>();
    for (const c of comments) {
      const arr = map.get(c.slideId) ?? [];
      arr.push(c);
      map.set(c.slideId, arr);
    }
    return map;
  }, [comments]);

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
              className="btn-gradient inline-flex items-center justify-center gap-2 px-6 py-3 disabled:opacity-60"
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

          {/* SLOW notice lives on the active slide card (see the
              `state === "current"` branch below). The STUCK signal is
              surfaced via the bell notification — DeckView pushes it
              when `isStuck` first flips true. No on-page banner: the
              bell is the single source of "something's wrong, look
              here". When the job actually fails, the failure card
              (top of this component) shows the retry affordance. */}
        </header>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {placeholders.map((_, idx) => {
            const state = cardStatus(idx);
            return (
              <div
                key={idx}
                style={{ aspectRatio: "16 / 9" }}
                className={`glass-card relative w-full overflow-hidden rounded-xl ${
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
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-white">
                    <span className="spinner h-6 w-6 rounded-full border-2 border-white/20 border-t-white" />
                    <span className="text-sm" dir="rtl">
                      جارٍ تصميم الشريحة {idx + 1} من {total}
                    </span>
                    {/* SLOW notice surfaces here on the active slide card —
                        not as a global header line — so it reads as "this
                        specific slide is taking longer". Wording switched
                        from "long content" to "server pressure" per the
                        product brief. */}
                    {isSlow && (
                      <span className="text-[11px] leading-relaxed text-white/60" dir="rtl">
                        الخادم تحت ضغط عالٍ حالياً — الانتظار طبيعي
                      </span>
                    )}
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
        <link key={url} rel="stylesheet" href={url} />
      ))}

      <header className="text-center">
        <p className="text-muted text-xs tracking-widest">
          {manifest!.slides.length} SLIDES
        </p>
        <h1 className="mt-2 text-3xl font-bold text-white">{manifest!.title}</h1>
      </header>

      {/* Universal toolbar. Single PreviewActionBar instance that lives
          at the page root (portal'd to body so its z-index isn't trapped
          by an ancestor stacking context) and animates its `left` between
          the page edge (16px) and a position just to the LEFT of the
          lightbox stage when the user enlarges a slide. The inner motion
          remounts via `key` flip on every state change, firing the scale
          pulse (0.88 → 1) that gives the "lift off, land" 3d feel.
          z-[1050] keeps it above the z-[1000] lightbox backdrop in body's
          stacking context. pointer-events-none on the outer wrapper so
          the full-height fixed strip never intercepts clicks outside the
          toolbar's actual buttons. */}
      {bodyMounted
        ? createPortal(
            <motion.div
              className="pointer-events-none fixed inset-y-0 z-[1050] flex items-center"
              initial={{ left: -150, opacity: 0 }}
              animate={{
                left: lightboxIndex !== null ? toolbarLightboxLeft : 16,
                opacity: 1,
              }}
              transition={{
                left: TOOLBAR_POSITION_SPRING,
                opacity: { duration: 0.5, ease: "easeOut" },
              }}
            >
              <motion.div
                key={lightboxIndex !== null ? "open" : "closed"}
                initial={{ scale: 0.88 }}
                animate={{ scale: 1 }}
                transition={TOOLBAR_SCALE_SPRING}
                className="pointer-events-auto"
              >
                <PreviewActionBar
                  projectId={projectId}
                  projectTitle={projectTitle}
                  manifest={manifest!}
                  commentMode={commentMode}
                  onToggleCommentMode={handleToggleCommentMode}
                  draftCommentCount={comments.length}
                  onApplyComments={handleApplyComments}
                  commentsArmed={commentsArmed}
                  onFirePartialRegen={handleFirePartialRegen}
                  applying={!!applying}
                />
              </motion.div>
            </motion.div>,
            document.body
          )
        : null}

      <motion.div
        ref={gridRef}
        variants={slideListVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        {manifest!.slides.map((slide, idx) => {
          const slideCommentCount = commentsBySlideId.get(slide.slideId)?.length ?? 0;
          const isRegenerating = !!applying?.targetSlideIds.includes(slide.slideId);
          // In comment mode, slides with 0 comments dim so the user can see
          // at a glance which slides are queued for partial regen. Slides
          // with comments stay bright. During applying, the targeted slides
          // get a spinner overlay AND non-targeted slides stay bright.
          const dimmed = commentMode && slideCommentCount === 0 && !isRegenerating;
          return (
            <motion.button
              type="button"
              key={slide.slideId}
              variants={slideCardVariants}
              whileHover="hover"
              initial="rest"
              animate="rest"
              onClick={() => setLightboxIndex(idx)}
              aria-label={`فتح الشريحة ${idx + 1} بحجم أكبر`}
              style={{ aspectRatio: "16 / 9" }}
              // During applying, ALL slides are non-interactive — clicking
              // a non-target shouldn't open the lightbox or otherwise let
              // the user mess with state that's mid-transition. The target
              // slide carries its own blur+spinner overlay; non-targets stay
              // dimmed but locked. Once Inngest completes and the manifest
              // swaps in, clicks restore.
              className={`glass-card relative w-full overflow-hidden rounded-xl p-0 text-start outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-white/60 ${
                applying ? "pointer-events-none cursor-default" : "cursor-zoom-in"
              } ${dimmed && !applying ? "opacity-40 hover:opacity-100" : ""}`}
            >
              {/* Slide content. Heavily blurred while THIS slide is being
                  regenerated (no opacity dim — full brightness, the blur
                  alone signals "processing"). The regenerating overlay
                  sits on top in sharp focus. Non-target slides render
                  normally so the deck stays legible. */}
              <div
                className="h-full w-full transition-[filter] duration-300"
                style={isRegenerating ? { filter: "blur(20px)" } : undefined}
              >
                <SlideRenderer
                  slide={slide}
                  theme={manifest!.theme}
                  direction={manifest!.direction}
                  language={manifest!.language}
                  scale={gridScale}
                />
              </div>
              {/* Hover overlay — only enabled when NOT in comment mode so
                  the dim affordance reads clearly. */}
              {!commentMode ? (
                <motion.div
                  aria-hidden
                  variants={slideHoverVariants}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="pointer-events-none absolute inset-0 flex items-center justify-center"
                >
                  <motion.div
                    variants={slideHoverIconVariants}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="glass-card flex h-12 w-12 items-center justify-center rounded-full text-white"
                  >
                    <span className="material-symbols-outlined">zoom_in</span>
                  </motion.div>
                </motion.div>
              ) : null}
              {/* Comment-count badge — top-end (left in RTL). Only shows in
                  comment mode when the slide has drafts. Hidden while the
                  slide is being regenerated (the regen overlay is taking
                  the user's attention; the badge would be redundant /
                  distracting). Brand-blue chip with a compact comment
                  glyph; sized smaller than before so it doesn't crowd
                  the slide thumbnail. */}
              {commentMode && slideCommentCount > 0 && !isRegenerating ? (
                <div
                  className="absolute end-2 top-2 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white shadow"
                  style={{ background: "var(--tq-blue)" }}
                >
                  <span className="material-symbols-outlined text-[11px]">
                    comment
                  </span>
                  {slideCommentCount}
                </div>
              ) : null}
              {/* Regenerating overlay — spinner + label sitting directly on
                  the blurred slide. No glass-card surround; the heavy blur
                  underneath already gives enough separation. */}
              {isRegenerating ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-white">
                  <div className="flex flex-col items-center gap-2 text-center">
                    <span className="spinner h-7 w-7 rounded-full border-2 border-white/30 border-t-white" />
                    <span className="text-xs font-medium">جارٍ إعادة التصميم...</span>
                  </div>
                </div>
              ) : null}
            </motion.button>
          );
        })}
      </motion.div>

      {/* Lightbox — full-viewport modal. Mounted unconditionally so the
          AnimatePresence inside can play exit animations on close. The
          toolbar lives at DeckView root and animates into a position
          alongside the lightbox stage; the lightbox itself just reserves
          a gap on its right via the TOOLBAR_RESERVE_PX clamp. */}
      <SlideLightbox
        manifest={manifest!}
        index={lightboxIndex}
        mode={commentMode ? "comment" : "idle"}
        comments={comments}
        onClose={() => setLightboxIndex(null)}
        onNav={(next) => setLightboxIndex(next)}
        onCreateComment={handleCreateComment}
        onUpdateComment={handleUpdateComment}
        onDeleteComment={handleDeleteComment}
      />
    </section>
  );
}
