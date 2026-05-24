"use client";

// Share + Export modal — opened from a project tile's 3-dots menu OR
// from the preview toolbar's Share button.
//
// Two-tab layout (locked 2026-05-23 per user sketch):
//
//   Share  →  invite-by-email + people list. The role chip on the
//             invite bar (AccessChipDropdown) is the SAME control
//             used per-row to change an existing invitee's role.
//             View / Comment / Edit roles. No public-access pill
//             picker — public link is always view-only.
//   Export →  same four export pipelines the preview toolbar exposes
//             (PPTX / PDF / HTML / PNGs). The modal consumes the
//             `useExportActions` hook so both surfaces run the same
//             handlers / serialise via the same `busy` flag.
//             LinkedIn share button at the bottom of this tab.
//
// Constant footer (both tabs): copy-link button. The link goes to
// `/project/[id]` and is gated server-side as view-only for
// non-owners (Phase 15.E).
//
// Frame: copies `SaveAsTemplateDialog` byte-for-byte (sibling
// overlay+panel pattern, glass-popover surface, Esc + body-scroll
// lock, btn-pill footer). Only the BODY content + tab strip differ.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import type { SlideManifest, SlideFormat } from "@/lib/schema/slide";
import {
  AccessChipDropdown,
  type AccessRole,
} from "@/components/app/AccessChipDropdown";
import { useExportActions } from "@/lib/preview/use-export-actions";
import { Avatar } from "@/components/common/Avatar";

type ShareRow = {
  id: string;
  email: string;
  accessLevel: AccessRole;
  invitedAt: string;
  acceptedAt: string | null;
  userId: string | null;
  // Joined User row, present once the invitee has accepted. The
  // modal swaps the pending row's "invited email + بانتظار القبول"
  // for the accepted user's real name + login email. `image` is the
  // Google OAuth photo URL (null for email/password signups — the
  // Avatar atom falls back to a deterministic gradient + initial).
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  } | null;
};

type ShareOwner = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
};

type ShareState = {
  publicAccessLevel: AccessRole | null;
  hideBrandingBadge: boolean;
  user: ShareOwner;
  shares: ShareRow[];
};

export type ShareDialogTab = "share" | "export";

export function ShareDialog({
  open,
  projectId,
  projectTitle,
  initialTab = "share",
  // Optional manifest/format passed when the modal is opened from
  // the editor (where they're already loaded). When opened from a
  // tile in /projects we don't have the manifest yet — the Export
  // tab disables its buttons until manifest is available.
  manifest,
  formatFallback,
  // When false, the Export tab + its TabPill are not rendered at all
  // and the modal is share-only. Used by the editor toolbar where
  // there's already a dedicated set of export buttons on the toolbox
  // (the share+export combo there was redundant). Tile-launched
  // invocations keep the default `true` because the modal is the
  // only export path from /projects. Added 2026-05-24.
  showExportTab = true,
  onClose,
}: {
  open: boolean;
  projectId: string | null;
  projectTitle: string;
  initialTab?: ShareDialogTab;
  manifest?: SlideManifest;
  formatFallback?: SlideFormat;
  showExportTab?: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<ShareDialogTab>(initialTab);
  const [state, setState] = useState<ShareState | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Tab content height — measured per tab via ResizeObserver so the
  // body wrapper can animate height between them with framer-motion
  // (browsers can't transition `auto`, but framer can animate to
  // numeric values smoothly). Both tabs are kept mounted (inactive
  // one absolute-positioned, top-anchored), so both heights are
  // continuously known. activeHeight is the value framer animates to.
  const shareRef = useRef<HTMLDivElement | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const [shareHeight, setShareHeight] = useState<number | null>(null);
  const [exportHeight, setExportHeight] = useState<number | null>(null);

  // Lazy-loaded manifest + format for the Export tab, used when the
  // modal is opened from outside the editor (project tile 3-dots).
  // Inside the editor the parent passes `manifest` + `formatFallback`
  // directly, so we skip the fetch. From the tile we need both for
  // the client-side PPTX + HTML exports (PDF/PNG only need projectId
  // but we keep the gating simple — all four work or none do).
  const [fetchedManifest, setFetchedManifest] = useState<
    SlideManifest | null
  >(null);
  const [fetchedFormat, setFetchedFormat] = useState<
    SlideFormat | undefined
  >(undefined);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const effectiveManifest = manifest ?? fetchedManifest;
  const effectiveFormat = formatFallback ?? fetchedFormat;

  // Per-action busy flags so a slow PATCH on a single row doesn't grey
  // out the whole panel — only the in-flight control.
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState<boolean>(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // Add-invitee form state. Role defaults to `view` — the safer pick.
  const [inviteEmail, setInviteEmail] = useState<string>("");
  const [inviteRole, setInviteRole] = useState<AccessRole>("view");

  // Body-scroll lock while open — same recipe SaveAsTemplateDialog uses.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Tracks the LAST projectId we hydrated state for. Used to decide
  // whether the open-time reset below clears `state` to null. If the
  // user re-opens the modal for the SAME project the previously
  // fetched state is reusable; clearing it would force the modal to
  // re-render at the "just invite form" height while the fetch flies,
  // and the motion.div would animate from the previous settled height
  // DOWN to the empty height and then BACK UP — user reads that as a
  // collapse-then-expand glitch (measured h=275 → 192 → 275 with the
  // identical payload). Reported 2026-05-24, observed via DOM
  // sampling during open.
  const lastHydratedProjectIdRef = useRef<string | null>(null);

  // Reset internal state on every open for a NEW project so state
  // from project A doesn't bleed into project B. Skips the reset
  // when reopening the same project — the previous open's state
  // (owner pill, invitees) stays mounted so the height transition
  // is a no-op.
  useEffect(() => {
    if (!open || !projectId) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    const projectChanged = lastHydratedProjectIdRef.current !== projectId;
    if (projectChanged) {
      setState(null);
    }
    setFetchError(null);
    setInviteEmail("");
    setInviteRole("view");
    setInviteError(null);
    setCopied(false);
    // When export tab is hidden, force "share" — `initialTab="export"`
    // would otherwise leave the modal on a tab that's not rendered.
    setTab(showExportTab ? initialTab : "share");
    setFetchedManifest(null);
    setFetchedFormat(undefined);
    setManifestError(null);
    /* eslint-enable react-hooks/set-state-in-effect */

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/share`,
          { credentials: "same-origin" },
        );
        if (!res.ok) {
          if (!cancelled) {
            setFetchError("تعذر تحميل إعدادات المشاركة");
          }
          return;
        }
        const data = (await res.json()) as ShareState;
        if (cancelled) return;
        setState(data);
        lastHydratedProjectIdRef.current = projectId;
      } catch {
        if (!cancelled) setFetchError("تعذر تحميل إعدادات المشاركة");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId, initialTab, showExportTab]);

  // Lazy-fetch the deck manifest when the modal opens without one
  // (i.e. opened from a project tile rather than the editor). The
  // Export tab needs the manifest in the client for the PPTX +
  // HTML pipelines. Skipped when the parent already provided it,
  // OR when the Export tab is hidden — no consumer downstream so
  // the round-trip would be wasted bandwidth.
  useEffect(() => {
    if (!open || !projectId || manifest || !showExportTab) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/manifest`,
          { credentials: "same-origin" },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          if (!cancelled) {
            setManifestError(body.error ?? "تعذر تحميل المشروع");
          }
          return;
        }
        const data = (await res.json()) as {
          manifest: SlideManifest;
          format: SlideFormat | null;
        };
        if (cancelled) return;
        setFetchedManifest(data.manifest);
        setFetchedFormat(data.format ?? undefined);
      } catch {
        if (!cancelled) setManifestError("تعذر تحميل المشروع");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId, manifest, showExportTab]);

  // Measure each tab's border-box height (includes the tab's own
  // py-5 padding) with a ResizeObserver. Using contentRect.height
  // would skip padding → body wrapper would animate to 40px short
  // → bottom of the active tab gets clipped by overflow-hidden.
  // `borderBoxSize.blockSize` reports the full outer box; fall
  // back to offsetHeight if the runtime doesn't expose it. RO also
  // re-fires when invitees are added/removed, so the height tracks
  // dynamic content.
  useLayoutEffect(() => {
    if (!open) return;
    const observers: ResizeObserver[] = [];
    const observe = (
      el: HTMLDivElement | null,
      setter: (n: number) => void,
    ) => {
      if (!el) return;
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const box = entry.borderBoxSize?.[0]?.blockSize;
          const h = Math.ceil(
            typeof box === "number"
              ? box
              : (entry.target as HTMLElement).offsetHeight,
          );
          if (h > 0) setter(h);
        }
      });
      ro.observe(el);
      observers.push(ro);
    };
    observe(shareRef.current, setShareHeight);
    observe(exportRef.current, setExportHeight);
    return () => observers.forEach((ro) => ro.disconnect());
  }, [open]);

  const activeHeight = tab === "share" ? shareHeight : exportHeight;

  // Esc closes — but never while a request is in flight.
  const anyBusy =
    revokingId !== null || updatingRoleId !== null || inviteBusy;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !anyBusy) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, anyBusy, onClose]);

  // ─── POST new invite ────────────────────────────────────────────
  const submitInvite = useCallback(async () => {
    if (!projectId || !state) return;
    setInviteError(null);
    const email = inviteEmail.trim();
    if (!email) {
      setInviteError("أدخل البريد الإلكتروني");
      return;
    }
    setInviteBusy(true);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/share`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, accessLevel: inviteRole }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        share?: { id: string; email: string; accessLevel: AccessRole };
        error?: string;
      };
      if (!res.ok || !body.ok) {
        setInviteError(body.error ?? "تعذر إرسال الدعوة");
        return;
      }
      // Refetch the canonical list so the new row appears (with the
      // server-derived invitedAt + null acceptedAt) without us
      // hand-rolling that state.
      const refresh = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/share`,
        { credentials: "same-origin" },
      );
      if (refresh.ok) {
        setState((await refresh.json()) as ShareState);
      }
      setInviteEmail("");
      setInviteRole("view");
    } catch {
      setInviteError("تعذر إرسال الدعوة");
    } finally {
      setInviteBusy(false);
    }
  }, [projectId, state, inviteEmail, inviteRole]);

  // ─── PATCH role on an existing row (upsert via same endpoint) ────
  const updateRole = useCallback(
    async (row: ShareRow, next: AccessRole) => {
      if (!projectId || !state) return;
      if (row.accessLevel === next) return;
      setUpdatingRoleId(row.id);
      const prevState = state;
      // Optimistic update — replace the row's accessLevel locally.
      setState({
        ...state,
        shares: state.shares.map((r) =>
          r.id === row.id ? { ...r, accessLevel: next } : r,
        ),
      });
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/share`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: row.email, accessLevel: next }),
          },
        );
        if (!res.ok) setState(prevState);
      } catch {
        setState(prevState);
      } finally {
        setUpdatingRoleId(null);
      }
    },
    [projectId, state],
  );

  // ─── DELETE revoke ──────────────────────────────────────────────
  const revoke = useCallback(
    async (shareId: string) => {
      if (!projectId) return;
      setRevokingId(shareId);
      const prevState = state;
      setState((s) =>
        s ? { ...s, shares: s.shares.filter((r) => r.id !== shareId) } : s,
      );
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/share/${encodeURIComponent(shareId)}`,
          { method: "DELETE", credentials: "same-origin" },
        );
        if (!res.ok) setState(prevState);
      } catch {
        setState(prevState);
      } finally {
        setRevokingId(null);
      }
    },
    [projectId, state],
  );

  // ─── Copy link ───────────────────────────────────────────────────
  //
  // Side-effect on the server: if the project's `publicAccessLevel`
  // is still `null` (no shares + never copied before), the URL we're
  // about to put on the clipboard wouldn't actually grant access to
  // recipients — they'd hit a 404 on /project. We POST a public-view
  // lock first so the link is functional the moment the owner pastes
  // it. Idempotent — already-view stays view. If the lock fails we
  // skip the copy and surface the error via the modal's fetch error
  // path; copying a broken link silently would be worse.
  const copyLink = useCallback(async () => {
    if (!projectId) return;
    if (!state || state.publicAccessLevel !== "view") {
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/share`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ publicAccessLevel: "view" }),
          },
        );
        if (!res.ok) {
          setFetchError("تعذر تفعيل الرابط العام");
          return;
        }
        // Mirror the lock in local state so subsequent copies skip
        // the round-trip.
        setState((s) =>
          s ? { ...s, publicAccessLevel: "view" } : s,
        );
      } catch {
        setFetchError("تعذر تفعيل الرابط العام");
        return;
      }
    }
    const url = `${window.location.origin}/project/${projectId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — silent for now */
    }
  }, [projectId, state]);

  if (typeof window === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && projectId ? (
        <>
          {/* Dim overlay — `.modal-dim` carries the canonical
              `color-mix(in oklab, black 70%, transparent)` tint used
              by every modal in the app (locked 2026-05-23). No
              per-modal brightness override. */}
          <motion.div
            key="share-dim"
            onClick={() => {
              if (!anyBusy) onClose();
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="modal-dim fixed inset-0 z-[1000]"
          />
          {/* Panel wrapper — initial=1 (no entry fade) so the
              backdrop-filter isn't trapped in a stacking context. */}
          <motion.div
            key="share-wrapper"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="pointer-events-none fixed inset-0 z-[1001] flex items-center justify-center p-4"
          >
            {/* Panel — backdrop-blur stays trap-free because we never
                apply a transform to it; the size delta is driven by
                animating the BODY wrapper's explicit height (see
                below). Panel naturally reflows via flex-col when its
                body child resizes. */}
            <div
              dir="rtl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="share-title"
              onClick={(e) => e.stopPropagation()}
              className="glass-popover backdrop-blur-glass backdrop-saturate-(--glass-saturation) pointer-events-auto flex w-[min(100vw-24px,640px)] max-h-[min(85vh,720px)] flex-col overflow-hidden rounded-2xl"
            >
              {/* Header */}
              <header className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-5 py-4">
                <h2
                  id="share-title"
                  className="text-base font-semibold text-white truncate"
                  title={projectTitle}
                >
                  {tab === "share" || !showExportTab ? "مشاركة" : "تصدير"} ·{" "}
                  <span className="text-white/60 font-normal">
                    {projectTitle}
                  </span>
                </h2>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={anyBusy}
                  aria-label="إغلاق"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </header>

              {/* Body — split horizontally. Under `dir="rtl"` the FIRST
                  flex child lands on the visual RIGHT, so we place the
                  tab strip first (Share/Export rail on the right per
                  sketch) and the content column second (fills the
                  remaining width on the visual left).
                  Height animation is driven from THIS wrapper (not
                  the content column) because flex's default
                  `align-items: stretch` overrides any explicit cross-
                  axis height on a flex child — making the wrapper
                  itself the height-owner is the only reliable spot
                  for the CSS transition. The content column then
                  fills naturally via `align-self: stretch`. */}
              {/* Body wrapper — height animated by framer-motion to
                  the active tab's measured height. Browsers can't
                  transition `auto`, so we feed framer a numeric value
                  the moment the active tab's ResizeObserver reports
                  it. `initial={false}` skips the first mount animation
                  (no flash from 0 → measured). */}
              <motion.div
                className="flex shrink-0 overflow-hidden"
                initial={false}
                animate={{ height: activeHeight ?? "auto" }}
                transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              >
                {/* Tab strip — first child = RTL right. Suppressed
                    entirely when `showExportTab` is false (editor
                    toolbox use case — share-only, no rail needed). */}
                {showExportTab ? (
                  <div className="flex shrink-0 flex-col gap-2 border-e border-white/[0.08] px-3 py-5">
                    <TabPill
                      label="مشاركة"
                      icon="person_add"
                      active={tab === "share"}
                      onClick={() => setTab("share")}
                    />
                    <TabPill
                      label="تصدير"
                      icon="download"
                      active={tab === "export"}
                      onClick={() => setTab("export")}
                    />
                  </div>
                ) : null}
                {/* Content column — sized by flex stretch. Both tabs
                    are rendered (inactive absolute-positioned with
                    top-anchored coords so its natural height is
                    measurable); cross-fade is per-tab opacity inside. */}
                <div className="flex-1 min-w-0 overflow-hidden px-5">
                  <div className="relative">
                    {/* Share tab — in-flow when active, absolute
                        when inactive so it doesn't push layout but
                        is still measurable. */}
                    <motion.div
                      ref={shareRef}
                      animate={{ opacity: tab === "share" ? 1 : 0 }}
                      transition={{
                        duration: 0.2,
                        ease: [0.16, 1, 0.3, 1],
                      }}
                      style={{
                        position: tab === "share" ? "relative" : "absolute",
                        // Top-anchored only — full-width but NOT
                        // full-height. With `inset: 0` the absolute
                        // child stretches to fill the parent, which
                        // forces ResizeObserver to report the PARENT's
                        // height (matching the active tab) instead of
                        // this child's natural content height. Drop
                        // `bottom` so the box height equals content.
                        top: tab === "share" ? "auto" : 0,
                        left: tab === "share" ? "auto" : 0,
                        right: tab === "share" ? "auto" : 0,
                        pointerEvents: tab === "share" ? "auto" : "none",
                      }}
                      className="py-5"
                      aria-hidden={tab !== "share"}
                    >
                      <ShareTabContent
                        state={state}
                        fetchError={fetchError}
                        inviteEmail={inviteEmail}
                        setInviteEmail={setInviteEmail}
                        inviteRole={inviteRole}
                        setInviteRole={setInviteRole}
                        inviteBusy={inviteBusy}
                        inviteError={inviteError}
                        submitInvite={submitInvite}
                        updateRole={updateRole}
                        revoke={revoke}
                        revokingId={revokingId}
                        updatingRoleId={updatingRoleId}
                      />
                    </motion.div>
                    {showExportTab ? (
                      <motion.div
                        ref={exportRef}
                        animate={{ opacity: tab === "export" ? 1 : 0 }}
                        transition={{
                          duration: 0.2,
                          ease: [0.16, 1, 0.3, 1],
                        }}
                        style={{
                          position: tab === "export" ? "relative" : "absolute",
                          // Top-anchored only — see Share tab block above.
                          top: tab === "export" ? "auto" : 0,
                          left: tab === "export" ? "auto" : 0,
                          right: tab === "export" ? "auto" : 0,
                          pointerEvents: tab === "export" ? "auto" : "none",
                        }}
                        className="py-5"
                        aria-hidden={tab !== "export"}
                      >
                        <ExportTabContent
                          projectId={projectId}
                          projectTitle={projectTitle}
                          manifest={effectiveManifest}
                          formatFallback={effectiveFormat}
                          loadError={manifestError}
                        />
                      </motion.div>
                    ) : null}
                  </div>
                </div>
              </motion.div>

              {/* Footer — constant Copy-Link CTA across both tabs.
                  Always view-only (the link route is gated server-side
                  by publicAccessLevel='view' once a link is shared).
                  Uses `.btn-gradient` (PATTERN 2 — primary CTA) to
                  match the template-modal "استخدامه كقالب" button so
                  the modals read as one family. */}
              <footer className="flex items-center justify-between gap-2 border-t border-white/[0.08] px-4 py-3">
                <span className="text-xs text-white/40">
                  الرابط يفتح للمشاهدة فقط
                </span>
                <button
                  type="button"
                  onClick={copyLink}
                  disabled={!projectId}
                  className="btn-gradient inline-flex items-center gap-2 px-4 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={copied ? "copied" : "idle"}
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.6 }}
                      transition={{ duration: 0.18 }}
                      className="material-symbols-outlined"
                      style={{ fontSize: 16 }}
                      aria-hidden
                    >
                      {copied ? "check" : "link"}
                    </motion.span>
                  </AnimatePresence>
                  {copied ? "تم النسخ" : "نسخ رابط المشاركة"}
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

// ─── Vertical tab strip pill ────────────────────────────────────────

function TabPill({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
}) {
  // Horizontal pill — icon + label on the same line per the sketch.
  // Active state IS a pill (raised glass intensity); inactive is
  // borderless ghost text. The animated layoutId-shared background
  // slides between pills when the user switches tabs.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`relative flex items-center justify-start gap-2 rounded-full px-4 py-2 text-xs transition-colors ${
        active ? "text-white" : "text-white/55 hover:text-white"
      }`}
      style={{ minWidth: 110 }}
    >
      {active ? (
        <motion.div
          layoutId="share-tab-active-bg"
          className="absolute inset-0 rounded-full"
          style={{
            background: "var(--tq-bg-glass)",
            border: "1px solid var(--tq-border-glass)",
          }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        />
      ) : null}
      <span
        className="material-symbols-outlined relative"
        style={{ fontSize: 18 }}
        aria-hidden
      >
        {icon}
      </span>
      <span className="relative">{label}</span>
    </button>
  );
}

// ─── Share tab content ──────────────────────────────────────────────

function ShareTabContent({
  state,
  fetchError,
  inviteEmail,
  setInviteEmail,
  inviteRole,
  setInviteRole,
  inviteBusy,
  inviteError,
  submitInvite,
  updateRole,
  revoke,
  revokingId,
  updatingRoleId,
}: {
  state: ShareState | null;
  fetchError: string | null;
  inviteEmail: string;
  setInviteEmail: (s: string) => void;
  inviteRole: AccessRole;
  setInviteRole: (r: AccessRole) => void;
  inviteBusy: boolean;
  inviteError: string | null;
  submitInvite: () => void;
  updateRole: (row: ShareRow, next: AccessRole) => void;
  revoke: (id: string) => void;
  revokingId: string | null;
  updatingRoleId: string | null;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-sm font-medium text-white">دعوة أشخاص</h3>

        {fetchError ? (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {fetchError}
          </div>
        ) : null}

        {/* Invite bar — chip on the leading side, email input on the
            trailing side, send button after. Submit on Enter. The
            chip uses AccessChipDropdown (not a native <select>). */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitInvite();
          }}
          className="flex flex-col gap-2"
        >
          {/* Invite bar — under `dir="rtl"` the FIRST flex child lands
              on the visual RIGHT. Per sketch: email input on the
              visual RIGHT, access chip on the visual LEFT, send
              button further LEFT. DOM order is therefore:
                1. <input>     → right
                2. <chip>      → middle
                3. <button>    → left */}
          <div
            className="flex items-stretch gap-2 rounded-full p-1"
            style={{
              background: "var(--tq-bg-glass)",
              border: "1px solid var(--tq-border-glass)",
            }}
          >
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="email@example.com"
              dir="ltr"
              disabled={inviteBusy || !state}
              className="flex-1 bg-transparent px-4 text-end text-sm text-white placeholder:text-white/35 focus:outline-none disabled:opacity-50"
            />
            <AccessChipDropdown
              value={inviteRole}
              onChange={setInviteRole}
              disabled={inviteBusy || !state}
            />
            <button
              type="submit"
              disabled={inviteBusy || !state || !inviteEmail.trim()}
              className="btn-gradient inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              {inviteBusy ? "جارٍ..." : "دعوة"}
            </button>
          </div>
          {inviteError ? (
            <div className="text-xs text-red-300 pe-2">{inviteError}</div>
          ) : null}
        </form>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-white">
          الأشخاص الذين لديهم وصول
        </h3>

        <ul className="space-y-1.5">
          {/* Owner row — always shown, non-revokable. */}
          {state?.user ? (
            <PersonRow
              role="owner"
              displayName={state.user.name ?? "أنت"}
              email={state.user.email}
              avatarName={state.user.name ?? state.user.email}
              avatarImage={state.user.image}
              avatarSeedId={state.user.id}
            />
          ) : null}

          <AnimatePresence initial={false}>
            {state?.shares.map((row) => (
              <motion.li
                key={row.id}
                layout
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              >
                <PersonRow
                  role={row.accessLevel}
                  /* Accepted: show user's actual name + login email.
                     Pending: show the invited email + a single
                     "بانتظار القبول" status (per direction 2026-05-23
                     — no separate accepted state, the name/email
                     swap IS the signal). */
                  displayName={row.user?.name ?? row.user?.email ?? row.email}
                  email={row.user ? row.user.email : "بانتظار القبول"}
                  // Avatar seed prefers the joined user id (stable
                  // across re-invites of the same person); falls back
                  // to the share row id for pending invites so each
                  // pending row gets its own consistent gradient.
                  avatarName={row.user?.name ?? row.user?.email ?? row.email}
                  avatarImage={row.user?.image ?? null}
                  avatarSeedId={row.user?.id ?? row.id}
                  onRoleChange={(next) => updateRole(row, next)}
                  onRevoke={() => revoke(row.id)}
                  busy={
                    revokingId === row.id || updatingRoleId === row.id
                  }
                />
              </motion.li>
            ))}
          </AnimatePresence>

          {state && state.shares.length === 0 ? (
            <li className="text-xs text-white/40 pe-1 pt-1">
              لا يوجد أشخاص مدعوّون بعد.
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

// ─── Per-person row ─────────────────────────────────────────────────

function PersonRow({
  role,
  displayName,
  email,
  avatarName,
  avatarImage,
  avatarSeedId,
  onRoleChange,
  onRevoke,
  busy,
}: {
  role: AccessRole | "owner";
  displayName: string;
  email: string;
  // Avatar uses Google OAuth photo when present; otherwise a stable
  // gradient + initial derived from `avatarSeedId`. `avatarName`
  // provides the initial; `avatarSeedId` keys the gradient bucket
  // (user id for accepted invites, share row id for pending).
  avatarName: string;
  avatarImage: string | null;
  avatarSeedId: string;
  onRoleChange?: (next: AccessRole) => void;
  onRevoke?: () => void;
  busy?: boolean;
}) {
  // Under `dir="rtl"` the FIRST flex child lands on the visual RIGHT.
  // Per direction 2026-05-24 — avatar on the visual RIGHT (start),
  // then name+email, access chip, revoke X going LEFT. DOM order:
  //   1. <Avatar>      → right (start)
  //   2. <text block>  → next to avatar
  //   3. <chip>        → middle
  //   4. <revoke X>    → left
  //
  // Row chrome is pill-shaped (rounded-full) per design rule —
  // matches the rest of the modal's pill family (invite bar, copy-
  // link CTA, access chip).
  return (
    <div
      className="flex items-center gap-3 rounded-full px-4 py-2"
      style={{
        background: "var(--tq-bg-glass)",
        border: "1px solid var(--tq-border-glass)",
      }}
    >
      <Avatar
        name={avatarName}
        image={avatarImage}
        seedId={avatarSeedId}
        size={28}
      />
      {/* Use PHYSICAL `text-right` (not logical `text-end`) so both
          lines always anchor to the visual right, regardless of the
          content's own directionality. Mixing logical `text-end`
          with `dir="auto"` / `dir="rtl"` per-line caused the LTR
          email (text-end under auto-LTR = right) and the Arabic
          status string (text-end under RTL = left) to disagree —
          the visual right edge was the spec, so pin it physically. */}
      <div className="min-w-0 flex-1 text-right">
        <div className="truncate text-sm text-white">{displayName}</div>
        <div className="truncate text-[11px] text-white/40">{email}</div>
      </div>
      {role === "owner" ? (
        <AccessChipDropdown
          value="edit"
          onChange={() => {}}
          readOnly
          triggerLabel="ملكية كاملة"
        />
      ) : (
        <AccessChipDropdown
          value={role}
          onChange={(next) => onRoleChange?.(next)}
          disabled={busy}
        />
      )}
      {onRevoke ? (
        <button
          type="button"
          onClick={onRevoke}
          disabled={busy}
          aria-label="إزالة"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 16 }}
          >
            close
          </span>
        </button>
      ) : null}
    </div>
  );
}

// ─── Export tab content ─────────────────────────────────────────────

function ExportTabContent({
  projectId,
  projectTitle,
  manifest,
  formatFallback,
  loadError,
}: {
  projectId: string;
  projectTitle: string;
  manifest: SlideManifest | null | undefined;
  formatFallback: SlideFormat | undefined;
  loadError: string | null;
}) {
  // Manifest is required for the client-side PPTX + HTML pipelines.
  // It's either passed in directly (editor) or lazy-fetched via
  // /api/projects/[id]/manifest (project tile). Errors render as
  // a danger box; pending state renders a skeleton so the modal
  // doesn't shift size between "loading" and "loaded".
  if (loadError) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-white">تصدير العرض</h3>
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {loadError}
        </div>
      </div>
    );
  }
  if (!manifest) {
    return <ExportTabSkeleton />;
  }
  return (
    <ExportTabBody
      projectId={projectId}
      projectTitle={projectTitle}
      manifest={manifest}
      formatFallback={formatFallback}
    />
  );
}

function ExportTabSkeleton() {
  // Mirrors the loaded layout (heading + 4 rows + LinkedIn) so the
  // body wrapper's measured height doesn't lurch when the manifest
  // fetch lands.
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-white">صيغة التصدير</h3>
      <ul className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <li
            key={i}
            className="flex h-[60px] items-center gap-3 rounded-xl px-3 py-2.5"
            style={{ border: "1px solid var(--tq-border-glass)" }}
          >
            <span className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-white/[0.05]" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-20 animate-pulse rounded bg-white/[0.05]" />
              <div className="h-2.5 w-32 animate-pulse rounded bg-white/[0.05]" />
            </div>
          </li>
        ))}
      </ul>
      <div className="space-y-2 pt-2">
        <p className="text-xs text-white/50">أو شارك مباشرة على:</p>
        <div className="h-8 w-24 animate-pulse rounded-full bg-white/[0.05]" />
      </div>
    </div>
  );
}

function ExportTabBody({
  projectId,
  projectTitle,
  manifest,
  formatFallback,
}: {
  projectId: string;
  projectTitle: string;
  manifest: SlideManifest;
  formatFallback: SlideFormat | undefined;
}) {
  const actions = useExportActions({
    projectId,
    projectTitle,
    manifest,
    formatFallback,
  });
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-white">صيغة التصدير</h3>
      <ul className="space-y-2">
        {/* Format accents come from `--tq-export-*` tokens in
            globals.css so future palette tweaks propagate without
            grepping for component-local rgba literals. */}
        <ExportRow
          icon="picture_as_pdf"
          accent="var(--tq-export-pdf)"
          label="PDF"
          sub="ملف PDF متعدد الصفحات"
          running={actions.states.pdf.status === "running"}
          disabled={actions.busy && actions.states.pdf.status !== "running"}
          onClick={actions.runPdf}
        />
        <ExportRow
          icon="slideshow"
          accent="var(--tq-export-pptx)"
          label="PowerPoint"
          sub="ملف PPTX قابل للتحرير"
          running={actions.states.pptx.status === "running"}
          disabled={actions.busy && actions.states.pptx.status !== "running"}
          onClick={actions.runPptx}
        />
        <ExportRow
          icon="code"
          accent="var(--tq-export-html)"
          label="HTML"
          sub="ملف HTML مستقل"
          running={actions.states.html.status === "running"}
          disabled={actions.busy && actions.states.html.status !== "running"}
          onClick={actions.runHtml}
        />
        <ExportRow
          icon="image"
          accent="var(--tq-export-png)"
          label="PNGs"
          sub="مجلد صور مضغوط"
          running={actions.states.png.status === "running"}
          disabled={actions.busy && actions.states.png.status !== "running"}
          onClick={actions.runPng}
        />
      </ul>

      {actions.lastError ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {actions.lastError}
        </div>
      ) : null}

      <div className="space-y-2 pt-2">
        <p className="text-xs text-white/50">أو شارك مباشرة على:</p>
        <LinkedInShareButton projectId={projectId} />
      </div>
    </div>
  );
}

function ExportRow({
  icon,
  accent,
  label,
  sub,
  running,
  disabled,
  onClick,
}: {
  icon: string;
  accent: string;
  label: string;
  sub: string;
  running: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || running}
        className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start transition-colors hover:bg-white/[0.04] disabled:opacity-50"
        style={{
          border: "1px solid var(--tq-border-glass)",
        }}
      >
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{ background: accent }}
        >
          <span
            className="material-symbols-outlined text-white"
            style={{ fontSize: 22 }}
            aria-hidden
          >
            {icon}
          </span>
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-white">{label}</div>
          <div className="text-[11px] text-white/45">{sub}</div>
        </div>
        <span
          className="material-symbols-outlined text-white/40 transition-colors group-hover:text-white"
          style={{ fontSize: 20 }}
          aria-hidden
        >
          {running ? "progress_activity" : "download"}
        </span>
      </button>
    </li>
  );
}

function LinkedInShareButton({ projectId }: { projectId: string }) {
  const open = () => {
    const url = `${window.location.origin}/project/${projectId}`;
    const linkedIn = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
    // `noopener,noreferrer` severs the popup's reference to
    // `window.opener` so the third-party page can't navigate or
    // script the original app tab — small but free reverse-tabnab
    // hardening on any cross-origin window.open.
    window.open(
      linkedIn,
      "share-linkedin",
      "width=600,height=600,noopener,noreferrer",
    );
  };
  return (
    <button
      type="button"
      onClick={open}
      className="btn-pill flex items-center gap-2 !px-3.5 !py-2 text-xs"
    >
      <span
        className="material-symbols-outlined"
        style={{ fontSize: 16 }}
        aria-hidden
      >
        share
      </span>
      LinkedIn
    </button>
  );
}
