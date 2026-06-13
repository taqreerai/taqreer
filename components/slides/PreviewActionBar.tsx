"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { SegmentedToggle } from "@/components/create/controls";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";

// Toolbar orientation → drives where each ToolButton's tooltip pops. Vertical
// (left rail): to the right, toward content. Horizontal (Studio bottom bar):
// above the button. Context so it doesn't have to thread through every call site.
const ToolbarHorizontalContext = createContext(false);
// useLayoutEffect on the client (measure before paint, no flash), useEffect on
// the server (no-op, avoids the SSR warning).
const useIsoLayoutEffect =
  typeof document !== "undefined" ? useLayoutEffect : useEffect;

// Studio editor mode — Edit (manual scalpel + user comments) vs AI (generative).
export type StudioMode = "edit" | "ai";

type Status = "idle" | "running" | "success" | "error";

type ButtonState = {
  status: Status;
  message?: string;
};

// All toolbar buttons share ONE neutral glass visual language. No solid
// fills, no gradients, no brand-coloured tints. Idle / active / hover
// differ only by glass intensity — active raises bg opacity ~3× and border
// opacity ~2×, hover bumps brightness slightly. Reads like the dashboard's
// `.glass` system on the bootcamp / sidebar pages.
//
// Why no colours: at scale the toolbar accumulates many actions; brand
// colours per-button creates visual noise. Context identifies CTAs (the
// detached Apply cell only appears when there are drafts; the Save button
// only inside the editor). The badge on the comment icon is the only
// coloured element — that's INFO, not button state.
function ToolButton({
  icon,
  iconNode,
  label,
  badge,
  countBadge,
  onClick,
  disabled,
  running,
  active,
  gradient,
  iconFilled,
  buttonProps,
}: {
  icon: string;
  // Optional custom icon node — overrides the material-symbols icon
  // when provided. Used by the regen button to render an
  // AnimatePresence icon morph (autorenew ↔ check with continuous
  // rotation) instead of a static glyph.
  iconNode?: React.ReactNode;
  label: string;
  badge?: string;
  // Small numeric badge in the top-end corner. Used for the comment toggle
  // to show how many draft comments live across the deck.
  countBadge?: number;
  // Receives the click event so callers that need the button's geometry
  // (e.g. the History button anchoring its popover) can read
  // `e.currentTarget.getBoundingClientRect()`. Most callers ignore it.
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  running?: boolean;
  active?: boolean;
  // Animated brand-gradient variant (`.btn-gradient-anim` in globals.css).
  // Used on the AI-related buttons (Regen, Comment) so they read as
  // one family against the otherwise-neutral glass toolbar.
  gradient?: boolean;
  // Swap the Material Symbols icon to its FILLED variant
  // (`font-variation-settings: FILL 1`). Substitutes the
  // raised-bg active state on `gradient` buttons — under
  // .btn-gradient-anim the inline `activeBg` is suppressed, so a
  // shape-level cue (outline → filled) is the cleanest way to
  // signal "this button is engaged" without competing with the
  // animated gradient ring. The font URL in layout.tsx loads
  // FILL@0..1 so this toggle is a no-extra-network swap.
  iconFilled?: boolean;
  // Extra attributes spread onto the underlying <button>. Used by the
  // History trigger to carry `data-history-trigger="true"` so
  // HistoryPopover's outside-click handler skips the trigger
  // (otherwise the popover closes-then-reopens on the trigger click).
  // The `data-*` intersection lets callers pass custom data attributes,
  // which TS's strict object-literal check rejects on a bare
  // ButtonHTMLAttributes type (they're only inferred through JSX).
  buttonProps?: React.ButtonHTMLAttributes<HTMLButtonElement> &
    Record<`data-${string}`, string>;
}) {
  const isDisabled = disabled || running;
  const tooltipHorizontal = useContext(ToolbarHorizontalContext);
  // Two coordinated visual transitions on hover:
  //   - icon: muted (white/60) → white
  //   - border: dim (white/15) → bright (white/40)
  // Idle = TRANSPARENT background (the toolbar sits on a `.surface-card`
  // surface; stacking another glass tint on top reads as a solid chip,
  // which is wrong — same rule as `.btn-pill` in globals.css). Active
  // raises the glass intensity as the sole state indicator (e.g.
  // commentMode on, isSaved). Gradient variant bypasses the glass
  // system — its visuals come from `.btn-gradient-anim`.
  // State-driven appearance — NO BACKGROUND at any state. Hover +
  // active feedback comes from the border (white/15 → white/60) and
  // the text (white/60 → white) brightening. Pure-white borders
  // read as too thick at 1px on a dark page; white/60 gives a
  // clearly-defined ring without the chunky feel (user feedback
  // 2026-05-22 after the first all-white attempt).
  // Bare icon buttons (§16): no ring, no background chip. State reads purely
  // from icon brightness — active/hover = white, idle = white/60.
  const colorClasses = active
    ? "text-foreground"
    : "text-foreground/60 hover:text-foreground";
  return (
    <div className="group relative">
      <button
        type="button"
        {...buttonProps}
        onClick={onClick}
        disabled={isDisabled}
        aria-label={label}
        aria-pressed={active}
        // No inline style anymore — both hover + active backgrounds
        // come from Tailwind utilities in `colorClasses` above. The
        // blur still comes from `` so the button
        // participates in v4's compositional backdrop-filter rule.
        className={
          gradient
            ? // `rounded-full` makes the 44×44 button a perfect circle.
              // `btn-gradient-anim::before` uses `border-radius: inherit`
              // so its mesh ring follows automatically — no separate
              // edit needed for the animated border.
              //
              // No `transition-shadow` (removed 2026-05-23 per CR) —
              // toolbox icon buttons sit under the no-shadow-motion
              // contract; the scale hover is the only motion this
              // variant gets.
              `btn-gradient-anim relative flex h-9 w-9 items-center justify-center rounded-full ${
                isDisabled ? "" : "hover:scale-[1.02]"
              }`
            : // Glass variant — same circle treatment. The brand-system
              // rule is: small icon-only buttons are circles. The bell +
              // collapsed sidebar are larger square chrome (intentionally
              // rounded-rect, not in scope here).
              `relative flex h-9 w-9 items-center justify-center rounded-full transition-colors ${colorClasses} ${
                isDisabled ? "opacity-40" : ""
              }`
        }
      >
        {iconNode ? (
          iconNode
        ) : running ? (
          <span className="spinner h-4 w-4 rounded-full border-2 border-foreground/20 border-t-white" />
        ) : (
          <span
            className="material-symbols-outlined text-[18px]"
            // `font-variation-settings` replaces the WHOLE shorthand,
            // not just one axis — so when we want FILL=1 we have to
            // re-state every axis the base `.material-symbols-outlined`
            // rule set (wght 200, GRAD 0, opsz 24). Otherwise wght
            // would silently drop to the variable-font default.
            style={
              iconFilled
                ? {
                    fontVariationSettings:
                      '"FILL" 1, "wght" 200, "GRAD" 0, "opsz" 24',
                  }
                : undefined
            }
          >
            {icon}
          </span>
        )}
        {/* Count badge — top-end corner. Clear sky blue (Tailwind
            blue-500) so it reads as an unmistakable "info" indicator.
            Brand `--tq-blue` is violet-leaning and was repeatedly
            flagged as not reading as blue at this badge size. */}
        {countBadge && countBadge > 0 ? (
          <span className="absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-semibold leading-none text-foreground shadow">
            {countBadge}
          </span>
        ) : null}
      </button>
      {/* Tooltip — appears to the right of the toolbar (toward content).
          `dir="auto"` so the FIRST
          strong directional character of the label drives reading
          direction. Without it the tooltip inherits the toolbar
          wrapper's outer dir="ltr" (chosen so the icon row layout
          centres correctly), and Arabic labels like "تصدير PPTX"
          render bidi-flipped — Arabic glyph order stays correct
          (Unicode BiDi handles it) but the inline "PPTX" lands on
          the wrong side of the Arabic word. With dir="auto" the
          tooltip reads RTL for Arabic labels and LTR for any pure-
          Latin label, no per-button decision needed. */}
      {/* §24: bordered dark-surface tooltip (matches the sidebar's). Slides in
          on hover — UP for the bottom bar (down→up), in-from-the-side for the
          left rail. Positioning + transform live in classes (not inline style)
          so `group-hover` can animate the slide. */}
      <div
        dir="auto"
        className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-lg border border-foreground/[0.12] bg-[var(--tq-surface)] px-3 py-1.5 text-xs text-foreground opacity-0 transition-all duration-200 group-hover:opacity-100 ${
          tooltipHorizontal
            ? // Bottom bar → pop ABOVE the button, centered, sliding up.
              "bottom-full left-1/2 mb-2.5 -translate-x-1/2 translate-y-1.5 group-hover:translate-y-0"
            : // Left rail → pop to the right (toward content), sliding in.
              "left-full top-1/2 ml-3 -translate-y-1/2 translate-x-1.5 group-hover:translate-x-0"
        }`}
      >
        {label}
        {badge ? <span className="badge-purple ms-2">{badge}</span> : null}
      </div>
    </div>
  );
}

// Hairline separator between toolbar categories. Narrow (w-6) so it
// doesn't extend into the parent pill's curved edges — full-bleed
// dividers would clip against the `rounded-full` container's curves.
// w-6 centred between the 36 px buttons reads as a clean category
// boundary without bleeding.
function ToolbarDivider({ horizontal = false }: { horizontal?: boolean }) {
  return (
    <div
      aria-hidden
      className={
        horizontal ? "mx-2 h-6 w-px bg-foreground/[0.12]" : "my-2 h-px w-6 bg-foreground/[0.12]"
      }
    />
  );
}

export function PreviewActionBar({
  projectId,
  role,
  studioMode,
  onSetStudioMode,
  commentMode,
  onToggleCommentMode,
  draftCommentCount,
  focusedSlideLocked,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onOpenHistory,
  onToggleLock,
  onRegenSlide,
  hasAiRegion,
  onAiSubmit,
  historyOpen,
  applying,
  currentVersionId,
  isSaved,
  onSaved,
  onBeforeSave,
  horizontal = false,
  disabled = false,
}: {
  projectId: string;
  // Phase 15.B — viewer's role on this project. Drives which toolbar
  // affordances are visible. "owner"/"edit" → full toolbar. "comment"
  // → comments + exports only (no regen/save/lock). "view" → exports
  // + share, no comments at all.
  role: "owner" | "edit" | "comment" | "view";
  // Studio mode (Edit ⇄ AI) — owned by DeckView; only owners/edit see the toggle.
  studioMode: StudioMode;
  onSetStudioMode: (m: StudioMode) => void;
  // Comment-mode state — owned by DeckView. Apply lives inside the
  // CommentsPanel footer and just exits commentMode (drafts persist
  // as drafts). When drafts exist + commentMode is off, the regen
  // button morphs to the AI icon and fires the partial regen.
  commentMode: boolean;
  onToggleCommentMode: () => void;
  // User (collaboration) comment count — badges the Edit-mode Comment
  // button. AI comments are ephemeral (§17 — created on send, cleared on
  // regen completion) so they no longer carry a persistent count badge.
  draftCommentCount: number;
  // True when the currently-focused slide is locked. Disables the
  // Comment button entry-point — a locked slide refuses new comment
  // markers (server enforces with 423, overlay suppresses click-to-
  // create), so the affordance shouldn't read as available. Letting
  // the user enter comment mode + see the "+" cursor only to have
  // clicks no-op is worse UX than greying the button on the locked
  // slide. Per-slide flag (not "every slide is locked") so navigating
  // off the locked slide flips the button back without leaving /
  // re-entering the deck.
  focusedSlideLocked: boolean;
  // Undo / redo over the focused slide's version log (same stack as ⌘Z / ⌘⇧Z).
  // `canUndo` / `canRedo` grey the buttons at the ends of history.
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  // True when there are unsent drafts ready to be fired. Drives the
  // autorenew → assistant icon morph + swaps the click handler
  // from full regen to partial regen.
  // Studio command-bar shared cluster (§16) — History + Lock relocated off
  // the deleted canvas pill; `onRegenSlide` is the AI-mode single-slide
  // regen (precursor to the composer's Generate). `historyOpen` drives the
  // History button's active styling while its popover is open.
  onOpenHistory?: (rect: DOMRect) => void;
  onToggleLock?: () => void;
  onRegenSlide?: () => void;
  // AI composer (§17) — the persistent bottom-bar instruction input. The user
  // scopes a region by dragging on the canvas (its on-canvas marker is the
  // only indicator now); submitting hands the typed instruction to `onAiSubmit`,
  // which creates the forAi comment + fires the partial regen. `hasAiRegion`
  // (a region is drawn) only flips the placeholder copy from "select a region"
  // to "write your edits".
  hasAiRegion?: boolean;
  onAiSubmit?: (text: string) => Promise<void> | void;
  historyOpen?: boolean;
  // Partial regen in flight. Locks the toolbar buttons so the user
  // can't kick off a second job while one is running.
  applying: boolean;
  // Save-Project state. `currentVersionId` gates the save button
  // (can't save while there's no version to pin). `isSaved` is the
  // precomputed display flag — DeckView owns the comparison
  // (version pointer + per-slide snapshot) so the button can react
  // to per-slide restores too. `onSaved` ferries the server's
  // response back to DeckView's local mirrors of both the pinned
  // version id and the per-slide snapshot.
  currentVersionId: string | null;
  isSaved: boolean;
  onSaved: (payload: {
    savedVersionId: string;
    savedSlideVersions: Record<string, number>;
  }) => void;
  // Flush pending edits to history checkpoints (SlideVersions) BEFORE pinning the
  // saved version, so the saved snapshot reflects the just-checkpointed numbers.
  onBeforeSave?: () => Promise<void>;
  // Studio bottom-bar mode — lay the cluster out as a horizontal row (pill +
  // dividers rotate) instead of the default vertical left-rail strip.
  horizontal?: boolean;
  // Generation phase (§unify): render the full bar but inert + dimmed — every
  // control is present (so the shell doesn't reflow on completion) and just
  // enables when the deck finishes. Applied as `pointer-events-none` + opacity
  // on the pill so we don't have to thread it through every button.
  disabled?: boolean;
}) {
  const router = useRouter();
  const dict = useDict();
  const { dir, locale } = useLocale();
  const [regen, setRegen] = useState<ButtonState>({ status: "idle" });
  // Export + Share moved to the StudioHeader (command-bar redesign §16) —
  // useExportActions + the ShareDialog live up there now, not in this bar.
  const [saveProject, setSaveProject] = useState<ButtonState>({ status: "idle" });
  // Edit⇄AI mode-content resize: the two mode contents are absolutely stacked
  // and cross-FADE (icons fade in place, never slide), while the slot's WIDTH
  // animates between the two contents' measured PIXEL widths via a CSS
  // transition (px↔px IS transitionable, unlike width:auto, and it doesn't
  // bump/glitch the way two-in-flow groups do). Measured pre-paint so there's
  // no flash; the transition is armed only after the first measure so the slot
  // doesn't grow-in on mount.
  const editSlotRef = useRef<HTMLDivElement>(null);
  const aiSlotRef = useRef<HTMLDivElement>(null);
  const [modeWidth, setModeWidth] = useState<number>();
  const [widthAnimatable, setWidthAnimatable] = useState(false);

  // AI composer (§17) — the bottom-bar instruction input. Local text state;
  // `aiSending` covers the brief POST window before `applying` (the optimistic
  // partial-regen flag) takes over, so the busy treatment never flickers off
  // between the two. `aiBusy` drives the "يُطبّق…" collapse.
  const [aiInput, setAiInput] = useState("");
  const [aiSending, setAiSending] = useState(false);
  // True only while the mode-content width is mid-spring. Drives `overflow-x:
  // clip` so the active content REVEALS (expands open) as the slot grows; at
  // rest we revert to `visible` so the count-badge + tooltips aren't clipped.
  const [widthAnimating, setWidthAnimating] = useState(false);
  const aiBusy = applying || aiSending;
  const handleAiSend = async () => {
    const text = aiInput.trim();
    if (!text || aiBusy || !onAiSubmit) return;
    setAiSending(true);
    try {
      await onAiSubmit(text);
      // Clear only on success; a thrown submit keeps the text so the user can
      // retry without re-typing. DeckView's optimistic `applying` keeps the
      // bar busy from here until the regen settles.
      setAiInput("");
    } catch (err) {
      console.error("AI submit failed", err);
    } finally {
      setAiSending(false);
    }
  };

  // Capability flags from role (Phase 15.B). Edit/owner sees all
  // mutation buttons. Comment sees only the Comment toggle (flat,
  // non-gradient because regen isn't available to them). View
  // sees neither — pure read-only toolbar = exports + share.
  const canEdit = role === "owner" || role === "edit";
  const canComment = canEdit || role === "comment";
  // Non-editors have no AI mode — they're effectively always in "edit".
  const effectiveMode: StudioMode = canEdit ? studioMode : "edit";
  // The AI slot shows a slide-regen button only when DeckView wires one.
  const showSlideRegen = canEdit && !!onRegenSlide;

  // Measure the active mode content (pre-paint) so the slot animates to its
  // pixel width. Re-measures when the mode or the AI button set changes.
  useIsoLayoutEffect(() => {
    const el = effectiveMode === "ai" ? aiSlotRef.current : editSlotRef.current;
    if (el) setModeWidth(el.offsetWidth);
  }, [effectiveMode, canEdit, canComment, showSlideRegen]);
  // Arm the width transition only AFTER the first measure (this runs post-paint,
  // after the layout-effect above set the initial width), so the slot doesn't
  // animate its initial width in from zero on mount. One-shot mount flag.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWidthAnimatable(true);
  }, []);

  // Legacy `saveTpl` state + `showSaveForm` popover + `templateTitle`
  // input were removed 2026-05-22. The canonical "Save as template"
  // flow lives in SaveAsTemplateDialog, opened from a project tile's
  // 3-dots menu. Templates are untitled, so there was never any
  // client-supplied title for that inline form to send.

  const handleRegenerate = async () => {
    if (regen.status === "running") return;
    setRegen({ status: "running", message: dict.editor.toasts.sendingRequest });
    try {
      const response = await fetch(`/api/projects/${projectId}/regenerate`, { method: "POST" });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Regenerate failed");
      }
      router.refresh();
      setRegen({ status: "idle" });
    } catch (error) {
      setRegen({
        status: "error",
        message: error instanceof Error ? error.message : dict.editor.toasts.regenFailed,
      });
    }
  };

  // Save Project — pins Presentation.savedVersionId to the version the
  // deck is currently rendering AND snapshots every slide's
  // currentVersionNumber, so a later restore can re-arm the button.
  // Idempotent on the server (re-saving an already-saved version is a
  // no-op). After success, DeckView's local savedVersionId +
  // savedSlideVersions are updated via `onSaved` so the button morphs
  // to its "saved" check without a router.refresh.
  //
  // First-save side effects (server-side): freezes Project.slideCount
  // and Project.dominantColor for the /projects filter columns. Step 8
  // also dispatches the thumbnail render job from this route.
  const handleSaveProject = async () => {
    if (saveProject.status === "running") return;
    if (!currentVersionId) {
      setSaveProject({ status: "error", message: dict.editor.toasts.noVersionToSave });
      return;
    }
    setSaveProject({ status: "running", message: dict.editor.toasts.savingProject });
    try {
      // Snapshot pending edits as history checkpoints first, so the pinned
      // saved version captures the new per-slide version numbers.
      await onBeforeSave?.();
      const response = await fetch(`/api/projects/${projectId}/save`, {
        method: "POST",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? "Save failed");
      }
      const data = (await response.json()) as {
        ok: true;
        savedVersionId: string;
        savedSlideVersions: Record<string, number>;
      };
      onSaved({
        savedVersionId: data.savedVersionId,
        savedSlideVersions: data.savedSlideVersions,
      });
      setSaveProject({ status: "success", message: dict.editor.toasts.projectSaved });
    } catch (error) {
      setSaveProject({
        status: "error",
        message: error instanceof Error ? error.message : dict.editor.toasts.saveFailed,
      });
    }
  };

  // Export pipelines + their busy/error states are owned by the
  // shared `useExportActions` hook (handlers + states aliased above
  // when the hook was instantiated). The dom-to-pptx + BiDi post-
  // processor wiring, the Puppeteer fetch calls, and the HTML bundle
  // download all live in lib/preview/use-export-actions.ts now.

  // `handleSaveAsTemplate` was removed 2026-05-22 alongside the
  // inline UI — see the saveProject useState comment above.

  // Status toast under the toolbar. Export download progress + success
  // are intentionally NOT surfaced — the browser's own download UI is
  // enough signal that an export is in flight, and exports settle back
  // to "idle" once the file is dispatched. Only ERRORS (for any action)
  // and the regen / save-template running + success states make it through.
  // Save Project never surfaces running / success in the toast — the
  // button's spinner + save→check icon morph is enough signal on its
  // own; the extra toast read as noise. Errors still bubble up so the
  // user sees auth / 4xx failures.
  let visibleMessage: { text?: string; kind: "error" | "info" } | null = null;
  if (regen.status === "error") {
    visibleMessage = { text: regen.message, kind: "error" };
  } else if (saveProject.status === "error") {
    visibleMessage = { text: saveProject.message, kind: "error" };
  } else if (regen.status === "running") {
    visibleMessage = { text: regen.message, kind: "info" };
  }

  return (
    <ToolbarHorizontalContext.Provider value={horizontal}>
    <div
      dir="ltr"
      // Stable selector for DeckView's click-outside handler to
      // recognise the toolbar — class-based selectors broke when the
      // toolbar's flex direction changed (flex-col → flex-row-reverse
      // in 2026-05-23). data-* lives outside CSS layout concerns so
      // future re-layouts won't accidentally trip the click handler
      // into killing comment mode on toolbar clicks.
      data-preview-toolbar="true"
      aria-disabled={disabled || undefined}
      // Generation phase: the whole bar is present but inert + dimmed; it lights
      // up the moment the deck completes (no reflow).
      className={`flex items-center gap-3 transition-opacity duration-300 ${
        horizontal ? "flex-row" : "flex-col"
      } ${disabled ? "pointer-events-none opacity-50" : ""}`}
    >
      {/* Toolbar column — Photoshop-style icon stack, grouped into
          three visual categories by horizontal dividers. Categories
          (top → bottom):
            1. EDIT / AI       — regen, comments
            2. PERSISTENCE     — save project, save as template
            3. EXPORT          — PPTX, HTML, PNG, PDF
          The dividers are 1 px lines at white/8 alpha — same colour
          token the rest of the glass surfaces use for hairline
          separators. Match the visual recipe in SlideNavSidebar's
          header / footer borders so the toolbar reads as part of
          the same chrome family. */}
      <div
        // Pill shape — `rounded-full` on a flex row of square (36 × 36) circle
        // children → a stadium silhouette. The pill is auto-width, so it follows
        // the mode content's animated width (below) and resizes smoothly without
        // any layout-projection (framer `layout` doesn't animate reliably here).
        // dir=rtl so the Edit⇄AI toggle leads on the RIGHT (RTL leading edge)
        // and the rest of the cluster flows leftward from it.
        dir={dir}
        className={`surface-card flex items-center gap-1 rounded-full p-1.5 ${
          horizontal ? "flex-row" : "flex-col"
        }`}
      >
        {/* Edit ⇄ AI mode toggle — owners/edit only (others have no AI mode). */}
        {canEdit ? (
          <div className="flex items-center gap-1">
            <SegmentedToggle
              options={[
                { value: "edit", label: dict.editor.toolbar.edit, icon: "edit" },
                { value: "ai", label: dict.editor.toolbar.ai, icon: "auto_awesome" },
              ]}
              value={studioMode}
              onChange={onSetStudioMode}
              ariaLabel={dict.editor.toolbar.editorMode}
              size="comfortable"
            />
            <ToolbarDivider horizontal={horizontal} />
          </div>
        ) : null}
        {/* Mode content — Edit (Comment) ↔ AI (composer). The two contents are
            absolutely STACKED and right-anchored; the slot's WIDTH springs
            between their measured pixel widths (spring 500/35, the design-
            system motion). `overflow-x: clip` makes the active content REVEAL
            as the slot widens — it expands open from the leading (right) edge
            rather than fading in. `overflow-y: visible` lets the count-badge +
            hover tooltips still escape upward. The INCOMING content snaps to
            opacity 1 (revealed by the clip, not a fade); the OUTGOING one fades
            out fast so the two never overlap mid-reveal. */}
        {canComment ? (
          <motion.div
            className="relative h-9 shrink-0"
            animate={{ width: modeWidth }}
            transition={
              widthAnimatable
                ? { type: "spring", stiffness: 500, damping: 35 }
                : { duration: 0 }
            }
            onAnimationStart={() => setWidthAnimating(true)}
            onAnimationComplete={() => setWidthAnimating(false)}
            // Clip ONLY while springing (the reveal); visible at rest so the
            // edit button's count-badge + the regen-button tooltips show.
            style={{
              overflowX: widthAnimating ? "clip" : "visible",
              overflowY: "visible",
            }}
          >
            {/* AI — composer + regen. Owners/edit only. */}
            {canEdit ? (
              <motion.div
                ref={aiSlotRef}
                aria-hidden={effectiveMode !== "ai"}
                animate={{ opacity: effectiveMode === "ai" ? 1 : 0 }}
                // Incoming: snap opaque (duration 0) so the width-clip reveal
                // does the work — it expands open, never fades. Outgoing: a
                // quick fade so it clears before the incoming content reveals
                // over the same right-anchored spot.
                transition={{ duration: effectiveMode === "ai" ? 0 : 0.12 }}
                className="absolute inset-y-0 right-0 flex items-center gap-1"
                style={{
                  pointerEvents: effectiveMode === "ai" ? "auto" : "none",
                }}
              >
                {/* AI composer (§17) — scope chip · sparkle · instruction input
                    · send. The region is scoped by dragging on the canvas (→
                    `pendingAiBounds`); the instruction is typed here. The mesh
                    gradient lives ONLY on this AI hero (the sparkle + the send
                    button), per the frontend consult. */}
                <div className="surface-popover flex h-9 items-center gap-1.5 rounded-full px-1.5">
                  {aiBusy ? (
                    // Submitting — collapse to a compact running label, the mesh
                    // ring spinning, until the regen settles (§17 states).
                    <div className="flex items-center gap-2 px-2 text-xs text-foreground/80">
                      <span className="btn-gradient-anim flex h-5 w-5 items-center justify-center rounded-full">
                        <span className="spinner h-3 w-3 rounded-full border-2 border-foreground/30 border-t-white" />
                      </span>
                      {dict.editor.toolbar.applying}
                    </div>
                  ) : (
                    <>
                      {/* Instruction input — single line; Enter submits. No scope
                          chip / sparkle: the drawn region's on-canvas marker is
                          enough signal, so the composer stays a clean input +
                          send (user direction — don't over-explain). */}
                      <input
                        type="text"
                        dir="auto"
                        value={aiInput}
                        onChange={(e) => setAiInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleAiSend();
                          }
                        }}
                        placeholder={
                          hasAiRegion
                            ? dict.editor.toolbar.aiPlaceholderRegion
                            : dict.editor.toolbar.aiPlaceholderNoRegion
                        }
                        disabled={focusedSlideLocked}
                        className="w-[250px] bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-foreground/35 disabled:opacity-50"
                      />
                      {/* Send (توليد) — the one mesh button; needs an instruction. */}
                      <button
                        type="button"
                        onClick={() => void handleAiSend()}
                        disabled={!aiInput.trim() || focusedSlideLocked}
                        aria-label={dict.editor.toolbar.generate}
                        className="btn-gradient-anim flex h-7 w-7 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
                      >
                        <span className="material-symbols-outlined text-[16px] leading-none">
                          arrow_upward
                        </span>
                      </button>
                    </>
                  )}
                </div>
                {/* Regenerate THIS slide — clean, no-instruction redesign. */}
                {onRegenSlide ? (
                  <ToolButton
                    icon="auto_fix_high"
                    label={dict.editor.toolbar.redesignSlide}
                    onClick={onRegenSlide}
                    disabled={applying || focusedSlideLocked}
                  />
                ) : null}
                {/* Regen the whole deck. Applying AI comments is NOT here
                    anymore — it lives on the obvious in-canvas button in the
                    comment overlay (user direction). This button always means
                    "redesign the whole deck". */}
                <ToolButton
                  icon="autorenew"
                  label={dict.editor.toolbar.redesignAll}
                  running={regen.status === "running"}
                  onClick={handleRegenerate}
                  disabled={applying || commentMode}
                />
              </motion.div>
            ) : null}
            {/* Edit — user comments. Plain comment glyph for ALL roles now; the
                AI-flavored `assistant` glyph (comment + sparkle) moved onto the
                AI-mode "apply comments" regen button. */}
            <motion.div
              ref={editSlotRef}
              aria-hidden={effectiveMode !== "edit"}
              animate={{ opacity: effectiveMode === "edit" ? 1 : 0 }}
              // Incoming snaps opaque (revealed by the width-clip), outgoing
              // fades fast — see the AI group above.
              transition={{ duration: effectiveMode === "edit" ? 0 : 0.12 }}
              className="absolute inset-y-0 right-0 flex items-center gap-1"
              style={{
                pointerEvents: effectiveMode === "edit" ? "auto" : "none",
              }}
            >
              {/* Undo / redo — edit-mode only (they do nothing in AI mode), so
                  they live in this edit slot beside the comment button rather
                  than the always-visible shared cluster. Forced `dir=ltr` so the
                  pair always reads back-on-the-left, forward-on-the-right in BOTH
                  languages (nav controls, not locale-mirrored). */}
              {onUndo || onRedo ? (
                <div dir="ltr" className="flex items-center gap-1">
                  {onUndo ? (
                    <ToolButton
                      icon="undo"
                      label={dict.editor.toolbar.undo}
                      onClick={onUndo}
                      disabled={applying || !canUndo}
                    />
                  ) : null}
                  {onRedo ? (
                    <ToolButton
                      icon="redo"
                      label={dict.editor.toolbar.redo}
                      onClick={onRedo}
                      disabled={applying || !canRedo}
                    />
                  ) : null}
                </div>
              ) : null}
              <ToolButton
                icon="chat_bubble_outline"
                label={
                  focusedSlideLocked && !commentMode
                    ? dict.editor.toolbar.slideLockedComment
                    : commentMode
                      ? dict.editor.toolbar.exitComments
                      : dict.editor.toolbar.addComment
                }
                iconFilled={commentMode}
                onClick={onToggleCommentMode}
                active={commentMode}
                // Locked focused slide → muted + no-op, UNLESS commentMode is
                // already on (so the user can still toggle out of it).
                disabled={applying || (focusedSlideLocked && !commentMode)}
                countBadge={draftCommentCount}
              />
            </motion.div>
          </motion.div>
        ) : null}

        {/* Shared cluster (§16) — divider + History + Lock + Save, visible in
            both modes. owners/edit only (History needs onOpenHistory, Lock
            onToggleLock). Reflows via flex as the mode content width animates. */}
        {canEdit ? (
          <div className="flex items-center gap-1">
            <ToolbarDivider horizontal={horizontal} />
            {onOpenHistory ? (
              <ToolButton
                icon="history"
                label={dict.editor.toolbar.versionHistory}
                active={historyOpen}
                onClick={(e) =>
                  onOpenHistory(e.currentTarget.getBoundingClientRect())
                }
                buttonProps={{ "data-history-trigger": "true" }}
              />
            ) : null}
            {onToggleLock ? (
              <ToolButton
                icon={focusedSlideLocked ? "lock" : "lock_open"}
                label={
                  focusedSlideLocked ? dict.editor.toolbar.unlockSlide : dict.editor.toolbar.lockSlide
                }
                active={focusedSlideLocked}
                iconFilled={focusedSlideLocked}
                onClick={onToggleLock}
              />
            ) : null}
            {/* Save Project. */}
            <ToolButton
              icon={isSaved ? "check" : "save"}
              label={isSaved ? dict.editor.toolbar.saved : dict.editor.toolbar.saveProject}
              running={saveProject.status === "running"}
              onClick={handleSaveProject}
              active={isSaved}
              disabled={applying || commentMode || !currentVersionId}
              iconNode={
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={isSaved ? "saved" : "unsaved"}
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.6 }}
                    transition={{ duration: 0.25 }}
                    className="material-symbols-outlined text-[18px]"
                  >
                    {isSaved ? "check" : "save"}
                  </motion.span>
                </AnimatePresence>
              }
            />
          </div>
        ) : null}
        {/* Export + Share live in the slide-nav footer (§22). */}

        {/* Home / back to dashboard (§22) — the editor has no app sidebar, so
            this is the way out. Visible to ALL roles. The leading divider only
            shows when there's a cluster before it (owner/edit/comment). No
            inner `gap-1` here: the divider's own `mx-2` already spaces it from
            the home button. `pe-1` nudges the button off the pill's rounded
            inline-end cap — the curved edge optically pulls the button toward
            it, so a hair of extra inline-end clearance makes it read centered
            between the divider and the pill edge (logical, so it mirrors in RTL). */}
        <div className="flex items-center pe-1">
          {canEdit || canComment ? (
            <ToolbarDivider horizontal={horizontal} />
          ) : null}
          <ToolButton
            icon="home"
            label={dict.editor.toolbar.backToDashboard}
            onClick={() => router.push(localizedHref("/dashboard", locale))}
          />
        </div>
      </div>

      {/* Status toast below the toolbar — error (red) or info (muted).
          The `success` variant was only set by the legacy save-template
          flow that was removed 2026-05-22; dropped here too. */}
      {visibleMessage?.text ? (
        <div
          className={`rounded-lg px-3 py-1.5 text-xs ${
            visibleMessage.kind === "error"
              ? "bg-red-500/10 text-red-300"
              : "bg-foreground/5 text-muted"
          }`}
        >
          {visibleMessage.text}
        </div>
      ) : null}

    </div>
    </ToolbarHorizontalContext.Provider>
  );
}
