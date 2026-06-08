"use client";

// Hero comment overlay — drag-box + pins + editor popover that sit
// on top of the hero canvas while commentMode is active.
//
// Coordinates: bounds live in slide-space (0..canvasW × 0..canvasH)
// regardless of slide format. The `scale` prop converts slide-space
// to overlay-pixel-space (which matches the hero's rendered size).

import { useCallback, useEffect, useRef, useState } from "react";
import type { CommentRow, CommentBounds } from "@/lib/types/comment";
import { Avatar } from "@/components/common/Avatar";
import { formatRelativeArabic } from "@/lib/util/relative-time";

// Minimum drag size in slide-space pixels. Smaller drags are treated
// as misfired clicks and discarded — keeps stray mousedowns from
// opening empty editors.
const MIN_DRAG_SIZE = 40;

type EditorState =
  | { kind: "new"; bounds: CommentBounds; content: string }
  | { kind: "existing"; commentId: string; bounds: CommentBounds; content: string }
  | null;

type DragState = {
  startSlide: { x: number; y: number };
  currentSlide: { x: number; y: number };
} | null;

export function HeroCommentOverlay({
  slideId,
  comments,
  scale,
  canvasW,
  canvasH,
  direction,
  onCreate,
  onUpdate,
  onDelete,
  canModerate,
  currentUserId,
  commentMode,
  onRequestCommentMode,
  forAi = false,
  pendingAiBounds = null,
  onAiBoundsChange,
}: {
  slideId: string;
  // ALL drafts — filtered to this slide internally so the caller
  // doesn't recompute on every keystroke.
  comments: CommentRow[];
  // When true: full drag-to-create + click-pin-to-edit + editor
  // popover. When false: pins still render (read-only, so viewers
  // who aren't in comment mode can SEE that comments exist on this
  // slide — important once Phase 16.C wired live broadcasts), but
  // the overlay doesn't intercept mouse events and pins are visual-
  // only. The component is always mounted regardless; this prop is
  // the interaction gate. Optional + defaults true for existing
  // callers that always wrapped the overlay in `{commentMode ? ...}`.
  // Hero pixels per slide-space pixel (heroWidth / canvasW). Same
  // value SlideRenderer takes.
  scale: number;
  canvasW: number;
  canvasH: number;
  direction: "rtl" | "ltr";
  onCreate: (input: { slideId: string; bounds: CommentBounds; content: string }) => Promise<void>;
  onUpdate: (input: { commentId: string; content?: string; bounds?: CommentBounds }) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
  // True when the viewer is owner / edit — they can delete any
  // comment (moderation). False for comment-only viewers, who can
  // only delete comments they authored. Phase 15.D.
  canModerate: boolean;
  // Current viewer's prisma User row id, used to compare against
  // each comment's authorId for the per-row delete affordance.
  // Null for anonymous public-view (they don't reach commentMode
  // anyway, but the type allows the prop to be omitted upstream).
  currentUserId: string | null;
  commentMode?: boolean;
  // Fires when the user clicks "Edit" inside the read-only marker
  // preview popup. Parent (DeckView) flips its `commentMode` state
  // to true; this component's `editor` state is already set to the
  // chosen comment so the editor popover opens automatically once
  // `commentMode` propagates back as `isInteractive`. Optional —
  // omitting it disables the Edit affordance in the popup.
  onRequestCommentMode?: () => void;
  // True when the active studio mode is AI (§17). In AI mode there is NO inline
  // composer: a finished drag reports its region up via `onAiBoundsChange`, the
  // instruction is typed in the bottom-bar AI input, and the drawn region shows
  // a corner-sparkle marker (not the old `.ai-comment-box`). Drag-to-draw is
  // always armed in AI mode (the `commentMode` gate only governs Edit-mode user
  // comments).
  forAi?: boolean;
  // The committed AI region (DeckView-owned). Rendered as a corner-sparkle
  // marker while in AI mode; cleared via the bottom-bar scope chip's ✕ or on
  // send. `null` = whole-slide (no region drawn).
  pendingAiBounds?: CommentBounds | null;
  // Reports a freshly-drawn AI region up to DeckView. `null` when a drag was
  // too small (a misfired click) so it doubles as "clear the region".
  onAiBoundsChange?: (bounds: CommentBounds | null) => void;
}) {
  // Defaults true so the historical callers that gated the whole
  // mount on `{commentMode ? <HeroCommentOverlay /> : null}` keep
  // working without passing the prop.
  const isInteractive = commentMode !== false;
  const [drag, setDrag] = useState<DragState>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  // Read-only preview popup state. Tracks the comment id being
  // previewed AND the click coordinates (overlay-space pixels) so
  // the popup anchors at the cursor instead of the marker bounds
  // — user wanted "the corner of the mouse click, not far away".
  // Mutually exclusive with `editor` — opening the editor (Edit
  // button) clears this; opening this clears `editor`.
  const [previewState, setPreviewState] = useState<{
    commentId: string;
    x: number;
    y: number;
  } | null>(null);
  const previewCommentId = previewState?.commentId ?? null;
  // Editor in-flight states — the check / trash icons morph to
  // spinners while their requests are pending. Same pattern the
  // marker preview popup's delete uses, lifted up to the parent so
  // BOTH the new-comment POST and the existing-comment
  // PATCH/DELETE paths share the same gate.
  const [savingEditor, setSavingEditor] = useState(false);
  const [deletingEditor, setDeletingEditor] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const slideComments = comments.filter((c) => c.slideId === slideId);

  // Reset transient state when the focused slide changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrag(null);
    setEditor(null);
    setEditorError(null);
    setPreviewState(null);
    setSavingEditor(false);
    setDeletingEditor(false);
  }, [slideId]);

  // When the viewer flips INTO comment mode (e.g. via clicking Edit
  // in the preview popup), close the read-only preview — its job is
  // done and the editor popover takes over.
  useEffect(() => {
    if (isInteractive && previewCommentId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreviewState(null);
    }
  }, [isInteractive, previewCommentId]);

  // Viewport coords → slide-space coords via the overlay's bounding
  // rect + the current scale. Clamped to canvas so persisted values
  // stay inside [0, canvasW] × [0, canvasH].
  const toSlideCoords = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const el = overlayRef.current;
      if (!el || scale <= 0) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      const x = (clientX - rect.left) / scale;
      const y = (clientY - rect.top) / scale;
      return {
        x: Math.max(0, Math.min(canvasW, x)),
        y: Math.max(0, Math.min(canvasH, y)),
      };
    },
    [scale, canvasW, canvasH],
  );

  // mousedown on empty overlay → start drag. The overlay layer has
  // `pointer-events: auto` only on this catcher div; pins enable
  // their own pointer events so they intercept clicks before drag
  // starts.
  const handleStartDrag = (e: React.MouseEvent) => {
    if (editor !== null) return; // Don't restart while editing.
    e.preventDefault();
    const p = toSlideCoords(e.clientX, e.clientY);
    setDrag({ startSlide: p, currentSlide: p });
  };

  // Drag-active: listen on window so the user can release outside
  // the overlay and the box still finalises.
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      setDrag((prev) =>
        prev ? { ...prev, currentSlide: toSlideCoords(e.clientX, e.clientY) } : prev,
      );
    };
    const onUp = () => {
      // Read the drag from the effect closure — this effect re-runs on every
      // `drag` change (it's in the deps), so `drag` here is always the latest
      // currentSlide. Side effects run OUTSIDE any state updater: `setEditor`
      // would be tolerated (same component) but `onAiBoundsChange` updates
      // DeckView, and firing a parent setState from inside our setDrag updater
      // is a setState-during-render violation. Compute → act → clear.
      if (!drag) return;
      const x = Math.min(drag.startSlide.x, drag.currentSlide.x);
      const y = Math.min(drag.startSlide.y, drag.currentSlide.y);
      const w = Math.abs(drag.currentSlide.x - drag.startSlide.x);
      const h = Math.abs(drag.currentSlide.y - drag.startSlide.y);
      const tooSmall = w < MIN_DRAG_SIZE || h < MIN_DRAG_SIZE;
      const bounds = {
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        h: Math.round(h),
      };
      // AI mode (§17): a finished drag scopes the region for the bottom-bar
      // composer — report it up; a too-small drag clears the region (so a bare
      // click on empty canvas resets to whole-slide). NO inline editor.
      if (forAi) {
        onAiBoundsChange?.(tooSmall ? null : bounds);
      } else if (!tooSmall) {
        setEditor({ kind: "new", bounds, content: "" });
      }
      setDrag(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, toSlideCoords, forAi, onAiBoundsChange]);

  // Pin click → open editor on an existing comment.
  const handlePinClick = (comment: CommentRow) => {
    if (!comment.boundsJson) return;
    setEditor({
      kind: "existing",
      commentId: comment.id,
      bounds: comment.boundsJson,
      content: comment.content,
    });
  };

  const handleSave = async () => {
    if (!editor) return;
    if (savingEditor) return; // Re-entry guard against a fast double-click.
    const trimmed = editor.content.trim();
    if (!trimmed) return;
    setEditorError(null);
    setSavingEditor(true);
    try {
      if (editor.kind === "new") {
        await onCreate({ slideId, bounds: editor.bounds, content: trimmed });
      } else {
        await onUpdate({
          commentId: editor.commentId,
          content: trimmed,
          bounds: editor.bounds,
        });
      }
      setEditor(null);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "تعذر حفظ التعليق.");
    } finally {
      // `finally` not `else` — on success the editor closes (above)
      // but we still want the in-flight flag reset for the next
      // open. React's reconciler is fine clearing state on an
      // already-null `editor`.
      setSavingEditor(false);
    }
  };

  const handleDelete = async () => {
    if (!editor || editor.kind !== "existing") return;
    if (deletingEditor) return;
    setEditorError(null);
    setDeletingEditor(true);
    try {
      await onDelete(editor.commentId);
      setEditor(null);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "تعذر حذف التعليق.");
    } finally {
      setDeletingEditor(false);
    }
  };

  // Esc closes the editor (or clears the live drag, or closes the
  // read-only marker preview popup) — does NOT exit commentMode.
  // That's owned by DeckView's own Esc handler, which skips if our
  // editor / preview / drag is active (Esc cascades).
  useEffect(() => {
    if (!editor && !drag && !previewCommentId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (editor) {
        setEditor(null);
        setEditorError(null);
      } else if (previewCommentId) {
        setPreviewState(null);
      } else if (drag) {
        setDrag(null);
      }
    };
    // Capture so we beat DeckView's keydown listener.
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [editor, drag, previewCommentId]);

  // Live drag rect in slide-space — feeds both the dashed preview
  // and (after mouseup) the editor anchor.
  const liveBounds: CommentBounds | null = drag
    ? {
        x: Math.min(drag.startSlide.x, drag.currentSlide.x),
        y: Math.min(drag.startSlide.y, drag.currentSlide.y),
        w: Math.abs(drag.currentSlide.x - drag.startSlide.x),
        h: Math.abs(drag.currentSlide.y - drag.startSlide.y),
      }
    : null;

  return (
    <div
      ref={overlayRef}
      // `dir="ltr"` forces left/top positioning to be visual-left /
      // visual-top regardless of slide direction — bounds are stored
      // in slide-space with x=0 at the visual left edge in BOTH RTL
      // and LTR slides (the slide content itself flips, not the
      // bounds coordinate origin).
      dir="ltr"
      // Read-only mode (`!isInteractive`): wrapper has no pointer
      // events so it doesn't swallow clicks meant for the canvas
      // below, AND there's no drag handler. Pins below opt back in
      // via their own pointer-events when interactive.
      className={`absolute inset-0 overflow-hidden ${isInteractive ? "" : "pointer-events-none"}`}
      // High enough to sit above the SlideRenderer (z-auto) but BELOW
      // the canvas-gradient-border's ::after (z:2).
      style={{ zIndex: 1 }}
      onMouseDown={isInteractive ? handleStartDrag : undefined}
    >
      {/* Existing pins. Hidden when their comment is being edited so
          the editor's solid anchor box doesn't double up on a pin.
          In read-only mode (`!isInteractive`) pins render as plain
          divs (no click handler, no hover state) so they're purely
          visual indicators — important for viewers NOT in comment
          mode who need to SEE that someone else commented but
          shouldn't be able to open the editor on someone else's
          markers. */}
      {slideComments.map((c) => {
        if (!c.boundsJson) return null;
        if (editor?.kind === "existing" && editor.commentId === c.id) return null;
        const b = c.boundsJson;
        const style: React.CSSProperties = {
          left: b.x * scale,
          top: b.y * scale,
          width: b.w * scale,
          height: b.h * scale,
        };
        // AI instruction region (§17): a read-only corner-sparkle marker.
        // No editor / preview / apply affordance — the instruction lives in
        // the bottom-bar composer and this is just the scoped box. Same
        // treatment as the freshly-drawn pending region rendered below.
        if (c.forAi) {
          return <AiRegionMarker key={c.id} style={style} />;
        }
        if (!isInteractive) {
          // Read-only marker — clickable to open the preview popup
          // (avatar / name / time / content / edit+delete). The
          // parent overlay is `pointer-events-none` in this mode so
          // the slide content underneath stays interactive; the pin
          // opts back in to catch its own clicks. Hidden when the
          // popup is open ON this comment to avoid double-drawing
          // the rectangle behind the popup's anchor.
          if (previewCommentId === c.id) return null;
          return (
            <button
              type="button"
              key={c.id}
              onClick={(e) => {
                e.stopPropagation();
                // Capture click coords in overlay-pixel-space so the
                // popup anchors at the cursor (user wanted "the
                // corner of the mouse click", not the marker bounds
                // — the previous bounds-anchored math placed the
                // popup arbitrarily far from where the user clicked).
                const rect = overlayRef.current?.getBoundingClientRect();
                const localX = rect ? e.clientX - rect.left : 0;
                const localY = rect ? e.clientY - rect.top : 0;
                setPreviewState({ commentId: c.id, x: localX, y: localY });
              }}
              aria-label="عرض التعليق"
              className="pointer-events-auto absolute rounded-md border border-orange-400/80 bg-orange-400/15 transition-colors hover:bg-orange-400/30"
              style={style}
            />
          );
        }
        return (
          <button
            type="button"
            key={c.id}
            onClick={(e) => {
              e.stopPropagation();
              handlePinClick(c);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="تعديل التعليق"
            className="absolute rounded-md border border-orange-400/80 bg-orange-400/15 transition-colors hover:bg-orange-400/30"
            style={style}
          />
        );
      })}

      {/* Committed AI region (§17) — the drawn-but-not-yet-sent box that the
          bottom-bar composer will scope its instruction to. Dims everything
          outside it (spotlight). Rendered only in AI mode; cleared via the
          scope chip's ✕ or on send. Hidden WHILE dragging (the live rect below
          owns the dim then) so the two spotlights never stack. */}
      {forAi && pendingAiBounds && !drag ? (
        <AiRegionMarker
          dim
          style={{
            left: pendingAiBounds.x * scale,
            top: pendingAiBounds.y * scale,
            width: pendingAiBounds.w * scale,
            height: pendingAiBounds.h * scale,
          }}
        />
      ) : null}

      {/* Live drag rect — dashed while the user is dragging. In AI mode it
          carries the corner sparkle so the region reads as "AI scope" the
          moment it starts growing (§17 drawing state). Skipped entirely in
          read-only mode (no drag state can exist there anyway, but explicit
          guard reads cleaner). */}
      {isInteractive && liveBounds ? (
        forAi ? (
          <AiRegionMarker
            dashed
            dim
            style={{
              left: liveBounds.x * scale,
              top: liveBounds.y * scale,
              width: liveBounds.w * scale,
              height: liveBounds.h * scale,
            }}
          />
        ) : (
          <div
            className="pointer-events-none absolute rounded-md border border-dashed border-orange-400 bg-orange-400/10"
            style={{
              left: liveBounds.x * scale,
              top: liveBounds.y * scale,
              width: liveBounds.w * scale,
              height: liveBounds.h * scale,
            }}
          />
        )
      ) : null}

      {/* Editor anchor rect — solid box around the active editor. Edit-mode
          (user comments) only now: AI mode never opens the editor (§17), so
          this is always the orange user-comment box. */}
      {isInteractive && editor ? (
        <div
          className="pointer-events-none absolute rounded-md border border-orange-400 bg-orange-400/15"
          style={{
            left: editor.bounds.x * scale,
            top: editor.bounds.y * scale,
            width: editor.bounds.w * scale,
            height: editor.bounds.h * scale,
          }}
        />
      ) : null}

      {/* Editor popover — anchored to the bounds.
          Per-comment delete affordance is gated by authorship:
            • owner / edit (canModerate) → see delete on any comment
            • comment-only → see delete ONLY on their own comments
          New-comment editor (kind === "new") has no delete button by
          construction (nothing to delete yet). The server route also
          enforces the same rule as defense-in-depth. */}
      {editor ? (() => {
        const isExisting = editor.kind === "existing";
        const isAuthor =
          isExisting &&
          currentUserId !== null &&
          comments.find((c) => c.id === editor.commentId)?.authorId ===
            currentUserId;
        const canDeleteThis = isExisting && (canModerate || isAuthor);
        return (
          <CommentEditor
            editor={editor}
            scale={scale}
            canvasW={canvasW}
            canvasH={canvasH}
            direction={direction}
            error={editorError}
            onContentChange={(content) => {
              if (editorError) setEditorError(null);
              setEditor((prev) => (prev ? { ...prev, content } : prev));
            }}
            onSave={handleSave}
            onCancel={() => {
              setEditor(null);
              setEditorError(null);
            }}
            onDelete={canDeleteThis ? handleDelete : undefined}
            saving={savingEditor}
            deleting={deletingEditor}
          />
        );
      })() : null}

      {/* Read-only marker preview popup. Opens when a non-commenting
          viewer clicks a marker pin. Contents mirror the new
          CommentsPanel row layout (avatar visual-right, name+time
          stacked visual-left, content below) so both surfaces read
          identically. Edit button flips DeckView into commentMode +
          pre-opens this same comment in the editor; Delete fires
          the existing onDelete handler. Both buttons gated by the
          standard author-or-moderator rules. */}
      {!isInteractive && previewState
        ? (() => {
            const comment = slideComments.find((c) => c.id === previewState.commentId);
            if (!comment || !comment.boundsJson) return null;
            const isAuthor =
              currentUserId !== null && comment.authorId === currentUserId;
            const canEditThis = isAuthor;
            const canDeleteThis = canModerate || isAuthor;
            return (
              <MarkerPreviewPopup
                comment={comment}
                anchorX={previewState.x}
                anchorY={previewState.y}
                canvasW={canvasW}
                canvasH={canvasH}
                scale={scale}
                canEdit={canEditThis && !!onRequestCommentMode}
                canDelete={canDeleteThis}
                onClose={() => setPreviewState(null)}
                onEdit={() => {
                  if (!onRequestCommentMode || !comment.boundsJson) return;
                  // Open the editor state on this comment BEFORE
                  // flipping commentMode. Once `isInteractive` flips
                  // to true on the next render, the existing
                  // `{isInteractive && editor ? <CommentEditor … /> :
                  // null}` branch renders the editor automatically.
                  setEditor({
                    kind: "existing",
                    commentId: comment.id,
                    bounds: comment.boundsJson,
                    content: comment.content,
                  });
                  setPreviewState(null);
                  onRequestCommentMode();
                }}
                onDelete={async () => {
                  try {
                    await onDelete(comment.id);
                    setPreviewState(null);
                  } catch (err) {
                    // Keep the popup open on failure so the user can
                    // retry — same error UX the in-mode editor uses.
                    // RE-THROW so MarkerPreviewPopup.handleDeleteClick's
                    // catch fires and resets its `isDeleting` flag —
                    // otherwise the delete button stays permanently
                    // disabled (CR PR #33, 2026-05-24).
                    throw err;
                  }
                }}
              />
            );
          })()
        : null}
    </div>
  );
}

// AI region marker (§17) — the scoped box for a bottom-bar AI instruction.
// A clean light frame + a glass `auto_awesome` sparkle chip pinned to the
// top-trailing corner (the overlay is `dir="ltr"`, so `-top/-right` = visual
// top-right). `dim` paints a spotlight: a massive spread box-shadow darkens
// everything OUTSIDE the box — clipped to the overlay's `overflow-hidden`,
// i.e. the canvas — leaving the selected region clear (the crop-tool look).
// Uses `var(--tq-bg-dim)` (the same scrim the regen overlay uses) so the dim
// reads consistently on any slide background. `dashed` marks the live drag.
// Purely visual: `pointer-events-none` so it never blocks a re-draw.
function AiRegionMarker({
  style,
  dashed,
  dim,
}: {
  style: React.CSSProperties;
  dashed?: boolean;
  dim?: boolean;
}) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute rounded-[6px] border-[1.5px] ${
        dashed ? "border-dashed" : ""
      }`}
      style={{
        ...style,
        borderColor: "var(--tq-violet)",
        boxShadow: dim ? "0 0 0 9999px var(--tq-bg-dim)" : undefined,
      }}
    >
      <span className="ai-marker-chip absolute -right-3 -top-3 flex h-6 w-6 items-center justify-center rounded-full shadow-lg">
        {/* Size owned by `.ai-marker-chip .material-symbols-outlined` in
            globals.css — a Tailwind text-[…] utility loses to the font's own
            24px rule. */}
        <span className="material-symbols-outlined leading-none text-white">
          magic_button
        </span>
      </span>
    </div>
  );
}

// Glass icon button — same neutral surface language as the toolbar.
// `loading` swaps the icon for a spinner AND disables the click —
// universal pattern for "anything that writes to the database shows
// a loading wheel" (user direction 2026-05-23). Disabling-during-
// loading also guards against a fast double-click queuing a
// duplicate request.
function GlassIconButton({
  icon,
  label,
  active,
  disabled,
  loading,
  onClick,
}: {
  icon: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  const baseBg = active
    ? "rgba(255, 255, 255, calc(var(--glass-opacity) * 2.6))"
    : "rgba(255, 255, 255, var(--glass-opacity))";
  const colorClasses = active
    ? "border-white/40 text-white"
    : "border-white/15 text-white/60 hover:border-white/40 hover:text-white";
  const isDisabled = disabled || loading;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      aria-label={label}
      aria-busy={loading}
      // bg inline (state-driven); blur via Tailwind utility (memory:
      // feedback_tw_glass_system).
      style={{ background: baseBg }}
      className={`backdrop-blur-glass backdrop-saturate-(--glass-saturation) flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${colorClasses} ${
        isDisabled ? "opacity-40" : ""
      }`}
    >
      {loading ? (
        <span
          aria-hidden
          className="spinner h-4 w-4 rounded-full border-2 border-white/30 border-t-white"
        />
      ) : (
        <span className="material-symbols-outlined text-[18px]">{icon}</span>
      )}
    </button>
  );
}

// Floating editor — textarea + save/cancel/delete. Edit-mode (user /
// collaboration) comments ONLY: AI instructions are authored in the bottom-bar
// composer now (§17), so this popover no longer carries the AI placeholder or
// the quick-suggestion chips. Positioned just BELOW the bounds; flips ABOVE if
// clipping the hero's bottom edge. Width is fixed (360 px in hero-space) so the
// popover doesn't change shape based on the drag-box size.
function CommentEditor({
  editor,
  scale,
  canvasW,
  canvasH,
  // Received for API parity with the marker-preview popup but unused
  // here — the editor popover is always app-chrome RTL regardless of
  // the slide's reading direction.
  direction: _direction,
  onContentChange,
  onSave,
  onCancel,
  onDelete,
  error,
  saving,
  deleting,
}: {
  editor: NonNullable<EditorState>;
  scale: number;
  canvasW: number;
  canvasH: number;
  direction: "rtl" | "ltr";
  onContentChange: (content: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  error: string | null;
  // In-flight flags lifted up to the parent (`HeroCommentOverlay`)
  // so the save and delete icons can morph to spinners while their
  // requests are pending. POST/PATCH/DELETE comments all take
  // ~1-2 s end-to-end; without spinners the user reads the click
  // as "nothing happened" and double-fires.
  saving?: boolean;
  deleting?: boolean;
}) {
  const POPOVER_W = 360;
  const POPOVER_GAP = 8;
  const POPOVER_ESTIMATED_H = 260;
  const heroH = canvasH * scale;
  const heroW = canvasW * scale;
  const boundsLeft = editor.bounds.x * scale;
  const boundsTop = editor.bounds.y * scale;
  const boundsHeight = editor.bounds.h * scale;
  const flipAbove =
    boundsTop + boundsHeight + POPOVER_GAP + POPOVER_ESTIMATED_H > heroH;
  const top = flipAbove
    ? Math.max(POPOVER_GAP, boundsTop - POPOVER_ESTIMATED_H - POPOVER_GAP)
    : boundsTop + boundsHeight + POPOVER_GAP;
  const left = Math.max(
    POPOVER_GAP,
    Math.min(heroW - POPOVER_W - POPOVER_GAP, boundsLeft),
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  return (
    <div
      // Always RTL — this is app chrome, not slide content. The
      // `direction` prop on this component is the slide's reading
      // direction, but the editor popover is part of the editor UI
      // and follows the app's Arabic-first conventions (matches the
      // MarkerPreviewPopup). The textarea inside uses `dir="auto"`
      // so a comment that starts with a Latin word still flows LTR
      // visually while the chrome stays RTL.
      dir="rtl"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      // `.in-slide-dim` carries the shared `--tq-bg`-mix background so
      // the popover stays readable on white slides — same recipe the
      // SlidePill uses. Class lives in globals.css so future palette
      // changes propagate; inline style only carries layout values
      // (left/top/width) that depend on the click location.
      // NO `.glass-modal` class — it sets `background: transparent`
      // via the SHORTHAND, which Safari's cascade was treating as
      // winning over any class-based `background-color` longhand
      // including `.in-slide-dim`'s. Replaced with inline values so
      // the background-color has no competing shorthand to lose
      // against. The inline value is a pre-composed `var(--tq-bg-dim)`
      // token (not `rgba(var(--tq-bg-rgb), 0.55)`) because Safari
      // has a long-standing bug where a `var()` holding a comma-
      // separated value fails to split back into `rgba()`'s argument
      // list, the whole declaration becomes invalid, and the bg
      // falls back to transparent. Border uses `--tq-border-glass`
      // (single token, no nested function), which Safari handles
      // cleanly.
      // `.in-slide-popover` carries the dim + hairline border. Class-
      // based bg (literal rgba in globals.css) so Safari's
      // backdrop-filter compositor sees a fully-resolved background
      // colour — inline `var()` references kept rendering transparent
      // for both popovers on Safari despite valid token definitions.
      className="in-slide-popover backdrop-blur-glass-boost backdrop-saturate-(--glass-saturation) pointer-events-auto absolute z-20 rounded-xl p-3 text-white shadow-2xl"
      style={{ left, top, width: POPOVER_W }}
    >
      {error ? (
        <div
          role="alert"
          className="mb-2 rounded-lg border border-orange-400/40 bg-orange-400/10 px-3 py-2 text-xs text-orange-200"
        >
          {error}
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        value={editor.content}
        onChange={(e) => onContentChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSave();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        rows={3}
        placeholder="اكتب تعليقك هنا..."
        style={{
          background: "rgba(255, 255, 255, var(--glass-opacity))",
          borderColor: "rgba(255, 255, 255, var(--glass-border-opacity))",
        }}
        className="backdrop-blur-glass backdrop-saturate-(--glass-saturation) w-full resize-none rounded-xl border px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-white/40 focus:border-white/40"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex gap-1">
          {onDelete ? (
            <GlassIconButton
              icon="delete"
              label="حذف التعليق"
              onClick={onDelete}
              loading={deleting}
            />
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <GlassIconButton icon="close" label="إلغاء" onClick={onCancel} />
          <GlassIconButton
            icon="check"
            label="حفظ"
            active
            onClick={onSave}
            disabled={!editor.content.trim()}
            loading={saving}
          />
        </div>
      </div>
    </div>
  );
}

// Read-only popup that opens when a viewer clicks a marker outside
// comment mode. Anchored at the CLICK position (overlay-space px)
// so the popup appears right at the cursor — user feedback was
// "on the corner of the mouse click, not far away". Clamped to the
// canvas so the popup never extends off-screen; flips above the
// click if it would clip the bottom edge.
//
// Closes on Esc (handled by the parent's existing keydown listener),
// outside-click, or after Edit/Delete fires. The popup itself is
// always RTL (app chrome convention) regardless of slide direction;
// the comment body inside uses `dir="auto"` so mixed-script content
// gets the right BiDi treatment per first strong character.
function MarkerPreviewPopup({
  comment,
  anchorX,
  anchorY,
  canvasW,
  canvasH,
  scale,
  canEdit,
  canDelete,
  onClose,
  onEdit,
  onDelete,
}: {
  comment: CommentRow;
  // Overlay-space pixel coordinates of the click point. The popup's
  // top-left corner anchors here (with clamps + flip-above).
  anchorX: number;
  anchorY: number;
  canvasW: number;
  canvasH: number;
  scale: number;
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => Promise<void> | void;
}) {
  const POPOVER_W = 320;
  const POPOVER_GAP = 8;
  // Conservative estimate covering header (~36 px) + content
  // (~3 lines ≈ 60 px) + footer (~40 px) + paddings (~32 px).
  // Used only for the "would I clip the bottom edge?" check —
  // actual layout flows freely so a shorter / taller comment
  // still renders correctly.
  const POPOVER_ESTIMATED_H = 180;
  const heroH = canvasH * scale;
  const heroW = canvasW * scale;
  // Flip above the click if anchoring below would clip the canvas
  // bottom. Either way the popup hugs the click position vertically.
  const flipAbove = anchorY + POPOVER_ESTIMATED_H + POPOVER_GAP > heroH;
  const top = flipAbove
    ? Math.max(POPOVER_GAP, anchorY - POPOVER_ESTIMATED_H - POPOVER_GAP)
    : anchorY + POPOVER_GAP;
  // Clamp horizontally so the popover never extends off-canvas.
  // In RTL chrome the popup grows toward the visual-left from the
  // click; in LTR toward visual-right. Either way, just clamp the
  // top-left within the canvas envelope.
  const left = Math.max(
    POPOVER_GAP,
    Math.min(heroW - POPOVER_W - POPOVER_GAP, anchorX),
  );

  const popoverRef = useRef<HTMLDivElement>(null);
  // Local deleting-in-flight state. The DELETE round-trip + the
  // upstream broadcast + the React re-render that drops the row can
  // take ~1-2 s; without a spinner the user reads it as a "nothing
  // happened" tap and double-fires the click. setting `isDeleting`
  // also disables the button so a fast second click doesn't queue
  // a duplicate request.
  const [isDeleting, setIsDeleting] = useState(false);

  // Outside-click closes the popup. Listen on `mousedown` (not
  // `click`) so the close fires BEFORE any nested button's onClick —
  // closing on click would race against Edit/Delete and could close
  // before the action fires.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target instanceof Node)) return;
      if (popoverRef.current?.contains(e.target)) return;
      // Don't close on clicks landing on a marker pin — the parent
      // will swap `previewCommentId` and we'd race.
      if (e.target instanceof Element && e.target.closest("[aria-label='عرض التعليق']")) {
        return;
      }
      onClose();
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [onClose]);

  const displayName = comment.author?.name?.trim() || "غير معروف";

  const handleDeleteClick = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await onDelete();
      // On success the parent closes the popup → this component
      // unmounts before the next render. No need to flip
      // `isDeleting` back; if we DID get here the unmount race
      // means React drops the state anyway.
    } catch {
      // Caller already keeps the popup open on failure so the user
      // can retry. Re-enable the button.
      setIsDeleting(false);
    }
  };

  return (
    <div
      ref={popoverRef}
      // Always RTL — this is app chrome (Arabic-first product), not
      // slide content. Slide direction is irrelevant here. The
      // comment body div below uses `dir="auto"` so mixed-script
      // content still flows correctly per first strong character.
      dir="rtl"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      // Same glass + dim recipe the editor uses — readable on white
      // slides (via `.in-slide-dim`), border ring from `.glass-modal`,
      // backdrop blur via Tailwind v4 compositional utility.
      // NO `.glass-modal` class — it sets `background: transparent`
      // via the SHORTHAND, which Safari's cascade was treating as
      // winning over any class-based `background-color` longhand
      // including `.in-slide-dim`'s. Replaced with inline values so
      // the background-color has no competing shorthand to lose
      // against. The inline value is a pre-composed `var(--tq-bg-dim)`
      // token (not `rgba(var(--tq-bg-rgb), 0.55)`) because Safari
      // has a long-standing bug where a `var()` holding a comma-
      // separated value fails to split back into `rgba()`'s argument
      // list, the whole declaration becomes invalid, and the bg
      // falls back to transparent. Border uses `--tq-border-glass`
      // (single token, no nested function), which Safari handles
      // cleanly.
      // `.in-slide-popover` carries the dim + hairline border. Class-
      // based bg (literal rgba in globals.css) so Safari's
      // backdrop-filter compositor sees a fully-resolved background
      // colour — inline `var()` references kept rendering transparent
      // for both popovers on Safari despite valid token definitions.
      className="in-slide-popover backdrop-blur-glass-boost backdrop-saturate-(--glass-saturation) pointer-events-auto absolute z-20 rounded-xl p-3 text-white shadow-2xl"
      style={{ left, top, width: POPOVER_W }}
    >
      {/* Header — avatar visual-right, name+time stacked visual-left
          under the parent's RTL direction. Matches the new
          CommentsPanel row layout exactly. */}
      <div className="flex items-center gap-2">
        <Avatar
          name={comment.author?.name ?? null}
          image={comment.author?.image ?? null}
          seedId={comment.author?.id ?? null}
          size={28}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span
            // NO `dir="auto"` — the popup is forced RTL chrome.
            // `dir="auto"` would flip a Latin display name (e.g.
            // "Osama") to LTR locally and the name would snap to
            // visual-LEFT inside the RTL popup, misaligning the
            // header row.
            className="truncate text-xs font-semibold leading-tight text-white"
          >
            {displayName}
          </span>
          <time
            className="text-[10px] leading-tight text-white/40"
            dateTime={comment.createdAt}
            title={new Date(comment.createdAt).toLocaleString("ar")}
          >
            {formatRelativeArabic(comment.createdAt)}
          </time>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="إغلاق"
          className="ms-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-white/10 hover:text-white"
        >
          <span className="material-symbols-outlined text-[16px]">close</span>
        </button>
      </div>

      {/* Comment content — preserves user line breaks. Inherits
          the popup's RTL chrome (NO `dir="auto"`) so the block
          stays right-aligned even when the comment opens with a
          Latin word like "Make the title bigger". Unicode BiDi
          still handles inline glyph order inside the line. */}
      <div className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-white/90">
        {comment.content}
      </div>

      {/* Footer — Edit + Delete buttons, gated by authorship. Empty
          (no row at all) when the viewer can do neither, so a
          comment-only user looking at someone else's marker just
          sees the read-only window. */}
      {canEdit || canDelete ? (
        <div className="mt-3 flex items-center justify-end gap-2 border-t border-white/[0.08] pt-3">
          {/* Both buttons use `.btn-pill` — the design-system normal-
              button surface (glass, white text, no brand colour). The
              earlier red-tinted delete read as a destructive emphasis
              that the design system doesn't elsewhere use for inline
              actions (only the dashboard's `TrashConfirmDialog` keeps
              the red, and only on its confirm CTA). Edit + Delete
              here are siblings — same visual weight, action
              identified by glyph + label. */}
          {canDelete ? (
            <button
              type="button"
              onClick={() => {
                void handleDeleteClick();
              }}
              disabled={isDeleting}
              aria-busy={isDeleting}
              className="btn-pill inline-flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
            >
              {/* Icon morphs to a spinner while the DELETE request is
                  in flight — same recipe as the toolbar's running-
                  state spinner. The trash icon disappears so the user
                  reads the button as "in progress" not "double-click
                  me". */}
              {isDeleting ? (
                <span
                  aria-hidden
                  className="spinner h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white"
                />
              ) : (
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 14 }}
                  aria-hidden
                >
                  delete
                </span>
              )}
              حذف
            </button>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              onClick={onEdit}
              className="btn-pill inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 14 }}
                aria-hidden
              >
                edit
              </span>
              تعديل
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
