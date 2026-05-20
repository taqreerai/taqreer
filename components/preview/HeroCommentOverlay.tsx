"use client";

// Hero comment overlay — drag-box + pins + editor popover that sit
// on top of the hero canvas while commentMode is active.
//
// Coordinates: bounds live in slide-space (0..canvasW × 0..canvasH)
// regardless of slide format. The `scale` prop converts slide-space
// to overlay-pixel-space (which matches the hero's rendered size).

import { useCallback, useEffect, useRef, useState } from "react";
import type { CommentRow, CommentBounds } from "@/lib/types/comment";

// Minimum drag size in slide-space pixels. Smaller drags are treated
// as misfired clicks and discarded — keeps stray mousedowns from
// opening empty editors.
const MIN_DRAG_SIZE = 40;

// Arabic quick-action prompts. Click a chip to append its `text` to
// the textarea. Order: most-common edit → least-common.
const QUICK_CHIPS: { label: string; text: string }[] = [
  { label: "اجعل النص أكبر", text: "اجعل النص أكبر بحوالي 1.3× مع الحفاظ على باقي تخطيط الشريحة." },
  { label: "اجعل النص أصغر", text: "صغّر حجم النص بحوالي 1.3×." },
  { label: "غيّر اللون", text: "غيّر لون العنصر المحدد إلى لون أكثر تباينًا ووضوحًا من نفس اللوحة." },
  { label: "احذف هذا", text: "احذف هذا العنصر بالكامل من الشريحة." },
  { label: "بسّط", text: "بسّط المحتوى المرئي — عدد أقل من العناصر، مساحة بيضاء أكثر، تسلسل هرمي أوضح." },
  { label: "أضف أيقونة", text: "أضف أيقونة SVG ذات صلة لتعزيز معنى المحتوى." },
];

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
}: {
  slideId: string;
  // ALL drafts — filtered to this slide internally so the caller
  // doesn't recompute on every keystroke.
  comments: CommentRow[];
  // Hero pixels per slide-space pixel (heroWidth / canvasW). Same
  // value SlideRenderer takes.
  scale: number;
  canvasW: number;
  canvasH: number;
  direction: "rtl" | "ltr";
  onCreate: (input: { slideId: string; bounds: CommentBounds; content: string }) => Promise<void>;
  onUpdate: (input: { commentId: string; content?: string; bounds?: CommentBounds }) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
}) {
  const [drag, setDrag] = useState<DragState>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const slideComments = comments.filter((c) => c.slideId === slideId);

  // Reset transient state when the focused slide changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrag(null);
    setEditor(null);
    setEditorError(null);
  }, [slideId]);

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
      setDrag((prev) => {
        if (!prev) return null;
        const x = Math.min(prev.startSlide.x, prev.currentSlide.x);
        const y = Math.min(prev.startSlide.y, prev.currentSlide.y);
        const w = Math.abs(prev.currentSlide.x - prev.startSlide.x);
        const h = Math.abs(prev.currentSlide.y - prev.startSlide.y);
        if (w < MIN_DRAG_SIZE || h < MIN_DRAG_SIZE) return null;
        setEditor({
          kind: "new",
          bounds: { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) },
          content: "",
        });
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
    const trimmed = editor.content.trim();
    if (!trimmed) return;
    setEditorError(null);
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
    }
  };

  const handleDelete = async () => {
    if (!editor || editor.kind !== "existing") return;
    setEditorError(null);
    try {
      await onDelete(editor.commentId);
      setEditor(null);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "تعذر حذف التعليق.");
    }
  };

  // Esc closes the editor (or clears the live drag) — does NOT exit
  // commentMode. That's owned by DeckView's own Esc handler, which
  // skips if our editor is open (Esc cascades).
  useEffect(() => {
    if (!editor && !drag) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (editor) {
        setEditor(null);
        setEditorError(null);
      } else if (drag) {
        setDrag(null);
      }
    };
    // Capture so we beat DeckView's keydown listener.
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [editor, drag]);

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
      className="absolute inset-0 overflow-hidden"
      // High enough to sit above the SlideRenderer (z-auto) but BELOW
      // the canvas-gradient-border's ::after (z:2).
      style={{ zIndex: 1 }}
      onMouseDown={handleStartDrag}
    >
      {/* Existing pins. Hidden when their comment is being edited so
          the editor's solid anchor box doesn't double up on a pin. */}
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
              handlePinClick(c);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="تعديل التعليق"
            className="absolute rounded-md border border-orange-400/80 bg-orange-400/15 transition-colors hover:bg-orange-400/30"
            style={{
              left: b.x * scale,
              top: b.y * scale,
              width: b.w * scale,
              height: b.h * scale,
            }}
          />
        );
      })}

      {/* Live drag rect — dashed while the user is dragging. */}
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

      {/* Editor anchor rect — solid box around the active editor. */}
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

      {/* Editor popover — anchored to the bounds. */}
      {editor ? (
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
          onDelete={editor.kind === "existing" ? handleDelete : undefined}
        />
      ) : null}
    </div>
  );
}

// Glass icon button — same neutral surface language as the toolbar.
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
      // bg inline (state-driven); blur via Tailwind utility (memory:
      // feedback_tw_glass_system).
      style={{ background: baseBg }}
      className={`backdrop-blur-glass backdrop-saturate-(--glass-saturation) flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${colorClasses} ${
        disabled ? "opacity-40" : ""
      }`}
    >
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
    </button>
  );
}

// Floating editor — textarea + quick chips + save/cancel/delete.
// Positioned just BELOW the bounds; flips ABOVE if clipping the
// hero's bottom edge. Width is fixed (360 px in hero-space) so the
// popover doesn't change shape based on the drag-box size.
function CommentEditor({
  editor,
  scale,
  canvasW,
  canvasH,
  direction,
  onContentChange,
  onSave,
  onCancel,
  onDelete,
  error,
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
      className="glass-modal backdrop-blur-glass backdrop-saturate-(--glass-saturation) pointer-events-auto absolute z-20 rounded-xl p-3 text-white shadow-2xl"
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
      <div className="mb-2 flex flex-wrap gap-1.5">
        {QUICK_CHIPS.map((chip) => (
          <button
            type="button"
            key={chip.label}
            onClick={() => appendChip(chip.text)}
            style={{
              background: "rgba(255, 255, 255, var(--glass-opacity))",
            }}
            className="backdrop-blur-glass backdrop-saturate-(--glass-saturation) rounded-full border border-white/15 px-2.5 py-1 text-xs text-white/60 transition-colors hover:border-white/40 hover:text-white"
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
            <GlassIconButton icon="delete" label="حذف التعليق" onClick={onDelete} />
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
          />
        </div>
      </div>
    </div>
  );
}
