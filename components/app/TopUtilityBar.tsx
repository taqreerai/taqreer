"use client";

// §24 (2026-06-09): a thin utility cluster pinned to the TOP of the content
// panel — search (icon + ⌘K hint), theme, and language. These used to live as
// rows inside the sidebar profile popup; the user moved them up here as
// icon-only controls, aligned to the start (visual right in RTL).
//
// Search opens a command-palette overlay (HeaderSearch in `palette` variant),
// triggerable by click or the ⌘K / Ctrl+K shortcut. Theme + language are
// present as icons (tooltipped) but not wired to a real theme/i18n system yet.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { HeaderSearch } from "@/components/app/HeaderSearch";
import { BellDropdown } from "@/components/app/BellDropdown";
import { LanguageMenu } from "@/components/i18n/LanguageMenu";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import Link from "next/link";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";
import { useServerStatus } from "@/lib/hooks/useServerStatus";
import { useCreditBalance } from "@/lib/credits/store";
import { normalizePlan, planLabel } from "@/lib/plan";
import { Tooltip } from "@/components/common/Tooltip";

// Current-plan chip at the cluster's start edge (user direction
// 2026-06-11): AR reads SEARCH | BELL | BADGE toward the right edge,
// EN mirrors. Links to /billing. Hidden until the balance loads.
function PlanBadge() {
  const dict = useDict();
  const { locale } = useLocale();
  const credits = useCreditBalance();
  if (!credits) return null;
  // Admin/superuser: an "Admin" chip instead of the plan/billing link
  // (credits + plans don't apply). Matches the profile-menu chip.
  if (credits.isAdmin) {
    return (
      <span className="badge-purple me-2 inline-flex items-center gap-1">
        <span className="material-symbols-outlined text-[12px]" aria-hidden>
          shield_person
        </span>
        {dict.common.admin}
      </span>
    );
  }
  const plan = normalizePlan(credits.plan);
  return (
    <Link
      href={localizedHref("/plans", locale)}
      // me-2 compensates for the bell button's ~8px internal icon
      // inset: the badge edge is solid while its neighbors are padded
      // icon buttons, so the raw gap-1.5 read tighter on this side.
      className="badge-purple me-2 no-underline"
      aria-label={dict.components.billing.title}
    >
      {planLabel(dict.components.planUsage, plan)}
    </Link>
  );
}

// Server-health indicator — a small pill with a colored dot (green/amber/red)
// for the upstream provider status, status label on hover (shared animated
// tooltip). Replaces the old pre-generate ServerStatusBanner notifications + the
// sidebar status row. Hidden while loading or when the status is unknown.
function HealthDot() {
  const status = useServerStatus();
  const dict = useDict();
  if (!status || status.level === "unknown") return null;
  const meta = {
    operational: { dot: "bg-[var(--tq-status-ok-dot)]", label: dict.serverStatus.operational },
    degraded: { dot: "bg-[var(--tq-status-warn-dot)]", label: dict.serverStatus.degraded },
    down: { dot: "bg-[var(--tq-status-down-dot)]", label: dict.serverStatus.down },
  }[status.level];
  return (
    <Tooltip label={meta.label} placement="bottom">
      <span className="hidden h-9 items-center rounded-lg px-2.5 md:flex" role="status" aria-label={meta.label}>
        <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} aria-hidden />
      </span>
    </Tooltip>
  );
}

export function TopUtilityBar({
  // Extra controls appended to the END cluster (visual far edge) -
  // the studio header passes Export/Share here.
  trailing,
  // Rendered at the START cluster's edge, before the plan badge - the
  // studio header puts the avatar menu here (next to the tier pill,
  // user direction 2026-06-12).
  avatar,
  // Rendered at the very START of the start cluster (before the avatar/plan
  // badge) - the dashboard shell passes the mobile hamburger (MobileNav) here.
  // It's `md:hidden` internally, so the desktop bar is unchanged.
  leading,
}: {
  trailing?: React.ReactNode;
  avatar?: React.ReactNode;
  leading?: React.ReactNode;
} = {}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const dict = useDict();
  const { locale } = useLocale();

  // ⌘K (Mac) / Ctrl+K — global open shortcut. Ignored while typing in a field
  // other than to open (it preventDefaults the browser's own ⌘K).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      {/* Cluster — absolutely pinned to the panel's top-start corner (right in
          RTL). `pointer-events-none` on the rail + `auto` on the buttons lets
          clicks pass through the empty stretch to the content beneath. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-3 z-30 flex items-center justify-between px-3 md:px-5"
      >
        {/* Search — pinned to the inline start (right in RTL, left in LTR; the
            cluster inherits direction from the chrome locale). */}
        {/* Order from the start edge: plan badge (edge) → bell → search
            (user direction 2026-06-11). AR reads SEARCH | BELL | BADGE
            toward the right edge; EN mirrors. */}
        <div className="pointer-events-auto flex items-center gap-1.5">
          {/* Mobile hamburger (md:hidden) leads the cluster on the dashboard. */}
          {leading}
          {/* me-3 makes the avatar→tier-pill gap OPTICALLY equal to the
              pill→bell one: the pill side is gap-1.5 + its me-2 + the
              bell glyph's ~4px inset inside its padded button, while the
              avatar disc+ring fill their box edge-to-edge (user reports
              2026-06-12/13). */}
          {avatar ? <span className="me-3 flex items-center">{avatar}</span> : null}
          {/* Plan badge: in the studio (avatar present) it duplicates the avatar
              menu's tier chip, so hide it on phones to keep Export/Share in view
              down to 320px. The dashboard keeps it (upgrade CTA, has room). */}
          {avatar ? (
            <span className="hidden md:inline-flex md:items-center">
              <PlanBadge />
            </span>
          ) : (
            <PlanBadge />
          )}
          {/* Notifications bell - this instance also boots the
              notification store + owns the live toast stack. */}
          <BellDropdown />
          {/* Home - studio header only (`avatar` is the studio signal; the
              dashboard already has the sidebar home link). Hidden on phones,
              where the bottom action bar already carries a "back to dashboard"
              home button and the top-bar space is needed for Export/Share. */}
          {avatar ? (
            <Tooltip label={dict.nav.home} placement="bottom">
              <Link
                href={localizedHref("/dashboard", locale)}
                aria-label={dict.nav.home}
                className="icon-hover hidden h-9 w-9 items-center justify-center rounded-lg md:flex"
              >
                <span className="material-symbols-outlined text-[20px]">
                  home
                </span>
              </Link>
            </Tooltip>
          ) : null}
          <Tooltip label={dict.topBar.search} placement="bottom">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label={dict.topBar.search}
              // In the dense studio top bar (avatar present) the search palette is
              // low-value on phones, so hide it there to keep Export/Share in view.
              // The dashboard keeps search on mobile.
              className={`icon-hover h-9 items-center gap-2 rounded-lg ps-2 pe-2.5 ${
                avatar ? "hidden md:flex" : "flex"
              }`}
            >
              <span className="material-symbols-outlined text-[20px]">search</span>
              <kbd className="hidden rounded border border-border bg-overlay-soft px-1.5 py-0.5 font-sans text-[10px] font-medium leading-none text-muted md:inline-block">
                ⌘K
              </kbd>
            </button>
          </Tooltip>
        </div>

        {/* Theme + language — pinned to the end (visual left). Theme is still an
            icon-only placeholder; language is the real chrome chooser (same
            translate icon, now a dropdown menu). */}
        <div className="pointer-events-auto flex items-center gap-1">
          <HealthDot />
          {/* Theme + language: in the studio (avatar present) these duplicate the
              avatar menu's controls, so hide them on phones to free room for the
              Export/Share actions passed via `trailing`. The dashboard top bar
              has space and keeps them visible. */}
          <span
            className={
              avatar
                ? "hidden items-center gap-1 md:flex"
                : "flex items-center gap-1"
            }
          >
            <ThemeToggle />
            <LanguageMenu />
          </span>
          {trailing}
        </div>
      </div>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}

// Command-palette search overlay — a centered, dimmed dark panel that wraps
// HeaderSearch in its `palette` variant (input + inline results + footer hint).
// Portalled to body so it sits above everything. Esc / backdrop-click dismiss.
function SearchOverlay({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { dir } = useLocale();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="search-dim"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="modal-dim fixed inset-0 z-[1000]"
          />
          {/* Centered wrapper — flex-centers the palette on the page. The
              motion lives on the wrapper so the panel itself stays a plain
              centered box (no transform conflict with the centering). */}
          <motion.div
            key="search-panel"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-none fixed inset-0 z-[1001] flex items-center justify-center p-4"
          >
            <div
              dir={dir}
              className="pointer-events-auto w-[min(92vw,580px)] overflow-hidden rounded-xl"
              style={{
                background: "var(--tq-surface)",
                border: "1px solid var(--tq-border-hairline)",
              }}
            >
              <HeaderSearch autoFocus variant="palette" />
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
