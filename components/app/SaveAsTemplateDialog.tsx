"use client";

// Modal for the "Save copy as template" action.
//
// Mirrors the Bell-modal visual pattern (AllNotificationsModal) so the
// dialog feels native to the app:
//   • dim overlay sibling (motion fade) — NO backdrop-filter on this one
//   • surface-popover panel sibling — fixed-positioned, NOT animated, so
//     backdrop-filter actually blurs the page beneath it (any animated
//     transform/opacity ancestor would trap the filter in a stacking
//     context and the blur would silently disappear)
//   • btn-pill footer buttons (same family as the bell's "مسح الكل" /
//     "عرض الكل") — pill-shaped, transparent bg, white-on-hover
//
// Lifecycle on open=true:
//   1. Mount → fetch /api/projects/[id]/template-preview to get the
//      BrandSnapshot.
//   2. Inject the brand's webfont URLs into <head> as <link> tags so
//      the live preview renders in the actual brand fonts.
//   3. Render: preview card (a generic heading-font sample on the brand
//      background) + isPublic toggle + Cancel/Save footer.
//   4. Save → POST /api/projects/[id]/save-as-template with { isPublic }.
//      Templates are UNTITLED — the user does not name them and no
//      project-derived title is stored, so the public feed stays free
//      of "Q4 Pitch — Client X"-style private names.
//   5. onSaved(templateId) fires; the modal closes itself first.
//
// Failure handling:
//   • Preview fetch fails → modal shows an inline error in place of
//     the preview, Save stays disabled.
//   • Save fails → toast-style inline error above the buttons, modal
//     stays open so the user can retry or cancel.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Toggle } from "@/components/create/controls";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";
import type { BrandSnapshot } from "@/lib/template/derive-brand";

type PreviewResponse = {
  brand: BrandSnapshot;
};

export function SaveAsTemplateDialog({
  open,
  projectId,
  onCancel,
  onSaved,
}: {
  open: boolean;
  projectId: string | null;
  onCancel: () => void;
  // Fired after a successful save. Receives the new template id so the
  // parent can toast or route. The modal closes itself before calling
  // this — onSaved should not call onCancel.
  onSaved: (templateId: string) => void;
}) {
  const dict = useDict();
  const { dir } = useLocale();
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Default OFF — a template is private unless the user explicitly asks to
  // publish it. Turning it on submits a request that an admin must approve
  // before the template appears in the community feed (reviewStatus=PENDING).
  const [isPublic, setIsPublic] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Next router — used to refresh SSR templates queries on successful
  // save so the new template tile appears in /templates + dashboard
  // widget immediately, without a manual reload.
  const router = useRouter();

  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open && !!projectId);

  // Body-scroll lock while open — matches AllNotificationsModal so the
  // page behind the modal doesn't scroll under the user's pointer
  // when they're interacting with the dialog.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Reset internal state every time the modal opens for a new project.
  // Without this, switching from A to B would leak A's preview into B.
  useEffect(() => {
    if (!open || !projectId) return;
    /* eslint-disable react-hooks/set-state-in-effect -- canonical "reset modal-local state on prop change" shape */
    setPreview(null);
    setPreviewError(null);
    // Reset to the SAME default the initial useState uses — `false`
    // (private). The toggle is an opt-in request to publish for review.
    setIsPublic(false);
    setSaveError(null);
    /* eslint-enable react-hooks/set-state-in-effect */

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/template-preview`,
          { credentials: "same-origin" },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          if (!cancelled) {
            setPreviewError(body.error ?? dict.dialogs.saveTemplate.errLoadPreview);
          }
          return;
        }
        const data = (await res.json()) as PreviewResponse;
        if (cancelled) return;
        setPreview(data);
      } catch {
        if (!cancelled) setPreviewError(dict.dialogs.saveTemplate.errLoadPreview);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId, dict]);

  // Inject brand webfonts so the live preview renders in the actual
  // brand fonts. Idempotent — same href twice produces one link tag.
  // Links intentionally persist after unmount (browser caches the
  // file anyway; re-opening is instant).
  useEffect(() => {
    if (!preview) return;
    const urls = uniqueFontUrls(preview.brand);
    for (const url of urls) {
      if (document.querySelector(`link[data-tpl-font="${url}"]`)) continue;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      link.crossOrigin = "anonymous";
      link.dataset.tplFont = url;
      document.head.appendChild(link);
    }
  }, [preview]);

  // Esc closes (but not while saving — closing mid-request would
  // dismiss the spinner without aborting the POST, leaving the user
  // without feedback when the response lands).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, saving, onCancel]);

  const canSave = !saving && !!preview;

  const handleSubmit = useCallback(async () => {
    if (!projectId || !canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/save-as-template`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          // Templates are untitled — the client only sends the
          // visibility toggle here (see route.ts docstring).
          body: JSON.stringify({ isPublic }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: true;
        templateId?: string;
        error?: string;
      };
      if (!res.ok || !body.ok || !body.templateId) {
        setSaveError(body.error ?? dict.dialogs.saveTemplate.errSave);
        return;
      }
      // Re-run the parent's server component before notifying the
      // caller. Without this, /templates + dashboard widget keep
      // their pre-save SSR fetch results and the new template tile
      // doesn't appear until the user navigates / reloads. Templates'
      // thumbnails come in via the pending-refresh hook on the next
      // SSR tick.
      router.refresh();
      onSaved(body.templateId);
    } catch {
      setSaveError(dict.dialogs.saveTemplate.errSave);
    } finally {
      setSaving(false);
    }
  }, [projectId, canSave, isPublic, onSaved, router, dict]);

  if (typeof window === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && projectId ? (
        <>
          {/* Dim overlay — sibling, fade animated. Uses .modal-dim so
              the page-darkening comes from a backdrop-filter brightness
              instead of a near-opaque background; without that fix the
              panel's own backdrop-blur sampled a solid dark layer and
              the blur effect was invisible. See globals.css `.modal-dim`. */}
          <motion.div
            key="save-tpl-dim"
            onClick={() => {
              if (!saving) onCancel();
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="modal-dim fixed inset-0 z-[1000]"
          />
          {/* Panel wrapper — motion.div so AnimatePresence tracks
              its enter/exit lifecycle and the panel fades with the
              dim instead of disappearing instantly. At steady state
              (opacity=1) there's no stacking context, so the panel's
              backdrop-filter still samples the dim+page correctly.
              See TemplateLightbox for the full reasoning. */}
          <motion.div
            key="save-tpl-wrapper"
            // Entry intentionally instant (initial=1) so the panel's
            // backdrop-blur is present from the first frame. Animating
            // opacity 0→1 on this wrapper would trap the panel's
            // backdrop-filter in a stacking context during the
            // transition — the blur would visibly stagger in after
            // ~180 ms. Exit fade stays so click-outside / Esc has a
            // smooth dismiss. See TemplateLightbox for full reasoning.
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="pointer-events-none fixed inset-0 z-[1001] flex items-center justify-center p-4"
          >
            <div
              ref={panelRef}
              dir={dir}
              role="dialog"
              aria-modal="true"
              aria-labelledby="save-tpl-title"
              onClick={(e) => e.stopPropagation()}
              // Width + max-height mirror AllNotificationsModal byte-
              // for-byte so the two modals read as the same artefact.
              className="surface-modal pointer-events-auto flex w-[min(100vw-24px,560px)] max-h-[min(85vh,720px)] flex-col overflow-hidden rounded-2xl"
            >
              {/* Header — title + close X, exactly the BellModal shape
                  (items-center; single-line title; no descriptive
                  paragraph). The "what does this do" copy lives in
                  the body instead — keeps the header reading like a
                  toolbar, not a wall of explanation. */}
              <header className="flex items-center justify-between gap-3 border-b border-foreground/[0.08] px-5 py-4">
                <h2
                  id="save-tpl-title"
                  className="text-base font-semibold text-foreground"
                >
                  {dict.dialogs.saveTemplate.title}
                </h2>
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={saving}
                  aria-label={dict.common.close}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground disabled:opacity-50"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </header>

              {/* Body — flex-1 so the panel expands to its max-h cap
                  when content allows, scrolls if it overflows. Same
                  shape AllNotificationsModal uses for its list. */}
              <div className="flex-1 overflow-y-auto px-5 py-5">
                {/* One-line context note — replaces the long header
                    description so the header stays compact. */}
                <p className="mb-4 text-xs text-foreground/50 leading-relaxed">
                  {dict.dialogs.saveTemplate.description}
                </p>
                <BrandPreview preview={preview} error={previewError} />

                {/* isPublic toggle */}
                <div className="mt-5 flex items-start gap-3">
                  <Toggle
                    value={isPublic}
                    onChange={setIsPublic}
                    disabled={saving || !preview}
                    ariaLabel={dict.dialogs.saveTemplate.shareCommunity}
                  />
                  <div className="flex-1 select-none">
                    <div className="text-sm font-medium text-foreground">
                      {dict.dialogs.saveTemplate.shareCommunity}
                    </div>
                    <div className="text-xs text-foreground/50 mt-0.5 leading-relaxed">
                      {dict.dialogs.saveTemplate.shareCommunityDesc}
                    </div>
                  </div>
                </div>

                {saveError ? (
                  <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                    {saveError}
                  </div>
                ) : null}
              </div>

              {/* Footer — btn-pill duo, same family as BellModal's
                  "مسح الكل". Both pills carry equal visual weight; Save
                  conveys primacy via copy + placement, not a different
                  button style — matches the rest of the glass system. */}
              <footer className="flex items-center justify-end gap-2 border-t border-foreground/[0.08] px-4 py-3">
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={saving}
                  className="btn-pill"
                >
                  {dict.common.cancel}
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSave}
                  className="btn-pill"
                >
                  {saving ? dict.dialogs.saveTemplate.saving : dict.dialogs.saveTemplate.save}
                </button>
              </footer>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

// ─── Preview sub-component ────────────────────────────────────────────

function BrandPreview({
  preview,
  error,
}: {
  preview: PreviewResponse | null;
  error: string | null;
}) {
  const dict = useDict();
  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
        {error}
      </div>
    );
  }
  // ALWAYS render the same card shell — padding, border-radius, and
  // `min-h` are identical between the loading skeleton and the loaded
  // state. The modal panel therefore keeps the same height across
  // the lifecycle and there's no layout reflow when the fetch lands.
  // Background fades from a neutral glass tint to the brand's actual
  // chrome via `transition-colors`, smoothing the swap further.
  const loaded = preview !== null;
  const shellStyle: React.CSSProperties = loaded
    ? {
        background: preview.brand.background,
        color: preview.brand.text,
        border: `1px solid color-mix(in srgb, ${preview.brand.text} 12%, transparent)`,
      }
    : {
        background: "var(--tq-overlay-soft)",
        border: "1px solid var(--tq-border-hairline)",
      };

  return (
    <div
      className="rounded-xl px-5 py-6 min-h-[156px] transition-colors duration-200"
      style={shellStyle}
    >
      {loaded ? (
        <>
          {/* Templates are untitled — this big line is purely a heading-
              font sample (a generic, language-aware phrase) so the user
              still judges the typography at display size. */}
          <div
            style={{
              fontFamily: `"${preview.brand.fontHeading.name}", system-ui, sans-serif`,
              fontSize: 32,
              fontWeight: 700,
              lineHeight: 1.1,
            }}
          >
            {preview.brand.language === "ar" ? dict.dialogs.saveTemplate.headingLabel : "Heading"}
          </div>
          <div
            style={{
              fontFamily: `"${preview.brand.fontBody.name}", system-ui, sans-serif`,
              fontSize: 13,
              opacity: 0.6,
              marginTop: 8,
            }}
          >
            {preview.brand.fontHeading.name} · {preview.brand.fontBody.name} ·{" "}
            {preview.brand.language === "ar" ? dict.dialogs.saveTemplate.langArabic : "English"} · {preview.brand.format}
          </div>
          <div className="mt-5 flex gap-2">
            {preview.brand.palette.map((hex, i) => (
              <div
                // Index in the key: extracted palettes can repeat a hex
                // (two #FFFFFF swatches crashed the keying, 2026-06-12).
                key={`${hex}-${i}`}
                title={hex.toUpperCase()}
                style={{
                  background: hex,
                  width: 32,
                  height: 32,
                  borderRadius: 9,
                  boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${preview.brand.text} 18%, transparent)`,
                }}
              />
            ))}
          </div>
        </>
      ) : (
        // Skeleton — placeholder rectangles that mirror each piece of
        // real content's footprint: a wide heading line, a narrower
        // subtitle line, and a row of 4 palette swatches. Sizes match
        // the loaded values byte-for-byte so the moment data arrives
        // nothing nudges.
        <div className="animate-pulse">
          <div className="h-[35px] w-2/3 rounded bg-foreground/[0.05]" />
          <div className="mt-2 h-[14px] w-1/2 rounded bg-foreground/[0.05]" />
          <div className="mt-5 flex gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-[9px] bg-foreground/[0.05]"
                style={{ width: 32, height: 32 }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function uniqueFontUrls(brand: BrandSnapshot): string[] {
  const urls: string[] = [];
  if (brand.fontHeading.url) urls.push(brand.fontHeading.url);
  if (brand.fontBody.url && brand.fontBody.url !== brand.fontHeading.url) {
    urls.push(brand.fontBody.url);
  }
  return urls;
}
