"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import type { SlideManifest } from "@/lib/schema/slide";
import { exportManifestAsPptx } from "@/lib/export/html-export";
import { downloadHtmlDocument } from "@/lib/export/html-document";

type Status = "idle" | "running" | "success" | "error";

function baseFileName(title: string): string {
  return (
    title.trim().replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").slice(0, 80) ||
    "presentation"
  );
}

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
}: {
  icon: string;
  // Optional custom icon node — overrides the material-symbols icon when
  // provided. Used by the regen button so we can render an AnimatePresence
  // icon morph (autorenew ↔ check with continuous rotation) instead of a
  // static glyph.
  iconNode?: React.ReactNode;
  label: string;
  badge?: string;
  // Small numeric badge in the top-end corner. Used for the comment toggle
  // to show how many draft comments live across the deck. Coloured blue
  // (--tq-blue) so it reads as "info / count" rather than "alert / warn".
  countBadge?: number;
  onClick?: () => void;
  disabled?: boolean;
  running?: boolean;
  active?: boolean;
  // Animated brand-gradient variant (`.btn-gradient-anim` in globals.css).
  // Used ONLY on the regen button so the deck's primary CTA stands out
  // against the otherwise-neutral glass toolbar.
  gradient?: boolean;
}) {
  const isDisabled = disabled || running;
  // Two coordinated visual transitions on hover:
  //   - icon: muted (white/60) → white
  //   - border: dim (white/15) → bright (white/40)
  // Active = always at the bright end (white icon + brighter border + raised
  // glass background). Inline-style is only used for the bg (which depends
  // on --glass-opacity CSS var); border + text colours are pure Tailwind so
  // :hover transitions work without state plumbing. Gradient variant
  // bypasses the glass system entirely — its visuals come from
  // `.btn-gradient-anim` (animated linear gradient + brand glow).
  const baseBg = active
    ? "rgba(255, 255, 255, calc(var(--glass-opacity) * 2.6))"
    : "rgba(255, 255, 255, var(--glass-opacity))";
  const colorClasses = active
    ? "border-white/40 text-white"
    : "border-white/15 text-white/60 hover:border-white/40 hover:text-white";
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        disabled={isDisabled}
        aria-label={label}
        aria-pressed={active}
        style={
          gradient
            ? undefined
            : {
                background: baseBg,
                backdropFilter:
                  "blur(var(--glass-blur)) saturate(var(--glass-saturation))",
                WebkitBackdropFilter:
                  "blur(var(--glass-blur)) saturate(var(--glass-saturation))",
              }
        }
        className={
          gradient
            ? `btn-gradient-anim relative flex h-11 w-11 items-center justify-center rounded-xl transition-shadow ${
                isDisabled ? "" : "hover:scale-[1.02]"
              }`
            : `relative flex h-11 w-11 items-center justify-center rounded-xl border transition-colors ${colorClasses} ${
                isDisabled ? "opacity-40" : ""
              }`
        }
      >
        {iconNode ? (
          iconNode
        ) : running ? (
          <span className="spinner h-4 w-4 rounded-full border-2 border-white/20 border-t-white" />
        ) : (
          <span className="material-symbols-outlined text-[22px]">{icon}</span>
        )}
        {/* Count badge — top-end corner. Blue chip; the ONLY brand colour
            in the toolbar (info, not state). */}
        {countBadge && countBadge > 0 ? (
          <span
            className="absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none text-white shadow"
            style={{ background: "var(--tq-blue)" }}
          >
            {countBadge}
          </span>
        ) : null}
      </button>
      {/* Tooltip — appears to the right of the toolbar (toward content) */}
      <div
        className="pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-black/90 px-3 py-1.5 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
        style={{ left: "100%", marginLeft: "12px" }}
      >
        {label}
        {badge ? <span className="badge-purple ms-2">{badge}</span> : null}
      </div>
    </div>
  );
}

export function PreviewActionBar({
  projectId,
  projectTitle,
  manifest,
  commentMode,
  onToggleCommentMode,
  draftCommentCount,
  onApplyComments,
  commentsArmed,
  onFirePartialRegen,
  applying,
}: {
  projectId: string;
  projectTitle: string;
  manifest: SlideManifest;
  // Comment-mode state machine, all owned by DeckView:
  //   commentMode       — user toggled the comment tool
  //   draftCommentCount — # of "draft" comments saved in the DB
  //   commentsArmed     — user clicked Apply: drafts are locked, regen
  //                       button is primed to FIRE the partial regen
  //   applying          — partial regen is in flight (versionId queued
  //                       until Inngest finishes)
  //
  // Click handlers:
  //   onToggleCommentMode  — turn comment mode on/off
  //   onApplyComments      — Apply: arm (no Claude call yet)
  //   onFirePartialRegen   — used by the regen button when ARMED → fires
  //                          the partial regen (the only path that hits
  //                          Claude for slide-level changes)
  commentMode: boolean;
  onToggleCommentMode: () => void;
  draftCommentCount: number;
  onApplyComments: () => void;
  commentsArmed: boolean;
  onFirePartialRegen: () => void;
  applying: boolean;
}) {
  const router = useRouter();
  const [regen, setRegen] = useState<ButtonState>({ status: "idle" });
  const [exportPptx, setExportPptx] = useState<ButtonState>({ status: "idle" });
  const [exportHtml, setExportHtml] = useState<ButtonState>({ status: "idle" });
  const [saveTpl, setSaveTpl] = useState<ButtonState>({ status: "idle" });

  const [showSaveForm, setShowSaveForm] = useState(false);
  const [templateTitle, setTemplateTitle] = useState(projectTitle);

  const handleRegenerate = async () => {
    if (regen.status === "running") return;
    setRegen({ status: "running", message: "جارٍ إرسال الطلب..." });
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
        message: error instanceof Error ? error.message : "تعذر إعادة التصميم",
      });
    }
  };

  // Client-side export via dom-to-pptx + our BiDi post-processor. Runs
  // entirely in the browser — no Inngest job, no Supabase upload, no
  // polling. Replaces the previous server-side PptxGenJS pipeline.
  const handleExport = async () => {
    if (exportPptx.status === "running") return;
    setExportPptx({ status: "running", message: "جارٍ التصدير..." });
    try {
      // Prefer the manifest's title — it's the freshly regenerated value
      // (cover headline + dashboard label). `projectTitle` is the cached
      // server-side prop captured at SSR; if the user has just regenerated
      // and changed direction/topic, the manifest title is more current.
      const fileName = `${baseFileName(manifest.title || projectTitle)}.pptx`;
      await exportManifestAsPptx(manifest, fileName);
      setExportPptx({ status: "success", message: "تم التحميل" });
    } catch (error) {
      setExportPptx({
        status: "error",
        message: error instanceof Error ? error.message : "تعذر التصدير",
      });
    }
  };

  // HTML download — bundles all slides into one standalone .html file at
  // full 1920×1080 so the user can open it in a browser and screenshot.
  // No dom-to-pptx, no BiDi post-process; this is the raw rendered preview.
  const handleDownloadHtml = () => {
    if (exportHtml.status === "running") return;
    setExportHtml({ status: "running", message: "جارٍ التحميل..." });
    try {
      const fileName = `${baseFileName(manifest.title || projectTitle)}.html`;
      downloadHtmlDocument(manifest, fileName);
      setExportHtml({ status: "success", message: "تم التحميل" });
    } catch (error) {
      setExportHtml({
        status: "error",
        message: error instanceof Error ? error.message : "تعذر التحميل",
      });
    }
  };

  const handleSaveAsTemplate = async () => {
    if (saveTpl.status === "running") return;
    const trimmed = templateTitle.trim();
    if (!trimmed) {
      setSaveTpl({ status: "error", message: "أدخل اسماً للقالب" });
      return;
    }
    setSaveTpl({ status: "running", message: "جارٍ الحفظ..." });
    try {
      const response = await fetch(`/api/projects/${projectId}/save-as-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Save failed");
      }
      setSaveTpl({ status: "success", message: "تم الحفظ في مكتبة القوالب" });
      setShowSaveForm(false);
    } catch (error) {
      setSaveTpl({
        status: "error",
        message: error instanceof Error ? error.message : "تعذر الحفظ",
      });
    }
  };

  // Status toast under the toolbar. Download progress / "تم التحميل" are
  // intentionally NOT surfaced — the browser's own download UI is enough
  // signal that an export is in flight. Only ERRORS (for any action) and
  // the regen / save-template running + success states make it through.
  const visibleMessage =
    regen.status === "error" ? { text: regen.message, kind: "error" as const } :
    exportPptx.status === "error" ? { text: exportPptx.message, kind: "error" as const } :
    exportHtml.status === "error" ? { text: exportHtml.message, kind: "error" as const } :
    saveTpl.status === "error" ? { text: saveTpl.message, kind: "error" as const } :
    saveTpl.status === "running" ? { text: saveTpl.message, kind: "info" as const } :
    regen.status === "running" ? { text: regen.message, kind: "info" as const } :
    saveTpl.status === "success" ? { text: saveTpl.message, kind: "success" as const } :
    null;

  return (
    <div dir="ltr" className="flex flex-col items-center gap-3">
      {/* Apply Comments — detached glass cell that appears ABOVE the main
          toolbar when there are drafts AND the user hasn't armed yet.
          Hidden the moment `commentsArmed` flips true (after user clicks
          Apply): the regen button in the toolbar morphs to a check and
          becomes the trigger that actually fires the partial regen. */}
      <AnimatePresence initial={false}>
        {commentMode && draftCommentCount > 0 && !commentsArmed && !applying ? (
          <motion.div
            key="apply-cell-wrapper"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            // Tween with ease-out-quart: fast at the start, smooth slow at
            // the end, NO spring tail / wobble. Same curve on enter + exit
            // so the toolbar settling animation feels equally crisp both
            // directions.
            transition={{
              height: { duration: 0.32, ease: [0.16, 1, 0.3, 1] },
              opacity: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
            }}
            style={{ overflow: "hidden" }}
          >
            <motion.div
              // Pop-in via scale + fade only — no slide-from-bottom (the
              // toolbar's glass-card clipped the slide, made it look cut).
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="glass-card flex items-center justify-center rounded-2xl p-2"
            >
              <ToolButton
                icon="check"
                label={`تطبيق التعليقات (${draftCommentCount})`}
                active
                running={applying}
                onClick={onApplyComments}
                disabled={applying}
              />
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Toolbar column — Photoshop-style icon stack. All buttons share
          one neutral glass surface. */}
      <div
        className="glass-card flex flex-col items-center gap-1.5 rounded-2xl p-2"
      >
        {/* Regen button — gradient mesh visual. Two roles depending on
            state:
              - NOT armed: full-deck regenerate (autorenew icon, calls
                /regenerate). Disabled while in comment mode.
              - ARMED (apply was clicked): fires the partial regen for
                the drafted slides (check icon, calls /regenerate-partial).
            Icon morphs via a one-shot 360° rotation during the swap —
            sits still after. */}
        <ToolButton
          icon="autorenew"
          label={commentsArmed ? "تطبيق التعليقات على الشرائح" : "أعد التصميم"}
          gradient
          running={regen.status === "running"}
          onClick={commentsArmed ? onFirePartialRegen : handleRegenerate}
          // Comment mode disables full regen so we don't lose drafts to a
          // full-deck regen. While applying, the button itself is locked
          // (the slide-level overlay already signals "in flight").
          disabled={applying || (commentMode && !commentsArmed)}
          iconNode={
            // Rotation only during the icon swap (~0.5s). After the swap,
            // the icon sits still. Same direction both ways so the morph
            // reads as one continuous motion (sidebar burger ↔ close).
            <motion.div
              animate={{ rotate: commentsArmed ? 360 : 0 }}
              transition={{ rotate: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } }}
              className="flex h-[22px] w-[22px] items-center justify-center"
            >
              <AnimatePresence mode="wait" initial={false}>
                {commentsArmed ? (
                  <motion.span
                    key="check"
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.6 }}
                    transition={{ duration: 0.25 }}
                    className="material-symbols-outlined text-[22px]"
                  >
                    check
                  </motion.span>
                ) : (
                  <motion.span
                    key="autorenew"
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.6 }}
                    transition={{ duration: 0.25 }}
                    className="material-symbols-outlined text-[22px]"
                  >
                    autorenew
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.div>
          }
        />
        <ToolButton
          icon="comment"
          label={commentMode ? "إنهاء وضع التعليقات" : "إضافة تعليق"}
          onClick={onToggleCommentMode}
          active={commentMode}
          disabled={applying}
          countBadge={draftCommentCount}
        />
        <ToolButton
          icon="download"
          label="تصدير PPTX"
          running={exportPptx.status === "running"}
          onClick={handleExport}
          disabled={applying}
        />
        <ToolButton
          icon="code"
          label="تنزيل HTML"
          running={exportHtml.status === "running"}
          onClick={handleDownloadHtml}
          disabled={applying}
        />
        <ToolButton
          icon="picture_as_pdf"
          label="تصدير PDF"
          badge="قريباً"
          disabled
        />
        <ToolButton
          icon="bookmark_add"
          label="حفظ كقالب"
          running={saveTpl.status === "running"}
          onClick={() => setShowSaveForm((v) => !v)}
          disabled={applying}
        />
      </div>

      {/* Status toast below the toolbar */}
      {visibleMessage?.text ? (
        <div
          className={`rounded-lg px-3 py-1.5 text-xs ${
            visibleMessage.kind === "error"
              ? "bg-red-500/10 text-red-300"
              : visibleMessage.kind === "success"
                ? "bg-emerald-500/10 text-emerald-300"
                : "bg-white/5 text-muted"
          }`}
        >
          {visibleMessage.text}
        </div>
      ) : null}

      {/* Save-as-template popover — floats to the right of the toolbar */}
      {showSaveForm ? (
        <div
          dir="rtl"
          className="glass-card absolute z-40 flex items-center gap-2 rounded-xl p-3"
          style={{ left: "100%", top: 0, marginLeft: "12px", width: "320px" }}
        >
          <input
            type="text"
            value={templateTitle}
            onChange={(event) => setTemplateTitle(event.target.value)}
            placeholder="اسم القالب"
            className="input-dark flex-1"
          />
          <button
            type="button"
            onClick={handleSaveAsTemplate}
            disabled={saveTpl.status === "running"}
            className="btn-gradient px-4 py-2 text-sm disabled:opacity-60"
          >
            {saveTpl.status === "running" ? "..." : "حفظ"}
          </button>
          <button
            type="button"
            onClick={() => setShowSaveForm(false)}
            aria-label="إلغاء"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-white/10 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
