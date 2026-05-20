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
  iconFilled,
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
}) {
  const isDisabled = disabled || running;
  // Two coordinated visual transitions on hover:
  //   - icon: muted (white/60) → white
  //   - border: dim (white/15) → bright (white/40)
  // Idle = TRANSPARENT background (the toolbar sits on a `.glass-card`
  // surface; stacking another glass tint on top reads as a solid chip,
  // which is wrong — same rule as `.btn-pill` in globals.css). Active
  // raises the glass intensity as the sole state indicator (e.g.
  // commentMode on, isSaved). Gradient variant bypasses the glass
  // system — its visuals come from `.btn-gradient-anim`.
  const colorClasses = active
    ? "border-white/40 text-white"
    : "border-white/15 text-white/60 hover:border-white/40 hover:text-white";
  // Only paint a background when active. Inline because the alpha
  // multiplies the preset-linked --glass-opacity var. Idle = no bg
  // at all → fully transparent over the parent's .glass-card tint.
  const activeBg = active
    ? { background: "rgba(255, 255, 255, calc(var(--glass-opacity) * 2.6))" }
    : undefined;
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        disabled={isDisabled}
        aria-label={label}
        aria-pressed={active}
        // Non-gradient (glass) variant: bg via preset-linked alpha
        // (inline because `activeBg` is computed per-button-state),
        // blur via Tailwind `backdrop-blur-glass` utility (memory:
        // feedback_tw_glass_system — raw `backdrop-filter:` loses
        // to Tailwind's compositional rule). Idle leaves bg unset
        // so the parent .glass-card tint shows through unobstructed.
        style={gradient ? undefined : activeBg}
        className={
          gradient
            ? `btn-gradient-anim relative flex h-11 w-11 items-center justify-center rounded-xl transition-shadow ${
                isDisabled ? "" : "hover:scale-[1.02]"
              }`
            : `backdrop-blur-glass backdrop-saturate-(--glass-saturation) relative flex h-11 w-11 items-center justify-center rounded-xl border transition-colors ${colorClasses} ${
                isDisabled ? "opacity-40" : ""
              }`
        }
      >
        {iconNode ? (
          iconNode
        ) : running ? (
          <span className="spinner h-4 w-4 rounded-full border-2 border-white/20 border-t-white" />
        ) : (
          <span
            className="material-symbols-outlined text-[22px]"
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
          <span className="absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-semibold leading-none text-white shadow">
            {countBadge}
          </span>
        ) : null}
      </button>
      {/* Tooltip — appears to the right of the toolbar (toward content).
          `dir="auto"` so the FIRST strong directional character of
          the label drives reading direction. Without it the tooltip
          inherits the toolbar wrapper's outer dir="ltr" (chosen so
          the icon stack centres correctly), and Arabic labels like
          "تصدير PPTX" render bidi-flipped — Arabic glyph order
          stays correct (Unicode BiDi handles it) but the inline
          "PPTX" lands on the wrong side of the Arabic word. With
          dir="auto" the tooltip reads RTL for Arabic labels and LTR
          for any pure-Latin label, no per-button decision needed. */}
      <div
        dir="auto"
        className="pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-black/90 px-3 py-1.5 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
        style={{ left: "100%", marginLeft: "12px" }}
      >
        {label}
        {badge ? <span className="badge-purple ms-2">{badge}</span> : null}
      </div>
    </div>
  );
}

// Hairline separator between toolbar categories. Full-width 1 px
// line at white/12 alpha with vertical breathing room — earlier
// w-7 / my-0.5 / white/8 read as "did this divider exist?" against
// the glass card. Now sits at my-2 (8 px top + bottom) and spans
// the toolbar's inner width so the category boundary is
// unambiguous.
function ToolbarDivider() {
  return (
    <div
      aria-hidden
      className="my-2 h-px w-full bg-white/[0.12]"
    />
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
  const [exportPng, setExportPng] = useState<ButtonState>({ status: "idle" });
  const [exportPdf, setExportPdf] = useState<ButtonState>({ status: "idle" });
  // Shared "any export running" flag. Each export individually
  // guards its own status, but without a shared flag the user can
  // click PPTX → PDF → PNG → HTML in quick succession and spin up
  // four parallel Puppeteer / dom-to-pptx pipelines at once
  // (CPU + memory spike, all exports get slower / less reliable).
  // Disabling the whole export group while any single export runs
  // serialises the work cleanly.
  const exportBusy =
    exportPptx.status === "running" ||
    exportHtml.status === "running" ||
    exportPng.status === "running" ||
    exportPdf.status === "running";
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
    if (exportBusy) return;
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

  // PDF export — server-side, sync. POST /api/projects/[id]/export/pdf
  // returns a multi-page PDF rendered by Puppeteer's `page.pdf()`.
  // Page size is driven by the @page CSS rule emitted by
  // buildHtmlDocumentServer({ printPageBreaks: true }) so the PDF
  // pages match the canvas dimensions exactly (landscape 1920×1080
  // for 16:9, portrait 1080×1920 for 9:16). Same UX as PNG: button
  // spins, blob downloads, no toast on success.
  const handleExportPdf = async () => {
    // Shared `exportBusy` check (not just exportPdf) so another
    // export already in flight blocks this one too — prevents
    // multi-Puppeteer concurrent runs.
    if (exportBusy) return;
    setExportPdf({ status: "running", message: "جارٍ تصدير PDF..." });
    try {
      const response = await fetch(`/api/projects/${projectId}/export/pdf`, {
        method: "POST",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? "PDF export failed");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${baseFileName(manifest.title || projectTitle)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportPdf({ status: "idle" });
    } catch (error) {
      setExportPdf({
        status: "error",
        message: error instanceof Error ? error.message : "تعذر تصدير PDF",
      });
    }
  };

  // PNG export — server-side, sync. POST /api/projects/[id]/export/png
  // returns a ZIP of canvas-native PNGs (1920×1080 / 1080×1920) rendered
  // by Puppeteer + the same JSDOM-backed HTML builder the thumbnail
  // pipeline uses. The endpoint streams the ZIP back as a single blob
  // (~3-10s for 5-25 slides); the button just spins for the duration
  // and no toast surfaces — the browser's own download UI is the
  // success signal, matching the PPTX + HTML buttons' pattern.
  const handleExportPng = async () => {
    if (exportBusy) return;
    setExportPng({ status: "running", message: "جارٍ تصدير الصور..." });
    try {
      const response = await fetch(`/api/projects/${projectId}/export/png`, {
        method: "POST",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? "PNG export failed");
      }
      // Stream the blob into a download. Same anchor-click trick the
      // dom-to-pptx export uses (`saveAs` from file-saver wraps this
      // internally); inlined here since we only need it for the ZIP
      // and don't want to pull file-saver as a dep just for that.
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${baseFileName(manifest.title || projectTitle)}-pngs.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Defer revoke so Safari's download flow has a tick to read
      // the blob URL — premature revoke aborts the download in some
      // browsers. 1 s is conservative; the download has long latched
      // onto the blob by then.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportPng({ status: "idle" });
    } catch (error) {
      setExportPng({
        status: "error",
        message: error instanceof Error ? error.message : "تعذر تصدير الصور",
      });
    }
  };

  // HTML download — bundles all slides into one standalone .html file at
  // the manifest's canvas dimensions (1920×1080 for 16:9, 1080×1920 for
  // 9:16) so the user can open it in a browser and screenshot. No
  // dom-to-pptx, no BiDi post-process; this is the raw rendered preview.
  const handleDownloadHtml = () => {
    if (exportBusy) return;
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
    exportPng.status === "error" ? { text: exportPng.message, kind: "error" as const } :
    exportPdf.status === "error" ? { text: exportPdf.message, kind: "error" as const } :
    saveTpl.status === "error" ? { text: saveTpl.message, kind: "error" as const } :
    saveProject.status === "error" ? { text: saveProject.message, kind: "error" as const } :
    saveTpl.status === "running" ? { text: saveTpl.message, kind: "info" as const } :
    regen.status === "running" ? { text: regen.message, kind: "info" as const } :
    saveTpl.status === "success" ? { text: saveTpl.message, kind: "success" as const } :
    null;

  return (
    <div dir="ltr" className="flex flex-col items-center gap-3">
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
        className="glass-card flex flex-col items-center gap-1.5 rounded-2xl p-2"
      >
        {/* ── Category 1: AI / Edit ─────────────────────────────── */}
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
        {/* AI-pair styling — Regen above + Comment here both run the
            `.btn-gradient-anim` ring so the user reads them as a
            single AI family. The `assistant` icon (speech bubble +
            sparkles) reinforces the system: assistant captures
            intent → auto_awesome applies it.
            Active state (commentMode on) is signalled by swapping
            the icon to its FILLED Material Symbols variant
            (outlined → solid bubble+sparkles). Under .btn-gradient-
            anim the raised-bg active style is suppressed by the
            gradient ring, so a SHAPE-level cue is the cleanest way
            to show "I'm engaged" without competing with the animated
            mesh-gradient. The font URL in layout.tsx loads
            FILL@0..1 so the toggle is a no-extra-network swap. */}
        <ToolButton
          icon="assistant"
          label={commentMode ? "إنهاء وضع التعليقات" : "إضافة تعليق"}
          gradient
          iconFilled={commentMode}
          onClick={onToggleCommentMode}
          active={commentMode}
          disabled={applying}
          countBadge={draftCommentCount}
        />

        <ToolbarDivider />

        {/* ── Category 2: Persistence ───────────────────────────── */}
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
          icon="bookmark_add"
          label="حفظ كقالب"
          running={saveTpl.status === "running"}
          onClick={() => setShowSaveForm((v) => !v)}
          disabled={applying}
        />

        <ToolbarDivider />

        {/* ── Category 3: Export ────────────────────────────────── */}
        {/* Tooltip wording unified — every export reads "تصدير X"
            and the order is PPTX → PDF → PNG → HTML (locked
            2026-05-21). PDF currently disabled with "قريباً"
            badge until step E lands. HTML was historically
            labelled "تنزيل HTML" — renamed to "تصدير HTML" so the
            export category reads as a single family. */}
        <ToolButton
          icon="download"
          label="تصدير PPTX"
          running={exportPptx.status === "running"}
          onClick={handleExport}
          disabled={applying || exportBusy}
        />
        <ToolButton
          icon="picture_as_pdf"
          label="تصدير PDF"
          running={exportPdf.status === "running"}
          onClick={handleExportPdf}
          disabled={applying || exportBusy}
        />
        <ToolButton
          icon="image"
          label="تصدير PNG"
          running={exportPng.status === "running"}
          onClick={handleExportPng}
          disabled={applying || exportBusy}
        />
        <ToolButton
          icon="code"
          label="تصدير HTML"
          running={exportHtml.status === "running"}
          onClick={handleDownloadHtml}
          disabled={applying || exportBusy}
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
