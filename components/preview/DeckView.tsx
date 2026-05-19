"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import {
  SlideManifestSchema,
  SlideSchema,
  ThemeSchema,
  type SlideManifest,
  type SlideType,
  type ThemeType,
} from "@/lib/schema/slide";
import { SlideRenderer } from "@/components/slides/SlideRenderer";
import { SlidePill } from "@/components/preview/SlidePill";
import type { InitialSlideState } from "@/app/(app)/preview/[projectId]/page";
import { dimensionsForFormat, type SlideFormat } from "@/lib/schema/slide";
import {
  SlideNavSidebar,
  SLIDE_NAV_WIDTH,
  type NavItem,
} from "@/components/preview/SlideNavSidebar";
import { CommentsPanel } from "@/components/preview/CommentsPanel";
import { HeroCommentOverlay } from "@/components/preview/HeroCommentOverlay";
import { PreviewActionBar } from "@/components/slides/PreviewActionBar";
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
  // Per-slide state for the pill (lock / version count / cached
  // comments). Empty array for projects without a presentation row.
  // The shape stays serialisable so it crosses the server→client
  // boundary without a client-side re-fetch.
  initialSlideStates?: InitialSlideState[];
  // Slide aspect ratio from the project (set at /create/brand time). Used
  // as the fallback for placeholder cards during generation, when there's
  // no manifest yet to read `format` from.
  initialFormat?: SlideFormat;
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
  // Live thinking-phase telemetry — populated by deck-generate's
  // `stream.on("thinking", …)` handler. Both optional because older
  // in-flight runs / the fast tier (thinking disabled) won't carry
  // them. We surface "thinkingTokens / thinkingBudget" in the
  // caption so the user sees forward motion during the silent
  // pre-output thinking phase.
  thinkingTokens?: number;
  thinkingBudget?: number;
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

// Compact human-readable token count. Sub-thousand: bare integer.
// Mid-range (1k–10k): one decimal place (e.g. 3.2k). 10k+: rounded
// integer (e.g. 12k). Keeps the caption short and readable while the
// budget grows during the thinking phase.
function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return `${Math.round(n)}`;
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1000).toFixed(1)}k`;
}

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

// Fallback scale used while ResizeObserver is wiring up to the hero.
const FALLBACK_SCALE = 0.18;

// Hero canvas layout constants. Kept here (rather than inline) so the
// width-clamp and the symmetric height-clamp we pass to the side
// panels read the same numbers — any tweak here flows to all three
// children of the canvas row.
//
// No hard width cap: the hero grows to fill whatever horizontal +
// vertical space the row affords. The two min() candidates (viewport
// height + row-fit) keep it from overflowing either dimension on
// their own, so the artificial 1100 px cap that used to live here
// only ever made the canvas smaller than necessary on wide monitors.
//
// HERO_VERTICAL_PADDING_PX = Header (80) + 40 px breathing room
// above the hero + 40 px breathing room below = 160 total. Must
// match the wrapper paddings DashboardShell uses for preview
// routes (pt-[120px] + pb-[40px]); the row's `minHeight: calc(100vh
// - HERO_VERTICAL_PADDING_PX)` then fits exactly between them.
const HERO_VERTICAL_PADDING_PX = 160;

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

// Hero card opacity-only reveal on mount.
const slideCardVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.7, ease: "easeOut" },
  },
};

// Toolbar entrance — slides in from off-screen on first paint. Spring
// for a softer landing.
const TOOLBAR_POSITION_SPRING = { type: "spring" as const, stiffness: 180, damping: 24 };

export function DeckView({
  projectId,
  projectTitle,
  presentationId,
  initialProjectStatus,
  initialVersionStatus,
  initialManifest,
  initialSlideCount,
  initialSlideStates = [],
  initialFormat,
}: Props) {
  const router = useRouter();
  // Initial state seeds from server props. The parent (re)keys this component
  // on status transitions, so a remount reseeds — no in-effect prop sync.
  const [manifest, setManifest] = useState<SlideManifest | null>(initialManifest);
  // Per-slide pill state, keyed by slideKey. Mutated by Lock /
  // Undo / Try-again actions; reseeds from props on parent remount.
  // Map<slideKey, state> for O(1) lookup; serialised to InitialSlideState
  // for crossing back to the server when an action fires.
  const [slideStates, setSlideStates] = useState<
    Record<string, InitialSlideState>
  >(() => Object.fromEntries(initialSlideStates.map((s) => [s.slideKey, s])));
  const [projectStatus] = useState(initialProjectStatus);
  const [versionStatus, setVersionStatus] = useState<string | null>(initialVersionStatus);
  const [slideCount, setSlideCount] = useState(initialSlideCount);
  const [progress, setProgress] = useState<Progress | null>(null);
  // Live-preview slides parsed out of Claude's streaming buffer by
  // deck-generate's StreamingSlideParser. Each entry is a Slide that
  // already passed shape validation server-side; we still re-validate
  // here via SlideSchema.safeParse before rendering. Empty until the
  // first slide closes in the stream — typically 30–60 s into a
  // generation. Reset to [] when status leaves "generating".
  const [streamingPreview, setStreamingPreview] = useState<SlideType[]>([]);
  // Theme captured from the same stream once Claude closes the
  // `theme` object (always streams before slides). Drives the CSS-var
  // wiring for streamingPreview slides — without it palette / fonts /
  // background colours fall through to browser defaults.
  const [streamingTheme, setStreamingTheme] = useState<ThemeType | null>(null);
  // Direction + language carried through the brief and echoed on the
  // streaming-preview slideJson. Without them the preview branch was
  // hardcoded to "rtl"/"ar" — fine for the current Arabic-first decks
  // but wrong if Taqreer ever ships an LTR/EN deck. Defaults match the
  // brief defaults so absence-of-signal looks identical to today.
  const [streamingDirection, setStreamingDirection] = useState<"rtl" | "ltr">("rtl");
  const [streamingLanguage, setStreamingLanguage] = useState<"ar" | "en">("ar");
  // True once the user has clicked a thumbnail during the streaming
  // phase — disables the auto-advance that otherwise yanks the hero
  // canvas to whatever slide just closed in the buffer. Stays true for
  // the rest of the run; the user can re-sync by clicking the latest
  // thumbnail manually. Ref (not state) because changing it shouldn't
  // re-render the effect that reads it.
  const previewManualClickRef = useRef(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  // Polling sets this when it sees a failed status arrive after mount.
  const [polledFailure, setPolledFailure] = useState(false);

  // Generation-clock state. SLOW threshold (6 min) flips an in-page
  // caption ("الخادم تحت ضغط عالٍ حالياً") so the user sees the run
  // is just running long, not silently dead. The old "STUCK" bell
  // notification was removed — it kept misfiring on legitimately
  // slow phases.
  //
  // `nowTick` increments every 10 s so the derived `elapsedMs` stays
  // current even when the polling effect doesn't fire (Claude is
  // silent between slides). useState(() => Date.now()) so the seed
  // isn't re-evaluated on every re-render.
  const [genStartedAt, setGenStartedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  // Slide aspect ratio. During generation `manifest` is null, so we fall
  // back to `initialFormat` (passed from the server-side preview page,
  // which reads it from `Project.format` set at /create/brand time).
  // Legacy manifests / very old projects without either set → 16:9 via
  // dimensionsForFormat's internal default. Drives placeholder cards,
  // real slide cards, SlideRenderer dimensions, and the grid scale.
  const { width: canvasW, height: canvasH } = dimensionsForFormat(
    manifest?.format ?? initialFormat,
  );
  const aspectRatio = `${canvasW} / ${canvasH}`;

  // gridRef is defined here so it can be passed to <motion.div>
  // below. The scale + height measurement effect that uses it lives
  // further down (after commentMode is declared — the effect's deps
  // include commentMode because changing it resizes the hero).
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridScale, setGridScale] = useState(FALLBACK_SCALE);

  // Comment-feature state.
  //   commentMode: in commenting flow → SlideNavSidebar swaps out for
  //                CommentsPanel in the right-edge slot. Drives the
  //                drag-box overlay on the hero (step 2c).
  //   comments:    DRAFT comments for the current version. Server is
  //                authoritative; we keep an optimistic local copy.
  //   applying:    partial regen in flight (versionId queued until
  //                Inngest completes). Targeted slides get a
  //                "regenerating" overlay; the Apply button locks.
  const [commentMode, setCommentMode] = useState(false);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [applying, setApplying] = useState<{
    versionId: string;
    targetSlideIds: string[];
  } | null>(null);

  // Measure the hero's rendered width so we can feed SlideRenderer
  // a `scale` of canvas-pixels-per-hero-pixel. The side panels are
  // now fixed-positioned (height comes from CSS `top: 80; bottom: 0`),
  // so we no longer need to track hero height.
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const recompute = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && canvasW > 0) setGridScale(rect.width / canvasW);
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [manifest, canvasW]);

  // Main app sidebar width — drives the slide-nav's `right` offset
  // so it docks against the main sidebar's inner edge. Mirrors the
  // source of truth in DashboardShell.tsx (localStorage +
  // `taqreer_sidebar_collapsed_changed` custom event). Default to
  // the expanded width (260) for SSR; the effect below replaces it
  // with the stored value on mount.
  const [mainSidebarWidth, setMainSidebarWidth] = useState<number>(260);
  useEffect(() => {
    const readWidth = (): number => {
      try {
        const v = window.localStorage.getItem("taqreer_sidebar_collapsed");
        if (v === "true") return 80;
        return 260;
      } catch {
        return 260;
      }
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMainSidebarWidth(readWidth());
    const onChange = (e: Event) => {
      if (e instanceof CustomEvent && typeof e.detail === "boolean") {
        setMainSidebarWidth(e.detail ? 80 : 260);
        return;
      }
      setMainSidebarWidth(readWidth());
    };
    window.addEventListener("taqreer_sidebar_collapsed_changed", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(
        "taqreer_sidebar_collapsed_changed",
        onChange,
      );
      window.removeEventListener("storage", onChange);
    };
  }, []);

  // Currently-focused slide in the hero canvas. Default to 0; resets
  // when a new manifest arrives (e.g. after regen) to keep the user on
  // the first slide rather than a potentially-out-of-range index.
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  useEffect(() => {
    if (!manifest) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentSlideIndex((prev) =>
      prev < manifest.slides.length ? prev : 0,
    );
  }, [manifest]);

  // Toolbar is portal'd to document.body so its z-index isn't trapped
  // by any ancestor's stacking context (transform, filter, isolation,
  // opacity != 1, etc.). `bodyMounted` gates the createPortal call so
  // we don't touch document during SSR.
  const [bodyMounted, setBodyMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBodyMounted(true);
  }, []);

  const status: DerivedStatus = polledFailure || isFailed(projectStatus, versionStatus)
    ? "failed"
    : manifest && isCompleted(projectStatus, versionStatus)
      ? "completed"
      : "generating";

  // Auto-advance the hero focus to the latest streamed slide while the
  // user is still riding the live stream (no manual click yet). Once the
  // user clicks any thumbnail, `previewManualClickRef.current` flips to
  // true and this effect goes dormant — respects their intent over the
  // raw arrival ordering. Triggers on `streamingPreview.length` (not
  // contents) so re-renders that don't add a slide don't bump the index.
  useEffect(() => {
    if (status !== "generating") return;
    if (previewManualClickRef.current) return;
    if (streamingPreview.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentSlideIndex(streamingPreview.length - 1);
  }, [status, streamingPreview.length]);

  // Realtime — Inngest writes the version → Supabase emits → we parse + render.
  // Scoped to this presentation via a server-side filter so other projects'
  // updates can't overwrite our local state. Active during EITHER full
  // generation (`status==="generating"`) OR an in-flight partial regen
  // (`applying != null`) — partial regen flips the target version row
  // status to "completed" via Inngest, and without the channel subscribed
  // during that window the new manifest doesn't reach DeckView and the
  // user has to reload to see the spliced slides.
  useEffect(() => {
    if (status !== "generating" && !applying) return;
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
  }, [presentationId, status, applying]);

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
          streamingPreview?: unknown[] | null;
          streamingTheme?: unknown;
          streamingDirection?: "rtl" | "ltr" | null;
          streamingLanguage?: "ar" | "en" | null;
        };
        if (data.progress && isProgress(data.progress)) {
          setProgress(data.progress);
          if (data.progress.estimatedTotal > 0) {
            setSlideCount(data.progress.estimatedTotal);
          }
        } else if (data.slideCount > 0) {
          setSlideCount(data.slideCount);
        }
        // Live-preview slides — validate each via SlideSchema before
        // accepting (the server already validated, but the wire format
        // is `unknown` so we re-check rather than trust a cast).
        if (Array.isArray(data.streamingPreview)) {
          const validated: SlideType[] = [];
          for (const candidate of data.streamingPreview) {
            const parsed = SlideSchema.safeParse(candidate);
            if (parsed.success) validated.push(parsed.data);
          }
          // Monotonic guard — never shrink the preview during a single
          // generation. If a retry restarts Claude from slide 1, the
          // server's `streamingPreview` resets to [], but DeckView keeps
          // the high-watermark list visible until the canonical
          // `manifest` arrives on completion.
          setStreamingPreview((prev) =>
            validated.length >= prev.length ? validated : prev,
          );
        }
        if (data.streamingTheme) {
          const parsed = ThemeSchema.safeParse(data.streamingTheme);
          if (parsed.success) setStreamingTheme(parsed.data);
        }
        if (data.streamingDirection === "rtl" || data.streamingDirection === "ltr") {
          setStreamingDirection(data.streamingDirection);
        }
        if (data.streamingLanguage === "ar" || data.streamingLanguage === "en") {
          setStreamingLanguage(data.streamingLanguage);
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

  // Start the generation clock when we first enter `generating`. Prefer
  // the server-persisted `progress.genStartedAt` (ISO from the Inngest
  // job) over local mount time so a mid-generation tab reload doesn't
  // reset the clock to 0. Fall back to Date.now() for older in-flight
  // runs that didn't write the timestamp yet. setState-in-effect is
  // intentional (client-only wall clock).
  useEffect(() => {
    if (status !== "generating") return;
    if (genStartedAt !== null) return;
    const serverStartIso = progress?.genStartedAt;
    const serverStartMs = serverStartIso ? Date.parse(serverStartIso) : NaN;
    const start = Number.isFinite(serverStartMs) ? serverStartMs : Date.now();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGenStartedAt(start);
  }, [status, genStartedAt, progress]);

  // Re-render every 10 s so the elapsed / stale times stay current even when
  // no other state changes (i.e. when the generation actually IS stuck and
  // polling brings back identical progress responses).
  useEffect(() => {
    if (status !== "generating") return;
    const id = window.setInterval(() => setNowTick(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, [status]);

  // SLOW just nudges in-page copy ("الخادم تحت ضغط عالٍ حالياً").
  // The stuck-detection bell notification was removed entirely
  // (was producing false positives even with tightened thresholds —
  // notifications persist in localStorage so any old alert kept
  // re-surfacing). If a run actually hangs, the user closes the tab
  // or hits retry from the preview — no need for the bell channel
  // to second-guess.
  const SLOW_WARN_MS = 6 * 60 * 1000;
  const elapsedMs = genStartedAt ? nowTick - genStartedAt : 0;
  const isSlow =
    status === "generating" &&
    !!genStartedAt &&
    elapsedMs > SLOW_WARN_MS;

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

  // While applying, poll project status. The user must hear about
  // ANY disconnect — Inngest cancellations don't flip the DB row to
  // "failed" (it stays "queued" forever), network blips might mask
  // real failures, and a genuinely stuck job needs to fail visibly
  // instead of spinning silently. Four terminal cases, each surfaces
  // via notificationStore and clears `applying` so the UI returns
  // to its normal view:
  //   1. Pinned version status === "completed" → success.
  //   2. Pinned version status === "failed" / project "failed" →
  //      explicit backend failure.
  //   3. No `progress` advancement for 60 s while pinned & queued →
  //      treat as stuck / cancelled (Inngest-cancelled case).
  //   4. ≥5 consecutive fetch failures → server / network disconnect.
  //   5. Hard 5-min cap as a final fallback.
  useEffect(() => {
    if (!applying) return;
    let cancelled = false;
    const applyStartedAt = Date.now();
    const APPLY_TIMEOUT_MS = 5 * 60 * 1000;
    const STUCK_NO_PROGRESS_MS = 60 * 1000;
    const MAX_CONSECUTIVE_ERRORS = 5;
    let lastProgressMs = Date.now();
    let lastProgressSlide = 0;
    let lastProgressStage: string | null = null;
    let consecutiveErrors = 0;
    const failApply = (message: string) => {
      if (cancelled) return;
      setApplying(null);
      notificationStore.push({
        kind: "warning",
        title: "تعذر تطبيق التعليقات",
        desc: `${projectTitle} — ${message}`,
        href: `/preview/${projectId}`,
      });
    };
    const tick = async () => {
      try {
        // Pin the poll to the EXACT target version once known. Two
        // close partial regens otherwise let the status route return
        // the newer version's row, leaving this poller stuck. Pre-
        // apply (sentinel versionId), fall back to default (latest).
        const versionParam =
          applying.versionId && applying.versionId !== "__pending__"
            ? `?versionId=${encodeURIComponent(applying.versionId)}`
            : "";
        const res = await fetch(
          `/api/projects/${projectId}/status${versionParam}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (cancelled) return;
        consecutiveErrors = 0;
        const data = (await res.json()) as {
          status: string;
          versionId: string | null;
          versionStatus: string | null;
          progress: { stage: string; currentSlide: number } | null;
          // Status route returns the full manifest alongside the version
          // status when (a) the caller pinned a versionId and (b) that
          // version is completed. Used here to swap in the spliced
          // slides without depending on Supabase Realtime (which the
          // local docker Postgres doesn't broadcast) or `router.refresh()`
          // (RSC payload caching has been unreliable).
          manifest?: unknown;
        };
        // Optimistic mode: applying.versionId starts as "__pending__".
        // Until the apply POST returns and we replace it with the real
        // versionId, no terminal can be declared on a pinned version
        // (real id can never equal the sentinel).
        const isPinned =
          applying.versionId &&
          applying.versionId !== "__pending__" &&
          data.versionId === applying.versionId;

        // 1. Success.
        if (isPinned && data.versionStatus === "completed") {
          // Splice the new manifest in directly from the status
          // response. Local-dev parity: Supabase Realtime doesn't
          // broadcast from the docker Postgres, and `router.refresh()`
          // alone has been flaky for swapping the manifest in-place.
          // Schema-validate before assigning so a malformed payload
          // can't corrupt the visible deck.
          if (data.manifest) {
            const parsed = SlideManifestSchema.safeParse(data.manifest);
            if (parsed.success) setManifest(parsed.data);
          }
          setApplying(null);
          setComments([]);
          setCommentMode(false);
          router.refresh();
          return;
        }
        // 2. Explicit failure.
        if (
          (isPinned && data.versionStatus === "failed") ||
          data.status === "failed"
        ) {
          failApply("تم إلغاء العملية أو حدث خطأ. يمكنك المحاولة مرة أخرى.");
          return;
        }

        // Update progress watermark if it advanced.
        if (
          data.progress &&
          (data.progress.currentSlide !== lastProgressSlide ||
            data.progress.stage !== lastProgressStage)
        ) {
          lastProgressMs = Date.now();
          lastProgressSlide = data.progress.currentSlide;
          lastProgressStage = data.progress.stage;
        }

        // 3. Stuck — pinned + queued + no progress in 60 s. Covers
        // the Inngest-cancelled case (DB row stays "queued" forever).
        if (
          isPinned &&
          data.versionStatus !== "completed" &&
          Date.now() - lastProgressMs > STUCK_NO_PROGRESS_MS
        ) {
          failApply("توقفت العملية. ربما تم إلغاؤها — حاول مرة أخرى.");
          return;
        }

        // 5. Hard timeout.
        if (Date.now() - applyStartedAt > APPLY_TIMEOUT_MS) {
          failApply("استغرقت العملية وقتاً أطول من المتوقع. حاول مجدداً.");
          return;
        }
      } catch {
        consecutiveErrors += 1;
        // 4. Network / server disconnect. ~10 s of failed polls.
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          failApply("انقطع الاتصال بالخادم. تحقق من الشبكة ثم حاول مجدداً.");
        }
      }
    };
    void tick();
    const id = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [applying, projectId, projectTitle, router]);

  // Translate API failure status codes to Arabic UI messages — used
  // by the drag-box comment editor (step 2c/d). 409 is the realistic
  // real-world failure: comment was promoted to "applied" between the
  // user opening the editor and submitting. 401 happens after long
  // idle sessions.
  const throwApiError = (
    status: number,
    fallback: string,
  ): never => {
    let message: string;
    if (status === 409) {
      message = "تم تطبيق التعليقات. لم يعد قابلاً للتعديل.";
    } else if (status === 401) {
      message = "انتهت الجلسة، أعد تسجيل الدخول.";
    } else if (status === 404) {
      message = "التعليق غير موجود.";
    } else {
      message = fallback;
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = status;
    throw err;
  };

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
      if (!res.ok) throwApiError(res.status, "تعذر حفظ التعليق.");
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
      if (!res.ok) throwApiError(res.status, "تعذر تحديث التعليق.");
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
      if (!res.ok) throwApiError(res.status, "تعذر حذف التعليق.");
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    },
    [projectId],
  );

  // Apply button (in CommentsPanel footer) = just exit comment mode.
  // Drafts persist; the toolbar's regen button — which morphs to an
  // AI icon when drafts are armed — is what fires the actual partial
  // regen via handleFirePartialRegen below.
  const handleApplyComments = useCallback(() => {
    if (comments.length === 0) return;
    setCommentMode(false);
  }, [comments.length]);

  // Toolbar regen button when commentsArmed = true. Fires the partial
  // regen on every slide that has draft comments. Optimistic
  // `applying` state surfaces the per-slide overlay within one frame;
  // authoritative versionId arrives when the API resolves.
  const handleFirePartialRegen = useCallback(async () => {
    if (applying) return;
    if (comments.length === 0) return;
    const optimisticTargetIds = Array.from(
      new Set(comments.map((c) => c.slideId)),
    );
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
    }
  }, [applying, comments, projectId]);

  const handleToggleCommentMode = useCallback(() => {
    setCommentMode((v) => !v);
  }, []);

  // Esc handler — exits comment mode when active.
  useEffect(() => {
    if (!commentMode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setCommentMode(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [commentMode]);

  // Click-outside handler — exits comment mode when the user clicks
  // anywhere that isn't the hero canvas, the CommentsPanel, the
  // slide-nav (transient during fade), the toolbar, the app header,
  // or the main sidebar. The HeroCommentOverlay's editor popover is
  // a descendant of the hero so it's included via the hero closest().
  useEffect(() => {
    if (!commentMode) return;
    const handler = (e: MouseEvent) => {
      // Bail if the event somehow fired without an Element target
      // (e.g. dispatched on document directly — `.closest` is
      // Element-only).
      if (!(e.target instanceof Element)) return;
      const target = e.target;
      if (
        target.closest('[aria-label^="الشريحة"]') || // Hero motion.div
        target.closest('aside[aria-label="لوحة التعليقات"]') || // Comments panel
        target.closest('aside[aria-label="شريط الشرائح"]') || // SlideNav (transient during fade)
        target.closest(".glass-card.flex-col") || // Toolbar column (portal'd to body)
        target.closest(".glass-modal") || // Editor popover
        target.closest("header") || // App header
        target.closest('aside[aria-label="Sidebar"]') // Main app sidebar
      ) {
        return;
      }
      setCommentMode(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [commentMode]);

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
    // Mix real streamed slides (kind:"slide") into the head of the
    // nav row, padded with placeholders for slots Claude hasn't
    // closed yet. Once `streamingTheme` is null we can't render a
    // thumbnail (SlideRenderer needs theme CSS vars), so fall back
    // to placeholder pulse with the right state. Comment count is
    // hard-coded to 0 during streaming — comments don't exist yet.
    const navItems: NavItem[] = placeholders.map((_, idx) => {
      const previewSlide = streamingPreview[idx];
      if (previewSlide && streamingTheme) {
        return {
          kind: "slide",
          index: idx,
          slide: previewSlide,
          commentCount: 0,
        };
      }
      return {
        kind: "placeholder",
        index: idx,
        state: cardStatus(idx),
      };
    });
    // Synthetic manifest shell so SlideNavSidebar's `manifest.theme`
    // / `manifest.direction` / `manifest.language` reads work without
    // the canonical manifest existing yet. Only the fields the nav +
    // SlideRenderer actually consume are populated; the rest stay
    // structurally valid but empty.
    const previewManifestForNav: SlideManifest | null = streamingTheme
      ? ({
          version: "2.0",
          // `presentationId` and `title` are non-null in the canonical
          // schema. The preview manifest is a structural shim — empty
          // strings keep the type contract honoured and the nav doesn't
          // surface either field while generating, so the value is
          // never read.
          presentationId: presentationId ?? "",
          title: projectTitle ?? "",
          language: streamingLanguage,
          direction: streamingDirection,
          format: initialFormat ?? "16:9",
          theme: streamingTheme,
          slides: streamingPreview,
        } satisfies SlideManifest)
      : null;
    // The slide focused in the hero — user click overrides the
    // auto-tracked latest. Clamp to a slot that actually has a
    // preview slide; out-of-range falls back to the latest closed
    // slide so the hero never shows a blank canvas when there's
    // *something* to show.
    const previewHeroIdx =
      streamingPreview.length === 0
        ? -1
        : Math.min(currentSlideIndex, streamingPreview.length - 1);
    const previewHeroSlide =
      previewHeroIdx >= 0 ? streamingPreview[previewHeroIdx] : null;
    // Slide-nav is fixed-positioned outside the row, so the row has
    // no internal reservation while generating (no comments yet,
    // either). Hero centers in the remaining width.
    const genHeroWidthCss = `min(calc((100vh - ${HERO_VERTICAL_PADDING_PX}px) * ${canvasW} / ${canvasH}), 100%)`;
    return (
      <section
        dir="rtl"
        className="relative"
        style={{ marginRight: SLIDE_NAV_WIDTH }}
      >
        <SlideNavSidebar
          items={navItems}
          currentIndex={previewHeroIdx >= 0 ? previewHeroIdx : null}
          onSelect={(idx) => {
            // First user click in the streaming phase locks the hero
            // away from auto-advance for the rest of the run. They
            // can re-sync by clicking the latest thumbnail manually
            // (auto-advance won't override their next click — it's
            // already disabled).
            previewManualClickRef.current = true;
            setCurrentSlideIndex(idx);
          }}
          manifest={previewManifestForNav}
          format={initialFormat ?? "16:9"}
          mainSidebarWidth={mainSidebarWidth}
        />
        {/* Canvas row — hero centered in the remaining width. Same
            shape as the completed branch so the shell doesn't reflow
            when generation finishes. */}
        <div
          dir="ltr"
          className="flex items-center justify-center"
          style={{ minHeight: `calc(100vh - ${HERO_VERTICAL_PADDING_PX}px)` }}
        >
          <div
            ref={gridRef}
            className="glass-card relative flex items-center justify-center overflow-hidden rounded-2xl"
            style={{ aspectRatio, width: genHeroWidthCss }}
          >
            {/* Live preview hero — renders whichever slide the user is
                currently focused on (default: the latest streamed
                slide). Falls back to a blank canvas + caption until the
                first slide closes in Claude's buffer. SlideRenderer
                runs its own sanitize pass so the raw preview HTML is
                XSS-safe before it paints. */}
            {previewHeroSlide && streamingTheme ? (
              <div className="absolute inset-0 transition-opacity duration-300">
                <SlideRenderer
                  slide={previewHeroSlide}
                  theme={streamingTheme}
                  direction={streamingDirection}
                  language={streamingLanguage}
                  width={canvasW}
                  height={canvasH}
                  scale={gridScale}
                />
              </div>
            ) : null}
            {/* Caption overlay — ONLY shown when there's nothing
                rendered on the canvas yet (no streamed slide AND no
                theme to wire it). Once a real slide is visible behind,
                the thumbnail row + the rendered slide itself
                communicate progress; layering the caption on top is
                noisy and obscures content. The "stuck" banner stays
                visible since it's a different signal class.

                When this branch IS active, `dir="rtl"` so the spinner
                sits to the START of the Arabic caption (visual right)
                and the meta line reads in RTL order. */}
            {!(previewHeroSlide && streamingTheme) ? (
              <div
                dir="rtl"
                className="flex flex-col items-center gap-4 px-6 text-center text-white"
              >
                <h1 className="font-headline-lg text-[28px] font-bold">
                  جارٍ تصميم عرضك...
                </h1>
                {/* Live progress caption — thinking-token counter
                    during silent thinking, slide-being-designed during
                    streaming, validating / saving on the tail. */}
                <div className="text-muted flex items-center justify-center gap-3 text-sm">
                  <span className="spinner h-4 w-4 rounded-full border-2 border-white/20 border-t-white" />
                  <span>
                    {progress?.stage === "thinking" && progress.thinkingBudget
                      ? `التفكير: ${formatTokens(progress.thinkingTokens ?? 0)} / ${formatTokens(progress.thinkingBudget)} رمز`
                      : progress?.stage === "thinking"
                        ? "بدء التفكير..."
                        : progress?.stage === "validating"
                          ? "التحقق من المخرجات..."
                          : progress?.stage === "saving"
                            ? "حفظ العرض..."
                            : progress?.currentSlide
                              ? `جارٍ تصميم الشريحة ${progress.currentSlide} من ${total}`
                              : "بدء التصميم..."}
                  </span>
                </div>
                <div className="w-full max-w-md">
                  <div
                    className="progress-track"
                    role="progressbar"
                    aria-valuenow={percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div className="progress-bar" style={{ width: `${percent}%` }} />
                  </div>
                  <p className="text-muted mt-2 text-xs">
                    {percent}% · {progress?.currentSlide ?? 0} / {total}
                  </p>
                </div>
                {isSlow && (
                  <span className="text-[11px] leading-relaxed text-white/60">
                    الخادم تحت ضغط عالٍ حالياً — الانتظار طبيعي
                  </span>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  // ─── Completed ─────────────────────────────────────────────────────────────
  // Currently-focused slide. Clamped here so we don't blow up if the
  // index outpaces a freshly-shrunk manifest (e.g. after a partial regen
  // dropped a slide — shouldn't happen, but defensive).
  const focusedIndex = Math.min(
    Math.max(currentSlideIndex, 0),
    manifest!.slides.length - 1,
  );
  const focusedSlide = manifest!.slides[focusedIndex];
  const navItems: NavItem[] = manifest!.slides.map((slide, idx) => ({
    kind: "slide",
    index: idx,
    slide,
    commentCount: commentsBySlideId.get(slide.slideId)?.length ?? 0,
    regenerating: !!applying?.targetSlideIds.includes(slide.slideId),
    locked: slideStates[slide.slideId]?.lockedAt != null,
  }));
  const isFocusedRegenerating = !!applying?.targetSlideIds.includes(
    focusedSlide.slideId,
  );
  // Hero width clamp — two candidates, smallest wins:
  //   • viewport-height-derived width (so hero never exceeds the
  //     remaining vertical space given its aspect ratio)
  //   • the row's full width (side panels are fixed-positioned
  //     outside the section, so the row reserves nothing).
  const heroWidthCss = `min(calc((100vh - ${HERO_VERTICAL_PADDING_PX}px) * ${canvasW} / ${canvasH}), 100%)`;
  return (
    <section
      dir={manifest!.direction}
      className="relative"
      style={{ marginRight: SLIDE_NAV_WIDTH }}
    >
      {fontLinks.map((url) => (
        <link key={url} rel="stylesheet" href={url} />
      ))}

      {/* Right-edge slot: SlideNavSidebar swaps for CommentsPanel
          while in comment mode. Same fixed position (against the
          main sidebar's inner edge), same 260 px width, so section
          marginRight stays constant and the hero doesn't reflow.
          AnimatePresence crossfades the two panels — opacity is
          inheritable, so motion.div wrappers handle the fade without
          touching the fixed-positioned asides inside. */}
      <AnimatePresence initial={false}>
        {commentMode ? (
          <motion.div
            key="comments"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            // 1 s ease — matches the canvas gradient-border fade so
            // both transitions hit completion at the same moment.
            // Matches CSS `ease` (cubic-bezier(0.25, 0.1, 0.25, 1)),
            // so this swap's curve mirrors the canvas border's CSS
            // `transition: opacity 1s ease`.
            transition={{ duration: 1, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <CommentsPanel
              comments={comments}
              slideId={focusedSlide.slideId}
              onClose={handleToggleCommentMode}
              onApply={handleApplyComments}
              mainSidebarWidth={mainSidebarWidth}
            />
          </motion.div>
        ) : (
          <motion.div
            key="slidenav"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            // Matches CSS `ease` (cubic-bezier(0.25, 0.1, 0.25, 1)),
            // so this swap's curve mirrors the canvas border's CSS
            // `transition: opacity 1s ease`.
            transition={{ duration: 1, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <SlideNavSidebar
              items={navItems}
              currentIndex={focusedIndex}
              onSelect={(idx) => setCurrentSlideIndex(idx)}
              manifest={manifest}
              format={manifest!.format ?? initialFormat ?? "16:9"}
              title={manifest!.title}
              mainSidebarWidth={mainSidebarWidth}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Universal toolbar. Portal'd to document.body so its z-index
          isn't trapped by any ancestor stacking context (transform,
          filter, isolation, opacity != 1, etc.). pointer-events-none
          on the full-height fixed strip so it never intercepts clicks
          outside the toolbar's actual buttons. */}
      {bodyMounted
        ? createPortal(
            <motion.div
              className="pointer-events-none fixed inset-y-0 z-[1050] flex items-center"
              style={{ left: 16 }}
              initial={{ x: -150, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{
                x: TOOLBAR_POSITION_SPRING,
                opacity: { duration: 0.5, ease: "easeOut" },
              }}
            >
              <div className="pointer-events-auto">
                <PreviewActionBar
                  projectId={projectId}
                  projectTitle={projectTitle}
                  manifest={manifest!}
                  commentMode={commentMode}
                  onToggleCommentMode={handleToggleCommentMode}
                  draftCommentCount={comments.length}
                  // Armed = drafts exist, user has exited comment
                  // mode, and no apply is in flight → the regen
                  // button morphs to the AI icon and now triggers
                  // the partial regen.
                  commentsArmed={
                    !commentMode && comments.length > 0 && !applying
                  }
                  onFirePartialRegen={handleFirePartialRegen}
                  applying={!!applying}
                  formatFallback={initialFormat}
                />
              </div>
            </motion.div>,
            document.body
          )
        : null}

      {/* Canvas row.
          Single flex container — hero centered in the remaining
          width. Side panels are fixed-positioned (outside this row),
          so the row reserves no internal horizontal space. */}
      <div
        dir="ltr"
        className="flex items-center justify-center"
        style={{ minHeight: `calc(100vh - ${HERO_VERTICAL_PADDING_PX}px)` }}
      >
        <motion.div
          ref={gridRef}
          variants={slideCardVariants}
          initial="hidden"
          animate="visible"
          aria-label={`الشريحة ${focusedIndex + 1} من ${manifest!.slides.length}`}
          style={{ aspectRatio, width: heroWidthCss }}
          // Animated mesh-gradient ring — class is always present so
          // CSS owns the fade in/out via `data-active`. When false,
          // the ring is opacity:0 + animation paused; when true, it
          // fades to opacity:1 over 1 s and the slow drift resumes.
          // Crosshair cursor signals "click + drag to draw" while in
          // commentMode; reverts to default outside it.
          className={`canvas-gradient-border group relative overflow-hidden rounded-xl p-0 shadow-2xl${
            commentMode ? " cursor-crosshair" : ""
          }`}
          data-active={commentMode ? "true" : "false"}
        >
          {/* Slide content. Heavily blurred while THIS slide is being
              regenerated; the regenerating overlay sits on top in sharp
              focus. */}
          <div
            className="h-full w-full transition-[filter] duration-300"
            style={isFocusedRegenerating ? { filter: "blur(20px)" } : undefined}
          >
            <SlideRenderer
              slide={focusedSlide}
              theme={manifest!.theme}
              direction={manifest!.direction}
              language={manifest!.language}
              width={canvasW}
              height={canvasH}
              scale={gridScale}
            />
          </div>

          {/* Per-slide pill — Undo / Try again / Regen / History /
              Lock. Step 3 ships VISUAL ONLY; click handlers land
              in steps 4-6. Mounted inside the canvas-gradient-
              border container so it inherits the `group` hover
              state, fading in on canvas hover. State props are
              still placeholders until step 5 wires SlideState to
              the client. */}
          {!isFocusedRegenerating ? (
            <SlidePill
              currentVersionNumber={
                slideStates[focusedSlide.slideId]?.currentVersionNumber ?? 1
              }
              hasCachedComments={
                slideStates[focusedSlide.slideId]?.hasCachedComments ?? false
              }
              isLocked={
                slideStates[focusedSlide.slideId]?.lockedAt != null
              }
              onToggleLock={async () => {
                const current = slideStates[focusedSlide.slideId];
                const shouldLock = current?.lockedAt == null;
                // Optimistic flip — UI reacts before the request lands.
                // Server response (lockedAt ISO string) replaces our
                // synthesised value once it arrives. On error we revert.
                const optimistic: InitialSlideState = {
                  slideKey: focusedSlide.slideId,
                  currentVersionNumber: current?.currentVersionNumber ?? 1,
                  hasCachedComments: current?.hasCachedComments ?? false,
                  lockedAt: shouldLock ? new Date().toISOString() : null,
                };
                setSlideStates((prev) => ({
                  ...prev,
                  [focusedSlide.slideId]: optimistic,
                }));
                try {
                  const res = await fetch(
                    `/api/projects/${projectId}/slides/${encodeURIComponent(focusedSlide.slideId)}/lock`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ locked: shouldLock }),
                    },
                  );
                  if (!res.ok) throw new Error(`lock toggle: ${res.status}`);
                  const data = (await res.json()) as {
                    lockedAt: string | null;
                  };
                  setSlideStates((prev) => ({
                    ...prev,
                    [focusedSlide.slideId]: {
                      ...optimistic,
                      lockedAt: data.lockedAt,
                    },
                  }));
                } catch (err) {
                  console.error("lock toggle failed", err);
                  setSlideStates((prev) => ({
                    ...prev,
                    [focusedSlide.slideId]: {
                      slideKey: focusedSlide.slideId,
                      currentVersionNumber:
                        current?.currentVersionNumber ?? 1,
                      hasCachedComments: current?.hasCachedComments ?? false,
                      lockedAt: current?.lockedAt ?? null,
                    },
                  }));
                }
              }}
            />
          ) : null}

          {/* Regenerating overlay. */}
          {isFocusedRegenerating ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-white">
              <div className="flex flex-col items-center gap-2 text-center">
                <span className="spinner h-7 w-7 rounded-full border-2 border-white/30 border-t-white" />
                <span className="text-xs font-medium">
                  جارٍ إعادة التصميم...
                </span>
              </div>
            </div>
          ) : null}

          {/* Comment overlay — drag-to-draw + pins + editor popover.
              Only mounted while commentMode is on so its mouse
              capture doesn't intercept regular interactions outside
              the commenting flow. */}
          {commentMode ? (
            <HeroCommentOverlay
              slideId={focusedSlide.slideId}
              comments={comments}
              scale={gridScale}
              canvasW={canvasW}
              canvasH={canvasH}
              direction={manifest!.direction}
              onCreate={handleCreateComment}
              onUpdate={handleUpdateComment}
              onDelete={handleDeleteComment}
            />
          ) : null}
        </motion.div>
      </div>
    </section>
  );
}
