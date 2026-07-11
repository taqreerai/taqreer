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
import { useRouter } from "next/navigation";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { useServerStatus } from "@/lib/hooks/useServerStatus";
import {
  SlideManifestSchema,
  SlideSchema,
  ThemeSchema,
  GenChatEntrySchema,
  type GenChatEntry,
  type SlideManifest,
  type SlideType,
  type ThemeType,
} from "@/lib/schema/slide";
import { SlideRenderer } from "@/components/slides/SlideRenderer";
import { SlideEditor } from "@/components/preview/editor/SlideEditor";
import { StylePill } from "@/components/preview/editor/StylePill";
import { LayersPanel } from "@/components/preview/editor/LayersPanel";
import { GenChatPanel } from "@/components/preview/GenChatPanel";
import { SegmentedToggle } from "@/components/create/controls";
import { serializeSlideSection } from "@/lib/editor/serialize";
import { fitArtboard } from "@/lib/editor/canvas-fit";
import { TopUtilityBar } from "@/components/app/TopUtilityBar";
import { UserMenu } from "@/components/app/UserMenu";
import { MobileNav } from "@/components/app/MobileNav";
import {
  GenImageProvider,
  type GenImageFills,
} from "@/components/slides/gen-image-context";
import { scanGenImages, injectImgSrc, type GenImageAspect } from "@/lib/images/slide-images";
import { ParagraphWriteIcon } from "@/components/preview/ParagraphWriteIcon";
import { HistoryPopover, type HistoryRow } from "@/components/preview/HistoryPopover";
import type { InitialSlideState } from "@/lib/project/load-project";
import { dimensionsForFormat, type SlideFormat } from "@/lib/schema/slide";
import {
  SlideNavSidebar,
  SLIDE_NAV_WIDTH,
  RAIL_TOP,
  RAIL_BOTTOM,
  type NavItem,
} from "@/components/preview/SlideNavSidebar";
import { CancelGenerationDialog } from "@/components/preview/CancelGenerationDialog";
import { CommentsPanel } from "@/components/preview/CommentsPanel";
import { HeroCommentOverlay } from "@/components/preview/HeroCommentOverlay";
import { useSwipeNav } from "@/hooks/useSwipeNav";
import { PreviewActionBar, type StudioMode } from "@/components/slides/PreviewActionBar";
import { StudioActions } from "./StudioActions";
import { createClient } from "@/lib/supabase/client";
import { cssFontFamilyName } from "@/lib/export/theme-css-vars";
import type { CommentRow, CommentBounds } from "@/lib/types/comment";
import { notificationStore } from "@/lib/notifications/store";
import {
  openProjectChannel,
  type PresenceViewer,
  type ProjectChannelHandle,
  type ViewerPresence,
} from "@/lib/realtime/project-channel";
import {
  ensureProjectTopic,
  releaseProjectTopic,
} from "@/lib/realtime/token-manager";

import type { ProjectRole } from "@/lib/api/project-access";

// Preserve referential identity for streaming-preview slides whose content is
// unchanged between status polls. The poll re-fetches the WHOLE preview every
// ~1.5s and JSON.parse yields all-new slide objects even when nothing moved;
// handing those straight to setState re-renders DeckView (and, without memo,
// every SlideRenderer) on every tick — which rebuilds each slide's innerHTML
// and recreates its <img> nodes. Keeping the prior object when slideId+role+html
// all match lets `SlideRenderer`'s memo skip the re-render; returning the prior
// ARRAY unchanged when nothing moved lets DeckView itself bail the whole
// re-render on an idle poll.
function stabilizeStreamingSlides(
  prev: SlideType[],
  next: SlideType[],
): SlideType[] {
  let changed = next.length !== prev.length;
  const merged = next.map((ns, i) => {
    const ps = prev[i];
    if (
      ps &&
      ps.slideId === ns.slideId &&
      ps.role === ns.role &&
      ps.html === ns.html
    ) {
      return ps; // unchanged slide → keep stable reference
    }
    changed = true;
    return ns;
  });
  return changed ? merged : prev;
}

// Stable-identity guard for the streaming theme — same rationale as the slides
// above. Themes are small objects parsed from the same server JSON each poll,
// so a deterministic stringify compare avoids a new-object identity churn that
// would otherwise re-style every slide host (and defeat SlideRenderer's memo,
// which compares theme by reference).
function themesEqual(a: ThemeType, b: ThemeType): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

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
  // True when this viewer is an admin using the read-only oversight
  // bypass (admin console > Decks). Suppresses presence track() so the
  // deck owner never sees the admin navigating their slides; the admin
  // still RECEIVES presence/broadcast (receive is independent of send).
  isAdminObserver?: boolean;
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
  /**
   * True when the user picked "auto" slide-count (let Claude decide);
   * false when they pinned an explicit number. Drives the generating-
   * state slide-nav strategy: auto mode shows an empty sidebar that
   * grows tile-by-tile with a trailing "still working" placeholder,
   * custom mode shows the user-picked N up-front and fills as Claude
   * finishes each. Defaults to true on legacy briefs.
   */
  initialSlideCountAuto: boolean;
  /**
   * Which create flow produced this brief — drives the generating-
   * state status copy. "data" gets "analyzing data..." instead of
   * "extracting text and brand identity..." (which is misleading
   * for /datasheet, where the data is already parsed). Null for
   * legacy briefs that pre-date the source field.
   */
  initialSourceKind?: "scratch" | "enhance" | "mimic" | "data" | null;
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
  /**
   * Reload-defense for partial slide regen (2026-05-27). When a
   * `deck.regenerate.partial` Job row is still in flight, this
   * carries the target slide IDs + the new version's id so DeckView
   * pre-seeds `applying` on mount and the regenerating-slide overlay
   * survives a browser reload. The apply-poller below resumes
   * automatically and clears `applying` when the regen lands. Null
   * when no partial regen is active (the common case). Sourced from
   * `lib/project/load-project.ts:initialActiveRegen`.
   */
  initialActiveRegen?: {
    versionId: string;
    targetSlideIds: string[];
  } | null;
};

type DerivedStatus = "generating" | "completed" | "failed" | "cancelled";

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

// Fallback scale used while ResizeObserver is wiring up to the hero.
const FALLBACK_SCALE = 0.18;

// Editor undo/redo + checkpointing.
const UNDO_DEPTH = 100; // cap the per-slide local undo stack (bounds memory)
const CHECKPOINT_IDLE_MS = 10 * 60 * 1000; // idle-autosave a history checkpoint
// One undo step = the slide HTML BEFORE the edit and AFTER it. Storing both lets
// undo/redo apply a known snapshot instead of re-reading the (mutable) live manifest.
type UndoEntry = { before: string; after: string };

// Hero canvas layout constants. Kept here (rather than inline) so the
// width-clamp and the symmetric height-clamp we pass to the side
// panels read the same numbers — any tweak here flows to all three
// children of the canvas row.
//
// CANVAS_MAX_WIDTH caps the hero so it can't balloon to full-screen (and touch
// the header) when both side rails collapse and the row turns wide, per user
// direction 2026-06-14. The two min() height/row candidates still keep it from
// overflowing either dimension; the cap just bounds the wide case.
//
// HERO_VERTICAL_PADDING_PX is the vertical space reserved off the viewport for
// the height-fit candidate (header strip + bottom action bar + breathing room),
// kept a touch larger than the row's own paddingTop(72)+paddingBottom(100) so the
// centered canvas always has clear air above it and never reaches the header.
const HERO_VERTICAL_PADDING_PX = 220;
const CANVAS_MAX_WIDTH = 1280;

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

// User-initiated mid-generation cancel. Distinct from `failed` so the
// recovery UI can use neutral chrome (not danger red) and copy that
// reflects intent — "you stopped this" reads differently from
// "Claude crashed". POST /api/projects/[id]/cancel flips both
// Project.status and PresentationVersion.status to "cancelled" in
// one transaction; we OR them here so the derived status surfaces
// the moment either side flips.
function isCancelled(
  projectStatus: string,
  versionStatus: string | null,
): boolean {
  return projectStatus === "cancelled" || versionStatus === "cancelled";
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
  isAdminObserver = false,
  projectTitle,
  presentationId,
  initialProjectStatus,
  initialVersionStatus,
  initialVersionId,
  initialSavedVersionId,
  initialSavedSlideVersions,
  initialManifest,
  initialSlideCount,
  initialSlideCountAuto,
  initialSourceKind = null,
  initialSlideStates = [],
  initialFormat,
  initialMainSidebarWidth = 260,
  initialActiveRegen = null,
}: Props) {
  // Capability flags derived from role — passed/used wherever the
  // UI gates a mutation affordance. View-only sees the deck and
  // can export; comment can also create comments; edit/owner can
  // do anything (regen, save, lock, restore, lock-all). Computing
  // once here keeps the descendants from needing to know about the
  // role taxonomy.
  const canEdit = role === "owner" || role === "edit";
  const canComment = canEdit || role === "comment";
  const dict = useDict();
  const { dir, locale } = useLocale();
  const router = useRouter();
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
  // setManifestStable runs every external manifest swap and must drop the local
  // undo history of the slides it changed. The clearing callback (clearUndoFor)
  // is defined much later (it needs the undo state), so it's reached here through
  // a ref that the callback wires up on mount.
  const invalidateUndoRef = useRef<(slideKeys: string[]) => void>(() => {});

  // Churn-free manifest setter. The status poll + realtime broadcasts re-fetch
  // the WHOLE manifest every few seconds; a raw `setManifest(parsed.data)` then
  // hands every SlideRenderer all-new slide objects even when nothing changed,
  // re-applying each slide's innerHTML — which RESETS loading animations,
  // RELOADS images, and recreates nodes ("the whole block keeps refreshing even
  // though the slide already landed"). This:
  //   1. keeps the PREVIOUS slide object whenever its html is byte-identical, so
  //      unchanged slides never re-render the DOM; and
  //   2. never REVERTS a slide to a version with FEWER baked image URLs — a
  //      stale/slower poll otherwise flips a freshly-filled box back to its
  //      placeholder, which is the live-image flicker.
  // Returns the previous manifest unchanged when nothing actually moved, so
  // DeckView itself doesn't even re-render on an idle poll tick.
  const setManifestStable = useCallback((next: SlideManifest) => {
    const bakedCount = (html: string) =>
      (html.match(/supabase\.co\/storage/g) || []).length;
    // True when the swap should ADOPT ns over the previous ps: the html changed AND
    // it isn't a stale poll reverting freshly-filled images. ONE rule, shared by the
    // undo-invalidation pre-pass and the churn-free updater below so they can't drift.
    const adopts = (ps: { html: string }, ns: { html: string }) =>
      ps.html !== ns.html && bakedCount(ns.html) >= bakedCount(ps.html);
    // Drop the local undo history of slides this external swap actually replaces
    // (adopted) or that vanished from the deck. Local edits go through setManifest
    // directly, so they never reach here and the user's own undo stack is preserved.
    const prevLive = manifestRef.current;
    if (prevLive) {
      const nextIds = new Set(next.slides.map((s) => s.slideId));
      const overwritten = next.slides
        .filter((ns) => {
          const ps = prevLive.slides.find((p) => p.slideId === ns.slideId);
          return ps != null && adopts(ps, ns);
        })
        .map((ns) => ns.slideId);
      const removed = prevLive.slides
        .filter((ps) => !nextIds.has(ps.slideId))
        .map((ps) => ps.slideId);
      const invalidated = [...overwritten, ...removed];
      if (invalidated.length) invalidateUndoRef.current(invalidated);
    }
    setManifest((prev) => {
      if (!prev) return next;
      let changed = next.slides.length !== prev.slides.length;
      const slides = next.slides.map((ns) => {
        const ps = prev.slides.find((p) => p.slideId === ns.slideId);
        if (!ps) {
          changed = true;
          return ns;
        }
        if (!adopts(ps, ns)) return ps; // identical, or a stale image-revert → keep
        changed = true;
        return ns;
      });
      // GenChat rides the manifest, and during the BAKE phase it is often
      // the ONLY thing that changed - returning `prev` here silently
      // dropped every feed update until a slide's html finally moved,
      // freezing the chat for the whole review (user report 2026-07-10:
      // "stuck at designing slide 7 until I refreshed"). Newer = a longer
      // feed or a fresher last entry (the live thinking mutates in place).
      const feedKey = (m: SlideManifest) => {
        const c = m.genChat ?? [];
        const last = c[c.length - 1];
        return `${c.length}:${last?.at ?? 0}:${last?.text?.length ?? 0}`;
      };
      const genChatChanged = feedKey(next) !== feedKey(prev);
      if (!changed && !genChatChanged) return prev;
      return { ...next, slides: changed ? slides : prev.slides };
    });
  }, []);

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
  // Splice helper used by both Undo and Restore. Updates the live
  // manifest (so the renderer immediately shows the older slide
  // content) AND the per-slide pill state (currentVersionNumber).
  // Server returns the slide JSON + new pointer; client mirrors
  // those into local state. No re-fetch needed.
  // Move a slide's version pointer in local pill state, preserving the other
  // SlideState fields (comments cache, lock) from the prior entry. Shared by
  // applyRestoredSlide and the optimistic/revert writes in restoreToVersion —
  // one place to spell the SlideState shape so the three can't drift.
  const setSlideVersionPointer = useCallback(
    (slideKey: string, currentVersionNumber: number) => {
      setSlideStates((prev) => {
        const current = prev[slideKey];
        return {
          ...prev,
          [slideKey]: {
            slideKey,
            currentVersionNumber,
            hasCachedComments: current?.hasCachedComments ?? false,
            lockedAt: current?.lockedAt ?? null,
          },
        };
      });
    },
    [],
  );
  const applyRestoredSlide = useCallback((
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
    setSlideVersionPointer(slideKey, payload.currentVersionNumber);
    // historyVersions cache is intentionally NOT cleared here.
    // Restore is non-destructive — the rows themselves don't
    // change, only the SlideState pointer (currentVersionNumber)
    // moves. Clearing then refetching would briefly empty the
    // popover before unmount, producing the "collapse-then-flash"
    // glitch the user flagged 2026-05-20.
  }, [setSlideVersionPointer]);
  const [projectStatus] = useState(initialProjectStatus);
  const [versionStatus, setVersionStatus] = useState<string | null>(initialVersionStatus);

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
  // GenChat transparency feed accumulated from the generation status poll;
  // after completion the manifest's own genChat (which the bake keeps
  // appending to) takes over - see the genChatFeed derivation.
  const [liveGenChat, setLiveGenChat] = useState<GenChatEntry[]>([]);
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
  // version arrives (parser reset → second manifest pass, or a retry
  // restart) we keep showing the previous full-length list until the
  // new version catches up to that watermark — so the live preview
  // never visibly shrinks mid-stream.
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
  // Cancel-generation state. `cancelOpen` controls the confirmation
  // modal's visibility; `cancelBusy` is the in-flight POST window
  // between click + server ack. Local-only — the server-side
  // cancellation status lives on Project / Version / Job rows.
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
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
  // caption so the user sees the run is just running long, not silently
  // dead. The caption is status-aware (see `slowCaption` below): it only
  // blames upstream load when the real provider status says so. The old
  // "STUCK" bell notification was removed — it kept misfiring on
  // legitimately slow phases.
  //
  // `nowTick` increments every 10 s so the derived `elapsedMs` stays
  // current even when the polling effect doesn't fire (Claude is
  // silent between slides). useState(() => Date.now()) so the seed
  // isn't re-evaluated on every re-render.
  const [genStartedAt, setGenStartedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  // Real upstream-provider status — lets the "slow" caption (below) tell
  // a genuine load issue apart from a merely long-running deck.
  const serverStatus = useServerStatus();

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
  // 3:4 is a social post, not a deck — the generating title says "post".
  const isPostFormat = (manifest?.format ?? initialFormat) === "3:4";

  // gridRef is defined here so it can be passed to <motion.div>
  // below. The scale + height measurement effect that uses it lives
  // further down (after commentMode is declared — the effect's deps
  // include commentMode because changing it resizes the hero).
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridScale, setGridScale] = useState(FALLBACK_SCALE);
  // Workspace box (edit mode): the canvas area the iframe fills. The artboard floats
  // CENTRED + fit-scaled inside it, so the AI halo + comment overlay must track that
  // inner rect, not this outer box. Measured alongside gridScale below; fed through the
  // SAME fitArtboard() the editor's iframe uses, so overlays + artboard never drift.
  const [workspaceBox, setWorkspaceBox] = useState({ w: 0, h: 0 });

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
  // Studio mode (Edit ⇄ AI) — the bottom command bar's toggle. Edit = manual
  // scalpel + user comments; AI = generative. Defaults to Edit (§16).
  const [studioMode, setStudioMode] = useState<StudioMode>("edit");
  // AI composer scope (§17) — the region drawn on the canvas in AI mode that
  // the bottom-bar instruction applies to. `null` = whole slide. Drawn via
  // HeroCommentOverlay (`onAiBoundsChange`), cleared by the toolbar scope
  // chip's ✕, on submit, on slide change, and when leaving AI mode.
  const [pendingAiBounds, setPendingAiBounds] = useState<CommentBounds | null>(null);
  // §17 discovery cue — a finished region-draw should draw the eye to the
  // bottom bar (that's where the instruction gets typed). Each valid drag
  // release bumps this counter; PreviewActionBar plays a dock-style bounce
  // whenever it changes. Kept separate from `pendingAiBounds` so a redraw
  // (bounds non-null → non-null) still re-triggers the notice.
  const [aiRegionNudge, setAiRegionNudge] = useState(0);
  const handleAiBoundsChange = useCallback((b: CommentBounds | null) => {
    setPendingAiBounds(b);
    // Only a real (kept) region nudges — a too-small drag reports null.
    if (b) setAiRegionNudge((n) => n + 1);
  }, []);
  // Slide-nav tab (§16) — Slides (the thumbnail grid) vs Comments (the embedded
  // CommentsPanel) for REVIEWING comments outside comment mode. In comment mode
  // BOTH side panels hide (the canvas is the comment surface), so there's no
  // auto-switch to Comments — it would just be hidden anyway.
  const [navTab, setNavTab] = useState<"slides" | "comments">("slides");
  // Phones get a VIEW-FIRST studio (view+light-edit posture): precise object
  // dragging is a desktop experience, and a real finger on the editor iframe
  // swallows the swipe-to-navigate gesture. So on mobile the edit-capable user
  // lands in the plain SlideRenderer viewer (swipe works, AI-instruct + comment
  // still work — they ride the same overlay in both layouts). `false` on the
  // server + first client paint keeps DESKTOP identical (no editor remount); a
  // mount effect flips it for narrow viewports (same recipe as the rail collapse
  // below). See [[project_mobile_responsive_app]].
  const [isMobileStudio, setIsMobileStudio] = useState(false);
  // Edit mode = the DEFAULT working surface for edit-capable users (plan §0.6 — you
  // land in the editor). Mutually exclusive with commentMode: the comment overlay
  // needs the plain SlideRenderer beneath it, so commenting temporarily wins.
  // Gated OFF on phones (view-first) so owners view + swipe instead of dragging.
  const editMode = canEdit && !isMobileStudio;
  // The editor's selection SET (plan-editor §20 multi-select). Single-click → one
  // element; a marquee drag → the intersected set; bg-click / slide-change → [].
  // StylePill + LayersPanel read it; the empty array is a stable sentinel so
  // effects/handlers can compare lengths without null-guards.
  const [editorSelected, setEditorSelected] = useState<HTMLElement[]>([]);
  // The editor iframe's document — captured via SlideEditor.onDocReady so the
  // Studio Layers panel can build its tree from the live slide DOM.
  const [editorDoc, setEditorDoc] = useState<Document | null>(null);
  // Bumped whenever a per-layer lock toggles. Locks live as a `data-tq-lock`
  // attribute on the in-iframe element (so they travel with the element through
  // tree rebuilds and never need lifting into React state), but the canvas
  // Moveable memoises its grabbable set on `selected` — this bump is the signal
  // for it to recompute when only an attribute changed.
  const [lockTick, setLockTick] = useState(0);
  // Undo/redo apply-in-place signal for the editor iframe (bump token → SlideEditor
  // swaps the live section content without a srcDoc reload → no canvas flash).
  const [inPlaceApply, setInPlaceApply] = useState<{ html: string; token: number } | null>(null);
  const inPlaceTokenRef = useRef(0);
  // Bumped by bring-to-front / send-to-back so the Layers panel re-sorts (z-only).
  const [restackTick, setRestackTick] = useState(0);
  // Toggle a layer's lock from the Layers panel. A locked layer stays selectable
  // and restyleable; it just can't be dragged/resized/rotated on the canvas.
  const toggleLock = useCallback((el: HTMLElement) => {
    el.toggleAttribute("data-tq-lock");
    setLockTick((n) => n + 1);
  }, []);
  // Client-side undo/redo stacks, per slide — the fine-grained, IN-SESSION undo.
  // Each entry is a paired { before, after } snapshot captured at edit time, so
  // undo applies `before` and redo applies `after` WITHOUT re-reading the live
  // manifest (which an external write — regen, restore, peer edit — can change
  // out from under the stack; reading it on pop was the stale-baseline bug). The
  // coarse history layer is separate: SlideVersions from Save + the 10-min idle
  // checkpoint. The two reconcile via clearUndo() whenever an external write
  // overwrites a slide (see setManifestStable / restoreToVersion / delete).
  const [undoStacks, setUndoStacks] = useState<
    Record<string, { past: UndoEntry[]; future: UndoEntry[] }>
  >({});
  const undoStacksRef = useRef(undoStacks);
  useEffect(() => {
    undoStacksRef.current = undoStacks;
  }, [undoStacks]);
  // Slides edited since the last checkpoint — flushed to SlideVersions on Save
  // and on the 10-min idle timer. The timer re-arms on every edit/undo/redo.
  const dirtySlidesRef = useRef<Set<string>>(new Set());
  // Per-slide /edit write queue. Edits for a slide are chained so they POST in
  // ORDER (a slow earlier write can't land after a newer one), and the tail
  // promise is what flushCheckpoints awaits before snapshotting — so a
  // checkpoint never versions stale server html (CodeRabbit PR #53).
  const editChainsRef = useRef<Record<string, Promise<void>>>({});
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The SAVE (snapshot) is what the cloud icon reflects: it pins the saved version
  // (dashboard thumbnails + exports) and flushes history checkpoints. It runs when
  // the user LEAVES the canvas (switches slides, navigates, refreshes, closes) or
  // clicks the cloud — NOT on every edit, so a quick edit doesn't mint a version.
  // (Content itself is still kept safe per-commit by the silent /edit write below.)
  const [savingProject, setSavingProject] = useState(false);
  const [saveErrored, setSaveErrored] = useState(false);
  const saveInFlightRef = useRef(false);
  // Bumped on every local edit. saveProject captures it before its async work and
  // only clears localDirty if it's unchanged on completion — so an edit made DURING
  // a save doesn't get marked saved (which would skip the next leave-canvas save).
  const dirtyGenRef = useRef(0);
  // Live mirror of `applying` (a regen mid-flight, declared later). saveProject reads
  // it to skip auto-saving while currentVersionId may point at a queued version.
  const applyingRef = useRef(false);
  // Stable reference so StylePill's outside-click `mousedown` listener isn't
  // re-attached on every DeckView render (`setEditorSelected` is itself stable).
  const dismissEditorSelection = useCallback(() => setEditorSelected([]), []);
  // Bumped to force the editor iframe to rebuild from slide.html on an EXTERNAL
  // content change (restore / undo / redo). A self-save deliberately does NOT
  // bump it — the iframe already shows the user's edit, so rebuilding would wipe
  // their place. See SlideEditor's pinned bodyHtml effect.
  const [editorReloadKey, setEditorReloadKey] = useState(0);
  // Bump the editor reload key ONLY when the FOCUSED slide's html actually
  // changed between the current manifest and `next`. The status poll / peer
  // broadcasts re-fetch the whole manifest on visibility refresh or a peer's
  // regen on ANOTHER slide; an unconditional bump there remounts the focused
  // SlideEditor and wipes the user's selection + unsaved iframe state even
  // though nothing on their slide moved. Reads the focused slide id from the
  // refs (same clamp as `focusedIndex`) so it sees the latest value inside
  // async callbacks without a stale closure. Helpers fire post-mount, so the
  // refs are always populated by call time.
  const bumpEditorIfFocusedChanged = useCallback((next: SlideManifest) => {
    const prev = manifestRef.current;
    if (!prev) return;
    const idx = Math.min(
      Math.max(slideIndexRef.current, 0),
      prev.slides.length - 1,
    );
    const focusedId = prev.slides[idx]?.slideId;
    if (!focusedId) return;
    const prevHtml = prev.slides.find((s) => s.slideId === focusedId)?.html;
    const nextHtml = next.slides.find((s) => s.slideId === focusedId)?.html;
    // Slide gone from the new manifest (shouldn't happen) → leave the editor be.
    if (nextHtml == null) return;
    if (nextHtml !== prevHtml) setEditorReloadKey((k) => k + 1);
  }, []);
  // Per-slide mutation counter. Edit (save) and restore (undo/redo) are async
  // and target the same slide; their server responses can resolve OUT OF ORDER
  // (e.g. a save in flight when the user hits ⌘Z), which would let an older
  // response clobber newer content and leave the canvas on the wrong version.
  // Each mutation captures the slide's seq before awaiting and only applies its
  // result if it's still the latest — last-started wins, stale responses drop.
  const slideMutationSeqRef = useRef<Record<string, number>>({});
  const nextSlideMutationSeq = useCallback((slideKey: string) => {
    const next = (slideMutationSeqRef.current[slideKey] ?? 0) + 1;
    slideMutationSeqRef.current[slideKey] = next;
    return next;
  }, []);
  const isLatestSlideMutation = useCallback(
    (slideKey: string, seq: number) =>
      slideMutationSeqRef.current[slideKey] === seq,
    [],
  );
  // Persist a slide's CONTENT in place (no history row) — POST /edit, which
  // splices into the active manifest server-side. Silent + fire-and-forget: the
  // manifest + iframe already reflect the change locally, this just keeps the
  // server copy safe on every commit (so nothing is lost on a crash) WITHOUT
  // minting a version. The visible save (the cloud) is the explicit snapshot.
  const persistContentInPlace = useCallback(
    (slideKey: string, html: string) => {
      // Chain onto this slide's previous write so edits land in ORDER (a slow earlier
      // write can't land after a newer one). The inner work swallows its own errors
      // so the chain never rejects; the tail is stored for flushCheckpoints to await.
      const prev = editChainsRef.current[slideKey] ?? Promise.resolve();
      const next = prev.then(async () => {
        try {
          const res = await fetch(
            `/api/projects/${projectId}/slides/${encodeURIComponent(slideKey)}/edit`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ html }),
            },
          );
          if (!res.ok) throw new Error(`edit: ${res.status}`);
        } catch (err) {
          console.error("[edit] save failed", err);
        }
      });
      editChainsRef.current[slideKey] = next;
      return next;
    },
    [projectId],
  );

  // Flush a history CHECKPOINT for every slide edited since the last one — POST
  // /checkpoint snapshots the live content as a SlideVersion. Called by the
  // 10-min idle timer and by Save. Moves each slide's version pointer to the new
  // checkpoint and drops its cached history list so the popover refetches.
  const flushCheckpoints = useCallback(async () => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    const keys = Array.from(dirtySlidesRef.current);
    if (keys.length === 0) return;
    // Remove the flushing keys up front so a concurrent edit re-adds its own key
    // (and re-arms the idle timer) instead of being swallowed; failures re-add
    // the key below so the checkpoint is retried next flush.
    keys.forEach((k) => dirtySlidesRef.current.delete(k));
    await Promise.all(
      keys.map(async (slideKey) => {
        try {
          // Wait for this slide's latest /edit write to LAND first — /checkpoint
          // snapshots server state, so checkpointing before the edit persists
          // would version stale html (CodeRabbit PR #53).
          await editChainsRef.current[slideKey];
          const res = await fetch(
            `/api/projects/${projectId}/slides/${encodeURIComponent(slideKey)}/checkpoint`,
            { method: "POST" },
          );
          if (!res.ok) throw new Error(`checkpoint: ${res.status}`);
          const data = (await res.json()) as { currentVersionNumber: number };
          setSlideVersionPointer(slideKey, data.currentVersionNumber);
          setHistoryVersions((prev) => {
            if (!(slideKey in prev)) return prev;
            const next = { ...prev };
            delete next[slideKey];
            return next;
          });
        } catch (err) {
          console.error("[checkpoint] failed", err);
          // Leave the slide dirty so the next flush retries it.
          dirtySlidesRef.current.add(slideKey);
        }
      }),
    );
  }, [projectId, setSlideVersionPointer]);

  // Mark a slide dirty + (re)arm the 10-min idle autosave. Every edit/undo/redo
  // pushes the timer out, so a checkpoint lands 10 min after the user stops.
  const markDirtyAndArmIdle = useCallback(
    (slideKey: string) => {
      dirtySlidesRef.current.add(slideKey);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        void flushCheckpoints();
      }, CHECKPOINT_IDLE_MS);
    },
    [flushCheckpoints],
  );

  // Apply a slide's new html: splice into the manifest (thumbnails/export reflect
  // now), optionally rebuild the editor iframe (undo/redo change content the
  // iframe DOESN'T already show — an in-canvas edit does, so it skips the
  // reload), mark dirty, and persist in place.
  // Unsaved LOCAL edits flag (2026-06-12): edits are local-first (no
  // server version bump until Save), so the version-pointer comparator
  // below can't see them - the toolbar save icon stayed a checkmark
  // through live edits (user report). Set on every local content
  // apply (edit / undo / redo), cleared when a save lands.
  const [localDirty, setLocalDirty] = useState(false);

  const applyContentLocally = useCallback(
    (slideKey: string, html: string, opts?: { reload?: boolean }) => {
      setLocalDirty(true);
      dirtyGenRef.current += 1;
      setManifest((prev) =>
        prev
          ? {
              ...prev,
              slides: prev.slides.map((s) =>
                s.slideId === slideKey ? { ...s, html } : s,
              ),
            }
          : prev,
      );
      if (opts?.reload) setEditorReloadKey((k) => k + 1);
      markDirtyAndArmIdle(slideKey);
      void persistContentInPlace(slideKey, html);
    },
    [markDirtyAndArmIdle, persistContentInPlace],
  );

  // Undo/redo on the FOCUSED slide: apply the restored html to the live iframe IN
  // PLACE (no reload → no flash) instead of rebuilding the srcDoc.
  const applyRestoredLocally = useCallback(
    (slideKey: string, html: string) => {
      applyContentLocally(slideKey, html, { reload: false });
      inPlaceTokenRef.current += 1;
      setInPlaceApply({ html, token: inPlaceTokenRef.current });
    },
    [applyContentLocally],
  );

  // Live mirror of localDirty for the unload handler (which reads it without a dep).
  const localDirtyRef = useRef(localDirty);
  useEffect(() => {
    localDirtyRef.current = localDirty;
  }, [localDirty]);

  // The SAVE: flush pending edits to history checkpoints, then pin the saved version
  // (dashboard + exports). Drives the cloud icon. Runs on leave-canvas (slide switch,
  // navigation, unload) and on a manual cloud click. The in-flight ref guards the
  // overlapping triggers so two leave-events don't double-fire.
  const saveProject = useCallback(async () => {
    // Skip while a save is already running, before the first version exists, or while
    // a regen is in flight (currentVersionId may point at a queued/incomplete version
    // — pinning it would make the dashboard reference an unfinished snapshot).
    if (saveInFlightRef.current || !initialVersionId || applyingRef.current) return;
    saveInFlightRef.current = true;
    setSavingProject(true);
    setSaveErrored(false);
    // Snapshot the edit generation so a fresh edit during the async save isn't
    // wrongly marked saved below.
    const gen = dirtyGenRef.current;
    try {
      await flushCheckpoints();
      const res = await fetch(`/api/projects/${projectId}/save`, { method: "POST" });
      if (!res.ok) throw new Error(`save: ${res.status}`);
      const data = (await res.json()) as {
        savedVersionId: string;
        savedSlideVersions: Record<string, number>;
      };
      setSavedVersionId(data.savedVersionId);
      setSavedSlideVersions(data.savedSlideVersions);
      if (dirtyGenRef.current === gen) setLocalDirty(false);
    } catch (err) {
      console.error("[save] failed", err);
      setSaveErrored(true);
    } finally {
      saveInFlightRef.current = false;
      setSavingProject(false);
    }
  }, [initialVersionId, projectId, flushCheckpoints]);
  // Stable handle so navigateToSlide (read inside the keyboard/wheel effect) doesn't
  // re-subscribe its listeners on every save-identity change.
  const saveProjectRef = useRef(saveProject);
  useEffect(() => {
    saveProjectRef.current = saveProject;
  }, [saveProject]);

  // Refresh / tab-close: best-effort pin via a keepalive POST (content is already on
  // the server from the per-commit /edit, so this just advances the saved snapshot).
  useEffect(() => {
    const onPageHide = () => {
      if (!localDirtyRef.current || !initialVersionId || applyingRef.current) return;
      void fetch(`/api/projects/${projectId}/save`, {
        method: "POST",
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [projectId, initialVersionId]);

  // Push one { before, after } step onto a slide's undo stack and clear its redo
  // branch (standard truncate-on-new-edit), capped at UNDO_DEPTH.
  const pushUndo = useCallback(
    (slideKey: string, before: string, after: string) => {
      setUndoStacks((prev) => {
        const cur = prev[slideKey] ?? { past: [], future: [] };
        return {
          ...prev,
          [slideKey]: {
            past: [...cur.past, { before, after }].slice(-UNDO_DEPTH),
            future: [],
          },
        };
      });
    },
    [],
  );

  // Drop the local undo/redo history for one or more slides. Called whenever an
  // EXTERNAL write replaces a slide's baseline — a regen, a History restore, a
  // realtime peer edit, a slide that vanished on resync — so a later undo can't
  // apply a snapshot that no longer chains from what's live. No-op (same
  // reference) when none of the keys have a stack, so it's cheap to call on every
  // manifest diff. setManifestStable reaches this through invalidateUndoRef
  // because it's declared before this callback.
  const clearUndoFor = useCallback((slideKeys: string[]) => {
    setUndoStacks((prev) => {
      let mutated = false;
      const next = { ...prev };
      for (const key of slideKeys) {
        if (next[key]) {
          delete next[key];
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });
  }, []);
  useEffect(() => {
    invalidateUndoRef.current = clearUndoFor;
  }, [clearUndoFor]);

  // In-canvas edit committed (blur). Record the { before, after } step for undo,
  // then apply. No version row is created (history is now Save + 10-min
  // checkpoints); the iframe already shows the edit, so no reload. Behind
  // SlideEditor.onEditRef.
  const handleSlideEdit = useCallback(
    (slideKey: string, html: string) => {
      const prevHtml = manifestRef.current?.slides.find(
        (s) => s.slideId === slideKey,
      )?.html;
      if (prevHtml === html) return; // no-op
      if (prevHtml != null) pushUndo(slideKey, prevHtml, html);
      applyContentLocally(slideKey, html, { reload: false });
    },
    [pushUndo, applyContentLocally],
  );

  // Undo / redo over the focused slide's LOCAL stack. The focused slide is read
  // from refs so these work identically from the toolbar buttons and the
  // ⌘Z / ⌘⇧Z keydown handler. Both rebuild the iframe (reload: true) since the
  // restored html isn't what the iframe currently shows.
  const focusedSlideKeyFromRefs = useCallback((): string | null => {
    const m = manifestRef.current;
    if (!m || m.slides.length === 0) return null;
    const idx = Math.min(
      Math.max(slideIndexRef.current, 0),
      m.slides.length - 1,
    );
    return m.slides[idx]?.slideId ?? null;
  }, []);

  // ── Canvas object ops (delete / group / add text) — shared by the editor
  // keyboard, the Layers panel, and the bottom toolbar. Each mutates the FOCUSED
  // slide's LIVE iframe DOM, then commits through the same handleSlideEdit save
  // path (local apply, no reload). A counter seeds unique ids for new nodes +
  // virtual groups (both runtime-only, stripped on serialize). ──
  const editorSeqRef = useRef(0);
  const deleteEls = useCallback(
    (els: HTMLElement[]) => {
      const list = els.filter((el) => el.isConnected);
      if (!list.length) return;
      const sec = list[0].closest("section") as HTMLElement | null;
      list.forEach((el) => el.remove());
      setEditorSelected((cur) => cur.filter((el) => !list.includes(el)));
      const key = focusedSlideKeyFromRefs();
      if (sec && key) handleSlideEdit(key, serializeSlideSection(sec));
    },
    [focusedSlideKeyFromRefs, handleSlideEdit],
  );
  const deleteSelected = useCallback(
    () => deleteEls(editorSelected),
    [deleteEls, editorSelected],
  );
  // Virtual grouping: one shared data-tq-group id across the selection. No
  // reparenting, so positions + export are untouched; the id is stripped on save.
  const groupSelected = useCallback(() => {
    if (editorSelected.length < 2) return;
    // Persisted now (survives reload), so the id must not collide with a group id
    // already saved on the slide; stamp it with the time + a counter.
    const gid = `g${Date.now().toString(36)}${editorSeqRef.current++}`;
    editorSelected.forEach((el) => el.setAttribute("data-tq-group", gid));
    setEditorSelected((cur) => [...cur]); // re-render so the pill shows Ungroup
    // Commit so the group survives reload + lands in the undo history.
    const sec = editorSelected[0]?.closest("section") as HTMLElement | null;
    const key = focusedSlideKeyFromRefs();
    if (sec && key) handleSlideEdit(key, serializeSlideSection(sec));
  }, [editorSelected, focusedSlideKeyFromRefs, handleSlideEdit]);
  const ungroupSelected = useCallback(() => {
    const sec = editorSelected[0]?.closest("section") as HTMLElement | null;
    const gids = new Set(
      editorSelected
        .map((el) => el.getAttribute("data-tq-group"))
        .filter(Boolean) as string[],
    );
    gids.forEach((gid) =>
      sec
        ?.querySelectorAll(`[data-tq-group="${gid}"]`)
        .forEach((el) => el.removeAttribute("data-tq-group")),
    );
    editorSelected.forEach((el) => el.removeAttribute("data-tq-group"));
    setEditorSelected((cur) => [...cur]);
    // Commit so the ungroup survives reload + lands in the undo history.
    const key = focusedSlideKeyFromRefs();
    if (sec && key) handleSlideEdit(key, serializeSlideSection(sec));
  }, [editorSelected, focusedSlideKeyFromRefs, handleSlideEdit]);
  // Add a fresh text box at the slide centre + select it (double-click to type).
  const addTextBox = useCallback(() => {
    const stage = editorDoc?.getElementById("tqe-stage");
    const sec = stage?.querySelector("section") as HTMLElement | null;
    if (!editorDoc || !sec) return;
    const lang = manifestRef.current?.language === "en" ? "en" : "ar";
    const d = editorDoc.createElement("div");
    d.setAttribute("data-tq-cc", "1");
    d.setAttribute("data-tq-id", `n${++editorSeqRef.current}`);
    d.textContent = lang === "en" ? "New text" : "نص جديد";
    // Native (1920-space) px; colour + font inherit the deck theme from <body>.
    d.style.cssText = `position:absolute;left:${Math.round(canvasW / 2 - 200)}px;top:${Math.round(canvasH / 2 - 32)}px;width:400px;min-height:60px;font-size:44px;font-weight:700;line-height:1.2;text-align:center;z-index:60;`;
    sec.appendChild(d);
    setEditorSelected([d]);
    const key = focusedSlideKeyFromRefs();
    if (key) handleSlideEdit(key, serializeSlideSection(sec));
  }, [editorDoc, canvasW, canvasH, focusedSlideKeyFromRefs, handleSlideEdit]);

  // Bring to front / send to back — writes z-index on the SAME stacking target the
  // Layers reorder uses (the leaf's nearest positioned ancestor), so it actually
  // re-stacks AND the sidebar order reflects it (restackTick re-sorts the panel).
  // Send-to-back stops just above the backmost full-bleed layer (the background).
  const onRestack = useCallback(
    (dir: "front" | "back") => {
      const stage = editorDoc?.getElementById("tqe-stage");
      const win = editorDoc?.defaultView;
      const sec = stage?.querySelector("section") as HTMLElement | null;
      if (!stage || !win || !sec || editorSelected.length === 0) return;
      const zOf = (e: Element) => {
        const z = parseInt(win.getComputedStyle(e).zIndex, 10);
        return Number.isNaN(z) ? 0 : z;
      };
      const all = [...sec.querySelectorAll<HTMLElement>("*")];
      const maxZ = Math.max(0, ...all.map(zOf));
      // Operate on the SELECTED element itself (position:relative so its own z takes
      // effect), NOT a wrapping ancestor — otherwise bringing one text forward drags
      // every sibling in its block forward too.
      //   • front → above EVERYTHING (maxZ + 1).
      //   • back  → below every OTHER element, but never negative (a negative z paints
      //     behind the section's own background = the slide bg, hiding the layer).
      //     The floor at 0 + DOM order keeps real content above the bg image (the bg
      //     is first in the DOM), so it can't fly forward off a stale bg z, and
      //     nothing slips behind the slide background.
      for (const el of editorSelected) {
        // setProperty (method call), not `el.style.x = …` — a direct assignment on a
        // state-held element trips react-hooks/immutability.
        if (win.getComputedStyle(el).position === "static") {
          el.style.setProperty("position", "relative");
        }
        let z: number;
        if (dir === "front") {
          z = maxZ + 1;
        } else {
          const others = all.filter((e) => e !== el).map(zOf);
          z = Math.max(0, (others.length ? Math.min(...others) : 1) - 1);
        }
        el.style.setProperty("z-index", String(z));
      }
      setRestackTick((t) => t + 1);
      const key = focusedSlideKeyFromRefs();
      if (key) handleSlideEdit(key, serializeSlideSection(sec));
    },
    [editorDoc, editorSelected, focusedSlideKeyFromRefs, handleSlideEdit],
  );

  // Undo = move the last `past` step to `future` and apply its `before`. The
  // snapshot is read from the entry, NOT the live manifest, so an external write
  // that overwrote this slide can't make undo apply the wrong baseline (such a
  // write clears the stack via clearUndo — see A2).
  const handleLocalUndo = useCallback(() => {
    const slideKey = focusedSlideKeyFromRefs();
    if (!slideKey) return;
    const stack = undoStacksRef.current[slideKey];
    if (!stack || stack.past.length === 0) return;
    const entry = stack.past[stack.past.length - 1]!;
    setUndoStacks((prev) => {
      const s = prev[slideKey];
      if (!s || s.past.length === 0) return prev;
      return {
        ...prev,
        [slideKey]: {
          past: s.past.slice(0, -1),
          future: [...s.future, entry].slice(-UNDO_DEPTH),
        },
      };
    });
    applyRestoredLocally(slideKey, entry.before);
  }, [focusedSlideKeyFromRefs, applyRestoredLocally]);
  // Redo = move the last `future` step back to `past` and apply its `after`.
  const handleLocalRedo = useCallback(() => {
    const slideKey = focusedSlideKeyFromRefs();
    if (!slideKey) return;
    const stack = undoStacksRef.current[slideKey];
    if (!stack || stack.future.length === 0) return;
    const entry = stack.future[stack.future.length - 1]!;
    setUndoStacks((prev) => {
      const s = prev[slideKey];
      if (!s || s.future.length === 0) return prev;
      return {
        ...prev,
        [slideKey]: {
          past: [...s.past, entry].slice(-UNDO_DEPTH),
          future: s.future.slice(0, -1),
        },
      };
    });
    applyRestoredLocally(slideKey, entry.after);
  }, [focusedSlideKeyFromRefs, applyRestoredLocally]);

  // On unmount/navigation (e.g. clicking Home): clear the idle timer, flush pending
  // edits into a checkpoint, and best-effort pin the saved version via a keepalive
  // POST so the dashboard reflects the latest. Content is already persisted in place,
  // so a dropped flush only defers the history snapshot — never loses work.
  useEffect(() => {
    return () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      void flushCheckpoints();
      if (localDirtyRef.current && initialVersionId && !applyingRef.current) {
        void fetch(`/api/projects/${projectId}/save`, {
          method: "POST",
          keepalive: true,
        }).catch(() => {});
      }
    };
  }, [flushCheckpoints, projectId, initialVersionId]);

  // Move the slide's version pointer + splice that version into the manifest.
  // This is the COARSE history layer (the History popover), separate from the
  // fine-grained in-session undo (⌘Z / ⌘⇧Z drive the local stack). A restore
  // replaces the slide's baseline, so it clears that slide's local undo history.
  // Bumps editorReloadKey because the content actually changed → the editor
  // iframe must rebuild. The /restore route 400s past either end of history,
  // which the catch swallows.
  const restoreToVersion = useCallback(
    async (slideKey: string, versionNumber: number) => {
      if (versionNumber < 1) return;
      const prevVersionNumber =
        slideStates[slideKey]?.currentVersionNumber ?? null;
      if (prevVersionNumber === versionNumber) return;
      // Claim the slide AFTER the no-op guards above — a no-op undo/redo at the
      // ends of history must not bump the counter and invalidate an in-flight save.
      const seq = nextSlideMutationSeq(slideKey);
      // Optimistic pointer move (reverted below on failure).
      setSlideVersionPointer(slideKey, versionNumber);
      try {
        const res = await fetch(
          `/api/projects/${projectId}/slides/${encodeURIComponent(slideKey)}/restore`,
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
        // Superseded by a newer mutation while in flight → leave its state alone.
        if (!isLatestSlideMutation(slideKey, seq)) return;
        applyRestoredSlide(slideKey, data);
        clearUndoFor([slideKey]); // baseline replaced → local undo no longer chains
        setEditorReloadKey((k) => k + 1);
      } catch (err) {
        console.error("restore failed", err);
        // Roll the optimistic pointer back — but only if we're still the latest
        // mutation, else we'd clobber a newer edit/restore that already landed.
        if (prevVersionNumber != null && isLatestSlideMutation(slideKey, seq)) {
          setSlideVersionPointer(slideKey, prevVersionNumber);
        }
      }
    },
    [
      projectId,
      slideStates,
      applyRestoredSlide,
      clearUndoFor,
      setSlideVersionPointer,
      nextSlideMutationSeq,
      isLatestSlideMutation,
    ],
  );
  const [comments, setComments] = useState<CommentRow[]>([]);
  // Seed `applying` from `initialActiveRegen` so a browser reload
  // during a partial regen restores the per-slide overlay instead of
  // dropping it (2026-05-27 — user report: partial-regen overlay
  // disappeared from thumbnail + canvas after reload while the Inngest
  // run was still alive). The apply-poller below picks up the seed
  // and clears `applying` once the regen lands. Lazy initializer to
  // avoid a needless re-render when initialActiveRegen is null (the
  // common case).
  const [applying, setApplying] = useState<{
    versionId: string;
    targetSlideIds: string[];
  } | null>(() =>
    initialActiveRegen
      ? {
          versionId: initialActiveRegen.versionId,
          targetSlideIds: initialActiveRegen.targetSlideIds,
        }
      : null,
  );
  // Mirror `applying` into the ref saveProject reads (it's defined earlier).
  useEffect(() => {
    applyingRef.current = applying != null;
  }, [applying]);
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
  // Images mode (context/images.md): genid → public URL for boxes filled
  // live by gpt-image-2 (warm-during-stream + regenerate). Fed to
  // SlideRenderer via GenImageProvider so each box swaps its shimmer
  // placeholder → the image in place, no refresh. See the
  // `slide.image.ready` broadcast handler.
  const [filledImages, setFilledImages] = useState<GenImageFills>({});

  // Export-ready manifest. The live preview shows generated images through the
  // GenImageProvider context, which NEVER mutates `manifest` — so the toolbar's
  // client export (PPTX / HTML), which renders `manifest` directly, would miss
  // every image until a page reload re-read the reconciled slideJson from the
  // DB (the "first export has no images, refresh fixes it" bug). Bake the live
  // fills into the manifest the export consumes so the images are present
  // immediately, no reload. No-op for non-images decks (fills are empty → the
  // original `manifest` reference is returned, so no extra renders).
  const exportManifest = useMemo(() => {
    if (!manifest) return manifest;
    const fills = Object.entries(filledImages);
    if (fills.length === 0) return manifest;
    return {
      ...manifest,
      slides: manifest.slides.map((s) => {
        let html = s.html;
        for (const [genid, url] of fills) html = injectImgSrc(html, genid, url);
        return { ...s, html };
      }),
    };
  }, [manifest, filledImages]);

  // §19 — fire the single-image regen route. The StylePill already wrote the
  // new prompt onto the box (data-genimage, committed on deselect) and dropped
  // its src (→ shimmer); the regenerated image arrives via `slide.image.ready`
  // → filledImages → the iframe-patch effect below swaps it in. Fire-and-forget
  // with an error log (the box keeps its shimmer; the user can retry).
  const handleRegenImage = useCallback(
    async (input: {
      genid: string;
      slideId: string;
      prompt: string;
      aspect: GenImageAspect;
    }) => {
      // Drop the stale fill for this box immediately — matches the StylePill's
      // optimistic `src` removal. Otherwise `exportManifest` keeps baking the
      // OLD asset, and the iframe-sync effect below can re-inject the old `src`
      // (re-painting the box the StylePill just blanked) on the next
      // filledImages change. The fresh URL re-populates on `slide.image.ready`.
      setFilledImages((prev) => {
        if (!(input.genid in prev)) return prev;
        const next = { ...prev };
        delete next[input.genid];
        return next;
      });
      try {
        const res = await fetch(
          `/api/projects/${projectId}/slides/${encodeURIComponent(
            input.slideId,
          )}/images/${encodeURIComponent(input.genid)}/regen`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: input.prompt, aspect: input.aspect }),
          },
        );
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(data?.error ?? `regen image: ${res.status}`);
        }
      } catch (err) {
        console.error("[image-regen] failed", err);
      }
    },
    [projectId],
  );

  // Keep the editor iframe's gen-image <img>s in sync with `filledImages`
  // (genid → url). The iframe is a SEPARATE document — not a GenImageProvider
  // consumer like SlideRenderer — so when a regenerated (§19) or streamed image
  // lands we patch its src directly + add the one-shot fade. Persistence is
  // owned by the committed `data-genimage` (the status route derives the URL by
  // hash); this is purely the live in-editor swap. Re-runs on an iframe rebuild
  // (editorDoc changes) so a refilled box survives the rebuild.
  useEffect(() => {
    if (!editorDoc) return;
    for (const [genid, url] of Object.entries(filledImages)) {
      const img = editorDoc.querySelector<HTMLImageElement>(
        `img[data-genid="${genid}"][data-genimage]`,
      );
      if (!img || img.getAttribute("src") === url) continue;
      img.setAttribute("src", url);
      // The streamed placeholder carries inline opacity:0 - clear it so
      // the fade lands on the inline-editable value (slider fix
      // 2026-06-12; the fill-mode change in globals.css is the other
      // half - see img[data-genimage].tq-genimg-in).
      if (img.style.opacity === "0") img.style.removeProperty("opacity");
      img.classList.add("tq-genimg-in");
    }
    // Re-run after an in-place undo/redo too: it swaps the section innerHTML, which replaces
    // the patched <img> with the snapshot's SRCLESS placeholder, so the live fill must be
    // re-applied (else undo on a slide with a filled gen-image reverts it to the shimmer until
    // a slide switch re-runs this). SlideEditor's swap is a child effect, so it commits before
    // this parent effect re-patches the fresh <img>.
  }, [filledImages, editorDoc, inPlaceApply?.token]);
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
          if (parsed.success) setManifestStable(parsed.data);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setManifestStable is a stable setState dispatch; intentionally not a re-run trigger
  }, [peerRegenInProgress, projectId]);

  // How many reserved gen-image boxes does this deck have? Gates the
  // hydration poll below (text-only decks — the common case — never fire it)
  // AND gives the poll a completion target.
  //
  // Counted from BOTH the completed manifest AND the live streamingPreview, so
  // it goes > 0 the moment a reserved box appears DURING generation — not only
  // after the deck finishes. That matters because gpt-image-2 fills run while
  // the deck is still on `/preview`, where the slides live in streamingPreview,
  // not `manifest`. Gating on the manifest alone meant the poll never started
  // in that window, so live fills depended entirely on `slide.image.ready`
  // broadcasts — which have no replay and don't deliver at all in local dev, so
  // images only appeared after a manual reload. With the streamingPreview boxes
  // counted, the poll runs through the whole image-gen window and pulls each
  // fill from the status endpoint as it lands (broadcasts stay a fast-path).
  // The reserved-image genids the client has actually RENDERED (live preview +
  // completed manifest). `genBoxKey` is a stable, comma-joined primitive used
  // as the poll's effect dependency (a Set/array identity would churn every
  // render); the poll re-derives the id set from it to measure own-box
  // coverage. genids are filename-safe (no commas), so the join/split is exact.
  const genBoxKey = useMemo(() => {
    const ids = new Set<string>();
    // Use the canonical scanner (quote-agnostic, dedup, SAFE_GENID-filtered) so
    // the poll's coverage target is EXACTLY the set of boxes SlideRenderer and
    // the server actually fill — a raw `data-genid` regex also counts boxes
    // with no `data-genimage`/empty prompt/unsafe id, which would never fill
    // and would hold the poll open to its cap.
    for (const s of manifest?.slides ?? []) {
      for (const m of scanGenImages(s.html)) ids.add(m.genid);
    }
    for (const s of streamingPreview) {
      for (const m of scanGenImages(s.html)) ids.add(m.genid);
    }
    return Array.from(ids).sort().join(",");
  }, [manifest, streamingPreview]);

  // FRAME decks: slides still awaiting their bake outcome. The freeze bake
  // stamps every slide it settles - data-tq-frozen (pinned) or
  // data-tq-audited (kept-flow) - so "draft" is DERIVED, never tracked: a
  // frame slide with no marker can still be revised by the bake's vision
  // pass. Derivation makes every sync path converge for free: initial load,
  // the deck.baked fat-sync, the visibility-regain refetch. Legacy non-frame
  // decks have no data-tq-frame and never chip.
  const bakePendingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of manifest?.slides ?? []) {
      if (
        s.html.includes("data-tq-frame") &&
        !s.html.includes("data-tq-frozen") &&
        !s.html.includes("data-tq-audited")
      ) {
        ids.add(s.slideId);
      }
    }
    return ids;
  }, [manifest]);

  // The GenChat feed to display: the generation poll and the deck.genchat
  // broadcasts fill liveGenChat; the manifest's copy refreshes on every
  // fat-sync (the bake appends to it). Prefer the FRESHEST source - longer
  // feed wins, and at equal length the newer last entry wins (the live
  // thinking entry mutates in place, so length alone can't tell).
  const genChatFeed = useMemo<GenChatEntry[]>(() => {
    const a = manifest?.genChat ?? [];
    const b = liveGenChat;
    if (a.length !== b.length) return a.length > b.length ? a : b;
    const at = (c: GenChatEntry[]) => c[c.length - 1]?.at ?? 0;
    return at(a) >= at(b) ? a : b;
  }, [manifest, liveGenChat]);

  // Images-mode hydration + self-heal (context/images.md). The live swap
  // is driven by `slide.image.ready` broadcasts, but broadcasts have no
  // replay: one can land in the `/preview`→`/project` navigation gap
  // (before this client subscribes) or be dropped by a throttled
  // background socket. So once the deck has boxes, poll the fill endpoint
  // and merge whatever's ready into `filledImages` — a box that finalizes
  // after the client connected still swaps in, no reload.
  //
  // Poll until EVERY box is filled, or a generous hard cap. gpt-image-2
  // runs ~15-30 s PER image and the reconcile starts only after the deck
  // finishes streaming, so the first boxes can land 20-60 s post-stream.
  // An early "nothing new this tick" must NOT stop the poll (the earlier
  // dry-count stop gave up one tick before the first image was ready);
  // only full coverage or the cap ends it. Merge never clears — a fill is
  // permanent.
  useEffect(() => {
    if (!genBoxKey) return;
    const ownIds = new Set(genBoxKey.split(","));
    let cancelled = false;
    let done = false;
    let attempts = 0;
    const poll = async () => {
      if (cancelled || done) return;
      attempts += 1;
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/status?includeImageFills=true`,
          { credentials: "same-origin" },
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          imageFills?: Record<string, string> | null;
        };
        if (cancelled) return;
        const fills = data.imageFills;
        if (fills) {
          setFilledImages((prev) => {
            let changed = false;
            const next = { ...prev };
            for (const [genid, url] of Object.entries(fills)) {
              // Adopt only fills for boxes THIS deck rendered — the endpoint
              // returns a superset (it may surface stale genids from a prior
              // regen); ignoring them keeps coverage honest and never bakes a
              // foreign image. Merge never clears, so a fill is permanent.
              if (ownIds.has(genid) && next[genid] !== url) {
                next[genid] = url;
                changed = true;
              }
            }
            return changed ? next : prev;
          });
        }
        // Coverage is measured against OUR rendered boxes — NOT the server's
        // returned count — so a superset response can't stop the poll before
        // our own boxes are filled. Keep polling until every rendered box has a
        // fill (a late mid-deck image lands the instant the server has it), or
        // the ~4-min cap (covers a box whose image failed permanently).
        let covered = 0;
        for (const id of ownIds) if (fills && fills[id]) covered += 1;
        if (covered >= ownIds.size || attempts >= 40) done = true;
      } catch {
        /* network blip — next tick retries */
      }
    };
    void poll();
    const interval = window.setInterval(() => {
      if (cancelled || done) {
        window.clearInterval(interval);
        return;
      }
      void poll();
    }, 6000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [projectId, genBoxKey]);
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
    // Clear peer-regen overlays for slides whose version just bumped
    // (their regen finished) — a guarded resync of external state that
    // only fires when something actually bumped, so the cascading-render
    // concern is moot here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      // Track the full box too (w AND h) for the edit-mode artboard fit — the halo +
      // comment overlay are positioned over the centred artboard, which needs both.
      setWorkspaceBox((p) =>
        p.w === rect.width && p.h === rect.height
          ? p
          : { w: rect.width, h: rect.height },
      );
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

  // ── Editor rail collapse (item 11) ── Both floating rails (Slides on the
  // right, Layers on the left) collapse to a thin reopen handle and the canvas
  // reclaims the freed width. Per-rail state so each toggles independently; a
  // narrow-viewport media query collapses/expands both.
  //
  // Seeded COLLAPSED so SSR and the first client render AGREE. Reading matchMedia
  // in the useState initializer returned false on the server (window undefined,
  // rails expanded) but true on a narrow client → a hydration mismatch that
  // regenerated the whole DeckView tree + flashed on every phone load. Starting
  // collapsed means the server already renders the correct state for the mobile
  // majority; the mount effect swaps in the real viewport value: phones stay
  // collapsed (no change, no flash), desktop widens to expanded.
  // `railTransitionReady` holds the canvas margin transition off until after that
  // first correction so the canvas doesn't slide/rescale on load.
  const [layersCollapsed, setLayersCollapsed] = useState(true);
  const [slidesCollapsed, setSlidesCollapsed] = useState(true);
  const [railTransitionReady, setRailTransitionReady] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1280px)");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayersCollapsed(mq.matches);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSlidesCollapsed(mq.matches);
    // Enable the margin transition one frame after the initial correction so
    // user toggles animate but the load-time collapse/expand snaps.
    const raf = requestAnimationFrame(() => setRailTransitionReady(true));
    const onChange = (e: MediaQueryListEvent) => {
      setLayersCollapsed(e.matches);
      setSlidesCollapsed(e.matches);
    };
    mq.addEventListener("change", onChange);
    return () => {
      cancelAnimationFrame(raf);
      mq.removeEventListener("change", onChange);
    };
  }, []);

  // View-first switch for `isMobileStudio` — phones (< md, 768px) drop the
  // editor iframe for the SlideRenderer viewer. Same effect-not-initializer
  // recipe as the rail collapse above (matchMedia in a useState initializer
  // desyncs SSR vs client and flashes); default false keeps the server + first
  // paint on the desktop editor, so desktop never remounts.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMobileStudio(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobileStudio(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
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
  // Dismiss the editor selection (and its style pill) when the focused slide
  // changes — the selected element belongs to the previous slide's iframe doc, so
  // it must not linger over the new slide.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditorSelected([]);
  }, [currentSlideIndex]);


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
    // Standard latest-value ref sync (manifestRef above does the same). The
    // immutability rule only trips here now that a memoized reader
    // (bumpEditorIfFocusedChanged) was added — this is the React-sanctioned
    // ref-mutation pattern, not a real violation.
    // eslint-disable-next-line react-hooks/immutability
    slideIndexRef.current = currentSlideIndex;
  }, [currentSlideIndex]);

  // Leave-the-canvas auto-save: switching slides flushes + pins any unsaved edits on
  // the way out. Triggered from the user's navigation actions (slide nav, prev/next)
  // rather than a slide-index effect, so it's a user-initiated save, not a cascading
  // render. No-op when nothing is dirty, so browsing saved slides never writes.
  const navigateToSlide = useCallback(
    (next: number | ((prev: number) => number)) => {
      if (localDirtyRef.current) void saveProjectRef.current();
      setCurrentSlideIndex(next);
    },
    [],
  );

  // Touch swipe → prev/next slide (phones). Direction-aware via `dir` so the
  // gesture follows the reading flow. Clamped to the slide range; navigateToSlide
  // saves any dirty edit before flipping. The spread is gated in the JSX to the
  // "consume" posture (see `swipeEnabled`) so it never fights the AI/comment
  // region-draw or the editor's in-iframe object drag.
  const deckSwipe = useSwipeNav({
    onNext: () =>
      navigateToSlide((prev) => {
        const count = manifest?.slides.length ?? 0;
        return count ? Math.min(count - 1, prev + 1) : prev;
      }),
    onPrev: () => navigateToSlide((prev) => Math.max(0, prev - 1)),
    // Follow the DECK's reading flow, not the UI locale, so an Arabic-UI viewer
    // reading an English deck still swipes LTR. Mirrors the keyboard-nav mapping
    // (`isLtr = manifest.language === "en"`).
    dir: (manifest?.language ?? "ar") === "en" ? "ltr" : "rtl",
  });

  useEffect(() => {
    if (!currentUserId) return;
    let cancelled = false;
    let localHandle: ProjectChannelHandle | null = null;
    (async () => {
      // Pre-flight auth gate + private-channel token: one round-trip
      // mints the Realtime JWT whose `topics` claim must already list
      // `project:{id}` BEFORE the channel subscribes (the policy is
      // evaluated at join). Doubles as the old realtime-token access
      // check - the server refuses the topic for viewers who lost
      // access between SSR + mount.
      try {
        const allowed = await ensureProjectTopic(projectId);
        if (!allowed) return;
      } catch {
        return;
      }
      if (cancelled) return;
      // Supabase presence key MUST be unique per viewer (prisma User.id
      // works) — otherwise everyone's metas collide into one bucket
      // and the dispatcher only surfaces the most-recent tracker, so
      // one viewer sees the other but not vice-versa.
      localHandle = await openProjectChannel(projectId, currentUserId);
      if (cancelled) {
        void localHandle.close();
        return;
      }
      localHandle.onPresenceSync((state) => {
        if (!cancelled) {
          // Subscribe to external source: the channel owns this state,
          // we just mirror it into React.
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
            // Subscribe to external source: the channel is the source of
            // truth, we just mirror fresh rows in.
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
        // Subscribe to external source (channel is the source of truth).
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
            if (parsed.success) {
              // Bump the editor reload key BEFORE the swap (reads the pre-swap
              // manifest from the ref) and ONLY when the FOCUSED slide's html
              // changed — a whole-manifest poll/peer refresh otherwise remounts
              // the focused SlideEditor and drops the user's selection +
              // unsaved iframe state on every tick. SlideEditor is pinned to
              // slide IDENTITY (slideId), not slide.html, so a real regen
              // (same id, new html) still needs the bump to re-read slide.html.
              bumpEditorIfFocusedChanged(parsed.data);
              setManifestStable(parsed.data);
            }
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
      // FRAME decks: the freeze bake finished - vision revisions applied and
      // bake markers stamped. Pointer-only event: the fat-sync pulls the
      // updated manifest, which swaps any revised slides in place (editor
      // bump handled inside for the focused slide) and clears the draft
      // chips by derivation (bakePendingIds reads the markers). Fires for
      // everyone including the actor - the bake has no meaningful actor.
      localHandle.on("deck.baked", () => {
        if (cancelled) return;
        void fetchAndSwapState();
      });
      // GenChat LIVE tick from the bake - the feed updates the moment the
      // server writes instead of waiting for the next poll. Entries are
      // validated individually; thumbs are stripped on the wire, so keep
      // the thumbs the client already holds for the same position.
      localHandle.on("deck.genchat", (payload) => {
        if (cancelled) return;
        const feed: GenChatEntry[] = [];
        for (const candidate of payload.entries ?? []) {
          const parsed = GenChatEntrySchema.safeParse(candidate);
          if (parsed.success) feed.push(parsed.data);
        }
        if (feed.length === 0) return;
        setLiveGenChat((prev) => {
          const at = (c: GenChatEntry[]) => c[c.length - 1]?.at ?? 0;
          if (feed.length < prev.length) return prev;
          if (feed.length === prev.length && at(feed) <= at(prev)) return prev;
          return feed.map((e, i) =>
            !e.thumbs && prev[i]?.kind === "review" && prev[i]?.thumbs
              ? { ...e, thumbs: prev[i].thumbs }
              : e,
          );
        });
      });
      // Images mode (context/images.md): a reserved image box was filled
      // by gpt-image-2 — during the stream by deck-image-warm, or later by
      // regenerate. Record genid → url so SlideRenderer (via the
      // GenImageProvider below) swaps the box's shimmer placeholder → the
      // real image in place, live, while the deck is still generating.
      localHandle.on("slide.image.ready", (payload) => {
        if (cancelled) return;
        setFilledImages((prev) =>
          prev[payload.genid] === payload.url
            ? prev
            : { ...prev, [payload.genid]: payload.url },
        );
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
      // Admin oversight is invisible: never track(), so the owner sees
      // no admin avatar. Receive stays live (presence sync + broadcasts
      // don't require the client to track).
      if (isAdminObserver) return;
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
    })().catch((err) => {
      // The async open can reject (a stale-channel race during a fast
      // re-open, a network blip on the token round-trip, ...). Swallow it
      // as a warning so it never surfaces as an unhandled promise rejection
      // (those were the onunhandledrejection events Sentry was catching).
      if (!cancelled) console.warn("[realtime] channel open failed", err);
    });
    return () => {
      cancelled = true;
      presenceHandleRef.current = null;
      localHandle?.close();
      // Future token re-mints stop carrying this project's topic.
      releaseProjectTopic(projectId);
    };
    // `canComment` is read inside the broadcast handlers; including it
    // in deps reopens the channel when a role upgrade lands so the
    // listener gate flips on without a refresh. In practice role
    // changes mid-session are rare (Phase 15.E re-invite flow),
    // but keeping the dep set honest avoids the stale-closure trap.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bumpEditorIfFocusedChanged + setManifestStable are stable; deps curated intentionally (see note above)
  }, [
    projectId,
    currentUserId,
    currentUserName,
    currentUserImage,
    isAdminObserver,
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
            if (parsed.success) {
              // Bump the editor reload key BEFORE the swap (reads the pre-swap
              // manifest from the ref) and ONLY when the FOCUSED slide's html
              // changed — a whole-manifest poll/peer refresh otherwise remounts
              // the focused SlideEditor and drops the user's selection +
              // unsaved iframe state on every tick. SlideEditor is pinned to
              // slide IDENTITY (slideId), not slide.html, so a real regen
              // (same id, new html) still needs the bump to re-read slide.html.
              bumpEditorIfFocusedChanged(parsed.data);
              setManifestStable(parsed.data);
            }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bumpEditorIfFocusedChanged + setManifestStable are stable; intentionally not re-run triggers
  }, [projectId, canComment]);

  // Re-track on slide change + tab-visibility flip. Reads through the
  // ref so a no-op when the channel hasn't finished opening yet —
  // the initial-open path above handles the first track.
  useEffect(() => {
    // isAdminObserver: invisible oversight never re-tracks either.
    if (!currentUserId || isAdminObserver) return;
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
  }, [
    currentSlideIndex,
    currentUserId,
    currentUserName,
    currentUserImage,
    isAdminObserver,
  ]);

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

  // Cancelled takes precedence over failed/generating — once the user
  // explicitly stopped the run, no other state should mask it.
  const status: DerivedStatus = isCancelled(projectStatus, versionStatus)
    ? "cancelled"
    : polledFailure || isFailed(projectStatus, versionStatus)
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

  // BAKE-PENDING POLLER - the deck.baked broadcast's fallback, mirroring the
  // image-fill poller's rationale: broadcasts have no replay, and a tab whose
  // channel is mid-reconnect when the freeze bake lands otherwise wears the
  // draft chips until a manual refresh (user report 2026-07-10). While any
  // slide lacks its bake marker, poll the fat-sync; the derived
  // bakePendingIds empties as soon as a fetch sees the markers, which also
  // stops the interval. Capped so an abandoned bake (function failure after
  // retries) doesn't poll forever - the chips then stay, honestly.
  useEffect(() => {
    if (status === "generating" || bakePendingIds.size === 0) return;
    let cancelled = false;
    let ticks = 0;
    const MAX_TICKS = 72; // ~6 min at 5s - beyond any healthy bake
    const tick = async () => {
      if (cancelled || ticks++ >= MAX_TICKS) return;
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
          if (parsed.success) {
            bumpEditorIfFocusedChanged(parsed.data);
            setManifestStable(parsed.data);
          }
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
        /* network blip - next tick retries */
      }
    };
    // Immediate first tick (the interval alone left a 5s dead window right
    // when the review bubble lands), then 5s: fast enough that the GenChat
    // feed reads live as the poll fallback, cheap for a 60-180s window -
    // the deck.genchat broadcasts are the real-time path on top.
    // The cap CLEARS the interval (CR PR #128): an abandoned bake leaves
    // bakePendingIds stable, so the effect never re-runs and a no-op timer
    // would otherwise tick for the rest of the session.
    void tick();
    const id = setInterval(() => {
      if (cancelled || ticks >= MAX_TICKS) {
        clearInterval(id);
        return;
      }
      void tick();
    }, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bumpEditorIfFocusedChanged + setManifestStable are stable
  }, [projectId, status, bakePendingIds]);

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
      navigateToSlide((prev) => {
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
      // ⌘Z / ⌘⇧Z in edit mode → undo / redo on the focused slide's LOCAL stack
      // (the accurate fine-grained history; SlideVersions are now coarse Save /
      // 10-min checkpoints). isNavBlocked already excluded comment mode,
      // in-flight regen, and typing in a field, so this is safe. Runs before the
      // modifier-key bail below.
      if (
        editMode &&
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        e.key.toLowerCase() === "z"
      ) {
        e.preventDefault();
        if (e.shiftKey) handleLocalRedo();
        else handleLocalUndo();
        return;
      }
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
  }, [
    status,
    manifest,
    commentMode,
    applying,
    historyAnchor,
    editMode,
    handleLocalUndo,
    handleLocalRedo,
    navigateToSlide,
  ]);

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
                setManifestStable(parsed.data);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setManifestStable is a stable setState dispatch; intentionally not a re-run trigger
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
        // GenChat transparency feed - validated per entry; entries are
        // append-mostly so length-monotonic acceptance is enough (the live
        // thinking entry mutates in place, so also accept same-length
        // snapshots - text updates ride them).
        const rawGenChat = (data as unknown as { genChat?: unknown }).genChat;
        if (Array.isArray(rawGenChat)) {
          const feed: GenChatEntry[] = [];
          for (const candidate of rawGenChat) {
            const parsed = GenChatEntrySchema.safeParse(candidate);
            if (parsed.success) feed.push(parsed.data);
          }
          setLiveGenChat((prev) => (feed.length >= prev.length ? feed : prev));
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
          //       high-watermark of the previous version. Keeps the
          //       previous full-length list on screen while a fresh
          //       manifest (server clears its array on `didReset` +
          //       bumps version, or a retry restart) is still
          //       streaming — the brief empty window shouldn't blank
          //       the screen.
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
            // while the fresh manifest is still streaming.
            if (incomingVersion > lastVersion) {
              if (validated.length >= highWatermarkRef.current) {
                lastManifestVersionRef.current = incomingVersion;
                highWatermarkRef.current = validated.length;
                return stabilizeStreamingSlides(prev, validated);
              }
              // Polished pass still ramping up — hold the prior view.
              return prev;
            }
            // (c) Same version — legacy length-only monotonic guard.
            if (validated.length >= prev.length) {
              if (validated.length > highWatermarkRef.current) {
                highWatermarkRef.current = validated.length;
              }
              return stabilizeStreamingSlides(prev, validated);
            }
            return prev;
          });
        }
        // Theme / direction / language ride the same manifest version as
        // the preview slides, so gate them behind the same staleness check
        // — otherwise a slower OLDER-version poll could repaint the freshly
        // accepted slides with a stale theme/direction until the next poll.
        // (The setStreamingPreview updater above runs async, so this ref
        // still holds the pre-poll accepted version when we read it here.)
        const metaVersion =
          typeof data.streamingManifestVersion === "number" &&
          Number.isFinite(data.streamingManifestVersion)
            ? data.streamingManifestVersion
            : 0;
        if (metaVersion >= lastManifestVersionRef.current) {
          if (data.streamingTheme) {
            const parsed = ThemeSchema.safeParse(data.streamingTheme);
            if (parsed.success) {
              const nextTheme = parsed.data;
              setStreamingTheme((prevTheme) =>
                prevTheme && themesEqual(prevTheme, nextTheme)
                  ? prevTheme // unchanged → keep stable ref so memo holds
                  : nextTheme,
              );
            }
          }
          if (
            data.streamingDirection === "rtl" ||
            data.streamingDirection === "ltr"
          ) {
            setStreamingDirection(data.streamingDirection);
          }
          if (
            data.streamingLanguage === "ar" ||
            data.streamingLanguage === "en"
          ) {
            setStreamingLanguage(data.streamingLanguage);
          }
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
            if (parsed.success) {
              // Bump the editor reload key BEFORE the swap (reads the pre-swap
              // manifest from the ref) and ONLY when the FOCUSED slide's html
              // changed — a whole-manifest poll/peer refresh otherwise remounts
              // the focused SlideEditor and drops the user's selection +
              // unsaved iframe state on every tick. SlideEditor is pinned to
              // slide IDENTITY (slideId), not slide.html, so a real regen
              // (same id, new html) still needs the bump to re-read slide.html.
              bumpEditorIfFocusedChanged(parsed.data);
              setManifestStable(parsed.data);
            }
          }
          // Mirror the realtime path (which sets versionStatus on the row
          // update): in dev — and any time Realtime is asleep — the poll is the
          // ONLY completion detector, so it must drive `versionStatus` too.
          // Otherwise the preview→/project redirect (gated on
          // versionStatus === "completed") never fires: the user is stranded on
          // /preview with a stale, pre-image-fill manifest and the deck exports
          // WITHOUT its generated images until a manual reload.
          setVersionStatus("completed");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bumpEditorIfFocusedChanged + setManifestStable are stable; intentionally not re-run triggers
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

  // SLOW just nudges in-page copy (status-aware `slowCaption` below).
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
  // Truthful caption: only blame upstream load when the provider status
  // actually reports degraded/down; otherwise it's just a long deck.
  const slowCaption =
    serverStatus?.level === "degraded" || serverStatus?.level === "down"
      ? dict.editor.errors.serverBusy
      : dict.editor.errors.takingLonger;

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
        title: dict.editor.errors.failedApply,
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
        // GenChat: the partial regen appends per-slide milestones +
        // thinking to the pinned version's feed, and the status route
        // returns that row's genChat. Adopt with the same length-
        // monotonic guard as the generation poll - the deck.genchat
        // broadcasts stay the fast path; this poll is the no-replay net.
        const regenGenChat = (data as unknown as { genChat?: unknown })
          .genChat;
        if (Array.isArray(regenGenChat)) {
          const feed: GenChatEntry[] = [];
          for (const candidate of regenGenChat) {
            const parsed = GenChatEntrySchema.safeParse(candidate);
            if (parsed.success) feed.push(parsed.data);
          }
          setLiveGenChat((prev) => (feed.length >= prev.length ? feed : prev));
        }
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
            if (parsed.success) {
              // Bump the editor reload key BEFORE the swap (reads the pre-swap
              // manifest from the ref) and ONLY when the FOCUSED slide's html
              // changed — a whole-manifest poll/peer refresh otherwise remounts
              // the focused SlideEditor and drops the user's selection +
              // unsaved iframe state on every tick. SlideEditor is pinned to
              // slide IDENTITY (slideId), not slide.html, so a real regen
              // (same id, new html) still needs the bump to re-read slide.html.
              bumpEditorIfFocusedChanged(parsed.data);
              setManifestStable(parsed.data);
            }
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
          // The AI comments were consumed (applied) by THIS regen; the user /
          // collaboration comments were carried forward to the new version
          // server-side (regenerate-partial tx). Drop only the applied AI ones
          // locally so the user comments stay visible without a refresh.
          // Scope the drop to the regenerated slide set (`applying.targetSlideIds`)
          // — a plain single-slide /regen shares this `applying` path, and an
          // unscoped `!c.forAi` filter would wipe AI drafts on OTHER slides it
          // never consumed. Captured `applying` here is still the pinned job
          // (setApplying(null) only schedules the next render's state).
          const consumedSlideIds = new Set(applying.targetSlideIds);
          setComments((prev) =>
            prev.filter((c) => !(c.forAi && consumedSlideIds.has(c.slideId))),
          );
          setApplying(null);
          setCommentMode(false);
          return;
        }
        // 2. Explicit failure.
        if (
          (isPinned && data.versionStatus === "failed") ||
          data.status === "failed"
        ) {
          failApply(dict.editor.errors.cancelledOrFailed);
          return;
        }

        // 2b. SUPERSEDED / abandoned — `applying` pins a REAL version that is no
        // longer the active one (the status route now reports a different,
        // newer version). Every other terminal branch gates on `isPinned`
        // (data.versionId === applying.versionId), so a pinned-but-superseded
        // version can NEVER resolve through the poll and the overlay strands
        // forever — e.g. Inngest is killed mid-regen and a later regen runs, or
        // a peer's regen supersedes this one. Treat it as terminal and drop the
        // overlay (the visible deck is already on the newer version; the route
        // creates the new version row BEFORE we pin its id, so a freshly-fired
        // regen always matches and never trips this). reported 2026-06-07.
        if (
          applying.versionId !== "__pending__" &&
          typeof data.versionId === "string" &&
          data.versionId.length > 0 &&
          data.versionId !== applying.versionId
        ) {
          setApplying(null);
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
          failApply(dict.editor.errors.stopped);
          return;
        }

        // 5. Hard timeout.
        if (Date.now() - applyStartedAt > APPLY_TIMEOUT_MS) {
          failApply(dict.editor.errors.tookLonger);
          return;
        }
      } catch {
        consecutiveErrors += 1;
        // 4. Network / server disconnect. ~10 s of failed polls.
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          failApply(dict.editor.errors.disconnected);
        }
      }
    };
    void tick();
    const id = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dict.editor.errors strings + bumpEditorIfFocusedChanged + setManifestStable are stable; intentionally not re-run triggers
  }, [applying, projectId, projectTitle, router]);

  // ── Left rail tabs: Layers ⇄ Chat (owner spec 2026-07-10) ──────────
  // The GenChat feed is a persistent TAB beside Layers, same
  // SegmentedToggle UI as the right sidebar's slides/comments tabs. The
  // ACTIVE tab follows API activity: any communication with the model
  // (generation stream, freeze bake, partial regen) flips to Chat, and
  // the activity ending flips back to Layers. Only the EDGES
  // auto-switch, so a manual flip mid-run sticks. Adjust-during-render
  // (not a mount effect) per the set-state-in-effect lint rule.
  const apiActive =
    status === "generating" || bakePendingIds.size > 0 || applying != null;
  const [railTab, setRailTab] = useState<"layers" | "chat">("layers");
  // Whether the current Chat tab was AUTO-activated (an activity edge or a
  // manual open DURING activity) vs user-pinned while idle. Auto-activated
  // chat returns to Layers by a LEVEL rule - any render after the activity
  // ends corrects it - so a missed edge (batched state transitions on a
  // page opened mid-stream, seen live 2026-07-10) still heals; a user
  // reading history on an idle deck is never yanked away.
  const [autoChat, setAutoChat] = useState(false);
  const [prevApiActive, setPrevApiActive] = useState(false);
  if (apiActive !== prevApiActive) {
    setPrevApiActive(apiActive);
    if (apiActive) {
      setAutoChat(true);
      setRailTab("chat");
    }
  }
  if (!apiActive && autoChat && railTab === "chat") {
    setAutoChat(false);
    setRailTab("layers");
  }
  // The Chat tab exists whenever there is (or is about to be) a feed;
  // decks with no GenChat history keep the plain Layers header.
  const chatTabAvailable = apiActive || genChatFeed.length > 0;
  const railTabsSlot = chatTabAvailable ? (
    <SegmentedToggle
      options={[
        { value: "layers", label: dict.editor.layers.title, icon: "layers" },
        { value: "chat", label: dict.editor.genchat.title, icon: "auto_awesome" },
      ]}
      value={railTab}
      onChange={(v) => {
        // A manual flip to Chat DURING activity keeps the auto-return (the
        // user is watching the run); flipped while idle = pinned history
        // reading, never auto-yanked back to Layers.
        setAutoChat(v === "chat" && apiActive);
        setRailTab(v);
      }}
      ariaLabel={dict.editor.genchat.railTabsAria}
      size="comfortable"
      fullWidth
    />
  ) : undefined;

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
      message = dict.editor.errors.applied;
    } else if (status === 401) {
      message = dict.editor.errors.sessionExpired;
    } else if (status === 404) {
      message = dict.editor.errors.commentNotFound;
    } else if (status === 423) {
      // Server-side lock guard from POST /comments. Fires when a peer
      // locked the slide before the local optimistic create made it
      // to the server — the client gate hides comment-mode on locked
      // slides but a stale broadcast leaves a small window where the
      // local view still thinks the slide is unlocked.
      message = dict.editor.errors.slideLocked;
    } else {
      message = fallback;
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = status;
    throw err;
  };

  const handleCreateComment = useCallback(
    async (input: {
      slideId: string;
      // `null` = whole-slide (the AI composer's no-region case, §17). Edit-mode
      // user comments always pass a drawn box.
      bounds: CommentBounds | null;
      content: string;
    }) => {
      const res = await fetch(`/api/projects/${projectId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slideId: input.slideId,
          boundsJson: input.bounds,
          content: input.content,
          // Tag by mode (§16 Chunk 4): a comment authored in AI mode is
          // an instruction for the model (fed to the partial regen); in
          // Edit mode it's a normal collaboration comment that never
          // reaches Claude. Only editors can reach AI mode, so non-edit
          // roles always create user comments.
          forAi: studioMode === "ai",
        }),
      });
      if (!res.ok) {
        throwApiError(res.status, dict.editor.errors.failedSaveComment);
      }
      const data = (await res.json()) as { comment: CommentRow };
      setComments((prev) => [...prev, data.comment]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- throwApiError + dict.editor.errors strings are stable; used only in the error path
    [projectId, studioMode],
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
      if (!res.ok) throwApiError(res.status, dict.editor.errors.failedUpdateComment);
      const data = (await res.json()) as { comment: CommentRow };
      setComments((prev) =>
        prev.map((c) => (c.id === input.commentId ? data.comment : c)),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- throwApiError + dict.editor.errors strings are stable; used only in the error path
    [projectId],
  );

  const handleDeleteComment = useCallback(
    async (commentId: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/comments/${commentId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throwApiError(res.status, dict.editor.errors.failedDeleteComment);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- throwApiError + dict.editor.errors strings are stable; used only in the error path
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
  const handleFirePartialRegen = useCallback(async (
    // §17: the AI composer fires this right after POSTing its forAi comment.
    // That comment isn't in the client `comments` state yet (setComments hasn't
    // re-rendered), so the comments-derived guard below would wrongly bail —
    // the caller passes the focused slide's id explicitly instead. The server
    // (regenerate-partial) is the source of truth for which slides regenerate;
    // these ids only seed the optimistic overlay.
    explicitTargetIds?: string[],
  ) => {
    if (applying) return;
    // Only AI comments are applied (§16 Chunk 4) — scope the guard + the
    // optimistic overlay to forAi slides so they match what the server promotes.
    let optimisticTargetIds: string[];
    if (explicitTargetIds && explicitTargetIds.length > 0) {
      optimisticTargetIds = explicitTargetIds;
    } else {
      const aiComments = comments.filter((c) => c.forAi);
      if (aiComments.length === 0) return;
      optimisticTargetIds = Array.from(
        new Set(aiComments.map((c) => c.slideId)),
      );
    }
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

  // AI composer submit (§17) — the bottom-bar send. Creates the forAi comment
  // (drawn region as bounds, or null = whole slide) via the existing /comments
  // POST, then fires the partial regen scoped to the focused slide. forAi is
  // derived from `studioMode` inside handleCreateComment, so we only supply
  // content + bounds. The explicit target id is REQUIRED: the freshly-created
  // comment isn't in the client `comments` state yet (setComments hasn't
  // re-rendered), so handleFirePartialRegen's comments-derived guard would
  // wrongly bail — the server reads the comment from the DB regardless. The
  // focused slide is recomputed here (not via the late `focusedSlide`, which is
  // declared after this component's early returns) from manifest +
  // currentSlideIndex. On a thrown create/regen the error propagates so
  // PreviewActionBar keeps the typed text for a retry.
  const handleAiSubmit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || applying) return;
      const slides = manifest?.slides;
      if (!slides || slides.length === 0) return;
      const idx = Math.min(Math.max(currentSlideIndex, 0), slides.length - 1);
      const target = slides[idx];
      if (!target) return;
      const targetId = target.slideId;
      if (slideStates[targetId]?.lockedAt != null) return;
      await handleCreateComment({
        slideId: targetId,
        bounds: pendingAiBounds,
        content: trimmed,
      });
      // Region consumed — clear it; the optimistic regen overlay takes over.
      setPendingAiBounds(null);
      await handleFirePartialRegen([targetId]);
    },
    [
      applying,
      manifest,
      currentSlideIndex,
      slideStates,
      pendingAiBounds,
      handleCreateComment,
      handleFirePartialRegen,
    ],
  );

  // Drop the drawn AI region when the user leaves AI mode or the focused slide
  // changes — a region only means something for the slide it was drawn on while
  // the AI composer is showing. Keyed on currentSlideIndex (the focused-slide
  // source) so it fires on navigation; focusedSlide itself is computed after
  // the early returns below.
  useEffect(() => {
    // setState(null) is a no-op when already null (React bails on identical
    // value), so this needn't guard on the current value — and dropping
    // `pendingAiBounds` from the deps stops it re-running on every draw.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPendingAiBounds(null);
  }, [studioMode, currentSlideIndex]);

  const handleToggleCommentMode = useCallback(() => {
    setCommentMode((v) => !v);
  }, []);

  // Esc cancels the active commenting mode — normal comment mode OR §17 AI mode.
  // The HeroCommentOverlay's own capture-phase Esc handler runs FIRST for an open
  // comment editor / live drag / marker preview and stops propagation, so this
  // only fires once those inner layers are clear (the Esc cascade): an in-progress
  // AI drag is cancelled by the overlay; a committed region (or none) backs all
  // the way out here. Leaving AI mode drops `pendingAiBounds` via the studioMode
  // effect above, so we just flip the mode.
  useEffect(() => {
    const inAi = studioMode === "ai";
    if (!commentMode && !inAi) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (commentMode) setCommentMode(false);
      if (inAi) setStudioMode("edit");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [commentMode, studioMode]);

  // Delete / Backspace on the canvas selection — handled at the PARENT window so
  // it works even when the editor iframe isn't focused (the press-and-drag handler
  // preventDefaults the mousedown, which can keep focus off the iframe, so its own
  // keydown bridge wouldn't fire). Ignored while typing in any field.
  useEffect(() => {
    if (!editMode || studioMode !== "edit" || commentMode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (t?.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (editorSelected.length === 0) return;
      e.preventDefault();
      deleteSelected();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editMode, studioMode, commentMode, editorSelected, deleteSelected]);

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
      // Match against the LOCALIZED aria-labels (these elements' aria-labels now
      // come from the active-locale dict). `slidePrefix` is the slide-aria text
      // before the number, so it matches both the focused hero ("Slide N of M")
      // and the thumbnails ("Slide N") in either locale.
      const slidePrefix = dict.editor.nav.slideAria.split("{n}")[0];
      if (
        target.closest(`[aria-label^="${slidePrefix}"]`) || // Hero motion.div / thumbnails
        target.closest(`aside[aria-label="${dict.editor.comments.panelAria}"]`) || // Comments panel
        target.closest(`aside[aria-label="${dict.editor.nav.slidesSidebar}"]`) || // SlideNav (transient during fade)
        target.closest('[data-preview-toolbar="true"]') || // PreviewActionBar wrapper
        target.closest(".surface-modal") || // Editor popover
        target.closest("header") || // App header
        target.closest('aside[aria-label="Sidebar"]') // Main app sidebar
      ) {
        return;
      }
      setCommentMode(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dict.editor aria strings are stable per locale; intentionally not re-run triggers
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
      if (!res.ok) throw new Error(dict.editor.errors.cannotRetry);
      // Let the server re-render the parent with the queued status; parent
      // keys DeckView so this component remounts back into "generating".
      router.refresh();
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : dict.editor.errors.cannotRetry);
    } finally {
      setRetrying(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dict.editor.errors.cannotRetry is a stable i18n string; used only in the error path
  }, [projectId, router]);

  // Cancel mid-generation. POSTs to /api/projects/[id]/cancel — the
  // route flips Job.cancelRequestedAt + Project.status + Version.status
  // in one transaction AND fires the Inngest cancel event. The
  // deck-generate worker polls the DB flag inside its streaming step
  // and aborts the Anthropic stream when it observes the flip; Inngest
  // tears the function envelope down at the next step boundary. After
  // a successful POST we router.refresh() so the parent re-runs
  // loadProject + sees the new "cancelled" status, swapping DeckView
  // into the cancelled-recovery state below.
  const handleCancel = useCallback(async () => {
    setCancelBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/cancel`, {
        method: "POST",
      });
      if (!res.ok) {
        // Surface the server's actual error message (route puts a
        // human-readable Arabic string in `error`) so we don't mask
        // a 404 / 403 / 500 as a generic failure. Inline the status
        // + body into the message string itself — Next.js's dev
        // overlay only renders the first console.error arg, so
        // passing the object as a second arg shows up as `{}`.
        const body = await res.text().catch(() => "<unreadable>");
        console.error(
          `[deck-view] cancel failed — HTTP ${res.status} — body: ${body}`,
        );
        throw new Error(
          dict.editor.errors.cancelFailed.replace("{status}", String(res.status)),
        );
      }
      // Close the modal optimistically; the page-level re-render
      // (router.refresh) will swap DeckView into the cancelled-recovery
      // shell using the same path the failed-state branch uses.
      setCancelOpen(false);
      router.refresh();
    } catch (err) {
      // Stay on the modal so the user sees the failure + can retry the
      // cancel. The original generation keeps running in the meantime.
      console.error("[deck-view] cancel failed", err);
      setCancelBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dict.editor.errors.cancelFailed is a stable i18n string; used only in the error path
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

  // Placeholder strategy switches on `initialSlideCountAuto`:
  //   • custom  → fixed-N tiles (the user picked N, show N up-front)
  //   • auto    → empty-then-grow — render only as many tiles as
  //                streamingPreview has delivered, PLUS one trailing
  //                "still working" placeholder while generation is
  //                live. Avoids the legacy 6/8-tile guess that read
  //                as a hard count to the user even though the auto
  //                mode means Claude picks.
  // Computed inside the `status === "generating"` branch (below); this
  // memo only handles the static-N case so the completed-branch math
  // (which uses manifest.slides.length) stays untouched.
  const placeholders = useMemo(
    () => Array.from({ length: Math.max(slideCount, 1) }),
    [slideCount],
  );

  const fontLinks = useMemo(() => {
    // Fall back to the mid-stream theme so Google webfonts load DURING
    // generation too — `manifest` stays null until the full deck parses, but
    // `streamingTheme` (ThemeSchema-validated, same host allowlist) carries the
    // fonts from the first streamed bytes.
    const theme = manifest?.theme ?? streamingTheme;
    if (!theme) return [] as string[];
    // Schema validates the host allowlist (lib/schema/slide.ts —
    // ALLOWED_FONT_HOSTS), so any URL we see here has already passed that
    // check. Just dedupe and emit; matches html-document.ts's behaviour for
    // preview ↔ exported-HTML parity.
    return [theme.font.url].filter(
      (url, idx, all): url is string =>
        typeof url === "string" && all.indexOf(url) === idx,
    );
  }, [manifest, streamingTheme]);

  // Uploaded brand fonts: theme.font*.fontFaces is a list of signed font-file
  // URLs, ONE per uploaded weight (deck-generate attached them by matching the
  // family name back to the uploaded storageUrls). Emit a direct @font-face per
  // WEIGHT so the slides — which reference the family by NAME and vary
  // font-weight — render each weighted run in the matching uploaded file.
  // Dedupe by family so heading + body sharing one upload emit once. Carry the
  // RAW family name (just trimmed); it's CSS-escaped at emit time via the SAME
  // cssFontFamilyName() the --font-* vars use, so the @font-face family and the
  // slides' `font-family: var(--font-heading)` resolve to the identical name
  // (e.g. "DIN NEXT™ ARABIC" — no char dropped, so they match).
  const fontFaces = useMemo(() => {
    // Fall back to the mid-stream theme so an UPLOADED font @font-faces DURING
    // generation — deck-generate pre-signs the faces and attaches them to the
    // streaming theme, so they're present from the first streamed bytes (not
    // just after the post-stream inject).
    const theme = manifest?.theme ?? streamingTheme;
    if (!theme)
      return [] as { name: string; faces: { weight: number; src: string }[] }[];
    const out: { name: string; faces: { weight: number; src: string }[] }[] = [];
    const f = theme.font;
    const name = f?.name?.trim();
    if (f?.fontFaces && f.fontFaces.length > 0 && name) {
      out.push({ name, faces: f.fontFaces });
    }
    return out;
  }, [manifest, streamingTheme]);

  // Google <link>s + uploaded-font @font-face <style>, rendered in BOTH the
  // generating AND completed branches below. Sourced from the memos above
  // (which fall back to streamingTheme), so the fonts load DURING streaming —
  // not only when the final manifest lands. Keeping one fragment means the two
  // branches can't drift.
  const fontAssets = (
    <>
      {fontLinks.map((url) => (
        <link key={url} rel="stylesheet" href={url} />
      ))}
      {fontFaces.length > 0 ? (
        <style>
          {fontFaces
            .flatMap((f) =>
              f.faces.map(
                (face) =>
                  `@font-face{font-family:"${cssFontFamilyName(f.name)}";font-weight:${face.weight};src:url("${cssFontFamilyName(face.src)}");font-display:swap;}`,
              ),
            )
            .join("")}
        </style>
      ) : null}
    </>
  );

  // ─── Failed ────────────────────────────────────────────────────────────────
  if (status === "failed") {
    return (
      <section dir={dir} className="page-container">
        <div className="surface-card-danger mx-auto max-w-xl rounded-xl p-8 text-center">
          <span className="material-symbols-outlined mb-4 block text-[42px] text-red-400">
            warning
          </span>
          <h1 className="mb-2 text-[26px] font-bold text-foreground">{dict.editor.screen.createFailedTitle}</h1>
          <p className="text-muted mb-6">
            {retryError || dict.editor.errors.designError}
          </p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={handleRetry}
              disabled={retrying}
              className="btn-gradient inline-flex items-center justify-center gap-2 px-6 py-3 disabled:opacity-60"
            >
              {retrying ? (
                <span className="spinner h-4 w-4 rounded-full border-2 border-foreground/20 border-t-white" />
              ) : null}
              {dict.editor.screen.tryAgain}
            </button>
            <Link href={localizedHref("/dashboard", locale)} className="btn-pill px-6 py-3 text-sm no-underline">
              {dict.editor.screen.backHome}
            </Link>
          </div>
        </div>
      </section>
    );
  }

  // ─── Cancelled ─────────────────────────────────────────────────────────────
  // User clicked the cancel pill mid-generation. Same recovery shell
  // as "failed" but with neutral (not danger) chrome — the deck isn't
  // broken, the user just stopped it intentionally. "Try again"
  // re-fires the original brief via /api/projects/[id]/retry; partial
  // slides were discarded server-side so we start from a clean state.
  //
  // Centered both axes — the recovery card is the only thing on the
  // page in this state, so it sits in the optical middle of the
  // viewport (minus the dashboard header). `min-h-[calc(100vh-120px)]`
  // = viewport minus the DashboardShell header padding so the card
  // floats inside the visible area rather than docking against the
  // top of the content well. `.surface-card` is the canonical neutral
  // surface (token-driven background + backdrop-blur, see globals.css
  // — no inline `style` overrides). Buttons use `.btn-gradient` +
  // `.btn-pill` to match the failed-state recovery card.
  if (status === "cancelled") {
    return (
      <section
        dir={dir}
        className="page-container flex min-h-[calc(100vh-120px)] items-center justify-center"
      >
        <div className="surface-card mx-auto w-full max-w-xl rounded-2xl p-8 text-center">
          <span className="material-symbols-outlined mb-4 block text-[42px] text-foreground/70">
            stop_circle
          </span>
          <h1 className="mb-2 text-[26px] font-bold text-foreground">
            {dict.editor.screen.cancelledTitle}
          </h1>
          <p className="text-muted mb-6">
            {dict.editor.screen.cancelledBody}
          </p>
          <div className="flex flex-col items-center justify-center gap-2 sm:flex-row">
            {/* "إعادة الإنشاء" — sends the user BACK to the create
                flow they originally came from (NOT a silent re-run of
                the same brief, which is what /api/projects/[id]/retry
                does). The point of cancelling is usually to ADJUST
                something — different language, slide count, file,
                etc. — so a fresh trip through the create form lets
                them revise. The flow URL is derived from
                `initialSourceKind` (see lib/project/load-project.ts
                → readSourceKind). null falls back to /create since
                that's the legacy default when the field is missing. */}
            <Link
              href={
                initialSourceKind === "enhance"
                  ? "/enhance"
                  : initialSourceKind === "mimic"
                    ? "/mimic"
                    : initialSourceKind === "data"
                      ? "/datasheet"
                      : "/create"
              }
              className="btn-gradient inline-flex items-center justify-center gap-2 px-5 py-2 text-sm no-underline"
            >
              {dict.editor.screen.recreate}
            </Link>
            <Link
              href={localizedHref("/dashboard", locale)}
              // `.btn-pill` lives unlayered in globals.css (see comment
              // at globals.css:1096 — "unlayered specificity beating
              // @layer utilities") so its own padding + font-size win
              // against plain `px-5 py-2 text-sm` utilities. The trailing
              // `!` (Tailwind v4 important syntax) lifts the utilities to
              // !important so the link renders at the same dimensions as
              // the gradient button beside it.
              className="btn-pill no-underline px-5! py-2! text-sm!"
            >
              {dict.editor.screen.backHome}
            </Link>
          </div>
        </div>
      </section>
    );
  }

  // ─── Generating + Completed: ONE unified Studio shell ───────────────────────
  // The generation phase is the editor with disabled controls + a streaming
  // canvas; completion just enables the controls + swaps in the editable canvas
  // — same render tree, so nothing remounts. (Routing serves both at /project,
  // so there's no route hop either.) These generation-phase derived values are
  // hoisted out of the old early-return so the unified return below can read
  // them. Cheap to compute always — they read the streaming state, empty when
  // not generating.
  const generating = status === "generating";
  // Edit-mode workspace fit: in edit mode the motion.div below is the WHOLE workspace
  // (the iframe fills it), and the artboard floats centred + fit-scaled inside. The AI
  // halo + comment overlay must sit on THAT inner rect, so derive it from the same
  // fitArtboard() the editor's iframe uses → pixel-aligned, no drift. null in the
  // viewer / generation paths, where the motion.div IS the artboard.
  const artboardFit =
    editMode && !generating
      ? fitArtboard(workspaceBox.w, workspaceBox.h, canvasW, canvasH)
      : null;
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

    // Slot count switches on the user's slide-count mode:
    //   • custom (user picked N) → fixed-N tiles. Today's behavior.
    //   • auto                   → reserve a slot per slide Claude COMMITTED
    //                              to up front (`progress.estimatedTotal`,
    //                              which the server fills from the manifest's
    //                              top-level `slideCount` as soon as it
    //                              streams). So the user sees the full total
    //                              immediately — closed slides render as
    //                              thumbnails, the rest pulse as pending, and
    //                              the slot Claude is writing shows the
    //                              paragraph-write icon. Before the count
    //                              arrives (early thinking) it's just the
    //                              streamed slides + a trailing tail. If Claude
    //                              overshoots its own number, the +1 keeps the
    //                              row growing. The tail/extra slots disappear
    //                              when status flips to "completed" and the
    //                              manifest branch below takes over.
    // The `Math.max(..., 1)` guarantees at least one tile so an empty
    // sidebar doesn't flash on initial paint before Claude's first
    // slide closes — the user sees the writing icon immediately.
  const autoTotalHint =
    progress && progress.estimatedTotal > 0 ? progress.estimatedTotal : 0;
  const slotCount = initialSlideCountAuto
    ? Math.max(streamingPreview.length + 1, autoTotalHint, 1)
    : placeholders.length;
  // Mix real streamed slides (kind:"slide") into the head of the nav row,
  // padded with placeholders for slots Claude hasn't closed yet. Auto-mode
  // tail: the LAST slot (index === streamingPreview.length) is forced to
  // state:"current" so the paragraph-write icon shows even before
  // progress.currentSlide ticks past it.
  const genNavItems: NavItem[] = Array.from({ length: slotCount }).map(
    (_, idx) => {
      const previewSlide = streamingPreview[idx];
      if (previewSlide && streamingTheme) {
        return {
          kind: "slide",
          index: idx,
          slide: previewSlide,
          commentCount: 0,
          // Every streamed slide is a DRAFT until the deck lands: the
          // model can still swap it via a data-revises correction (the
          // forced revision pass runs after the last slide streams).
          // The chip clears deck-wide when `generating` flips and the
          // manifest branch below takes over.
          draft: true,
        };
      }
      const isNextSlot = idx === streamingPreview.length;
      return {
        kind: "placeholder",
        index: idx,
        state: isNextSlot ? "current" : cardStatus(idx),
      };
    },
  );
  // Synthetic manifest shell so the nav's `manifest.theme`/`.direction`/
  // `.language` reads work before the canonical manifest exists. Only the
  // fields the nav + SlideRenderer consume are populated. Null until a theme
  // streams (the canvas shows the thinking screen until then).
  const previewManifestForNav: SlideManifest | null = streamingTheme
    ? ({
        version: "2.0",
        presentationId: presentationId ?? "",
        title: projectTitle ?? "",
        language: streamingLanguage,
        direction: streamingDirection,
        format: initialFormat ?? "16:9",
        theme: streamingTheme,
        slides: streamingPreview,
      } satisfies SlideManifest)
    : null;
  // The slide focused in the hero while streaming — clamp to a slot that has a
  // preview slide; -1 when nothing has streamed yet.
  const previewHeroIdx =
    streamingPreview.length === 0
      ? -1
      : Math.min(currentSlideIndex, streamingPreview.length - 1);
  const previewHeroSlide =
    previewHeroIdx >= 0 ? streamingPreview[previewHeroIdx] : null;

  // ─── Unified view values (generating OR completed) ──────────────────────────
  // `viewManifest` is the real manifest once completed, or the streaming shim
  // while generating — null only in the earliest "thinking" moment before a
  // theme streams (the canvas shows the thinking screen then). Everything below
  // reads from it so the SAME return renders both states.
  const viewManifest = manifest ?? previewManifestForNav;
  const viewSlides = viewManifest?.slides ?? [];
  // Currently-focused slide. Clamped so the index can't outpace a freshly
  // shrunk manifest. Null only when nothing has rendered yet (early generation);
  // the editable canvas + its overlays are suppressed while generating, so the
  // null case only ever feeds the streaming/thinking canvas.
  const focusedIndex = viewSlides.length
    ? Math.min(Math.max(currentSlideIndex, 0), viewSlides.length - 1)
    : 0;
  const focusedSlide: SlideType | null = viewSlides[focusedIndex] ?? null;

  // Nav items: streaming placeholders while generating, real slides once done.
  const navItems: NavItem[] = generating
    ? genNavItems
    : (manifest?.slides ?? []).map((slide, idx) => ({
        kind: "slide",
        index: idx,
        slide,
        commentCount: commentsBySlideId.get(slide.slideId)?.length ?? 0,
        regenerating:
          !!applying?.targetSlideIds.includes(slide.slideId) ||
          peerRegenInProgress.has(slide.slideId),
        locked: slideStates[slide.slideId]?.lockedAt != null,
        // Still awaiting its bake outcome - the vision pass may revise it.
        draft: bakePendingIds.has(slide.slideId),
      }));
  // Peer/own regen overlay for the focused slide (completed only — no focused
  // slide identity to key on while generating).
  const isFocusedRegenerating =
    !!focusedSlide &&
    (!!applying?.targetSlideIds.includes(focusedSlide.slideId) ||
      peerRegenInProgress.has(focusedSlide.slideId));
  const isFocusedLocked =
    !!focusedSlide && slideStates[focusedSlide.slideId]?.lockedAt != null;
  // DRAFT = the freeze bake's vision review is still in flight for this
  // slide: the bake may swap its html any moment, so editing is disabled
  // (belt to the bake's write guard's braces - an edit mid-bake would be
  // discarded by the stale check anyway, this makes it impossible instead).
  const isFocusedDraft =
    !!focusedSlide && bakePendingIds.has(focusedSlide.slideId);
  // Editing is disabled while generating (controls aren't live yet), or when
  // the focused slide is mid-regen / locked / still a draft.
  const editingDisabled =
    generating || isFocusedRegenerating || isFocusedLocked || isFocusedDraft;

  // Undo / redo enabled-state for the toolbar buttons — driven by the focused
  // slide's LOCAL stack (the same one ⌘Z / ⌘⇧Z + handleLocalUndo/Redo drive).
  const focusedSlideKey = focusedSlide?.slideId;
  const focusedStack = focusedSlideKey ? undoStacks[focusedSlideKey] : undefined;
  const canUndo =
    !editingDisabled && (focusedStack?.past.length ?? 0) > 0;
  const canRedo =
    !editingDisabled && (focusedStack?.future.length ?? 0) > 0;

  const heroWidthCss = `min(calc((100dvh - ${HERO_VERTICAL_PADDING_PX}px) * ${canvasW} / ${canvasH}), 100%, ${CANVAS_MAX_WIDTH}px)`;

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
    if (localDirty) return false;
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

  // Comment / AI-scope overlay. The SAME element in both layouts; only the pixel
  // `scale` (and therefore the host rect it's mounted in) differs — the centred
  // artboard fit in edit mode, the artboard-sized hero in the viewer. Factored so the
  // JSX isn't duplicated across the two mounts.
  const heroCommentOverlay = (scale: number) => (
    <HeroCommentOverlay
      slideId={focusedSlide!.slideId}
      comments={comments}
      scale={scale}
      canvasW={canvasW}
      canvasH={canvasH}
      direction={manifest!.direction}
      onCreate={handleCreateComment}
      onUpdate={handleUpdateComment}
      onDelete={handleDeleteComment}
      canModerate={canEdit}
      currentUserId={currentUserId}
      commentMode={
        (studioMode === "ai" ? true : commentMode) &&
        slideStates[focusedSlide!.slideId]?.lockedAt == null
      }
      onRequestCommentMode={canComment ? () => setCommentMode(true) : undefined}
      forAi={studioMode === "ai"}
      pendingAiBounds={pendingAiBounds}
      onAiBoundsChange={handleAiBoundsChange}
    />
  );

  return (
    <GenImageProvider value={filledImages}>
    <section
      dir={viewManifest?.direction ?? streamingDirection}
      className="relative"
      // Studio: the slide centers between the two floating panels (Slides on
      // the right, Layers on the left). Symmetric gutters reserve their space;
      // the panels themselves are fixed overlays so this only drives centering.
      // The panels sit 16px off each edge (width SLIDE_NAV_WIDTH), so a margin
      // of SLIDE_NAV_WIDTH + 56 leaves a comfortable ~40px breathing gap
      // between the canvas and each panel (was +24 → only ~8px, too tight).
      // Each gutter shrinks to a thin handle when its rail is collapsed so the
      // canvas reclaims the width (item 11). Layers (left) only mounts in EDIT
      // mode, so in the view-first posture (editMode false, e.g. phones) there's
      // no left panel to reserve for — the left gutter then MIRRORS the right
      // (slides) gutter so the slide stays centered instead of getting shoved
      // into a 336px phantom margin (which collapsed the hero to ~4px on phones).
      // `RAIL_GUTTER` (44) leaves room for the reopen handle.
      style={{
        marginLeft:
          (editMode ? layersCollapsed : slidesCollapsed)
            ? 44
            : SLIDE_NAV_WIDTH + 56,
        marginRight: slidesCollapsed ? 44 : SLIDE_NAV_WIDTH + 56,
        transition: railTransitionReady ? "margin 300ms ease" : "none",
      }}
    >
      {fontAssets}

      {/* Studio header strip (2026-06-12): the SAME utility cluster as the
          dashboard (plan badge / bell / search / health / theme / language)
          plus, in the trailing slot, the document actions (Export ▾ + Share -
          moved here from the slide-nav footer) and the avatar menu. */}
      {/* Fixed full-width wrapper: the section is inset by the panel
          gutters (marginLeft/Right above), so the strip's own
          `absolute inset-x-0` would inherit those margins. Pinning a
          zero-height fixed layer to the viewport makes the strip span
          edge-to-edge like the dashboard chrome. */}
      <div className="fixed inset-x-0 top-0 z-40 h-0">
        <TopUtilityBar
          avatar={<UserMenu />}
          // Mobile-only hamburger → the app nav drawer, so the editor isn't a
          // dead end on phones (the desktop home button is hidden there). md:hidden
          // internally, so desktop keeps the home button instead.
          leading={<MobileNav />}
          trailing={
            !generating && exportManifest ? (
              <>
                <span className="mx-1.5 h-5 w-px bg-[var(--tq-border-hairline)]" aria-hidden />
                <StudioActions
                  projectId={projectId}
                  projectTitle={projectTitle}
                  manifest={exportManifest}
                  formatFallback={initialFormat}
                  role={role}
                />
              </>
            ) : null
          }
        />
      </div>

      {/* Right-edge slot: the Slides nav (with a Comments tab for reviewing
          comments). FADED OUT (not unmounted) while commenting — both side
          panels clear so the canvas is the only comment surface. Kept mounted so
          the thumbnails don't remount + flash white when commenting ends. */}
      <motion.div
        animate={{ opacity: commentMode ? 0 : 1 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        style={{ pointerEvents: commentMode ? "none" : "auto" }}
      >
      <SlideNavSidebar
        items={navItems}
        currentIndex={focusedIndex}
        onSelect={(idx) => navigateToSlide(idx)}
        manifest={viewManifest}
        format={viewManifest?.format ?? initialFormat ?? "16:9"}
        title={viewManifest?.title ?? projectTitle}
        mainSidebarWidth={mainSidebarWidth}
        // Sidebar reading direction follows the deck's language —
        // EN decks flip to LTR so the visual #1 lands on the left
        // (user feedback 2026-05-20). Defaults to "ar" if missing.
        language={
          (viewManifest?.language ?? streamingLanguage) === "en" ? "en" : "ar"
        }
        // Bulk lock pill is hidden for non-edit roles + while generating
        // (nothing to lock yet). Same gating as the per-slide lock toggle.
        onLockAll={canEdit && !generating ? () => bulkSetLock(true) : undefined}
        onUnlockAll={
          canEdit && !generating ? () => bulkSetLock(false) : undefined
        }
        viewersBySlide={viewersBySlide}
        floating
        collapsed={slidesCollapsed}
        // Cancel pill (generating only). Confirmation modal below.
        onCancelGeneration={
          generating && canEdit ? () => setCancelOpen(true) : undefined
        }
        cancelDisabled={cancelBusy}
        // Slides ⇄ Comments tab (§16) — completed only (no comments while
        // generating). The badge counts the focused slide's comments.
        tab={generating ? undefined : navTab}
        onTabChange={
          generating
            ? undefined
            : (t) => {
                setNavTab(t);
                if (t === "slides") setCommentMode(false);
              }
        }
        commentCount={
          generating
            ? 0
            : comments.filter((c) => c.slideId === focusedSlide?.slideId).length
        }
        commentsSlot={
          !generating && canComment && focusedSlide ? (
            <CommentsPanel
              embedded
              comments={comments}
              slideId={focusedSlide.slideId}
              onClose={handleToggleCommentMode}
              onApply={handleApplyComments}
              mainSidebarWidth={mainSidebarWidth}
            />
          ) : undefined
        }
      />
      </motion.div>

      {/* Studio — Layers panel (left), mirroring the Slides nav on the right.
          Lists the focused slide's visual leaves from the live editor DOM;
          clicking a row selects that element. Only while the editor is active. */}
      {editMode ? (
        <motion.div
          animate={{ opacity: commentMode ? 0 : 1 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          style={{ pointerEvents: commentMode ? "none" : "auto" }}
        >
          <LayersPanel
            collapsed={layersCollapsed}
            tabsSlot={railTabsSlot}
            doc={editorDoc}
            // The full selection SET: a sole leaf highlights its row; a whole group
            // highlights its folder. A leaf-row click selects that one element; a
            // folder-header click selects every member (the group as a unit).
            selected={editorSelected}
            onSelect={setEditorSelected}
            onCommit={handleSlideEdit}
            onToggleLock={toggleLock}
            onDelete={(el) => deleteEls([el])}
            restackTick={restackTick}
            slideId={focusedSlide?.slideId ?? ""}
            language={
              (viewManifest?.language ?? streamingLanguage) === "en"
                ? "en"
                : "ar"
            }
          />
        </motion.div>
      ) : null}

      {/* GenChat - the backend-transparency feed, the Chat TAB of the left
          rail (owner spec 2026-07-10). While the model is talked to
          (generation, bake, partial regen) the rail auto-switches here; the
          activity ending switches back to Layers (the crossfade below
          reveals the LayersPanel beneath). In edit mode the tab bar lets
          the user flip back to the history at any time; during pure
          generation (no editor yet) the panel stands alone, no tabs. */}
      <AnimatePresence>
        {railTab === "chat" &&
        chatTabAvailable &&
        (editMode || apiActive) ? (
          <motion.div
            key="genchat"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          >
            <GenChatPanel
              entries={genChatFeed}
              language={
                (viewManifest?.language ?? streamingLanguage) === "en"
                  ? "en"
                  : "ar"
              }
              isPost={isPostFormat}
              collapsed={layersCollapsed}
              tabsSlot={editMode ? railTabsSlot : undefined}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Collapse / reopen the floating rails, a BARE arrow on the rail's
          canvas-facing edge (no border / no box, user direction 2026-06-14),
          centered in the same [RAIL_TOP, vh-RAIL_BOTTOM] band as the rails. The
          chevron points toward the canvas to open, toward the rail to close.
          Hidden in comment mode; the Layers arrow only shows while editing. */}
      {!commentMode ? (
        <button
          type="button"
          onClick={() => setSlidesCollapsed((v) => !v)}
          aria-label={slidesCollapsed ? dict.editor.nav.expandPanel : dict.editor.nav.collapsePanel}
          className="fixed z-[31] flex items-center justify-center p-1.5 text-muted transition-[right] duration-300 hover:text-foreground"
          style={{
            right: slidesCollapsed ? 10 : SLIDE_NAV_WIDTH + 16,
            top: `calc(50% - ${(RAIL_BOTTOM - RAIL_TOP) / 2}px)`,
            transform: "translateY(-50%)",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 22 }} aria-hidden>
            {slidesCollapsed ? "chevron_left" : "chevron_right"}
          </span>
        </button>
      ) : null}
      {editMode && !commentMode ? (
        <button
          type="button"
          onClick={() => setLayersCollapsed((v) => !v)}
          aria-label={layersCollapsed ? dict.editor.nav.expandPanel : dict.editor.nav.collapsePanel}
          className="fixed z-[31] flex items-center justify-center p-1.5 text-muted transition-[left] duration-300 hover:text-foreground"
          style={{
            left: layersCollapsed ? 10 : SLIDE_NAV_WIDTH + 16,
            top: `calc(50% - ${(RAIL_BOTTOM - RAIL_TOP) / 2}px)`,
            transform: "translateY(-50%)",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 22 }} aria-hidden>
            {layersCollapsed ? "chevron_right" : "chevron_left"}
          </span>
        </button>
      ) : null}

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
              className="pointer-events-none fixed inset-x-0 bottom-5 z-[1050] flex justify-center"
              initial={{ y: 90, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{
                y: TOOLBAR_POSITION_SPRING,
                opacity: { duration: 0.5, ease: "easeOut" },
              }}
            >
              <div className="pointer-events-auto">
                <PreviewActionBar
                  horizontal
                  // Generating: present but inert + dimmed; enables on completion.
                  disabled={generating}
                  // View-first on phones: the object-edit tools (add-text, undo/
                  // redo, history, lock, save) are dropped so the pill fits + stays
                  // centered; AI-instruct, comment, home stay. Desktop = always
                  // editing (canEdit) so the full toolbar is unchanged.
                  editing={editMode}
                  projectId={projectId}
                  role={role}
                  studioMode={studioMode}
                  onSetStudioMode={setStudioMode}
                  commentMode={commentMode}
                  onToggleCommentMode={handleToggleCommentMode}
                  onAddText={addTextBox}
                  draftCommentCount={
                    comments.filter((c) => !c.forAi).length
                  }
                  // AI composer (§17) — the instruction send. The drawn region
                  // (pendingAiBounds) lives on the canvas marker; the bar just
                  // collects + submits the instruction. `hasAiRegion` flips the
                  // input placeholder once a region is drawn.
                  hasAiRegion={pendingAiBounds != null}
                  // Bumps on each valid region-draw release → the bar bounces
                  // to point the user at the instruction input.
                  aiRegionNudge={aiRegionNudge}
                  onAiSubmit={handleAiSubmit}
                  // Locked focused slide → PreviewActionBar disables
                  // the Comment button (only the toggle-out path
                  // stays live if commentMode is already on; see
                  // its prop-doc). Mirrors the HeroCommentOverlay
                  // gate further down — same source of truth, just
                  // surfaced in the toolbar too so the user knows
                  // why "+ comment" doesn't work before clicking.
                  focusedSlideLocked={
                    slideStates[focusedSlide?.slideId ?? ""]?.lockedAt != null
                  }
                  // Armed = drafts exist, user has exited comment
                  // mode, and no apply is in flight → the regen
                  // Shared cluster (§16) — History + Lock relocated off the
                  // deleted canvas pill, plus the AI-mode single-slide regen.
                  // The History button is a TOGGLE relative to the current
                  // anchor; its popover flips up from the bottom bar.
                  // Undo / redo — the focused slide's local stack (mirrors ⌘Z /
                  // ⌘⇧Z). Greyed at the ends via canUndo / canRedo.
                  onUndo={handleLocalUndo}
                  onRedo={handleLocalRedo}
                  canUndo={canUndo}
                  canRedo={canRedo}
                  historyOpen={
                    historyAnchor != null &&
                    historySlideKey === focusedSlide?.slideId
                  }
                  onOpenHistory={async (rect) => {
                    if (historyAnchor != null) {
                      setHistoryAnchor(null);
                      setHistorySlideKey(null);
                      return;
                    }
                    if (!rect) return;
                    setHistoryAnchor(rect);
                    setHistorySlideKey(focusedSlide.slideId);
                    if (!historyVersions[focusedSlide.slideId]) {
                      try {
                        const res = await fetch(
                          `/api/projects/${projectId}/slides/${encodeURIComponent(focusedSlide.slideId)}/versions`,
                        );
                        if (!res.ok)
                          throw new Error(`versions: ${res.status}`);
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
                  onToggleLock={async () => {
                    const current = slideStates[focusedSlide.slideId];
                    const shouldLock = current?.lockedAt == null;
                    // Optimistic flip — server response replaces it; revert on error.
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
                      if (!res.ok)
                        throw new Error(`lock toggle: ${res.status}`);
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
                          hasCachedComments:
                            current?.hasCachedComments ?? false,
                          lockedAt: current?.lockedAt ?? null,
                        },
                      }));
                    }
                  }}
                  onRegenSlide={async () => {
                    // Clean partial regen of the focused slide — no comments.
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
                        const errorBody = (await res
                          .json()
                          .catch(() => null)) as { error?: string } | null;
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
                      setSlideStates((prev) => {
                        const cur = prev[focusedSlide.slideId];
                        return {
                          ...prev,
                          [focusedSlide.slideId]: {
                            slideKey: focusedSlide.slideId,
                            currentVersionNumber:
                              cur?.currentVersionNumber ?? 1,
                            hasCachedComments: false,
                            lockedAt: cur?.lockedAt ?? null,
                          },
                        };
                      });
                    } catch (err) {
                      console.error("regen failed", err);
                      setApplying(null);
                    }
                  }}
                  applying={!!applying}
                  currentVersionId={initialVersionId ?? null}
                  isSaved={isSaved}
                  saving={savingProject}
                  saveError={saveErrored}
                  onSave={saveProject}
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
        // §22: center the canvas within the SAME vertical band as the side
        // panels (both rails sit [RAIL_TOP, vh-RAIL_BOTTOM]), not the raw
        // viewport, so the slide + both rails line up on one centerline AND the
        // canvas always clears the header strip (paddingTop: RAIL_TOP).
        style={{ minHeight: "100dvh", paddingTop: RAIL_TOP, paddingBottom: RAIL_BOTTOM }}
      >
        <motion.div
          ref={gridRef}
          // Phone swipe-to-navigate. Enabled only in the "consume" posture:
          // OFF while generating (nothing to flip to), in comment mode, and in
          // AI mode (both draw a region on this same canvas via HeroCommentOverlay,
          // which a horizontal swipe would hijack). In object-edit mode the slide
          // is an iframe that captures its own touches, so margin swipes still flip
          // safely. Non-owner viewers are always in consume posture → full swipe.
          {...(!generating && !commentMode && studioMode !== "ai"
            ? deckSwipe
            : {})}
          variants={slideCardVariants}
          initial="hidden"
          animate="visible"
          aria-label={dict.editor.nav.slideOf
            .replace("{n}", String(focusedIndex + 1))
            .replace("{total}", String(Math.max(viewSlides.length, 1)))}
          // Edit mode = a full Canva-style WORKSPACE (the iframe fills the canvas area
          // and floats the artboard inside, so handles draw over the whole page); the
          // viewer / generation paths keep the artboard-sized hero box.
          style={editMode && !generating ? undefined : { aspectRatio, width: heroWidthCss }}
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
          // Edit mode: motion.div is the WORKSPACE, so it does NOT carry the halo
          // (the ring would hug the whole dark area). The halo + comment overlay live
          // on the inner artboard-frame below, which tracks the centred slide. Viewer /
          // generation: motion.div IS the artboard, so it keeps the halo as before.
          className={`group/canvas relative p-0${
            editMode && !generating ? " w-full self-stretch" : " canvas-gradient-border"
          }${commentMode || studioMode === "ai" ? " cursor-crosshair" : ""}`}
          // The gradient halo is the "you're instructing the AI" indicator. §17: AI mode
          // is a draw-to-scope surface, so the halo is on for the whole of AI mode. In
          // edit mode the halo moved to the artboard-frame, so this stays off here.
          data-active={
            !(editMode && !generating) && studioMode === "ai" ? "true" : "false"
          }
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
          <div
            className={`h-full w-full overflow-hidden${
              generating
                ? " canvas-gen-surface"
                : ""
            }`}
          >
            {generating ? (
              // ── Generation canvas: the streaming hero (once a slide closes)
              // or the thinking screen + progress bar until then. Same wrapper
              // as the editor canvas, so completion only swaps the INNER
              // content — the frame never remounts.
              previewHeroSlide && streamingTheme ? (
                <SlideRenderer
                  slide={previewHeroSlide}
                  theme={streamingTheme}
                  direction={streamingDirection}
                  language={streamingLanguage}
                  width={canvasW}
                  height={canvasH}
                  scale={gridScale}
                />
              ) : (
                <div
                  dir={dir}
                  className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center text-foreground"
                >
                  <h1 className="font-headline-lg text-[28px] font-bold">
                    {isPostFormat
                      ? dict.editor.screen.designingPost
                      : dict.editor.screen.designing}
                  </h1>
                  <div className="text-muted flex items-center justify-center gap-3 text-sm">
                    <span className="spinner h-4 w-4 rounded-full border-2 border-foreground/20 border-t-white" />
                    <span>
                      {progress?.stage === "thinking"
                        ? dict.editor.progress.thinking
                        : progress?.stage === "validating"
                          ? dict.editor.progress.validating
                          : progress?.stage === "saving"
                            ? dict.editor.progress.saving
                            : progress?.currentSlide
                              ? initialSourceKind === "data"
                                ? dict.editor.progress.analyzingData
                                : initialSourceKind === "mimic"
                                  ? dict.editor.progress.readingSource
                                  : initialSourceKind === "enhance"
                                    ? dict.editor.progress.extracting
                                    : dict.editor.progress.writing
                              : dict.editor.progress.startingDesign}
                    </span>
                  </div>
                  {isSlow && (
                    <span className="text-[11px] leading-relaxed text-foreground/60">
                      {slowCaption}
                    </span>
                  )}
                </div>
              )
            ) : editMode ? (
              <SlideEditor
                slide={focusedSlide}
                theme={manifest!.theme}
                direction={manifest!.direction}
                language={manifest!.language}
                width={canvasW}
                height={canvasH}
                scale={gridScale}
                selected={editorSelected}
                onSelect={setEditorSelected}
                onDocReady={setEditorDoc}
                /* selected/onSelect are now the multi-select SET (§20). */
                onEdit={handleSlideEdit}
                // ⌘Z / ⌘⇧Z pressed while focus is inside the editor iframe never
                // reaches the window listener above, the editor forwards them
                // to the same local history stack.
                onUndo={handleLocalUndo}
                onRedo={handleLocalRedo}
                reloadKey={editorReloadKey}
                lockTick={lockTick}
                inPlaceApply={inPlaceApply}
                onDeleteSelected={deleteSelected}
                onGroup={groupSelected}
                onUngroup={ungroupSelected}
                // Locked / mid-regen / comment mode / AI mode: keep the editor
                // mounted (no SlideEditor→SlideRenderer swap → no canvas flash)
                // but inert. The StylePill is suppressed below; the comment /
                // AI-region overlay sits on top and owns the draw interaction.
                // §17: AI mode is a draw-to-scope surface, so the editor is
                // inert there too even though commentMode is false.
                disabled={editingDisabled || commentMode || studioMode === "ai"}
              />
            ) : (
              <SlideRenderer
                slide={focusedSlide}
                theme={manifest!.theme}
                direction={manifest!.direction}
                language={manifest!.language}
                width={canvasW}
                height={canvasH}
                scale={gridScale}
              />
            )}
            {/* I2 — contextual style pill over the selected element (Edit
                studio-mode only; suppressed while generating, in AI mode,
                comment mode, or while the slide is regenerating / locked). */}
            {!generating && editMode && studioMode === "edit" && !commentMode && !editingDisabled && editorSelected.length > 0 ? (
              <StylePill
                targets={editorSelected}
                slideId={focusedSlide!.slideId}
                onCommit={handleSlideEdit}
                onDismiss={dismissEditorSelection}
                onRegenImage={handleRegenImage}
                onGroup={groupSelected}
                onUngroup={ungroupSelected}
                onToggleLock={toggleLock}
                onRestack={onRestack}
                language={manifest!.language === "en" ? "en" : "ar"}
              />
            ) : null}
          </div>


          {/* Draft chip — the focused slide's bake outcome hasn't landed:
              while generating every streamed slide is revisable, and after
              completion the freeze bake's vision pass can still revise it
              (bakePendingIds derives from the missing bake markers, so the
              chip clears the moment the deck.baked fat-sync lands). Same
              recipe as the nav-tile chip; anchored to the artboard corner
              via the artboardFit rect in edit mode (the wrapper there is
              the whole workspace, not the artboard). */}
          {(generating
            ? previewHeroSlide != null
            : focusedSlide != null && bakePendingIds.has(focusedSlide.slideId)) ? (
            <span
              className="pointer-events-none absolute z-10 flex items-center gap-1.5 rounded-md bg-black/70 px-2 py-1 text-xs font-semibold leading-none"
              style={{
                color: "var(--tq-status-warn-dot)",
                ...(artboardFit
                  ? {
                      insetInlineStart: artboardFit.offsetX + 12,
                      top: artboardFit.offsetY + 12,
                    }
                  : { insetInlineStart: 12, top: 12 }),
              }}
            >
              {/* Spinning ring: draft = the bake's vision review is in
                  flight, an active state (same recipe as the nav chip). */}
              <span
                className="spinner h-3 w-3 shrink-0 rounded-full border"
                style={{
                  borderColor: "color-mix(in srgb, var(--tq-status-warn-dot) 30%, transparent)",
                  borderTopColor: "var(--tq-status-warn-dot)",
                }}
              />
              {dict.editor.nav.draftChip}
            </span>
          ) : null}

          {/* Regenerating overlay — full-canvas dim + clean spinner.
              The dim layer uses `var(--tq-bg-dim)` (the same 55 %
              dark token the popovers use) so the white spinner reads
              cleanly on any slide background, including bright /
              white ones, without needing a separate chip chrome
              behind it. Replaces the previous filter:blur(20px) on
              the slide content + dim-chip combo (direction
              2026-05-23). */}
          {!generating && isFocusedRegenerating ? (
            <div
              // Follow the UI locale so the status label + its trailing
              // ellipsis read correctly in both directions (the overlay
              // otherwise inherits the canvas row's dir="ltr").
              dir={dir}
              className={`pointer-events-none absolute flex flex-col items-center justify-center gap-2 text-center text-foreground${
                artboardFit ? "" : " inset-0"
              }`}
              // In edit mode the motion.div is the whole WORKSPACE, so dim only the
              // centred artboard rect (same framing as the AI halo + comment overlay);
              // in viewer / generation the motion.div IS the artboard, so inset-0 fits.
              style={{
                backgroundColor: "var(--tq-bg-dim)",
                ...(artboardFit
                  ? {
                      left: artboardFit.offsetX,
                      top: artboardFit.offsetY,
                      width: artboardFit.width,
                      height: artboardFit.height,
                    }
                  : {}),
              }}
            >
              {/* Branded paragraph-write animation. Replaces the legacy
                  `.spinner` ring (2026-05-27) so canvas + sidebar
                  thumbnails share one loading vocabulary with the
                  initial-generation streaming cells. */}
              <ParagraphWriteIcon
                rtl={(manifest?.language ?? "ar") !== "en"}
                size={32}
                className="text-foreground/70"
              />
              <span className="text-xs font-medium">
                {dict.editor.screen.redesigning}
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
          {/* EDIT: mount on an inner FRAME at the centred artboard rect (the shared
              fitArtboard rect, pixel-aligned with the iframe artboard) which also carries
              the AI halo; pointer-events:none so it never blocks the iframe (the overlay
              re-enables events on its own interactive bits). VIEWER: the motion.div IS the
              artboard, so mount the overlay directly at the hero scale, as before. */}
          {artboardFit ? (
            <div
              className="canvas-gradient-border"
              data-active={studioMode === "ai" ? "true" : "false"}
              // position via INLINE style: `.canvas-gradient-border` sets
              // `position:relative`, which would beat a Tailwind `absolute` utility
              // class (cascade order) and drop the frame into normal flow below the
              // iframe. Inline style wins over any class, pinning it to the fit rect.
              style={{
                position: "absolute",
                left: artboardFit.offsetX,
                top: artboardFit.offsetY,
                width: artboardFit.width,
                height: artboardFit.height,
                pointerEvents: "none",
              }}
            >
              {canComment && !isFocusedRegenerating
                ? heroCommentOverlay(artboardFit.scale)
                : null}
            </div>
          ) : !generating && canComment && !isFocusedRegenerating ? (
            heroCommentOverlay(gridScale)
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
        versions={
          historySlideKey ? (historyVersions[historySlideKey] ?? []) : []
        }
        currentVersionNumber={
          historySlideKey
            ? (slideStates[historySlideKey]?.currentVersionNumber ?? null)
            : null
        }
        busy={false}
        onClose={() => {
          setHistoryAnchor(null);
          setHistorySlideKey(null);
        }}
        onRestore={async (versionNumber) => {
          if (!historySlideKey) return;
          const targetSlideKey = historySlideKey;
          // Close the popover FIRST so the click feels responsive — its exit
          // animation runs while restoreToVersion does the optimistic pointer
          // move + /restore call + in-place splice (and reverts on failure).
          setHistoryAnchor(null);
          setHistorySlideKey(null);
          await restoreToVersion(targetSlideKey, versionNumber);
        }}
      />
      {/* Cancel-confirmation modal (generation only) — portal'd to body so the
          backdrop-blur escapes the section's positioning context. */}
      {generating ? (
        <CancelGenerationDialog
          open={cancelOpen}
          onClose={() => {
            if (!cancelBusy) setCancelOpen(false);
          }}
          onConfirm={handleCancel}
          busy={cancelBusy}
        />
      ) : null}
    </section>
    </GenImageProvider>
  );
}
