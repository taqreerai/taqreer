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
//             (PDF / PPTX / Google Slides / PNGs). The modal consumes the
//             `useExportActions` hook so both surfaces run the same
//             handlers / serialise via the same `busy` flag.
//             LinkedIn share button at the bottom of this tab.
//
// Constant footer (both tabs): copy-link button. The link goes to
// `/project/[id]` and is gated server-side as view-only for
// non-owners (Phase 15.E).
//
// Frame: copies `SaveAsTemplateDialog` byte-for-byte (sibling
// overlay+panel pattern, surface-popover surface, Esc + body-scroll
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
import { Toggle } from "@/components/create/controls";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { useCreditBalance } from "@/lib/credits/store";
import { isExportGated, EXPORT_GATE_TIER } from "@/lib/export/export-gating";
import { UpgradeModal } from "@/components/billing/UpgradeModal";
import { GoogleSlidesReadyDialog } from "@/components/export/GoogleSlidesReadyDialog";
import { planLabel } from "@/lib/plan";

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
  const dict = useDict();
  const { dir } = useLocale();
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
            setFetchError(dict.dialogs.share.errLoadShare);
          }
          return;
        }
        const data = (await res.json()) as ShareState;
        if (cancelled) return;
        setState(data);
        lastHydratedProjectIdRef.current = projectId;
      } catch {
        if (!cancelled) setFetchError(dict.dialogs.share.errLoadShare);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dict.dialogs.share error strings are stable per locale; used only in the error path
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
            setManifestError(body.error ?? dict.dialogs.share.errLoadProject);
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
        if (!cancelled) setManifestError(dict.dialogs.share.errLoadProject);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dict.dialogs.share error strings are stable per locale; used only in the error path
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
      setInviteError(dict.dialogs.share.enterEmail);
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
        setInviteError(body.error ?? dict.dialogs.share.errSendInvite);
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
      setInviteError(dict.dialogs.share.errSendInvite);
    } finally {
      setInviteBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dict.dialogs.share strings are stable per locale; used only for validation/error messages
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

  // ─── Public link on/off toggle ──────────────────────────────────
  //
  // Posts `publicAccessLevel: "view" | null` to flip the project's
  // public-link state. Optimistic local update so the footer's
  // disabled/enabled UI flips instantly; on server error we revert.
  // The Toggle in the footer is the user-facing entry point — pre-
  // fix there was no way to TURN OFF the link once it was enabled
  // (it auto-activated on the first copy and stayed view-only
  // forever after, even after every share was revoked).
  const setPublicLinkEnabled = useCallback(
    async (enabled: boolean) => {
      if (!projectId) return;
      const next: AccessRole | null = enabled ? "view" : null;
      // Optimistic flip
      const prev = state?.publicAccessLevel ?? null;
      setState((s) => (s ? { ...s, publicAccessLevel: next } : s));
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/share`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ publicAccessLevel: next }),
          },
        );
        if (!res.ok) {
          // Revert on failure
          setState((s) => (s ? { ...s, publicAccessLevel: prev } : s));
          setFetchError(
            enabled
              ? dict.dialogs.share.errEnablePublic
              : dict.dialogs.share.errDisablePublic,
          );
        }
      } catch {
        setState((s) => (s ? { ...s, publicAccessLevel: prev } : s));
        setFetchError(
          enabled
            ? dict.dialogs.share.errEnablePublic
            : dict.dialogs.share.errDisablePublic,
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dict.dialogs.share error strings are stable per locale; used only in the error path
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
          setFetchError(dict.dialogs.share.errEnablePublic);
          return;
        }
        // Mirror the lock in local state so subsequent copies skip
        // the round-trip.
        setState((s) =>
          s ? { ...s, publicAccessLevel: "view" } : s,
        );
      } catch {
        setFetchError(dict.dialogs.share.errEnablePublic);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dict.dialogs.share strings are stable per locale; used only in the error path
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
              dir={dir}
              role="dialog"
              aria-modal="true"
              aria-labelledby="share-title"
              onClick={(e) => e.stopPropagation()}
              className="surface-modal pointer-events-auto flex w-[min(100vw-24px,640px)] max-h-[min(85vh,720px)] flex-col overflow-hidden rounded-2xl"
            >
              {/* Header */}
              <header className="flex items-center justify-between gap-3 border-b border-foreground/[0.08] px-5 py-4">
                <h2
                  id="share-title"
                  // min-w-0 so `truncate` can actually shrink this flex child
                  // (without it the long deck title overflows the dialog edge).
                  className="min-w-0 truncate text-base font-semibold text-foreground"
                  title={projectTitle}
                >
                  {tab === "share" || !showExportTab
                    ? dict.dialogs.share.title
                    : dict.common.export}{" "}
                  ·{" "}
                  <span className="text-foreground/60 font-normal">
                    {projectTitle}
                  </span>
                </h2>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={anyBusy}
                  aria-label={dict.common.close}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground disabled:opacity-50"
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
                  <div className="flex shrink-0 flex-col gap-2 border-e border-foreground/[0.08] px-3 py-5">
                    <TabPill
                      label={dict.dialogs.share.title}
                      icon="person_add"
                      active={tab === "share"}
                      onClick={() => setTab("share")}
                    />
                    <TabPill
                      label={dict.common.export}
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

              {/* Footer — Toggle on the right (RTL visual) controls
                  the public-link state; Copy-Link CTA on the left.
                  When the toggle is OFF, the link is fully disabled
                  on the server (`publicAccessLevel = null`) and the
                  copy button is disabled so the owner doesn't put a
                  non-functional URL on someone's clipboard. Pre-fix
                  there was no UI to disable the link; it auto-
                  activated on the first copy and stayed view-only
                  forever — see prior commit 43260e1 + user direction
                  2026-05-26 "there is no option to do this".
                  Uses `.btn-gradient` (PATTERN 2 — primary CTA) to
                  match the template-modal "استخدامه كقالب" button so
                  the modals read as one family. */}
              <footer className="flex items-center justify-between gap-2 border-t border-foreground/[0.08] px-4 py-3">
                <button
                  type="button"
                  onClick={copyLink}
                  disabled={!projectId || state?.publicAccessLevel !== "view"}
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
                  {copied
                    ? dict.dialogs.share.copied
                    : dict.dialogs.share.copyLink}
                </button>
                <div className="inline-flex items-center gap-2">
                  <span className="text-xs text-foreground/60">
                    {state?.publicAccessLevel === "view"
                      ? dict.dialogs.share.publicLinkEnabled
                      : dict.dialogs.share.publicLinkDisabled}
                  </span>
                  <Toggle
                    ariaLabel={dict.dialogs.share.publicLinkAria}
                    value={state?.publicAccessLevel === "view"}
                    onChange={(next) => void setPublicLinkEnabled(next)}
                    disabled={!projectId || !state}
                  />
                </div>
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
        active ? "text-foreground" : "text-foreground/55 hover:text-foreground"
      }`}
      style={{ minWidth: 110 }}
    >
      {active ? (
        <motion.div
          layoutId="share-tab-active-bg"
          className="absolute inset-0 rounded-full"
          style={{
            background: "var(--tq-surface)",
            border: "1px solid var(--tq-border-hairline)",
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
  const dict = useDict();
  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-sm font-medium text-foreground">
          {dict.dialogs.share.invitePeople}
        </h3>

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
              background: "var(--tq-surface)",
              border: "1px solid var(--tq-border-hairline)",
            }}
          >
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder={dict.dialogs.share.emailPlaceholder}
              dir="ltr"
              disabled={inviteBusy || !state}
              // min-w-0 lets the flex input shrink below its placeholder width so
              // the chip + دعوة button never get pushed past the pill edge.
              // max-md:text-base keeps it at 16px on phones (no iOS focus-zoom).
              className="min-w-0 flex-1 bg-transparent px-4 text-end text-sm text-foreground placeholder:text-foreground/35 focus:outline-none disabled:opacity-50 max-md:text-base"
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
              {inviteBusy
                ? dict.dialogs.share.sending
                : dict.dialogs.share.invite}
            </button>
          </div>
          {inviteError ? (
            <div className="text-xs text-red-300 pe-2">{inviteError}</div>
          ) : null}
        </form>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-foreground">
          {dict.dialogs.share.peopleWithAccess}
        </h3>

        <ul className="space-y-1.5">
          {/* Owner row — always shown, non-revokable. */}
          {state?.user ? (
            <PersonRow
              role="owner"
              displayName={state.user.name ?? dict.dialogs.share.you}
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
                  email={
                    row.user
                      ? row.user.email
                      : dict.dialogs.share.awaitingAcceptance
                  }
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
            <li className="text-xs text-foreground/40 pe-1 pt-1">
              {dict.dialogs.share.noInvites}
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
  const dict = useDict();
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
        background: "var(--tq-surface)",
        border: "1px solid var(--tq-border-hairline)",
      }}
    >
      <Avatar
        name={avatarName}
        image={avatarImage}
        seedId={avatarSeedId}
        size={28}
      />
      {/* Logical `text-start` so the name + email anchor to the SAME edge as the
          avatar in both directions (right in RTL, left in LTR). The earlier
          `text-end` resolved to the wrong edge under RTL, and physical
          `text-right` would misalign on /en and breaks the logical-CSS rule. */}
      <div className="min-w-0 flex-1 text-start">
        <div className="truncate text-sm text-foreground">{displayName}</div>
        <div className="truncate text-[11px] text-foreground/40">{email}</div>
      </div>
      {role === "owner" ? (
        <AccessChipDropdown
          value="edit"
          onChange={() => {}}
          readOnly
          triggerLabel={dict.dialogs.share.fullOwnership}
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
          aria-label={dict.dialogs.share.remove}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-foreground/40 transition-colors hover:bg-foreground/10 hover:text-foreground disabled:opacity-40"
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
  const dict = useDict();
  // Manifest is required for the client-side PPTX + HTML pipelines.
  // It's either passed in directly (editor) or lazy-fetched via
  // /api/projects/[id]/manifest (project tile). Errors render as
  // a danger box; pending state renders a skeleton so the modal
  // doesn't shift size between "loading" and "loaded".
  if (loadError) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">
          {dict.dialogs.share.exportPresentation}
        </h3>
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
  const dict = useDict();
  // Mirrors the loaded layout (heading + 4 rows + LinkedIn) so the
  // body wrapper's measured height doesn't lurch when the manifest
  // fetch lands.
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-foreground">
        {dict.dialogs.share.exportFormat}
      </h3>
      <ul className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <li
            key={i}
            className="flex h-[60px] items-center gap-3 rounded-xl px-3 py-2.5"
            style={{ border: "1px solid var(--tq-border-hairline)" }}
          >
            <span className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-foreground/[0.05]" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-20 animate-pulse rounded bg-foreground/[0.05]" />
              <div className="h-2.5 w-32 animate-pulse rounded bg-foreground/[0.05]" />
            </div>
          </li>
        ))}
      </ul>
      <div className="space-y-2 pt-2">
        <p className="text-xs text-foreground/50">{dict.dialogs.share.orShareOn}</p>
        <div className="h-8 w-24 animate-pulse rounded-full bg-foreground/[0.05]" />
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
  const dict = useDict();
  const actions = useExportActions({
    projectId,
    projectTitle,
    manifest,
    formatFallback,
  });
  // 3:4 social-post decks export as PDF/PNG only — mirror ExportMenu's
  // filter so both surfaces hide PowerPoint + HTML for them.
  const effectiveFormat = manifest?.format ?? formatFallback ?? "16:9";
  const isCarousel = effectiveFormat === "3:4";
  // Export tier gate — mirror ExportMenu: free keeps PNG only (nothing on
  // 3:4 social decks); gated rows crown + upsell instead of exporting.
  const credits = useCreditBalance();
  const gateUser = {
    plan: credits?.plan ?? null,
    isAdmin: credits?.isAdmin ?? false,
  };
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const rowProps = (kind: "pptx" | "pdf" | "png" | "gslides") => {
    const gated = isExportGated(kind, effectiveFormat, gateUser);
    const run = {
      pptx: actions.runPptx,
      pdf: actions.runPdf,
      png: actions.runPng,
      gslides: actions.runGslides,
    }[kind];
    return {
      gated,
      running: actions.states[kind].status === "running",
      disabled: actions.busy && actions.states[kind].status !== "running",
      onClick: gated ? () => setUpgradeOpen(true) : run,
    };
  };
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-foreground">
        {dict.dialogs.share.exportFormat}
      </h3>
      <ul className="space-y-2">
        {/* Format accents come from `--tq-export-*` tokens in
            globals.css so future palette tweaks propagate without
            grepping for component-local rgba literals. */}
        <ExportRow
          icon="picture_as_pdf"
          accent="var(--tq-export-pdf)"
          label="PDF"
          sub={dict.dialogs.share.fmtPdf}
          {...rowProps("pdf")}
        />
        {isCarousel ? null : (
          <ExportRow
            icon="slideshow"
            accent="var(--tq-export-pptx)"
            label="PowerPoint"
            sub={dict.dialogs.share.fmtPptx}
            {...rowProps("pptx")}
          />
        )}
        {isCarousel ? null : (
          <ExportRow
            icon="description"
            accent="var(--tq-export-gslides)"
            label="Google Slides"
            sub={dict.dialogs.share.fmtGslides}
            {...rowProps("gslides")}
          />
        )}
        <ExportRow
          icon="image"
          accent="var(--tq-export-png)"
          label="PNGs"
          sub={dict.dialogs.share.fmtPng}
          {...rowProps("png")}
        />
      </ul>

      {actions.lastError ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {actions.lastError}
        </div>
      ) : null}

      <div className="space-y-2 pt-2">
        <p className="text-xs text-foreground/50">{dict.dialogs.share.orShareOn}</p>
        <LinkedInShareButton projectId={projectId} />
      </div>

      {/* Google Slides success — Open button rides a fresh click gesture
          (popup-safe). z-[1200] portal, stacks above this dialog. */}
      <GoogleSlidesReadyDialog
        url={actions.gslidesUrl}
        onClose={actions.clearGslidesUrl}
      />

      {/* Gated-format upsell — z-[1200] portal, stacks above this dialog
          (z-[1001]). Same gateContext copy the studio ExportMenu uses. */}
      <UpgradeModal
        open={upgradeOpen}
        requiredTier={EXPORT_GATE_TIER}
        gateContext={{
          title: dict.components.creditGate.exportLockedTitle,
          body: dict.components.creditGate.exportLockedBody.replace(
            "{tier}",
            planLabel(dict.components.planUsage, EXPORT_GATE_TIER),
          ),
        }}
        onClose={() => setUpgradeOpen(false)}
      />
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
  gated,
  onClick,
}: {
  icon: string;
  accent: string;
  label: string;
  sub: string;
  running: boolean;
  disabled: boolean;
  // Tier-gated format: the trailing download glyph becomes a gold crown
  // and the click upsells (UpgradeModal) instead of exporting.
  gated: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || running}
        className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start transition-colors hover:bg-foreground/[0.04] disabled:opacity-50"
        style={{
          border: "1px solid var(--tq-border-hairline)",
        }}
      >
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{ background: accent }}
        >
          <span
            className="material-symbols-outlined text-foreground"
            style={{ fontSize: 22 }}
            aria-hidden
          >
            {icon}
          </span>
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-foreground">{label}</div>
          <div className="text-[11px] text-foreground/45">{sub}</div>
        </div>
        {gated && !running ? (
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 20, color: "var(--tq-premium-gold)" }}
            aria-hidden
          >
            crown
          </span>
        ) : (
          <span
            className="material-symbols-outlined text-foreground/40 transition-colors group-hover:text-foreground"
            style={{ fontSize: 20 }}
            aria-hidden
          >
            {running ? "progress_activity" : "download"}
          </span>
        )}
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
