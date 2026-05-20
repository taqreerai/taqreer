"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import type { SlideManifest, SlideFormat } from "@/lib/schema/slide";
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
  // Optional custom icon node — overrides the material-symbols icon
  // when provided. Reserved for future use; the morph that used it
  // was removed in step 2b.
  iconNode?: React.ReactNode;
  label: string;
  badge?: string;
  // Small numeric badge in the top-end corner. Used for the comment toggle
  // to show how many draft comments live across the deck.
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
        {/* Count badge — top-end corner. Clear sky blue (Tailwind
            blue-500) so it reads as an unmistakable "info" indicator.
            Brand `--tq-blue` is violet-leaning and was repeatedly
            flagged as not reading as blue at this badge size. */}
        {countBadge && countBadge > 0 ? (
          <span className="absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-semibold leading-none text-white shadow">
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
  commentsArmed,
  onFirePartialRegen,
  applying,
  formatFallback,
  currentVersionId,
  isSaved,
  onSaved,
}: {
  projectId: string;
  projectTitle: string;
  manifest: SlideManifest;
  // Comment-mode state — owned by DeckView. Apply lives inside the
  // CommentsPanel footer and just exits commentMode (drafts persist
  // as drafts). When drafts exist + commentMode is off, the regen
  // button morphs to the AI icon and fires the partial regen.
  commentMode: boolean;
  onToggleCommentMode: () => void;
  draftCommentCount: number;
  // True when there are unsent drafts ready to be fired. Drives the
  // autorenew → auto_awesome icon morph + swaps the click handler
  // from full regen to partial regen.
  commentsArmed: boolean;
  onFirePartialRegen: () => void;
  // Partial regen in flight. Locks the toolbar buttons so the user
  // can't kick off a second job while one is running.
  applying: boolean;
  // Format fallback when `manifest.format` is missing — used by export
  // helpers so legacy 9:16 manifests (saved before deck-generate.ts
  // started stamping `format`) export at the correct aspect ratio.
  // DeckView passes the project-level `Project.format` here.
  formatFallback?: SlideFormat;
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
}) {
  const router = useRouter();
  const [regen, setRegen] = useState<ButtonState>({ status: "idle" });
  const [exportPptx, setExportPptx] = useState<ButtonState>({ status: "idle" });
  const [exportHtml, setExportHtml] = useState<ButtonState>({ status: "idle" });
  const [saveTpl, setSaveTpl] = useState<ButtonState>({ status: "idle" });
  const [saveProject, setSaveProject] = useState<ButtonState>({ status: "idle" });

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
      setSaveProject({ status: "error", message: "لا يوجد إصدار للحفظ" });
      return;
    }
    setSaveProject({ status: "running", message: "جارٍ حفظ المشروع..." });
    try {
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
      setSaveProject({ status: "success", message: "تم حفظ المشروع" });
    } catch (error) {
      setSaveProject({
        status: "error",
        message: error instanceof Error ? error.message : "تعذر حفظ المشروع",
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
      // Back-fill format from the project-level fallback for legacy
      // manifests whose `format` field wasn't stamped at generation
      // time. Without this, exportManifestAsPptx falls through to the
      // 16:9 default and a 9:16 deck exports as a landscape PPT.
      const exportManifest = {
        ...manifest,
        format: manifest.format ?? formatFallback ?? "16:9",
      };
      await exportManifestAsPptx(exportManifest, fileName);
      setExportPptx({ status: "idle" });
    } catch (error) {
      setExportPptx({
        status: "error",
        message: error instanceof Error ? error.message : "تعذر التصدير",
      });
    }
  };

  // HTML download — bundles all slides into one standalone .html file at
  // the manifest's canvas dimensions (1920×1080 for 16:9, 1080×1920 for
  // 9:16) so the user can open it in a browser and screenshot. No
  // dom-to-pptx, no BiDi post-process; this is the raw rendered preview.
  const handleDownloadHtml = () => {
    if (exportHtml.status === "running") return;
    setExportHtml({ status: "running", message: "جارٍ التحميل..." });
    try {
      const fileName = `${baseFileName(manifest.title || projectTitle)}.html`;
      const exportManifest = {
        ...manifest,
        format: manifest.format ?? formatFallback ?? "16:9",
      };
      downloadHtmlDocument(exportManifest, fileName);
      setExportHtml({ status: "idle" });
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

  // Status toast under the toolbar. Export download progress + success
  // are intentionally NOT surfaced — the browser's own download UI is
  // enough signal that an export is in flight, and exports settle back
  // to "idle" once the file is dispatched. Only ERRORS (for any action)
  // and the regen / save-template running + success states make it through.
  // Save Project never surfaces running / success in the toast — the
  // button's spinner + save→check icon morph is enough signal on its
  // own; the extra toast read as noise. Errors still bubble up so the
  // user sees auth / 4xx failures.
  const visibleMessage =
    regen.status === "error" ? { text: regen.message, kind: "error" as const } :
    exportPptx.status === "error" ? { text: exportPptx.message, kind: "error" as const } :
    exportHtml.status === "error" ? { text: exportHtml.message, kind: "error" as const } :
    saveTpl.status === "error" ? { text: saveTpl.message, kind: "error" as const } :
    saveProject.status === "error" ? { text: saveProject.message, kind: "error" as const } :
    saveTpl.status === "running" ? { text: saveTpl.message, kind: "info" as const } :
    regen.status === "running" ? { text: regen.message, kind: "info" as const } :
    saveTpl.status === "success" ? { text: saveTpl.message, kind: "success" as const } :
    null;

  return (
    <div dir="ltr" className="flex flex-col items-center gap-3">
      {/* Toolbar column — Photoshop-style icon stack. All buttons share
          one neutral glass surface. */}
      <div
        className="glass-card flex flex-col items-center gap-1.5 rounded-2xl p-2"
      >
        {/* Regen button — two roles depending on state:
              • Idle / no drafts: full-deck regenerate (autorenew).
              • Armed (drafts exist + commentMode off): partial regen
                on drafted slides (auto_awesome — the AI sparkles).
            Disabled while in comment mode (user is still authoring)
            and while a partial regen is already in flight. Icon
            morphs via a 360° rotation + crossfade on the same axis. */}
        <ToolButton
          icon={commentsArmed ? "auto_awesome" : "autorenew"}
          label={commentsArmed ? "تطبيق التعليقات على الشرائح" : "أعد التصميم"}
          gradient
          running={regen.status === "running"}
          onClick={commentsArmed ? onFirePartialRegen : handleRegenerate}
          disabled={applying || commentMode}
          iconNode={
            <motion.div
              animate={{ rotate: commentsArmed ? 360 : 0 }}
              transition={{ rotate: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } }}
              className="flex h-[22px] w-[22px] items-center justify-center"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={commentsArmed ? "armed" : "idle"}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  transition={{ duration: 0.25 }}
                  className="material-symbols-outlined text-[22px]"
                >
                  {commentsArmed ? "auto_awesome" : "autorenew"}
                </motion.span>
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
        {/* Save Project — pins the canonical version. Icon morphs
            save → check once the current version matches
            savedVersionId. `active` brightens the glass when saved
            so the state reads at a glance, without breaking the
            toolbar's neutral-glass language. Re-clicking when
            already saved still hits the API (idempotent) so the
            button feels responsive on every click. */}
        <ToolButton
          icon={isSaved ? "check" : "save"}
          label={isSaved ? "محفوظ" : "حفظ المشروع"}
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
                className="material-symbols-outlined text-[22px]"
              >
                {isSaved ? "check" : "save"}
              </motion.span>
            </AnimatePresence>
          }
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
