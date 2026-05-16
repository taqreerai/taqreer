"use client";

// Slide lightbox — full-viewport modal that opens an enlarged view of a
// single slide. Two modes:
//
//   idle    → just enlarge + nav + close. Click a sibling to switch slides,
//             Esc to close.
//   comment → drag-box overlay on top of the slide. mousedown → drag →
//             mouseup spawns a textarea with quick-action chips. Existing
//             comments on the slide render as pins; click a pin to edit
//             or delete it. Backdrop click does NOT close in comment mode
//             (mid-drag would lose work).
//
// Visual language
// ---------------
// All chrome uses globals.css tokens — `.glass-modal` (backdrop),
// `.glass-card` (stage + counter + nav + close). The drag box itself uses
// a dashed orange outline that matches the toolbar's comment-active state.
//
// Coordinate model
// ----------------
// Drag-box bounds are persisted in slide-space (0..1920, 0..1080). The
// stage element renders the slide at `scale = stage.width / 1920`, so we
// translate viewport coords → slide coords by subtracting the stage's
// bounding rect and dividing by scale. Persisting in slide-space means
// a future viewport resize (or different scale on a different machine)
// doesn't move existing pins.
//
// Toolbar
// -------
// The PreviewActionBar lives at the DeckView root and animates between
// its page-edge home and a position adjacent to the slide stage here.
// This component does not own the toolbar — it just leaves a visual gap
// to the right of the stage for it via the `min(calc(90vw - 220px), …)`
// width clamp.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import type { SlideManifest } from "@/lib/schema/slide";
import { SlideRenderer } from "@/components/slides/SlideRenderer";
import type { CommentRow, CommentBounds } from "@/lib/types/comment";

const SLIDE_W = 1920;
const SLIDE_H = 1080;

// Minimum drag size (slide-space pixels). Anything smaller is treated as
// a click — discarded so a stray mousedown doesn't open an empty editor.
const MIN_DRAG_SIZE = 40;

// Quick-action chips. Each chip's `text` is appended to the textarea when
// clicked. Order from most-common to least-common edit (heuristic).
const QUICK_CHIPS: { label: string; text: string }[] = [
  { label: "اجعل النص أكبر", text: "اجعل النص أكبر بحوالي 1.3× مع الحفاظ على باقي تخطيط الشريحة." },
  { label: "اجعل النص أصغر", text: "صغّر حجم النص بحوالي 1.3×." },
  { label: "غيّر اللون", text: "غيّر لون العنصر المحدد إلى لون أكثر تباينًا ووضوحًا من نفس اللوحة." },
  { label: "احذف هذا", text: "احذف هذا العنصر بالكامل من الشريحة." },
  { label: "بسّط", text: "بسّط المحتوى المرئي — عدد أقل من العناصر، مساحة بيضاء أكثر، تسلسل هرمي أوضح." },
  { label: "أضف أيقونة", text: "أضف أيقونة SVG ذات صلة لتعزيز معنى المحتوى." },
];

// Editor state — either editing a NEW comment (just-finished drag) or an
// EXISTING comment (pin click). `null` means no editor open.
type EditorState =
  | { kind: "new"; bounds: CommentBounds; content: string }
  | { kind: "existing"; commentId: string; bounds: CommentBounds; content: string }
  | null;

// Live-drag state — mousedown captured, not yet released.
type DragState = {
  startSlide: { x: number; y: number };
  currentSlide: { x: number; y: number };
} | null;

export function SlideLightbox({
  manifest,
  index,
  mode,
  comments,
  onClose,
  onNav,
  onCreateComment,
  onUpdateComment,
  onDeleteComment,
}: {
  manifest: SlideManifest;
  index: number | null;
  mode: "idle" | "comment";
  comments: CommentRow[];
  onClose: () => void;
  onNav: (nextIndex: number) => void;
  onCreateComment: (input: {
    slideId: string;
    bounds: CommentBounds;
    content: string;
  }) => Promise<void>;
  onUpdateComment: (input: {
    commentId: string;
    content?: string;
    bounds?: CommentBounds;
  }) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
}) {
  const [mounted, setMounted] = useState(false);
  const [scale, setScale] = useState(0.5);
  const [drag, setDrag] = useState<DragState>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const open = index !== null;
  const total = manifest.slides.length;
  const slide = open ? manifest.slides[index] : null;
  const canPrev = open && index > 0;
  const canNext = open && index < total - 1;

  // Filter comments to the current slide. Memo'd so the render loop and
  // editor effects don't recompute on every parent re-render.
  const slideComments = useMemo(
    () => (slide ? comments.filter((c) => c.slideId === slide.slideId) : []),
    [slide, comments],
  );

  // Portal target is client-only. Standard "is mounted" pattern.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // Measure stage element + compute scale to fit. Re-runs whenever the
  // stage element resizes (viewport rotate, sidebar toggle, etc.).
  useEffect(() => {
    if (!open || !stageRef.current) return;
    const el = stageRef.current;
    const recompute = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return;
      const sw = w / SLIDE_W;
      const sh = h / SLIDE_H;
      setScale(Math.min(sw, sh));
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  // Body scroll lock — restore on close.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Reset transient drag/editor state when the slide changes or the user
  // toggles comment mode. Avoids stale boxes leaking into another slide's
  // editor. Intentional setState-in-effect — same pattern used elsewhere
  // for client-only state derived from prop changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrag(null);
    setEditor(null);
  }, [index, mode]);

  const goPrev = useCallback(() => {
    if (canPrev) onNav(index - 1);
  }, [canPrev, index, onNav]);

  const goNext = useCallback(() => {
    if (canNext) onNav(index + 1);
  }, [canNext, index, onNav]);

  // Keyboard handlers. Arrow keys keep universal meaning regardless of UI
  // direction. Escape: close the editor first if open, otherwise close
  // the modal (so a half-typed comment doesn't lose context to a stray Esc).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (editor !== null) {
          setEditor(null);
          return;
        }
        onClose();
        return;
      }
      // Arrow keys ignored while the editor is open so typing inside the
      // textarea isn't hijacked.
      if (editor !== null) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, goPrev, goNext, editor]);

  // Viewport coords → slide-space coords via the stage element's bounding
  // rect + the current scale. Clamped to canvas to keep persisted values
  // inside [0, 1920] × [0, 1080].
  const toSlideCoords = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const el = stageRef.current;
      if (!el || scale <= 0) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      const x = (clientX - rect.left) / scale;
      const y = (clientY - rect.top) / scale;
      return {
        x: Math.max(0, Math.min(SLIDE_W, x)),
        y: Math.max(0, Math.min(SLIDE_H, y)),
      };
    },
    [scale],
  );

  // Drag handlers — only active in comment mode and only on the stage. The
  // overlay layer captures mousedown; while dragging we listen on window
  // for mousemove/mouseup so the user can release outside the stage and
  // the box still finalises. setState-in-effect-style pattern via local
  // closure handlers.
  const handleStageMouseDown = (e: React.MouseEvent) => {
    if (mode !== "comment") return;
    if (editor !== null) return; // Don't restart while editing.
    e.preventDefault();
    const p = toSlideCoords(e.clientX, e.clientY);
    setDrag({ startSlide: p, currentSlide: p });
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      setDrag((prev) =>
        prev ? { ...prev, currentSlide: toSlideCoords(e.clientX, e.clientY) } : prev,
      );
    };
    const onUp = () => {
      setDrag((prev) => {
        if (!prev) return null;
        const x = Math.min(prev.startSlide.x, prev.currentSlide.x);
        const y = Math.min(prev.startSlide.y, prev.currentSlide.y);
        const w = Math.abs(prev.currentSlide.x - prev.startSlide.x);
        const h = Math.abs(prev.currentSlide.y - prev.startSlide.y);
        if (w < MIN_DRAG_SIZE || h < MIN_DRAG_SIZE) return null;
        setEditor({ kind: "new", bounds: { x, y, w, h }, content: "" });
        return null;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, toSlideCoords]);

  // Pin click — open editor on an existing comment.
  const handlePinClick = (comment: CommentRow) => {
    if (mode !== "comment") return;
    if (!comment.boundsJson) return;
    setEditor({
      kind: "existing",
      commentId: comment.id,
      bounds: comment.boundsJson,
      content: comment.content,
    });
  };

  // Save handlers wired to the parent's API helpers. Local state updates
  // happen in the parent (DeckView) when the helpers resolve, so we just
  // wait and close the editor on success.
  const handleSave = async () => {
    if (!editor || !slide) return;
    const trimmed = editor.content.trim();
    if (!trimmed) return;
    try {
      if (editor.kind === "new") {
        await onCreateComment({
          slideId: slide.slideId,
          bounds: editor.bounds,
          content: trimmed,
        });
      } else {
        await onUpdateComment({
          commentId: editor.commentId,
          content: trimmed,
          bounds: editor.bounds,
        });
      }
      setEditor(null);
    } catch {
      /* swallow — the parent surfaces toast / error UI */
    }
  };

  const handleDelete = async () => {
    if (!editor || editor.kind !== "existing") return;
    try {
      await onDeleteComment(editor.commentId);
      setEditor(null);
    } catch {
      /* swallow */
    }
  };

  if (!mounted) return null;

  // Live drag rect (in slide-space). Used for both the dashed preview and
  // the editor anchor.
  const liveBounds: CommentBounds | null = drag
    ? {
        x: Math.min(drag.startSlide.x, drag.currentSlide.x),
        y: Math.min(drag.startSlide.y, drag.currentSlide.y),
        w: Math.abs(drag.currentSlide.x - drag.startSlide.x),
        h: Math.abs(drag.currentSlide.y - drag.startSlide.y),
      }
    : null;

  // Backdrop click — close in idle mode; ignore in comment mode (a stray
  // outside-of-stage click while reaching for the textarea would otherwise
  // lose the half-typed comment).
  const handleBackdropClick = () => {
    if (mode === "comment") return;
    onClose();
  };

  return createPortal(
    <AnimatePresence>
      {open && slide ? (
        <motion.div
          key="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`الشريحة ${index + 1} من ${total}`}
          dir={manifest.direction}
          onClick={handleBackdropClick}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="glass-modal backdrop-blur-glass backdrop-saturate-150 fixed inset-0 z-[1000] flex items-center justify-center"
        >
          {/* Close — top-end (left in RTL) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="إغلاق"
            className="glass-card absolute top-6 end-6 flex h-11 w-11 items-center justify-center rounded-full text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>

          {/* Counter — top-center */}
          <div className="glass-card absolute top-6 left-1/2 -translate-x-1/2 rounded-full px-4 py-1.5 text-sm font-medium text-white">
            {index + 1} / {total}
          </div>

          {/* Previous — start side (right in RTL) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
            disabled={!canPrev}
            aria-label="الشريحة السابقة"
            className="glass-card absolute start-6 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full text-white disabled:opacity-30"
          >
            <span className="material-symbols-outlined">
              {manifest.direction === "rtl" ? "chevron_right" : "chevron_left"}
            </span>
          </button>

          {/* Next — end side (left in RTL) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goNext();
            }}
            disabled={!canNext}
            aria-label="الشريحة التالية"
            className="glass-card absolute end-6 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full text-white disabled:opacity-30"
          >
            <span className="material-symbols-outlined">
              {manifest.direction === "rtl" ? "chevron_left" : "chevron_right"}
            </span>
          </button>

          {/* Stage — sized to fit viewport, contains scaled slide + the
              comment overlay. The 90vw - 220px clamp reserves the strip
              for the toolbar that animates in from DeckView root. */}
          <motion.div
            key={`slide-${index}`}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            ref={stageRef}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={handleStageMouseDown}
            className={`glass-card relative overflow-hidden rounded-2xl ${
              mode === "comment" && !drag && !editor ? "cursor-crosshair" : ""
            }`}
            style={{
              width: "min(calc(90vw - 220px), calc((100vh - 160px) * 16 / 9))",
              aspectRatio: "16 / 9",
              background: manifest.theme.background,
            }}
          >
            <SlideRenderer
              slide={slide}
              theme={manifest.theme}
              direction={manifest.direction}
              language={manifest.language}
              scale={scale}
            />

            {/* Comment overlay layer — pins for existing comments, dashed
                rect during drag, editor anchor on a freshly-finished drag.
                Pointer events selectively enabled so the SlideRenderer
                underneath stays inert (no spurious clicks on slide content)
                while comments stay interactive. */}
            {mode === "comment" ? (
              <CommentLayer
                slideComments={slideComments}
                scale={scale}
                liveBounds={liveBounds}
                editor={editor}
                onPinClick={handlePinClick}
              />
            ) : null}

            {/* Editor popover — anchored to the bounds of the active editor.
                Rendered inside the stage so it scales with viewport. */}
            {editor && mode === "comment" ? (
              <CommentEditor
                editor={editor}
                scale={scale}
                direction={manifest.direction}
                onContentChange={(content) =>
                  setEditor((prev) => (prev ? { ...prev, content } : prev))
                }
                onSave={handleSave}
                onCancel={() => setEditor(null)}
                onDelete={editor.kind === "existing" ? handleDelete : undefined}
              />
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

// Renders pins + the live drag rect. Slide-space coords scaled into
// stage-space via the `scale` prop. Pointer events on by default so a
// pin can intercept clicks; the parent stage's mousedown handler triggers
// drag-start on empty-area clicks.
function CommentLayer({
  slideComments,
  scale,
  liveBounds,
  editor,
  onPinClick,
}: {
  slideComments: CommentRow[];
  scale: number;
  liveBounds: CommentBounds | null;
  editor: EditorState;
  onPinClick: (comment: CommentRow) => void;
}) {
  return (
    <div
      aria-hidden={false}
      className="pointer-events-none absolute inset-0"
      style={{ direction: "ltr" }}
    >
      {/* Existing pins. Hidden when their corresponding comment is being
          edited so the dashed editor rect doesn't double-up on a solid pin. */}
      {slideComments.map((c) => {
        if (!c.boundsJson) return null;
        if (editor?.kind === "existing" && editor.commentId === c.id) return null;
        const b = c.boundsJson;
        return (
          <button
            type="button"
            key={c.id}
            onClick={(e) => {
              e.stopPropagation();
              onPinClick(c);
            }}
            aria-label="تعديل التعليق"
            className="pointer-events-auto absolute rounded-md border border-orange-400/80 bg-orange-400/15 transition-colors hover:bg-orange-400/30"
            style={{
              left: b.x * scale,
              top: b.y * scale,
              width: b.w * scale,
              height: b.h * scale,
            }}
          />
        );
      })}

      {/* Live drag rect — dashed orange while the user is dragging. */}
      {liveBounds ? (
        <div
          className="pointer-events-none absolute rounded-md border border-dashed border-orange-400 bg-orange-400/10"
          style={{
            left: liveBounds.x * scale,
            top: liveBounds.y * scale,
            width: liveBounds.w * scale,
            height: liveBounds.h * scale,
          }}
        />
      ) : null}

      {/* Editor's anchor rect — solid orange around the active box. */}
      {editor ? (
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
    </div>
  );
}

// Reusable glass-icon button — same neutral glass visual language as the
// toolbar's ToolButton, just smaller (9×9 vs 11×11). No brand-coloured
// tints; active state raises glass intensity ~2.6× while keeping the 1px
// white border weight identical to idle.
function GlassIconButton({
  icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  // Same hover pattern as the toolbar's ToolButton: muted icon + dim border
  // idle, white icon + bright border on hover, active = bright. Keeps the
  // editor footer visually consistent with the toolbar.
  const baseBg = active
    ? "rgba(255, 255, 255, calc(var(--glass-opacity) * 2.6))"
    : "rgba(255, 255, 255, var(--glass-opacity))";
  const colorClasses = active
    ? "border-white/40 text-white"
    : "border-white/15 text-white/60 hover:border-white/40 hover:text-white";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{
        background: baseBg,
        backdropFilter: "blur(var(--glass-blur)) saturate(var(--glass-saturation))",
        WebkitBackdropFilter:
          "blur(var(--glass-blur)) saturate(var(--glass-saturation))",
      }}
      className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${colorClasses} ${
        disabled ? "opacity-40" : ""
      }`}
    >
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
    </button>
  );
}

// Floating editor — textarea + quick-action chips + save/cancel/delete.
// Positioned just BELOW the editor bounds (slide-space y + h, scaled). If
// the textarea would clip the stage bottom, flip above. Always 360 px wide
// in stage-space so it doesn't depend on the bounds' width.
function CommentEditor({
  editor,
  scale,
  direction,
  onContentChange,
  onSave,
  onCancel,
  onDelete,
}: {
  editor: NonNullable<EditorState>;
  scale: number;
  direction: "rtl" | "ltr";
  onContentChange: (content: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const POPOVER_W = 360;
  const POPOVER_GAP = 8;
  // Position: stage-space pixels. Anchor under the bounds; if that would
  // exceed stage height, flip above.
  const stageH = SLIDE_H * scale;
  const stageW = SLIDE_W * scale;
  const boundsLeft = editor.bounds.x * scale;
  const boundsTop = editor.bounds.y * scale;
  const boundsHeight = editor.bounds.h * scale;
  const POPOVER_ESTIMATED_H = 260;
  const flipAbove =
    boundsTop + boundsHeight + POPOVER_GAP + POPOVER_ESTIMATED_H > stageH;
  const top = flipAbove
    ? Math.max(POPOVER_GAP, boundsTop - POPOVER_ESTIMATED_H - POPOVER_GAP)
    : boundsTop + boundsHeight + POPOVER_GAP;
  // Clamp left so the popover doesn't overflow the stage horizontally.
  const left = Math.max(
    POPOVER_GAP,
    Math.min(stageW - POPOVER_W - POPOVER_GAP, boundsLeft),
  );

  // Autofocus the textarea on mount. setState-in-effect intentionally not
  // used here — useRef + useEffect.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const appendChip = (text: string) => {
    const current = editor.content.trim();
    const next = current ? `${current} ${text}` : text;
    onContentChange(next);
    textareaRef.current?.focus();
  };

  return (
    <div
      dir={direction}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="glass-modal backdrop-blur-glass backdrop-saturate-150 pointer-events-auto absolute z-20 rounded-xl p-3 text-white shadow-2xl"
      style={{ left, top, width: POPOVER_W }}
    >
      <div className="mb-2 flex flex-wrap gap-1.5">
        {QUICK_CHIPS.map((chip) => (
          <button
            type="button"
            key={chip.label}
            onClick={() => appendChip(chip.text)}
            style={{
              background: "rgba(255, 255, 255, var(--glass-opacity))",
              backdropFilter: "blur(var(--glass-blur)) saturate(var(--glass-saturation))",
              WebkitBackdropFilter:
                "blur(var(--glass-blur)) saturate(var(--glass-saturation))",
            }}
            className="rounded-full border border-white/15 px-2.5 py-1 text-xs text-white/60 transition-colors hover:border-white/40 hover:text-white"
          >
            {chip.label}
          </button>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        value={editor.content}
        onChange={(e) => onContentChange(e.target.value)}
        onKeyDown={(e) => {
          // Submit on Enter (without shift). Shift+Enter inserts newline.
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
        // `.input-dark` would apply the global blue focus border (defined
        // in globals.css for app-wide forms). The comment editor lives
        // inside a brand-neutral glass modal, so we replicate the glass
        // base + override the focus border to white. Inline styles + a
        // local class for the focus pseudo (Tailwind arbitrary variant).
        style={{
          background: "rgba(255, 255, 255, var(--glass-opacity))",
          borderColor: "rgba(255, 255, 255, var(--glass-border-opacity))",
          backdropFilter: "blur(var(--glass-blur)) saturate(var(--glass-saturation))",
          WebkitBackdropFilter:
            "blur(var(--glass-blur)) saturate(var(--glass-saturation))",
        }}
        className="w-full resize-none rounded-xl border px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-white/40 focus:border-white/40"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex gap-1">
          {onDelete ? (
            <GlassIconButton
              icon="delete"
              label="حذف التعليق"
              onClick={onDelete}
            />
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <GlassIconButton icon="close" label="إلغاء" onClick={onCancel} />
          {/* Save uses the SAME neutral glass as Cancel — the check icon
              + textarea-required state communicate "primary action". No
              colour accents per the brand rule (only CTAs have colour, and
              the team prefers no colour anywhere here). */}
          <GlassIconButton
            icon="check"
            label="حفظ"
            active
            onClick={onSave}
            disabled={!editor.content.trim()}
          />
        </div>
      </div>
    </div>
  );
}
