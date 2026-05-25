"use client";

import { createPortal } from "react-dom";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, usePathname } from "next/navigation";
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
import { HistoryPopover, type HistoryRow } from "@/components/preview/HistoryPopover";
import type { InitialSlideState } from "@/lib/project/load-project";
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
import {
  openProjectChannel,
  type PresenceViewer,
  type ProjectChannelHandle,
  type ViewerPresence,
} from "@/lib/realtime/project-channel";

import type { ProjectRole } from "@/lib/api/project-access";

type Props = {
  projectId: string;
  // Role of the current viewer (Phase 15.B). "owner" / "edit" = full
  // editor UI. "comment" = view + comments + flat (non-AI) comment
  // button, no regen / save / lock. "view" = pure read-only — no
  // toolbar mutation buttons, no comments, no slide-pill mutations.
  // Driven server-side in the page via resolveProjectAccess.
  role: ProjectRole;
  // Caller's prisma User row id — null for anonymous public-view
  // (no login). Used for client-side authorship comparisons:
  // currently the per-comment delete affordance hides for comment-
  // only users when comment.authorId !== currentUserId. Server
  // routes still enforce via their own auth checks (defense in
  // depth); this prop is for UX, not security.
  currentUserId: string | null;
  // Caller's display name + avatar URL — used for Phase 16.B presence
  // broadcast so other viewers see this user's name/avatar overlaid on
  // the slide thumbnail they're currently focused on. null for
  // anonymous public-view callers (no presence tracked in that case
  // — the user isn't identifiable).
  currentUserName?: string | null;
  currentUserImage?: string | null;
  projectTitle: string;
  presentationId: string | null;
  initialProjectStatus: string;
  initialVersionStatus: string | null;
  // Used by the parent page for `key` (forces remount on version change)
  // AND passed through to PreviewActionBar as `currentVersionId` so the
  // Save Project button can compare against `savedVersionId`.
  initialVersionId?: string | null;
  // Pinned canonical version pointer (Presentation.savedVersionId). Null
  // when the project has never been saved. Drives the Save Project
  // button's saved/unsaved indicator. Local state in DeckView mirrors
  // this — successful saves update it without a router.refresh.
  initialSavedVersionId?: string | null;
  // Per-slide snapshot taken at save time — { slideKey → versionNumber }.
  // Needed because per-slide restore mutates PresentationVersion.slideJson
  // in place WITHOUT bumping currentVersionId, so the Save button has to
  // compare each slide's live currentVersionNumber against this snapshot
  // (not just the version pointer). Null when the project has never been
  // saved or pre-dates the column.
  initialSavedSlideVersions?: Record<string, number> | null;
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
  // Width of the main app sidebar (80 collapsed, 260 expanded). Read
  // SSR-side from the `tq_sidebar_collapsed` cookie by the page that
  // mounts DeckView and passed in here so the SlideNavSidebar's
  // `right:` value is correct on first paint — without this prop the
  // sidebar defaulted to 260, then re-rendered to 80 once
  // localStorage was read in an effect, producing a visible
  // slide-in animation ("SlideNavSidebar slides ltr on refresh",
  // user report 2026-05-23). Optional + defaults to 260 so callers
  // that haven't wired the prop still work.
  initialMainSidebarWidth?: number;
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
  // `stream.on("thinking", …)` handler. Optional because older
  // in-flight runs / the fast tier (thinking disabled) won't carry
  // it. We no longer surface the count in the caption (dropped
  // 2026-05-25 — the bare "Thinking..." copy reads cleaner and the
  // numerator/denominator was noisy noise on max-effort runs where
  // server-side subagent thinking didn't stream incrementally), but
  // the field is still read by the "is the run actually advancing"
  // stuck-detection heuristic in the polling effect below.
  thinkingTokens?: number;
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
  role,
  currentUserId,
  currentUserName,
  currentUserImage,
  projectTitle,
  presentationId,
  initialProjectStatus,
  initialVersionStatus,
  initialVersionId,
  initialSavedVersionId,
  initialSavedSlideVersions,
  initialManifest,
  initialSlideCount,
  initialSlideStates = [],
  initialFormat,
  initialMainSidebarWidth = 260,
}: Props) {
  // Capability flags derived from role — passed/used wherever the
  // UI gates a mutation affordance. View-only sees the deck and
  // can export; comment can also create comments; edit/owner can
  // do anything (regen, save, lock, restore, lock-all). Computing
  // once here keeps the descendants from needing to know about the
  // role taxonomy.
  const canEdit = role === "owner" || role === "edit";
  const canComment = canEdit || role === "comment";
  const router = useRouter();
  const pathname = usePathname();
  // Initial state seeds from server props. The parent (re)keys this component
  // on status transitions, so a remount reseeds — no in-effect prop sync.
  const [manifest, setManifest] = useState<SlideManifest | null>(initialManifest);
  // Ref-mirror of manifest so realtime broadcast handlers can read the
  // latest slide list without re-binding to the channel on every
  // manifest change. Kept in sync via the useEffect right below the
  // state — synchronous-after-render sync is fine here (the handler
  // only fires async on socket events, never during render).
  const manifestRef = useRef<SlideManifest | null>(initialManifest);
  useEffect(() => {
    manifestRef.current = manifest;
  }, [manifest]);
  // Per-slide pill state, keyed by slideKey. Mutated by Lock /
  // Undo / Try-again actions; reseeds from props on parent remount.
  // Map<slideKey, state> for O(1) lookup; serialised to InitialSlideState
  // for crossing back to the server when an action fires.
  const [slideStates, setSlideStates] = useState<
    Record<string, InitialSlideState>
  >(() => Object.fromEntries(initialSlideStates.map((s) => [s.slideKey, s])));
  // History popover state. `anchorRect` is the History button's
  // bounding rect captured at click time; `slideKey` is the slide
  // whose history is being viewed. Both null when the popover is
  // closed. `versions` is lazy-loaded the first time the popover
  // opens for a given slide; cached in a Map keyed by slideKey so
  // re-opening the same slide's history doesn't re-fetch.
  const [historyAnchor, setHistoryAnchor] = useState<DOMRect | null>(null);
  const [historySlideKey, setHistorySlideKey] = useState<string | null>(null);
  // Hydrate from SSR — `initialSlideStates` carries each slide's
  // version list inline, so the popover opens already populated
  // and avoids the "0 rows → fetch → expand" glitch on first
  // open after a page refresh. Subsequent regens still push fresh
  // rows in via the partial-regen completion flow.
  const [historyVersions, setHistoryVersions] = useState<
    Record<string, HistoryRow[]>
  >(() =>
    Object.fromEntries(
      initialSlideStates.map((s) => [s.slideKey, s.versions ?? []]),
    ),
  );
  // `popoverEngaged` latches TRUE while the history popover is
  // either open OR fading out. Used by the slide pill to stay
  // visible through the entire popover lifecycle — without this,
  // the pill flickered when the popover unmounted because the
  // cursor was on the popover (outside the canvas hover area) at
  // the moment historyAnchor flipped to null. Set true on every
  // popover open; reset to false by HistoryPopover's
  // onExitComplete after the fade-out finishes.
  const [popoverEngaged, setPopoverEngaged] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  // Splice helper used by both Undo and Restore. Updates the live
  // manifest (so the renderer immediately shows the older slide
  // content) AND the per-slide pill state (currentVersionNumber).
  // Server returns the slide JSON + new pointer; client mirrors
  // those into local state. No re-fetch needed.
  const applyRestoredSlide = (
    slideKey: string,
    payload: { currentVersionNumber: number; slide: SlideType },
  ) => {
    setManifest((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        slides: prev.slides.map((s) =>
          s.slideId === slideKey ? payload.slide : s,
        ),
      };
    });
    setSlideStates((prev) => {
      const current = prev[slideKey];
      return {
        ...prev,
        [slideKey]: {
          slideKey,
          currentVersionNumber: payload.currentVersionNumber,
          hasCachedComments: current?.hasCachedComments ?? false,
          lockedAt: current?.lockedAt ?? null,
        },
      };
    });
    // historyVersions cache is intentionally NOT cleared here.
    // Restore is non-destructive — the rows themselves don't
    // change, only the SlideState pointer (currentVersionNumber)
    // moves. Clearing then refetching would briefly empty the
    // popover before unmount, producing the "collapse-then-flash"
    // glitch the user flagged 2026-05-20.
  };
  const [projectStatus] = useState(initialProjectStatus);
  const [versionStatus, setVersionStatus] = useState<string | null>(initialVersionStatus);

  // Stream-complete navigation. When this DeckView instance is
  // mounted on /preview/<id> and the version status transitions
  // (via polling) to "completed", flip the URL over to /project/<id>
  // so the user lands on the canonical working-session route —
  // matching what they'd see if they reloaded after completion.
  //
  // ONLY forward (preview → project). The inverse direction
  // (project → preview when status is no longer "completed") is
  // handled SSR-side at page load; doing it client-side would
  // produce a jarring URL flip during full regens (the status
  // briefly transitions through generating before re-completing).
  // The SSR redirect's job is bookmarks / stale URLs; here we just
  // forward the post-generation transition.
  useEffect(() => {
    if (
      versionStatus === "completed" &&
      pathname?.startsWith("/preview/")
    ) {
      router.replace(`/project/${projectId}`);
    }
  }, [versionStatus, pathname, projectId, router]);
  // Pinned canonical version pointer. Seeded from SSR; mutated by the
  // Save Project button's onSaved callback. Compared against
  // `initialVersionId` in PreviewActionBar to drive the saved/unsaved
  // indicator. Parent remount on version change reseeds this from
  // fresh SSR data, so partial-regen completion auto-flips the
  // button back to "unsaved" without explicit plumbing.
  const [savedVersionId, setSavedVersionId] = useState<string | null>(
    initialSavedVersionId ?? null,
  );
  // Per-slide snapshot { slideKey → versionNumber } taken on Save.
  // Restore mutates the active manifest in place without bumping
  // currentVersionId, so this is the only signal that lets the Save
  // button re-arm on restore — and re-detect "saved" when the user
  // restores BACK to whatever versions were active at save time.
  const [savedSlideVersions, setSavedSlideVersions] = useState<
    Record<string, number> | null
  >(initialSavedSlideVersions ?? null);
  const [slideCount, setSlideCount] = useState(initialSlideCount);
  const [progress, setProgress] = useState<Progress | null>(null);
  // Live-preview slides parsed out of Claude's streaming buffer by
  // deck-generate's StreamingSlideParser. Each entry is a Slide that
  // already passed shape validation server-side; we still re-validate
  // here via SlideSchema.safeParse before rendering. Empty until the
  // first slide closes in the stream — typically 30–60 s into a
  // generation. Reset to [] when status leaves "generating".
  const [streamingPreview, setStreamingPreview] = useState<SlideType[]>([]);
  // Parallel boolean array (indexed identical to streamingPreview) flagging
  // tiles whose slide is still showing Claude's FIRST-pass DRAFT (vs the
  // polished re-emit). Server only emits this field on enhance/mimic/data
  // flows; for /create it stays empty and no draft chips render. Kept in
  // strict zip-alignment with streamingPreview via the same monotonic
  // guard below — when we accept a new streamingPreview snapshot we also
  // accept the matching draft array; when we preserve the prior snapshot
  // we preserve the prior draft array too.
  const [streamingPreviewDraft, setStreamingPreviewDraft] = useState<boolean[]>(
    [],
  );
  // Stale-poll guards for the streaming preview. The pre-fix monotonic
  // guard was length-only (`validated.length >= prev.length`), which
  // worked for retry-induced shrinkage but couldn't reject the case
  // where two polls overlap: poll A starts, takes longer; poll B fires
  // and returns first with newer state; poll A returns last with stale
  // state of the same length, overwriting B's freshness with stale
  // slides. `lastManifestVersionRef` tracks the highest server-emitted
  // `streamingManifestVersion` we've accepted; incoming snapshots with
  // a lower version are rejected outright. `highWatermarkRef` retains
  // the length of the highest version accepted so far, so when a NEW
  // version arrives (parser reset → second manifest pass) we keep
  // showing the previous full-length list until the new version
  // catches up to that watermark — preserves the deliberate UX where
  // draft slides stay visible until the polished pass replaces them.
  const lastManifestVersionRef = useRef(0);
  const highWatermarkRef = useRef(0);
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
  // Polling sets this when the generation finishes on the server. Used
  // to flip the derived status from "generating" to "completed" without
  // a `router.refresh()` — the parent SSR still believes the project
  // is queued/generating until the user navigates, but DeckView reads
  // the manifest + this flag locally and renders the completed view
  // immediately. Avoids the visible flash + transient-client-state
  // loss that an SSR re-render cycle causes mid-generation completion.
  const [polledCompleted, setPolledCompleted] = useState(false);

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
  // True while the read-only marker preview popup (HeroCommentOverlay
  // sub-component) is open. Drives chrome that would otherwise compete
  // with the popup — the per-slide pill (regen / history / lock) hides
  // while a preview is showing so the popup reads as the primary
  // focus.
  const [markerPreviewOpen, setMarkerPreviewOpen] = useState(false);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [applying, setApplying] = useState<{
    versionId: string;
    targetSlideIds: string[];
  } | null>(null);
  // Slides currently being regen'd by a PEER (not the local user). Set
  // entries are slideIds. Added on `slide.regen.started` from the
  // project channel (self-echo skipped — the actor's `applying` state
  // already shows the spinner on the SAME slide for them), cleared on
  // `slide.regen.finished`. Unioned with `applying.targetSlideIds`
  // when computing the per-slide `regenerating` flag so observers see
  // the same dim+spinner overlay the actor sees. Re-added 2026-05-24.
  const [peerRegenInProgress, setPeerRegenInProgress] = useState<
    ReadonlySet<string>
  >(() => new Set());
  // Catch-up poll for missed `slide.regen.finished` broadcasts. Safari
  // throttles backgrounded / out-of-focus WebSockets and occasionally
  // drops broadcast frames entirely — symptom: the spinner overlay
  // stays past the actual regen completion until the next user-driven
  // refetch (visibility-change, manual click somewhere, etc.) catches
  // up. While peerRegenInProgress is non-empty, poll the status route
  // every 8s with `&includeSlideStates=true` so `slideStates` mirrors
  // the latest server state; the defensive useEffect below then notices
  // `currentVersionNumber` bumps and clears the matching peer entries.
  // 8 s balances "spinner clears within ~one regen-completion-window
  // of the truth" against not hammering the route on a healthy
  // websocket (in which case the broadcast clears the set first and
  // the poll's slideStates write is a no-op).
  useEffect(() => {
    if (peerRegenInProgress.size === 0) return;
    let cancelled = false;
    const tick = async () => {
      try {
        // `&includeManifest=true` is the missing piece (CR PR #33):
        // when Safari drops the `.finished` broadcast frame, the only
        // place new slide CONTENT lands is in the broadcast handler's
        // `fetchAndSwapState`. Without the manifest here, the catch-
        // up poll would clear the spinner (via the version-bump
        // useEffect below reacting to slideStates) but the peer would
        // keep rendering the OLD manifest until the next visibility
        // refresh or manual reload.
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/status?includeManifest=true&includeSlideStates=true`,
          { credentials: "same-origin" },
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          manifest?: unknown;
          slideStates?: InitialSlideState[] | null;
        };
        if (cancelled) return;
        if (data.manifest) {
          const parsed = SlideManifestSchema.safeParse(data.manifest);
          if (parsed.success) setManifest(parsed.data);
        }
        if (!Array.isArray(data.slideStates)) return;
        const nextStates: Record<string, InitialSlideState> = {};
        const nextVersions: Record<string, HistoryRow[]> = {};
        for (const s of data.slideStates) {
          nextStates[s.slideKey] = s;
          nextVersions[s.slideKey] = s.versions ?? [];
        }
        setSlideStates(nextStates);
        setHistoryVersions(nextVersions);
      } catch {
        /* network blip — next tick retries */
      }
    };
    const interval = window.setInterval(tick, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [peerRegenInProgress, projectId]);
  // Belt-and-braces clear for the peer-regen spinner: when a slide's
  // `currentVersionNumber` ticks up (a new version landed via the
  // fat-sync fetchAndSwapState in the slide.regen.finished handler),
  // forcibly drop that slideId from peerRegenInProgress. The broadcast
  // handler's set-remove already attempts this synchronously, but in
  // practice (2026-05-24 testing) the spinner was observed to stay
  // visible even after the new slide content landed — likely a stale-
  // closure or batching race between the broadcast handler and the
  // fetchAndSwapState rerender. Reacting to `currentVersionNumber`
  // changes as a definitive "this slide just got a new version"
  // signal closes the gap without depending on the listener's success.
  const versionNumbersRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const prevVersions = versionNumbersRef.current;
    const nextVersions = new Map<string, number>();
    const newlyBumped: string[] = [];
    for (const [slideKey, state] of Object.entries(slideStates)) {
      const n = state.currentVersionNumber;
      nextVersions.set(slideKey, n);
      const prevN = prevVersions.get(slideKey);
      if (prevN !== undefined && n > prevN) newlyBumped.push(slideKey);
    }
    versionNumbersRef.current = nextVersions;
    if (newlyBumped.length === 0) return;
    setPeerRegenInProgress((prev) => {
      if (prev.size === 0) return prev;
      let dirty = false;
      const next = new Set(prev);
      for (const slideKey of newlyBumped) {
        if (next.delete(slideKey)) dirty = true;
      }
      return dirty ? next : prev;
    });
  }, [slideStates]);

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
  // `taqreer_sidebar_collapsed_changed` custom event). Initial value
  // comes from the SSR-read cookie via `initialMainSidebarWidth` so
  // first paint already has the correct width — no flash where the
  // SlideNavSidebar starts at right:260 and snaps to right:80 (or
  // vice-versa) after the localStorage read fires in the effect
  // below. The localStorage sync is still kept so toggles from
  // other tabs propagate.
  const [mainSidebarWidth, setMainSidebarWidth] = useState<number>(initialMainSidebarWidth);
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

  // Toolbar is portal'd to document.body so its z-index isn't trapped
  // by any ancestor's stacking context (transform, filter, isolation,
  // opacity != 1, etc.). `bodyMounted` gates the createPortal call so
  // we don't touch document during SSR.
  const [bodyMounted, setBodyMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBodyMounted(true);
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


  // ─── Phase 16.B presence ────────────────────────────────────────────
  // Track which collaborators are online + which slide each is focused
  // on. Skip for anonymous public-view callers (no prisma id — they're
  // not identifiable enough to render as another viewer's avatar). The
  // channel itself stays open across slide-index changes; we just
  // re-`track` the same payload with the new slideIndex / tabActive.
  const [presence, setPresence] = useState<ViewerPresence>({});
  const presenceHandleRef = useRef<ProjectChannelHandle | null>(null);
  // Mirror the live slide index in a ref so the initial-open track
  // call (inside an async effect body) sees the latest value without
  // adding currentSlideIndex to the open-channel effect's deps (which
  // would re-open the channel on every navigation).
  const slideIndexRef = useRef(currentSlideIndex);
  useEffect(() => {
    slideIndexRef.current = currentSlideIndex;
  }, [currentSlideIndex]);

  useEffect(() => {
    if (!currentUserId) return;
    let cancelled = false;
    let localHandle: ProjectChannelHandle | null = null;
    (async () => {
      // Pre-flight auth gate. Cheap (~1 row prisma lookup via
      // resolveProjectAccess); avoids opening a socket for viewers
      // who lost access between SSR + mount.
      try {
        const tokenRes = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/realtime-token`,
          { credentials: "same-origin" },
        );
        if (!tokenRes.ok) return;
      } catch {
        return;
      }
      if (cancelled) return;
      // Supabase presence key MUST be unique per viewer (prisma User.id
      // works) — otherwise everyone's metas collide into one bucket
      // and the dispatcher only surfaces the most-recent tracker, so
      // one viewer sees the other but not vice-versa.
      localHandle = openProjectChannel(projectId, currentUserId);
      localHandle.onPresenceSync((state) => {
        if (!cancelled) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- canonical "subscribe to external source" shape; the channel is what owns the state, this just mirrors it into React
          setPresence(state);
        }
      });

      // Phase 16.C — live comment sync. On `comment.created` the
      // payload is pointer-only (commentId + slideId + actorPrismaUserId),
      // so dereference via `GET ?ids={id}` for the full row before
      // merging. The original poster's tab already has the comment
      // from its POST response — de-dup by id in the setter handles
      // that. Best-effort: a failed dereference just leaves the
      // comment out of view-only sessions until they refresh.
      localHandle.on("comment.created", (payload) => {
        if (cancelled || !canComment) return;
        // Skip echo from our own write — the POST handler already
        // optimistically set local state for us; the broadcast is
        // just a redundancy net for OTHER viewers.
        if (
          currentUserId &&
          payload.actorPrismaUserId === currentUserId
        ) {
          return;
        }
        (async () => {
          try {
            const res = await fetch(
              `/api/projects/${encodeURIComponent(projectId)}/comments?ids=${encodeURIComponent(payload.commentId)}`,
              { credentials: "same-origin" },
            );
            if (!res.ok || cancelled) return;
            const data = (await res.json()) as { comments?: CommentRow[] };
            const incoming = data.comments?.[0];
            if (!incoming || cancelled) return;
            // eslint-disable-next-line react-hooks/set-state-in-effect -- canonical "subscribe to external source" shape; the channel is the source of truth, this just mirrors fresh rows in
            setComments((prev) =>
              prev.some((c) => c.id === incoming.id)
                ? prev
                : [...prev, incoming],
            );
          } catch {
            /* network blip — viewer will pick the row up on next refresh */
          }
        })();
      });
      localHandle.on("comment.deleted", (payload) => {
        if (cancelled || !canComment) return;
        if (
          currentUserId &&
          payload.actorPrismaUserId === currentUserId
        ) {
          return;
        }
        // eslint-disable-next-line react-hooks/set-state-in-effect -- canonical "subscribe to external source" shape
        setComments((prev) => prev.filter((c) => c.id !== payload.commentId));
      });

      // Phase 16.D revised — only `.finished` events fire here.
      // The `.started` broadcasts were dropped from the Inngest
      // functions: a 1-3 minute dim+spinner over an observer's
      // canvas competed with whatever they were doing during the
      // regen. Observers now stay silent on the previous version
      // until the new one is ready, then a single router.refresh
      // swaps the content. Self-echo skip — the actor's tab
      // already has the new version locally via the apply-poller.
      // Peer-regen broadcasts pull the canonical manifest + per-slide
      // state in a single round-trip and apply both in-place. We don't
      // router.refresh() because that re-runs the parent SSR and
      // re-mounts DeckView, dropping transient client state (scroll
      // position, focus, popovers, hover hints) every time another
      // viewer regenerates a slide.
      //
      // What we sync from the response:
      //   • setManifest         → canvas + nav thumbnails reflect the
      //                            regen output immediately.
      //   • setSlideStates      → lock pills + currentVersionNumber
      //                            bumps land without staleness; a peer
      //                            regen on a slide the local viewer is
      //                            focused on now shows the right pill
      //                            state on the toolbar.
      //   • setHistoryVersions  → the History popover's row list stays
      //                            current (newest-first per the server
      //                            ordering), so opening it right after
      //                            a peer regen shows the new entry on
      //                            first render — no fetch glitch.
      const fetchAndSwapState = async () => {
        try {
          const res = await fetch(
            `/api/projects/${encodeURIComponent(projectId)}/status?includeManifest=true&includeSlideStates=true`,
            { credentials: "same-origin" },
          );
          if (!res.ok || cancelled) return;
          const data = (await res.json()) as {
            manifest?: unknown;
            slideStates?: InitialSlideState[] | null;
          };
          if (cancelled) return;
          if (data.manifest) {
            const parsed = SlideManifestSchema.safeParse(data.manifest);
            if (parsed.success) setManifest(parsed.data);
          }
          if (Array.isArray(data.slideStates)) {
            const nextStates: Record<string, InitialSlideState> = {};
            const nextVersions: Record<string, HistoryRow[]> = {};
            for (const s of data.slideStates) {
              nextStates[s.slideKey] = s;
              nextVersions[s.slideKey] = s.versions ?? [];
            }
            setSlideStates(nextStates);
            setHistoryVersions(nextVersions);
          }
        } catch {
          /* network blip — viewer keeps the previous state visible */
        }
      };
      // Peer started a regen — mark the slide as in-flight so the
      // dim+spinner overlay matches the visual the actor sees. Self
      // echo is skipped: the actor's own `applying` state already
      // drives the overlay for them; emitting the broadcast also for
      // self would double-mark the slide (harmless but wasteful).
      localHandle.on("slide.regen.started", (payload) => {
        if (cancelled) return;
        if (
          currentUserId &&
          payload.actorPrismaUserId === currentUserId
        ) {
          return;
        }
        setPeerRegenInProgress((prev) => {
          if (prev.has(payload.slideId)) return prev;
          const next = new Set(prev);
          next.add(payload.slideId);
          return next;
        });
      });
      localHandle.on("slide.regen.finished", (payload) => {
        if (cancelled) return;
        // Always clear the in-flight marker BEFORE the self-echo
        // skip — a "finished" event for a peer's slide should always
        // remove the overlay, even if the actor happens to receive
        // their own echo first. (The set entries are peer-only by
        // construction, so a self-echoed remove is a cheap no-op.)
        setPeerRegenInProgress((prev) => {
          if (!prev.has(payload.slideId)) return prev;
          const next = new Set(prev);
          next.delete(payload.slideId);
          return next;
        });
        if (
          currentUserId &&
          payload.actorPrismaUserId === currentUserId
        ) {
          return;
        }
        void fetchAndSwapState();
      });
      // Peer started a FULL deck regen. Mark every slide in the current
      // manifest as in-flight so the dim+spinner overlay covers the
      // whole deck (parallel to the per-slide treatment for partial
      // regens). Manifest IDs are read off the ref-mirrored state so
      // the handler doesn't need to re-bind on every manifest update.
      // Self-echo skipped: the actor's own deck regen is tracked by
      // their `applying` state via the apply-poller.
      // Peer started a FULL deck regen. Mark every slide in the current
      // manifest as in-flight so the dim+spinner overlay covers the
      // whole deck (parallel to the per-slide treatment for partial
      // regens). Tried a progressive "generating" render path on the
      // peer (would have matched the actor's done/current/pending view)
      // but the streamingPreview slides came through inaccurate for
      // the peer in testing 2026-05-24 — reverted to the simpler
      // all-slides spinner overlay. Manifest IDs read off the
      // ref-mirrored state so the handler doesn't need to re-bind on
      // every manifest update. Self-echo skipped: the actor's own
      // deck regen is driven by their `applying` state via the
      // apply-poller.
      localHandle.on("deck.regen.started", (payload) => {
        if (cancelled) return;
        if (
          currentUserId &&
          payload.actorPrismaUserId === currentUserId
        ) {
          return;
        }
        const currentManifest = manifestRef.current;
        if (!currentManifest) return;
        const allIds = currentManifest.slides.map((s) => s.slideId);
        if (allIds.length === 0) return;
        setPeerRegenInProgress((prev) => {
          const next = new Set(prev);
          for (const id of allIds) next.add(id);
          return next;
        });
      });
      localHandle.on("deck.regen.finished", (payload) => {
        if (cancelled) return;
        // Clear the full-deck overlay regardless of who finished —
        // the cleanup is harmless for the actor (their set was never
        // populated by the started self-echo skip).
        setPeerRegenInProgress(() => new Set());
        if (
          currentUserId &&
          payload.actorPrismaUserId === currentUserId
        ) {
          return;
        }
        void fetchAndSwapState();
      });

      // Lock pulses — flip slideStates[slideKey].lockedAt in-place
      // when a peer (un)locks a slide. No fetch needed; the broadcast
      // payload carries the canonical ISO timestamp the server
      // persisted. Self-echo skip: the actor's own POST already
      // applied the optimistic update.
      localHandle.on("slide.lock.changed", (payload) => {
        if (cancelled) return;
        if (
          currentUserId &&
          payload.actorPrismaUserId === currentUserId
        ) {
          return;
        }
        setSlideStates((prev) => {
          const current = prev[payload.slideKey];
          // No row yet — synthesise a minimal one. currentVersionNumber
          // defaults to 1 here; if a peer regen also lands the
          // visibility-regain refetch or a later slide.regen.finished
          // broadcast will reconcile the full row.
          const next: InitialSlideState = current
            ? { ...current, lockedAt: payload.lockedAt }
            : {
                slideKey: payload.slideKey,
                currentVersionNumber: 1,
                lockedAt: payload.lockedAt,
                hasCachedComments: false,
              };
          return { ...prev, [payload.slideKey]: next };
        });
      });

      // Bulk lock-all / unlock-all from a peer. Server sends ONE event
      // for the whole deck (vs. N per-slide events) and we apply it
      // uniformly across every slideStates row we currently know about.
      localHandle.on("slides.locks.bulk-changed", (payload) => {
        if (cancelled) return;
        if (
          currentUserId &&
          payload.actorPrismaUserId === currentUserId
        ) {
          return;
        }
        setSlideStates((prev) => {
          const next: Record<string, InitialSlideState> = {};
          for (const [key, state] of Object.entries(prev)) {
            next[key] = { ...state, lockedAt: payload.lockedAt };
          }
          return next;
        });
      });

      presenceHandleRef.current = localHandle;
      // Initial track with current slide / visibility — the re-track
      // effect below also fires on mount but races the async open;
      // tracking here makes the user appear to others immediately
      // when the channel joins. `.catch` (not try/catch around the
      // await) because Supabase's channel.track() can reject on a
      // socket hiccup mid-open; presence is non-critical so we just
      // log and let the next re-track on slide / visibility change
      // recover.
      await localHandle
        .track({
          userId: currentUserId,
          name: currentUserName ?? null,
          avatar: currentUserImage ?? null,
          slideIndex: slideIndexRef.current,
          tabActive:
            typeof document !== "undefined"
              ? document.visibilityState !== "hidden"
              : true,
        })
        .catch((err) => {
          console.warn("[realtime] initial track failed", err);
        });
    })();
    return () => {
      cancelled = true;
      presenceHandleRef.current = null;
      localHandle?.close();
    };
    // `canComment` is read inside the broadcast handlers; including it
    // in deps reopens the channel when a role upgrade lands so the
    // listener gate flips on without a refresh. In practice role
    // changes mid-session are rare (Phase 15.E re-invite flow),
    // but keeping the dep set honest avoids the stale-closure trap.
  }, [
    projectId,
    currentUserId,
    currentUserName,
    currentUserImage,
    canComment,
  ]);

  // Re-sync everything that's normally pushed via Supabase Realtime
  // whenever the tab regains visibility. WebKit (Safari, iOS) and
  // recent Chrome both throttle / pause WebSocket activity in
  // backgrounded tabs aggressively — events that fired while the tab
  // was hidden (a peer's `comment.created`, `slide.regen.finished`,
  // etc.) are NOT replayed when the socket wakes up. Without this
  // refresh, a viewer who alt-tabs out for a minute sees a stale
  // canvas + missing comments + stale lock pills until they manually
  // reload. Per user report 2026-05-24: added a comment in Chrome,
  // switched to Safari → comment didn't appear until refresh.
  //
  // What we pull in one shot:
  //   • /comments        → fresh draft comments (covers missed
  //                         `comment.created` / `comment.deleted`)
  //   • /status?...=true → fresh manifest + slideStates (covers missed
  //                         `slide.regen.finished` / `deck.regen.finished`)
  //
  // Presence (avatars) auto-syncs when the Supabase channel reattaches
  // — we don't need to do anything here for that bucket.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handler = () => {
      if (document.visibilityState !== "visible") return;
      // Comments — gated on canComment so we don't grant view-only
      // viewers a side-channel into reading comments.
      if (canComment) {
        (async () => {
          try {
            const res = await fetch(
              `/api/projects/${encodeURIComponent(projectId)}/comments`,
              { credentials: "same-origin" },
            );
            if (!res.ok) return;
            const data = (await res.json()) as { comments?: CommentRow[] };
            if (Array.isArray(data.comments)) {
              setComments(data.comments.filter((c) => c.status === "draft"));
            }
          } catch {
            /* network blip — viewer keeps the previous comments */
          }
        })();
      }
      // Manifest + slideStates — fire regardless of canComment. Even
      // view-only viewers need fresh slide content when a peer regens
      // the deck while they're in another tab.
      (async () => {
        try {
          const res = await fetch(
            `/api/projects/${encodeURIComponent(projectId)}/status?includeManifest=true&includeSlideStates=true`,
            { credentials: "same-origin" },
          );
          if (!res.ok) return;
          const data = (await res.json()) as {
            manifest?: unknown;
            slideStates?: InitialSlideState[] | null;
          };
          if (data.manifest) {
            const parsed = SlideManifestSchema.safeParse(data.manifest);
            if (parsed.success) setManifest(parsed.data);
          }
          if (Array.isArray(data.slideStates)) {
            const nextStates: Record<string, InitialSlideState> = {};
            const nextVersions: Record<string, HistoryRow[]> = {};
            for (const s of data.slideStates) {
              nextStates[s.slideKey] = s;
              nextVersions[s.slideKey] = s.versions ?? [];
            }
            setSlideStates(nextStates);
            setHistoryVersions(nextVersions);
          }
        } catch {
          /* network blip — viewer keeps the previous state */
        }
      })();
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [projectId, canComment]);

  // Re-track on slide change + tab-visibility flip. Reads through the
  // ref so a no-op when the channel hasn't finished opening yet —
  // the initial-open path above handles the first track.
  useEffect(() => {
    if (!currentUserId) return;
    const fire = () => {
      // Track is async + fire-and-forget here — re-track is a UX
      // courtesy, not a contract, so failures just log. Without the
      // `.catch` Node / browser would surface an unhandled-rejection
      // warning every time the socket hiccups mid-track.
      presenceHandleRef.current
        ?.track({
          userId: currentUserId,
          name: currentUserName ?? null,
          avatar: currentUserImage ?? null,
          slideIndex: currentSlideIndex,
          tabActive: document.visibilityState !== "hidden",
        })
        .catch((err) => {
          console.warn("[realtime] re-track failed", err);
        });
    };
    fire();
    document.addEventListener("visibilitychange", fire);
    return () => document.removeEventListener("visibilitychange", fire);
  }, [currentSlideIndex, currentUserId, currentUserName, currentUserImage]);

  // Per-slide viewer arrays consumed by SlideNavSidebar. Filters out
  // self (own avatar doesn't appear on own sidebar — the active-
  // thumbnail border already signals "you are here") and groups
  // every other viewer by their currently-focused slideIndex.
  const viewersBySlide = useMemo(() => {
    const out: Record<number, PresenceViewer[]> = {};
    for (const viewer of Object.values(presence)) {
      if (viewer.userId === currentUserId) continue;
      const bucket = out[viewer.slideIndex] ?? (out[viewer.slideIndex] = []);
      bucket.push(viewer);
    }
    return out;
  }, [presence, currentUserId]);

  const status: DerivedStatus = polledFailure || isFailed(projectStatus, versionStatus)
    ? "failed"
    : manifest && (polledCompleted || isCompleted(projectStatus, versionStatus))
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

  // Wheel + keyboard slide navigation. Velocity-aware: a fast trackpad
  // swipe consumes many pixels of deltaY in a short window and flips
  // multiple slides in one motion; a slow scroll flips one at a time.
  // Implementation:
  //   • Accumulate `Math.abs(deltaY)` across wheel events.
  //   • Each PX_PER_SLIDE of accumulated delta = one slide flip in
  //     the current direction.
  //   • Direction change OR idle for WHEEL_IDLE_RESET_MS resets the
  //     accumulator so the next swipe starts fresh.
  //   • Wheel events ONLY apply when the cursor is over the canvas
  //     (we reuse `gridRef`, which already points to the hero
  //     `motion.div` wrapper). Outside the canvas — sidebar list,
  //     toolbar, comments panel — native scroll runs normally.
  //   • `preventDefault` runs on every wheel event the canvas
  //     consumes (regardless of whether this event flips a slide).
  //     Below-threshold deltas would otherwise leak to native page
  //     scroll while we were quietly accumulating, dragging the
  //     hero element a few pixels before the next flip lands.
  // Gates (all of these block both wheel + keyboard):
  //   - commentMode (user drawing / typing comments)
  //   - applying (regen in flight, manifest is mid-swap)
  //   - history popover open
  //   - text input / textarea / contentEditable focused
  // Keyboard mapping:
  //   ArrowDown / PageDown → next   (always, both languages)
  //   ArrowUp / PageUp     → prev
  //   ArrowRight           → EN: next, AR: prev (RTL reading flow)
  //   ArrowLeft            → EN: prev, AR: next
  //   Home / End           → first / last slide
  const wheelAccumRef = useRef(0);
  const wheelDirRef = useRef<-1 | 0 | 1>(0);
  const wheelIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (status !== "completed") return;
    if (!manifest) return;
    const totalSlides = manifest.slides.length;
    if (totalSlides <= 1) return;

    // Tunables. PX_PER_SLIDE is the "scroll throttle" — lower = more
    // sensitive (one slide per smaller swipe), higher = slower flip
    // for the same scroll. 80px lands at "1 trackpad click ≈ 1 slide,
    // a fast swipe ≈ 4-8 slides" in practice.
    const PX_PER_SLIDE = 80;
    const WHEEL_IDLE_RESET_MS = 220;

    // Treat the deck language as authoritative for arrow-key mapping:
    // RTL reading flow makes ArrowLeft → advance natural for AR.
    const isLtr = (manifest.language ?? "ar") === "en";

    const isNavBlocked = (): boolean => {
      if (commentMode) return true;
      if (applying != null) return true;
      if (historyAnchor != null) return true;
      // Text inputs / textareas / contentEditable: let the user type
      // / Backspace-delete without trapping the cursor on a slide flip.
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable)
      ) {
        return true;
      }
      return false;
    };

    const goto = (delta: number) => {
      setCurrentSlideIndex((prev) => {
        const next = prev + delta;
        return Math.max(0, Math.min(totalSlides - 1, next));
      });
    };

    const handleWheel = (e: WheelEvent) => {
      // Only intercept wheel events targeting the hero canvas. The
      // sidebar's overflow-y scroll, the comments panel, popover
      // bodies — all keep native wheel behavior. `gridRef` is the
      // existing canvas-wrapper motion.div used by HeroCommentOverlay
      // for measurement; reusing it keeps the "what counts as the
      // canvas?" question single-sourced.
      const canvas = gridRef.current;
      const target = e.target as Node | null;
      if (!canvas || !target || !canvas.contains(target)) return;

      // Gating runs AFTER the canvas-hover check — outside the canvas
      // we don't want to silently swallow scrolls even when blocked.
      if (isNavBlocked()) return;

      // Wheel-over-canvas always blocks page scroll. Sub-threshold
      // accumulating deltas (e.g. a slow trackpad scroll before the
      // first flip lands) would otherwise drag the hero element by a
      // few pixels before the navigation kicks in (user-reported
      // 2026-05-20 "canvas drags a bit"). Calling preventDefault on
      // every consumed wheel event keeps the canvas pinned in place
      // throughout the entire swipe.
      e.preventDefault();

      const dir: 1 | -1 = e.deltaY > 0 ? 1 : -1;
      // Direction change resets the accumulator — switching from
      // scrolling down to scrolling up shouldn't carry leftover
      // momentum into the reverse flip.
      if (wheelDirRef.current !== 0 && wheelDirRef.current !== dir) {
        wheelAccumRef.current = 0;
      }
      wheelDirRef.current = dir;
      wheelAccumRef.current += Math.abs(e.deltaY);

      const slidesToFlip = Math.floor(wheelAccumRef.current / PX_PER_SLIDE);
      if (slidesToFlip > 0) {
        wheelAccumRef.current -= slidesToFlip * PX_PER_SLIDE;
        goto(dir * slidesToFlip);
      }

      if (wheelIdleTimerRef.current) {
        clearTimeout(wheelIdleTimerRef.current);
      }
      wheelIdleTimerRef.current = setTimeout(() => {
        wheelAccumRef.current = 0;
        wheelDirRef.current = 0;
      }, WHEEL_IDLE_RESET_MS);
    };

    const handleKey = (e: KeyboardEvent) => {
      if (isNavBlocked()) return;
      // Modifier keys → leave for native shortcuts (refresh, devtools, etc.)
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case "ArrowDown":
        case "PageDown":
          e.preventDefault();
          goto(1);
          return;
        case "ArrowUp":
        case "PageUp":
          e.preventDefault();
          goto(-1);
          return;
        case "ArrowRight":
          e.preventDefault();
          goto(isLtr ? 1 : -1);
          return;
        case "ArrowLeft":
          e.preventDefault();
          goto(isLtr ? -1 : 1);
          return;
        case "Home":
          e.preventDefault();
          setCurrentSlideIndex(0);
          return;
        case "End":
          e.preventDefault();
          setCurrentSlideIndex(totalSlides - 1);
          return;
        default:
          return;
      }
    };

    // `passive: false` so preventDefault works on the wheel handler.
    // Without it Chrome treats touchpad wheel listeners as passive
    // by default and our preventDefault is a no-op.
    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("keydown", handleKey);
      if (wheelIdleTimerRef.current) {
        clearTimeout(wheelIdleTimerRef.current);
        wheelIdleTimerRef.current = null;
      }
    };
  }, [status, manifest, commentMode, applying, historyAnchor]);

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
        // `includeManifest=true` so the completion branch below has
        // the canonical manifest in-hand and can swap it via
        // setManifest without a `router.refresh()` cycle. The
        // server only attaches the manifest payload when the latest
        // version is completed, so the polling path during
        // "generating" pays no extra bandwidth.
        const res = await fetch(
          `/api/projects/${projectId}/status?includeManifest=true`,
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          status: string;
          slideCount: number;
          progress: Progress | null;
          streamingPreview?: unknown[] | null;
          // Parallel boolean array — see comment on the matching server
          // field. Null/missing for /create runs; present and zip-aligned
          // with streamingPreview on /enhance|mimic|data.
          streamingPreviewDraft?: unknown[] | null;
          // Monotonic manifest-version token. See refs above for how
          // this drives the version-aware stale-poll guard. Null
          // /missing on older in-flight runs (treated as version 0
          // → equal to our initial ref, falls through to length-only).
          streamingManifestVersion?: number | null;
          streamingTheme?: unknown;
          streamingDirection?: "rtl" | "ltr" | null;
          streamingLanguage?: "ar" | "en" | null;
          manifest?: unknown;
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
          // Coerce the parallel draft array to clean booleans (defensive
          // even though the server already validated). Pad to the validated
          // length with `false` so the two arrays stay strictly zip-aligned
          // even if the server briefly emitted one before the other (race
          // window during writeProgress snapshot — `.slice()` is per-array
          // and a poll in between could see mismatched lengths).
          const draftFlags: boolean[] = [];
          const rawDraft = Array.isArray(data.streamingPreviewDraft)
            ? data.streamingPreviewDraft
            : [];
          for (let i = 0; i < validated.length; i += 1) {
            draftFlags.push(rawDraft[i] === true);
          }
          // ─── Stale-poll guard (2026-05-25, version-aware) ──────────
          // Three layered conditions decide whether to accept this
          // snapshot:
          //   (a) `incomingVersion < lastAccepted` → reject. The poll
          //       carries server state older than what we already
          //       displayed (two-polls-in-flight, older one returns
          //       last). Pre-fix length-only guard couldn't catch
          //       this when both polls happened to carry the same
          //       `streamingPreview.length`.
          //   (b) `incomingVersion > lastAccepted` → only accept once
          //       the new version's length catches up to the
          //       high-watermark of the previous version. Preserves
          //       the deliberate UX where draft slides stay visible
          //       until the polished pass replaces them (server
          //       clears its array on `didReset` + bumps version;
          //       the brief empty window shouldn't blank the screen).
          //   (c) Same version → fall back to length-only monotonic
          //       (catches retry-induced shrinkage within a manifest
          //       attempt). Always update the high-watermark when
          //       we grow.
          // Missing `streamingManifestVersion` (older in-flight runs
          // pre-deploy) is coerced to 0, which equals the initial
          // ref value, so the guard falls through to length-only —
          // identical behavior to the pre-fix code path.
          const incomingVersion =
            typeof data.streamingManifestVersion === "number" &&
            Number.isFinite(data.streamingManifestVersion)
              ? data.streamingManifestVersion
              : 0;
          setStreamingPreview((prev) => {
            const lastVersion = lastManifestVersionRef.current;
            // (a) Stale — older server version than what we last accepted.
            if (incomingVersion < lastVersion) {
              return prev;
            }
            // (b) Newer version — gate on catching up to the prior
            // version's high-watermark to avoid blanking the preview
            // during the draft→polished transition.
            if (incomingVersion > lastVersion) {
              if (validated.length >= highWatermarkRef.current) {
                lastManifestVersionRef.current = incomingVersion;
                highWatermarkRef.current = validated.length;
                setStreamingPreviewDraft(draftFlags);
                return validated;
              }
              // Polished pass still ramping up — hold the prior view.
              return prev;
            }
            // (c) Same version — legacy length-only monotonic guard.
            if (validated.length >= prev.length) {
              if (validated.length > highWatermarkRef.current) {
                highWatermarkRef.current = validated.length;
              }
              setStreamingPreviewDraft(draftFlags);
              return validated;
            }
            return prev;
          });
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
          // Swap manifest in-place if the server attached it (it
          // does so when latestVersion?.status === "completed"),
          // then flip the local `polledCompleted` flag so the
          // derived status escapes "generating" without a
          // router.refresh(). The parent SSR still believes the
          // project is queued/generating until the next user-driven
          // navigation, but DeckView renders the completed canvas
          // immediately — no flash, no transient-client-state loss.
          if (data.manifest) {
            const parsed = SlideManifestSchema.safeParse(data.manifest);
            if (parsed.success) setManifest(parsed.data);
          }
          setPolledCompleted(true);
          // Stop polling — completion is terminal. The interval
          // clearInterval lives in the cleanup function; setting
          // cancelled aborts any in-flight tick, and the
          // polledCompleted state flip will re-render → the effect
          // re-evaluates `status !== "generating"` and returns
          // early on the next render, leaving the cleanup to clear
          // the interval.
          cancelled = true;
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
  }, [projectId, status]);

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
  //
  // Phase 15.A — gated on `canComment`. View-only viewers never see the
  // comment UI; skipping the fetch saves a round-trip on every public-
  // view load (also, the server now rejects view callers on the
  // comments routes — without the gate the request would 403/404 and
  // spam the console with errors).
  useEffect(() => {
    if (status !== "completed") return;
    if (!canComment) return;
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
  }, [projectId, status, manifest?.presentationId, canComment]);

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
  //   3. No `progress` advancement for 240 s while pinned & queued →
  //      treat as stuck / cancelled (Inngest-cancelled case).
  //   4. ≥5 consecutive fetch failures → server / network disconnect.
  //   5. Hard 10-min cap as a final fallback.
  //
  // The 240 s stuck threshold (bumped from 60 s on 2026-05-24) reflects
  // the all-Opus thinking tiers landed earlier today: Opus 4.7 on
  // adaptive thinking can routinely spend 60-180 s in the thinking
  // phase before the model emits its first JSON token, and during
  // that window NEITHER `stage` nor `currentSlide` advances — so the
  // old 60 s watchdog false-positived a perfectly healthy regen and
  // tore down the poller mid-flight. Side effect of that tear-down
  // (which the user reported the same day): when the regen actually
  // finished, no poller was alive to see versionStatus flip to
  // "completed", so the manifest never swapped in-place and the user
  // had to refresh. Treating `thinkingTokens` advancement as a
  // heartbeat below additionally covers the full-deck case where
  // thinking is throttled-updated ~1×/sec.
  useEffect(() => {
    if (!applying) return;
    let cancelled = false;
    const applyStartedAt = Date.now();
    const APPLY_TIMEOUT_MS = 10 * 60 * 1000;
    const STUCK_NO_PROGRESS_MS = 240 * 1000;
    const MAX_CONSECUTIVE_ERRORS = 5;
    let lastProgressMs = Date.now();
    let lastProgressSlide = 0;
    let lastProgressStage: string | null = null;
    let lastThinkingTokens = 0;
    let consecutiveErrors = 0;
    const failApply = (message: string) => {
      if (cancelled) return;
      setApplying(null);
      notificationStore.push({
        kind: "warning",
        title: "تعذر تطبيق التعليقات",
        desc: `${projectTitle} — ${message}`,
        // /project is the canonical working-session URL post route
        // split. A "apply comments failed" notification dropped via
        // bell links the user back to where they can retry — that's
        // the working session, never /preview (which only serves
        // mid-stream generations + SSR-redirects to /project when
        // the deck is ready).
        href: `/project/${projectId}`,
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
            ? `?versionId=${encodeURIComponent(applying.versionId)}&includeSlideStates=true`
            : "?includeSlideStates=true";
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
          // `thinkingTokens` rides along in the same JSON column slot
          // even though the status route's Progress type guard doesn't
          // declare it — `deck-generate.ts` writes it via the `extra`
          // spread on each thinking delta. We read it here as a
          // heartbeat signal during the thinking phase, where neither
          // `currentSlide` nor `stage` advances.
          progress: {
            stage: string;
            currentSlide: number;
            thinkingTokens?: number;
          } | null;
          // Status route returns the full manifest alongside the version
          // status when (a) the caller pinned a versionId and (b) that
          // version is completed. Used here to swap in the spliced
          // slides without depending on Supabase Realtime (which the
          // local docker Postgres doesn't broadcast) or `router.refresh()`
          // (RSC payload caching has been unreliable).
          manifest?: unknown;
          // `slideStates` rides along when `includeSlideStates=true` is
          // set. Carries per-slide `versions[]` lists so the History
          // popover sees the new version row land WITHOUT requiring a
          // page refresh — fix 2026-05-24: actor's own regen finished
          // didn't update history because the broadcast handler self-
          // echo-skips, leaving the apply-poller as the only completion
          // signal. Apply-poller now mirrors what the peer-broadcast
          // handler does: setManifest + setSlideStates + setHistoryVersions.
          slideStates?: InitialSlideState[] | null;
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
          // broadcast from the docker Postgres, so we couldn't lean
          // on a `slide.regen.finished` broadcast to do the swap for
          // the OWN-actor path. Schema-validate before assigning so
          // a malformed payload can't corrupt the visible deck.
          // We no longer call `router.refresh()` after — setManifest
          // updates the canvas in-place, and the SSR re-render is
          // unnecessary (per-slide pill state ride along on the
          // applied-slide payload from `apply-comments`; the parent's
          // initialSlideStates may stay slightly stale but it doesn't
          // affect what the user sees).
          if (data.manifest) {
            const parsed = SlideManifestSchema.safeParse(data.manifest);
            if (parsed.success) setManifest(parsed.data);
          }
          // Mirror the peer-broadcast handler: refresh slideStates +
          // historyVersions from the same status payload so the
          // History popover reflects the new version immediately. The
          // actor used to have to refresh the page to see the regen's
          // row land in History — the broadcast handler skips self,
          // and this poller previously only updated the manifest.
          if (Array.isArray(data.slideStates)) {
            const nextStates: Record<string, InitialSlideState> = {};
            const nextVersions: Record<string, HistoryRow[]> = {};
            for (const s of data.slideStates) {
              nextStates[s.slideKey] = s;
              nextVersions[s.slideKey] = s.versions ?? [];
            }
            setSlideStates(nextStates);
            setHistoryVersions(nextVersions);
          }
          setApplying(null);
          setComments([]);
          setCommentMode(false);
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

        // Update progress watermark if it advanced. Three signals
        // qualify as "the run is alive":
        //   (a) `currentSlide` ticked up — a slide closed in the stream
        //   (b) `stage` transitioned (thinking → designing → validating
        //       → saving)
        //   (c) `thinkingTokens` advanced — deck-generate writes this
        //       on each thinking delta (~1×/sec). Critical for Opus
        //       which can spend minutes in adaptive-thinking before
        //       (a) or (b) ever change. Partial regen doesn't emit
        //       thinkingTokens today; for that path the 240 s stuck
        //       threshold above is the safety net.
        if (
          data.progress &&
          (data.progress.currentSlide !== lastProgressSlide ||
            data.progress.stage !== lastProgressStage ||
            (typeof data.progress.thinkingTokens === "number" &&
              data.progress.thinkingTokens > lastThinkingTokens))
        ) {
          lastProgressMs = Date.now();
          lastProgressSlide = data.progress.currentSlide;
          lastProgressStage = data.progress.stage;
          if (typeof data.progress.thinkingTokens === "number") {
            lastThinkingTokens = data.progress.thinkingTokens;
          }
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
    } else if (status === 423) {
      // Server-side lock guard from POST /comments. Fires when a peer
      // locked the slide before the local optimistic create made it
      // to the server — the client gate hides comment-mode on locked
      // slides but a stale broadcast leaves a small window where the
      // local view still thinks the slide is unlocked.
      message = "هذه الشريحة مقفلة — قم بفك القفل قبل إضافة تعليقات.";
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
        target.closest('[data-preview-toolbar="true"]') || // PreviewActionBar wrapper
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

  // Bulk lock / unlock — driven by the SlideNavSidebar footer pill.
  // Walks the current manifest's slide list, builds an optimistic
  // snapshot with every slide's lockedAt flipped, then POSTs the
  // bulk endpoint. On error we leave the optimistic state in place
  // Revert on failure (user-flagged via CR 2026-05-21): the sidebar
  // pill label flips based on the global locked count, and per-slide
  // `locked` badges drive UI everywhere. If the bulk API errors and
  // we leave the optimistic flip in place, the deck appears locked
  // while the server says otherwise — the user can't tell. Capturing
  // the previous state before the optimistic update and restoring it
  // in the catch path keeps UI honest on failure. Idempotent server-
  // side still (re-lock keeps original lockedAt; re-unlock no-ops).
  const bulkSetLock = useCallback(
    async (lock: boolean) => {
      if (!manifest) return;
      const nowIso = new Date().toISOString();
      let previousStates: Record<string, InitialSlideState> | null = null;
      setSlideStates((prev) => {
        previousStates = prev;
        const next: Record<string, InitialSlideState> = { ...prev };
        for (const slide of manifest.slides) {
          const current = prev[slide.slideId];
          next[slide.slideId] = {
            slideKey: slide.slideId,
            currentVersionNumber: current?.currentVersionNumber ?? 1,
            hasCachedComments: current?.hasCachedComments ?? false,
            // On lock: keep existing lockedAt if already set (matches
            // server idempotency); otherwise stamp now.
            // On unlock: always null.
            lockedAt: lock ? (current?.lockedAt ?? nowIso) : null,
          };
        }
        return next;
      });
      try {
        const res = await fetch(
          `/api/projects/${projectId}/slides/lock-all`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ locked: lock }),
          },
        );
        if (!res.ok) throw new Error(`lock-all: ${res.status}`);
      } catch (err) {
        // Restore the previous state so the sidebar's "All locked /
        // Lock all" label + per-slide badges reflect server truth.
        if (previousStates) {
          setSlideStates(previousStates);
        }
        console.error("bulk lock failed", err);
      }
    },
    [manifest, projectId],
  );

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
          // Flag drives the small "مسودة" chip in SlideNavSidebar. True
          // only when the server tagged this slide as belonging to
          // Claude's first manifest pass (drafting). Undefined / false
          // → no chip. Field is absent on /create runs by design.
          draft: streamingPreviewDraft[idx] === true,
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
        // `dir={streamingDirection}` (was hardcoded "rtl") so an EN
        // deck's generating layout flows LTR — the previous hardcoded
        // RTL produced thumbnails that read right-aligned inside the
        // hero canvas and got visually clipped against the LTR slide
        // content. The completed-state branch below already uses
        // `dir={manifest!.direction}`; this brings the generating
        // branch into parity.
        dir={streamingDirection}
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
          // Generating-branch language signal — sourced from the
          // brief (streamLanguage) up-thread, NOT the manifest
          // (which doesn't exist yet). EN decks need this so the
          // sidebar reads LTR even before the first slide closes.
          language={streamingLanguage}
          viewersBySlide={viewersBySlide}
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
            className="glass-card relative flex items-center justify-center overflow-hidden"
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
                    during silent thinking, "extracting" during the
                    designing stage (this caption is only visible when
                    NO real slide has rendered in the hero, so "designing
                    slide X of Y" was misleading — the design hasn't
                    landed yet; we're still preparing), validating /
                    saving on the tail. /create's fast slide streaming
                    swaps in a real hero slide before this branch is
                    ever shown, so this copy is in practice an /enhance
                    (long-thinking-then-burst) message. */}
                <div className="text-muted flex items-center justify-center gap-3 text-sm">
                  <span className="spinner h-4 w-4 rounded-full border-2 border-white/20 border-t-white" />
                  <span>
                    {progress?.stage === "thinking"
                      ? "التفكير..."
                      : progress?.stage === "validating"
                        ? "التحقق من المخرجات..."
                        : progress?.stage === "saving"
                          ? "حفظ العرض..."
                          : progress?.currentSlide
                            ? "جارٍ استخراج النص والهوية البصرية..."
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
    regenerating:
      !!applying?.targetSlideIds.includes(slide.slideId) ||
      peerRegenInProgress.has(slide.slideId),
    locked: slideStates[slide.slideId]?.lockedAt != null,
  }));
  // Phase 16.D revised (re-revised 2026-05-24) — observers now ALSO see
  // the dim+spinner overlay for peer regens. Unioning `applying`
  // (actor's own slides) with `peerRegenInProgress` (slides a peer
  // started regenerating, set/cleared by the project channel started+
  // finished broadcasts) keeps a single overlay path for both cases.
  // User accepted the friction trade-off: the live spinner is the
  // most legible "someone is changing this — don't start your own
  // edit yet" cue, worth the visual cost for the regen window.
  const isFocusedRegenerating =
    !!applying?.targetSlideIds.includes(focusedSlide.slideId) ||
    peerRegenInProgress.has(focusedSlide.slideId);
  // Hero width clamp — two candidates, smallest wins:
  //   • viewport-height-derived width (so hero never exceeds the
  //     remaining vertical space given its aspect ratio)
  //   • the row's full width (side panels are fixed-positioned
  //     outside the section, so the row reserves nothing).
  const heroWidthCss = `min(calc((100vh - ${HERO_VERTICAL_PADDING_PX}px) * ${canvasW} / ${canvasH}), 100%)`;

  // Saved-state comparator. Two halves, both required for "saved":
  //   1. Version pointer matches (catches partial regen + full regen,
  //      which both bump currentVersionId).
  //   2. Every live SlideState.currentVersionNumber matches the
  //      snapshot taken at save time (catches per-slide restore,
  //      which mutates PresentationVersion.slideJson IN PLACE and
  //      leaves currentVersionId untouched).
  // Slides that exist in slideStates but NOT in the snapshot count
  // as mismatches — defensive against a SlideState being created
  // post-save (which shouldn't happen in normal flow but would
  // otherwise read as "saved" silently).
  const isSaved = (() => {
    if (savedVersionId == null) return false;
    if (initialVersionId == null) return false;
    if (savedVersionId !== initialVersionId) return false;
    if (savedSlideVersions == null) {
      // Project was saved before the per-slide snapshot column
      // landed — fall back to the pointer-only comparison. New
      // saves populate the snapshot, so this branch dies off
      // naturally once the user clicks save again.
      return true;
    }
    for (const [slideKey, state] of Object.entries(slideStates)) {
      if (savedSlideVersions[slideKey] !== state.currentVersionNumber) {
        return false;
      }
    }
    return true;
  })();
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
              // Sidebar reading direction follows the deck's language —
              // EN decks flip to LTR so the visual #1 lands on the left
              // (user feedback 2026-05-20). Defaults to "ar" if missing.
              language={manifest!.language === "en" ? "en" : "ar"}
              // Bulk lock pill is hidden for non-edit roles (SlideNavSidebar
              // already auto-hides when both callbacks are omitted). Same
              // gating logic as the per-slide lock toggle in NavItem,
              // which checks canEdit before firing onToggleLock.
              onLockAll={canEdit ? () => bulkSetLock(true) : undefined}
              onUnlockAll={canEdit ? () => bulkSetLock(false) : undefined}
              viewersBySlide={viewersBySlide}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Universal toolbar. Portal'd to document.body so its z-index
          isn't trapped by any ancestor stacking context (transform,
          filter, isolation, opacity != 1, etc.). pointer-events-none
          on the full-height fixed strip so it never intercepts clicks
          outside the toolbar's actual buttons. */}
      {/* Toolbar — portal'd to document.body as a vertical fixed-left
          strip. Portal pattern guarantees its z-index isn't trapped
          by any ancestor's stacking context (transform, filter,
          isolation, opacity != 1, etc.). pointer-events-none on the
          full-height fixed strip so it never intercepts clicks
          outside the toolbar's actual buttons.
          Briefly experimented (2026-05-23) with moving the toolbar
          into the canvas column as a horizontal pill above the
          slide, hoping the canvas could reclaim the left margin.
          The recovered space turned out to be negligible because the
          canvas was already viewport-height-constrained, not width-
          constrained, on a typical desktop — so the toolbar moved
          back to its original vertical-left position. */}
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
                  role={role}
                  projectTitle={projectTitle}
                  manifest={manifest!}
                  commentMode={commentMode}
                  onToggleCommentMode={handleToggleCommentMode}
                  draftCommentCount={comments.length}
                  // Locked focused slide → PreviewActionBar disables
                  // the Comment button (only the toggle-out path
                  // stays live if commentMode is already on; see
                  // its prop-doc). Mirrors the HeroCommentOverlay
                  // gate further down — same source of truth, just
                  // surfaced in the toolbar too so the user knows
                  // why "+ comment" doesn't work before clicking.
                  focusedSlideLocked={
                    slideStates[focusedSlide.slideId]?.lockedAt != null
                  }
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
                  currentVersionId={initialVersionId ?? null}
                  isSaved={isSaved}
                  onSaved={(payload) => {
                    setSavedVersionId(payload.savedVersionId);
                    setSavedSlideVersions(payload.savedSlideVersions);
                  }}
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
          //
          // NO `overflow-hidden` here — the ring's `::after` is now
          // drawn at `inset:-5px`, halo-style OUTSIDE the canvas, so
          // any ancestor clip would chop the halo. The clip needed
          // for the SlideRenderer's scaled content moved down to
          // the inner wrapper below.
          className={`canvas-gradient-border group/canvas relative p-0 shadow-2xl${
            commentMode ? " cursor-crosshair" : ""
          }`}
          data-active={commentMode ? "true" : "false"}
        >
          {/* Slide content. `overflow-hidden` clips the scaled
              SlideRenderer so it can't bleed past the canvas while
              the outer halo ring extends freely. The previous
              `filter: blur(20px)` during regen was replaced with a
              full-canvas dim overlay (sibling below) per direction
              2026-05-23 — the blur left white slides bright and
              required a separate dark chip behind the spinner; a
              flat dim gives the spinner readable contrast against
              any slide background without an extra chrome chip. */}
          <div className="h-full w-full overflow-hidden">
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
              Lock. Mounted inside the canvas-gradient-border
              container so it inherits the `group/canvas` hover
              state, fading in on canvas hover.
              Hidden while the slide is being regenerated (the
              blur + spinner overlay owns the canvas) AND while
              the user is in comment mode (the comment overlay
              owns the canvas; the pill would steal cursor focus
              from drag-to-draw). */}
          {!isFocusedRegenerating && !commentMode && !markerPreviewOpen && canEdit ? (
            <SlidePill
              currentVersionNumber={
                slideStates[focusedSlide.slideId]?.currentVersionNumber ?? 1
              }
              isLocked={
                slideStates[focusedSlide.slideId]?.lockedAt != null
              }
              // Keep the pill fully opaque while THIS slide's history
              // popover is open OR is animating out — without latching
              // through the exit phase the pill flickered the instant
              // historyAnchor flipped to null (cursor was still over
              // the fading popover, not the canvas).
              popoverOpen={
                popoverEngaged &&
                historySlideKey === focusedSlide.slideId
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
              onRegen={async () => {
                // Clean partial regen of the focused slide — no
                // user comments. Sets `applying` so the existing
                // per-slide regenerating overlay (blur + spinner)
                // shows up immediately while the API + Inngest
                // worker churn. Server clears the slide's cached
                // comments as part of the same write.
                if (applying) return;
                if (slideStates[focusedSlide.slideId]?.lockedAt != null)
                  return;
                setApplying({
                  versionId: "__pending__",
                  targetSlideIds: [focusedSlide.slideId],
                });
                try {
                  const res = await fetch(
                    `/api/projects/${projectId}/slides/${encodeURIComponent(focusedSlide.slideId)}/regen`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ replay: false }),
                    },
                  );
                  if (!res.ok) {
                    const errorBody = (await res.json().catch(() => null)) as
                      | { error?: string }
                      | null;
                    throw new Error(errorBody?.error ?? "regen failed");
                  }
                  const data = (await res.json()) as {
                    versionId: string;
                    targetSlideIds: string[];
                  };
                  setApplying({
                    versionId: data.versionId,
                    targetSlideIds: data.targetSlideIds,
                  });
                  // Optimistically clear the cache locally — the
                  // Inngest worker will do the same server-side
                  // when it commits the new version.
                  setSlideStates((prev) => {
                    const current = prev[focusedSlide.slideId];
                    return {
                      ...prev,
                      [focusedSlide.slideId]: {
                        slideKey: focusedSlide.slideId,
                        currentVersionNumber:
                          current?.currentVersionNumber ?? 1,
                        hasCachedComments: false,
                        lockedAt: current?.lockedAt ?? null,
                      },
                    };
                  });
                } catch (err) {
                  console.error("regen failed", err);
                  setApplying(null);
                }
              }}
              onOpenHistory={async (rect) => {
                // Pill is stateless w.r.t. popover open/closed —
                // every click here is a TOGGLE relative to the
                // parent's current historyAnchor. If the popover
                // is already open for this slide, close it; else
                // open it at the new rect.
                if (historyAnchor != null) {
                  setHistoryAnchor(null);
                  setHistorySlideKey(null);
                  return;
                }
                if (!rect) return;
                setHistoryAnchor(rect);
                setHistorySlideKey(focusedSlide.slideId);
                setPopoverEngaged(true);
                // Lazy-fetch versions on open. Cached per slide so
                // re-opening the same slide skips the round-trip.
                if (!historyVersions[focusedSlide.slideId]) {
                  try {
                    const res = await fetch(
                      `/api/projects/${projectId}/slides/${encodeURIComponent(focusedSlide.slideId)}/versions`,
                    );
                    if (!res.ok) throw new Error(`versions: ${res.status}`);
                    const data = (await res.json()) as {
                      currentVersionNumber: number | null;
                      versions: HistoryRow[];
                    };
                    setHistoryVersions((prev) => ({
                      ...prev,
                      [focusedSlide.slideId]: data.versions,
                    }));
                  } catch (err) {
                    console.error("history fetch failed", err);
                  }
                }
              }}
            />
          ) : null}

          {/* Regenerating overlay — full-canvas dim + clean spinner.
              The dim layer uses `var(--tq-bg-dim)` (the same 55 %
              dark token the popovers use) so the white spinner reads
              cleanly on any slide background, including bright /
              white ones, without needing a separate chip chrome
              behind it. Replaces the previous filter:blur(20px) on
              the slide content + dim-chip combo (direction
              2026-05-23). */}
          {isFocusedRegenerating ? (
            <div
              // `dir="rtl"` so the trailing ASCII `...` lands on the
              // visual LEFT (end of an RTL line) instead of the
              // visual RIGHT. Without it the overlay inherits the
              // canvas row's `dir="ltr"`, the Unicode BiDi algorithm
              // treats `...` as a neutral run at line start, and the
              // dots render at the visual LEFT BEFORE the Arabic
              // ("... جارٍ إعادة التصميم") instead of after it.
              dir="rtl"
              className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-white"
              style={{ backgroundColor: "var(--tq-bg-dim)" }}
            >
              <span className="spinner h-7 w-7 rounded-full border-2 border-white/30 border-t-white" />
              <span className="text-xs font-medium">
                جارٍ إعادة التصميم...
              </span>
            </div>
          ) : null}

          {/* Comment overlay — drag-to-draw + pins + editor popover.
              Only mounted while commentMode is on so its mouse
              capture doesn't intercept regular interactions outside
              the commenting flow. */}
          {/* Always mounted (Phase 16.C) so READ-ONLY pins render
              for the slide regardless of whether THIS viewer is in
              comment mode. Otherwise tab B (just observing) wouldn't
              see markers when tab A creates a comment, defeating the
              live-comment broadcast we wired up. Interactivity (drag
              to create, click pin to edit) is still gated via the
              `commentMode` prop — pins are visual-only when off.
              Gated overall on `canComment` so pure view-only viewers
              don't even see the markers. */}
          {/* Hide the overlay entirely during a partial regen on
              this slide — otherwise the orange pins sit on top of
              the blur layer and read as decorative debris over the
              regenerating slide. The blur + spinner own the visual
              during that window; markers come back as soon as the
              new version lands and `isFocusedRegenerating` clears. */}
          {canComment && !isFocusedRegenerating ? (
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
              // For per-comment delete affordance gating: a viewer
              // who's NOT canEdit can only delete their own comments.
              // owner / edit see delete on everything (moderation).
              canModerate={canEdit}
              currentUserId={currentUserId}
              // Locked slides are "finalised" per the product
              // contract — no new comment markers are allowed on
              // them. We override `commentMode` to false on the
              // focused slide when it's locked so the overlay stays
              // in its read-only mode (existing markers still visible
              // + clickable for the preview popup; click-to-create is
              // suppressed). Switching to an unlocked slide restores
              // interactivity without leaving / re-entering comment
              // mode on the toolbar.
              commentMode={
                commentMode &&
                slideStates[focusedSlide.slideId]?.lockedAt == null
              }
              // Fires when the user clicks "Edit" inside the read-
              // only marker preview popup. HeroCommentOverlay has
              // already opened its `editor` state on the chosen
              // comment; we just flip commentMode so the editor
              // popover actually renders (gated on `isInteractive`
              // there).
              onRequestCommentMode={
                canComment ? () => setCommentMode(true) : undefined
              }
              onPreviewOpenChange={setMarkerPreviewOpen}
            />
          ) : null}
        </motion.div>
      </div>
      {/* History popover — portals to body so the canvas's
          overflow-hidden + z-index don't clip it. Owned by DeckView
          rather than SlidePill because the popover survives canvas-
          hover state changes (closing on mouseleave would be wrong
          — user might leave to click a row). */}
      <HistoryPopover
        open={historyAnchor != null && historySlideKey != null}
        triggerRect={historyAnchor}
        // Fires after the popover's fade-out animation completes.
        // Releases the pill's `popoverEngaged` latch so it returns
        // to canvas-hover-only visibility.
        onExitComplete={() => setPopoverEngaged(false)}
        versions={
          historySlideKey ? (historyVersions[historySlideKey] ?? []) : []
        }
        currentVersionNumber={
          historySlideKey
            ? (slideStates[historySlideKey]?.currentVersionNumber ?? null)
            : null
        }
        busy={historyBusy}
        onClose={() => {
          setHistoryAnchor(null);
          setHistorySlideKey(null);
        }}
        onRestore={async (versionNumber) => {
          if (!historySlideKey) return;
          const targetSlideKey = historySlideKey;
          // Capture the slide's pre-optimistic version BEFORE the
          // setSlideStates call below mutates it — fixes a CR-flagged
          // bug where the catch path was reading `current` AFTER the
          // optimistic write and "reverting" to the same value that
          // was just set, making the rollback a no-op. Now `prevVersionNumber`
          // holds the original currentVersionNumber and the catch path
          // restores it for real.
          const prevVersionNumber =
            slideStates[targetSlideKey]?.currentVersionNumber ?? null;
          // CLOSE THE POPOVER FIRST — start the exit animation
          // immediately so the click feels responsive. The async
          // work below splices the slide into the manifest after.
          // Previously we awaited both the /restore call AND a
          // followup /versions refetch BEFORE closing the popover,
          // leaving the popover frozen at full opacity for ~500 ms.
          // Optimistic local pointer update so the highlighted
          // "current" row would have already moved if the popover
          // weren't unmounting — keeps the projects table in sync
          // before the server response.
          setSlideStates((prev) => {
            const current = prev[targetSlideKey];
            return {
              ...prev,
              [targetSlideKey]: {
                slideKey: targetSlideKey,
                currentVersionNumber: versionNumber,
                hasCachedComments: current?.hasCachedComments ?? false,
                lockedAt: current?.lockedAt ?? null,
              },
            };
          });
          setHistoryAnchor(null);
          setHistorySlideKey(null);
          try {
            const res = await fetch(
              `/api/projects/${projectId}/slides/${encodeURIComponent(targetSlideKey)}/restore`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ versionNumber }),
              },
            );
            if (!res.ok) throw new Error(`restore: ${res.status}`);
            const data = (await res.json()) as {
              currentVersionNumber: number;
              slide: SlideType;
            };
            // Splice the returned slide into the manifest so the
            // hero renders the restored version. NOT clearing the
            // historyVersions cache — restore is non-destructive,
            // the list didn't change.
            applyRestoredSlide(targetSlideKey, data);
          } catch (err) {
            console.error("restore failed", err);
            // Revert to the version captured BEFORE the optimistic
            // write (now in `prevVersionNumber`). If the slide had
            // no SlideState row to begin with (prevVersionNumber ==
            // null) we leave the row alone — there was nothing to
            // restore to that didn't exist before.
            if (prevVersionNumber != null) {
              setSlideStates((prev) => {
                const current = prev[targetSlideKey];
                if (!current) return prev;
                return {
                  ...prev,
                  [targetSlideKey]: {
                    ...current,
                    currentVersionNumber: prevVersionNumber,
                  },
                };
              });
            }
          }
        }}
      />
    </section>
  );
}
