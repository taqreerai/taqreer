"use client";

// ─── DashboardPreview ────────────────────────────────────────────────
//
// Interactive HTML demo that replaces the static `/hero.png` screenshot
// inside the landing hero's browser-chrome frame. The four QuickActions
// cards on the dashboard view are the ONLY interactive elements — each
// one swaps the panel to a static rendering of the corresponding flow
// (/create, /enhance, /mimic, /social). Files cannot actually be
// uploaded — the dropzones are visual chrome only (no <input type=file>
// is rendered) so this is purely an HTML view.
//
// User direction (2026-05-28):
//   • Cards reveal a static HTML rendering of each flow, NOT navigation
//     to the real protected routes
//   • Recent projects + templates render as the SAME layout as the real
//     dashboard (3 cols × 2 rows = 6 tiles per widget), but as plain
//     glass surfaces with varied --tq-tint-opacity — no AI-slop gradients
//   • Sidebar shows COLLAPSED (icon-only) state; hover hits are
//     CIRCULAR (not elongated pills)
//   • Top icon on the sidebar uses `/icon-white.svg` (monochrome) —
//     matches the real Sidebar after the 2026-05-28 white-icon swap
//   • Flow card content mirrors the real flow pages (icons, headers,
//     copy) so a returning user reads each view as the actual app
//   • More vertical spacing above the flow title so it doesn't touch
//     the dashboard header bar
//
// Standalone — does not share code with the real `(app)/` flows. The
// real dashboard/components are auth-gated and depend on Prisma data,
// `useUser`, `usePathname`, etc., none of which fit a static marketing
// preview. Visual fidelity comes from reusing the design-system
// classes (`.qa-card`, `.surface-card`, `.nav-active`, `.nav-item`,
// `.sidebar-bg`, `.btn-pill`, `.input-dark`, `.divider-dark`,
// `.badge-purple`, `.progress-track`, `.progress-bar`) and brand
// tokens (`--tq-violet`, `--tq-blue`, `--tq-magenta`, `--tq-lavender`,
// `--tq-surface`, `--tq-border-hairline`, `--tq-tint-opacity`, etc.) —
// no hardcoded hex.
//
// The component sits inside the browser-chrome frame in
// `components/marketing/Hero.tsx`. The frame owns the rounded outer
// border + bottom-fade mask; this component owns the dashboard content
// + flow swap.

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AnimatedIcon } from "@/components/icons/AnimatedIcon";
import type { AnimatedIconHandle } from "@/components/icons/types";
import { ParagraphWriteIcon } from "@/components/preview/ParagraphWriteIcon";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { SLIDE_DIMENSIONS, type SlideFormat } from "@/lib/schema/slide";
import {
  SOCIAL_PLATFORMS,
  PLATFORM_LABEL,
  ratiosForPlatform,
  defaultRatioFor,
  DEFAULT_PLATFORM,
} from "@/lib/social/platforms";

type View = "dashboard" | "create" | "enhance" | "mimic" | "social";

// Quick-action card metadata. Copy (title/desc) is resolved from the
// dictionary at render time via `dict.landing.preview.quickActions[id]`
// so the cards follow the UI locale.
const QUICK_ACTIONS: Array<{
  id: Exclude<View, "dashboard">;
  icon: string;
}> = [
  { id: "create", icon: "add_circle" },
  { id: "enhance", icon: "auto_fix_high" },
  { id: "mimic", icon: "content_copy" },
  { id: "social", icon: "tag" },
];

// Sidebar icon list — mirrors `components/app/Sidebar.tsx` exactly so a
// returning user reads the demo as "yes, this is the same app". `home`
// is the active item on the dashboard view; flow views activate the
// matching action button instead.
// `labelKey` indexes `dict.landing.preview.sidebar.*` for the icon-only
// nav dot's accessible name — resolved at render time so it follows the
// UI locale.
const SIDEBAR_ITEMS: Array<{
  id: View | "projects" | "templates" | "brand-kits" | "favorites" | "settings";
  icon: string;
  // Accessible name for the icon-only nav dot (no visible text label).
  // Reads the REAL sidebar nav dictionary (dict.nav.*) so the demo can't
  // drift from the app's own labels.
  labelKey: keyof Dictionary["nav"];
  group: "home" | "actions" | "library";
  comingSoon?: boolean;
}> = [
  { id: "dashboard", icon: "home", labelKey: "home", group: "home" },
  { id: "create", icon: "add_circle", labelKey: "create", group: "actions" },
  { id: "enhance", icon: "auto_fix_high", labelKey: "enhance", group: "actions" },
  { id: "mimic", icon: "content_copy", labelKey: "mimic", group: "actions" },
  { id: "social", icon: "tag", labelKey: "social", group: "actions" },
  { id: "projects", icon: "folder_copy", labelKey: "projects", group: "library" },
  { id: "templates", icon: "grid_view", labelKey: "templates", group: "library" },
  { id: "brand-kits", icon: "id_card", labelKey: "brandKits", group: "library" },
  { id: "favorites", icon: "star", labelKey: "favorites", group: "library" },
  { id: "settings", icon: "settings", labelKey: "settings", group: "library" },
];

// Six placeholder tiles per widget — 3 cols × 2 rows mirrors the real
// dashboard's `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` layout
// (RecentProjects.tsx). Latin numerals per project rule. Titles come
// from `dict.landing.preview.projects` (same order); the slide count is
// formatted via `dict.landing.preview.slides` at render time.
const RECENT_PROJECT_SLIDE_COUNTS = [12, 8, 16, 10, 14, 6];

// Three glass tints cycled across placeholder tiles. All driven from
// the user's `--tq-tint-opacity` preset so they scale with the same
// Settings → glass slider that controls every other surface — no
// hardcoded numbers, no random rgba.
const PLACEHOLDER_TINTS = [
  "rgba(255, 255, 255, var(--tq-tint-opacity))",
  "rgba(255, 255, 255, calc(var(--tq-tint-opacity) * 1.8))",
  "rgba(255, 255, 255, calc(var(--tq-tint-opacity) * 0.6))",
];

// View → path mapping. Used by the demo to report the "current URL"
// up to the browser chrome bar (rendered in Hero.tsx) so the URL pill
// reflects the active flow — user direction 2026-05-28.
const VIEW_TO_PATH: Record<View, string> = {
  dashboard: "/dashboard",
  create: "/create",
  enhance: "/enhance",
  mimic: "/mimic",
  social: "/social",
};

// Links this element's internal scroll to the PAGE scroll, so the demo content
// reveals IN SYNC as the visitor scrolls the landing. There is NO nested wheel
// capture (no `data-lenis-prevent`), so it can never trap the page scroll at its
// edges — the page always scrolls; the demo content just follows. Anchored when
// the view mounts (a flow only mounts on click, i.e. while in view), so it
// starts at the top, then tracks how far the demo has risen up the viewport.
function useScrollSyncedToPage<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let base: number | null = null;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) {
        el.scrollTop = 0; // view fits — nothing to reveal
        return;
      }
      const rect = el.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      if (base === null) base = center;
      // How far the demo has travelled UP since this view mounted, normalised
      // over ~60% of the viewport height → 0..1 → scrollTop (auto-clamped).
      const progress = (base - center) / (window.innerHeight * 0.6);
      el.scrollTop = Math.max(0, Math.min(1, progress)) * max;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  return ref;
}

export function DashboardPreview({
  onPathChange,
  lockedView,
}: {
  /**
   * Fired whenever the active view changes. Parent uses this to update
   * the browser chrome bar's URL pill so the demo reads as a real
   * navigation between flows.
   */
  onPathChange?: (path: string) => void;
  /**
   * Marketing spoke pages pin the demo to THEIR flow: the full dashboard
   * chrome renders (rail + top bar) with the flow's sidebar dot active,
   * but every navigation is a no-op so a visitor can't wander off the
   * page's subject. Omit for the free-roaming hero demo.
   */
  lockedView?: Exclude<View, "dashboard">;
}) {
  const dict = useDict();
  const { dir } = useLocale();
  const [view, setViewRaw] = useState<View>(lockedView ?? "dashboard");

  // Wrap setView so every view change emits the new path to the
  // parent. Keeps DashboardPreview the source of truth for the
  // current view; Hero just mirrors the path for the URL pill.
  const setView = (next: View) => {
    if (lockedView) return;
    setViewRaw(next);
    onPathChange?.(VIEW_TO_PATH[next]);
  };

  return (
    // Outer surface — flat `--tq-bg` panel sized to fill the parent
    // 3:2 frame. Originally used `.dashboard-bg` (the real page-
    // container class) but that brings a `min-height: 100vh` rule
    // which forces this inner container to be ≥ the full viewport
    // height regardless of the aspect frame around it, producing a
    // huge unfaded bottom margin (user-spotted root cause
    // 2026-05-28). Using the flat bg + the page's own violet glow
    // above gives the right look without the viewport-bound height.
    //
    // RTL is forced explicitly since the browser-chrome wrapper
    // above this component is `dir="ltr"` to get LTR URL ordering
    // — re-anchor here so the inner content direction doesn't
    // inherit from the chrome.
    <div
      dir={dir}
      className="absolute inset-0 flex"
      style={{
        overflow: "hidden",
        backgroundColor: "var(--tq-bg)",
      }}
    >
      {/* §24: thin always-collapsed icon rail (mirrors the real Sidebar). */}
      <DemoSidebar
        view={view}
        onNavigate={setView}
        dict={dict}
        locked={Boolean(lockedView)}
      />

      {/* Main column — the rounded content panel floats on the dark gutter,
          exactly like the real DashboardShell `.tq-content-panel`. No header
          anymore (the app dropped it); chrome is the rail + the top cluster. */}
      <div className="flex flex-1 flex-col p-2">
        <div
          className="relative flex-1 overflow-hidden rounded-2xl"
          style={{ backgroundColor: "var(--tq-panel)" }}
        >
          {/* Dot field — same tiled grid as the real dashboard panel. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(circle, rgba(236,238,245,0.14) 0.9px, transparent 1.1px)",
              backgroundSize: "23px 23px",
            }}
          />

          {/* Top utility cluster — search (⌘K) on the start/right, theme +
              language on the end/left (mirrors the §24 TopUtilityBar). */}
          <DemoTopBar dir={dir} />

          <AnimatePresence mode="wait">
            {view === "dashboard" ? (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="absolute inset-0 overflow-hidden"
              >
                <DashboardBody onNavigate={setView} dict={dict} dir={dir} />
              </motion.div>
            ) : (
              <motion.div
                key={view}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="absolute inset-0 overflow-hidden"
              >
                <FlowBody view={view} dict={dict} dir={dir} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar ────────────────────────────────────────────────────────
function DemoSidebar({
  view,
  onNavigate,
  dict,
  locked = false,
}: {
  view: View;
  onNavigate: (v: View) => void;
  dict: Dictionary;
  // Spoke-page pinned mode: the rail renders (active dot included) but
  // nothing navigates and no dot advertises a pointer cursor.
  locked?: boolean;
}) {
  const interactiveIds = locked
    ? new Set<string>()
    : new Set<string>(["dashboard", "create", "enhance", "mimic", "social"]);

  const groupedItems = {
    home: SIDEBAR_ITEMS.filter((i) => i.group === "home"),
    actions: SIDEBAR_ITEMS.filter((i) => i.group === "actions"),
    library: SIDEBAR_ITEMS.filter((i) => i.group === "library"),
  };

  return (
    <aside
      aria-label="Sidebar (demo)"
      // §24: thin transparent icon rail — no fill, no border, no dividers (the
      // real rail floats on the gutter). Groups are separated by spacing only.
      className="sidebar-bg flex h-full w-[54px] shrink-0 flex-col items-center"
    >
      {/* Logo — icon-only, animated ParagraphWriteIcon in hover mode. Clicking
          returns the demo to the dashboard view. */}
      <div className="flex h-12 flex-shrink-0 items-center justify-center">
        <button
          type="button"
          onClick={() => onNavigate("dashboard")}
          aria-label={dict.nav.home}
          className="pw-hover-trigger flex h-8 w-8 items-center justify-center"
        >
          <ParagraphWriteIcon mode="hover" size={22} />
        </button>
      </div>

      {/* Body — home · actions · library groups, separated by spacing. */}
      <div className="flex flex-1 flex-col items-center">
        <div className="flex flex-col items-center py-1">
          {groupedItems.home.map((item) => (
            <SidebarDot
              key={item.id}
              item={item}
              dict={dict}
              active={view === item.id}
              interactive={interactiveIds.has(item.id)}
              onClick={() => {
                if (item.id === "dashboard") onNavigate("dashboard");
              }}
            />
          ))}
        </div>

        <div className="h-2" />

        <div className="flex flex-col items-center py-1">
          {groupedItems.actions.map((item) => (
            <SidebarDot
              key={item.id}
              item={item}
              dict={dict}
              active={view === item.id}
              interactive={interactiveIds.has(item.id)}
              onClick={() => {
                if (
                  item.id === "create" ||
                  item.id === "enhance" ||
                  item.id === "mimic" ||
                  item.id === "social"
                ) {
                  onNavigate(item.id);
                }
              }}
            />
          ))}
        </div>

        <div className="h-2" />

        <nav className="flex flex-col items-center py-1">
          {groupedItems.library.map((item) => (
            <SidebarDot
              key={item.id}
              item={item}
              dict={dict}
              active={false}
              interactive={false}
              onClick={() => {
                /* non-interactive in the demo */
              }}
            />
          ))}
        </nav>
      </div>

      {/* Profile avatar pinned to the bottom. */}
      <div className="flex items-center justify-center py-2">
        <div
          className="h-7 w-7 rounded-full"
          style={{ backgroundImage: "var(--tq-gradient-brand)" }}
          aria-hidden
        />
      </div>
    </aside>
  );
}

function SidebarDot({
  item,
  dict,
  active,
  interactive,
  onClick,
}: {
  item: (typeof SIDEBAR_ITEMS)[number];
  dict: Dictionary;
  active: boolean;
  interactive: boolean;
  onClick: () => void;
}) {
  // FIXED-SIZE 36 × 36 circle so the hover/active background is a
  // perfect circle (not an elongated oval). The real Sidebar uses
  // 44 × 44 with width:100% inside a 80 px rail — but in this demo
  // we want each item to read as a discrete icon button.
  //
  // Animation is driven by BUTTON hover (not icon hover) — the icon
  // ref's start/stop hooks fire on mouseenter / mouseleave on the
  // pill itself per user direction 2026-05-28.
  const iconRef = useRef<AnimatedIconHandle>(null);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => iconRef.current?.startAnimation()}
      onMouseLeave={() => iconRef.current?.stopAnimation()}
      aria-label={dict.nav[item.labelKey]}
      aria-current={active ? "page" : undefined}
      className={`my-1 flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200 ${
        active ? "nav-active" : "nav-item"
      } ${interactive ? "cursor-pointer" : "cursor-default"}`}
    >
      <div
        style={{
          color: active ? "var(--tq-text-primary)" : "var(--tq-text-muted)",
        }}
      >
        <AnimatedIcon ref={iconRef} name={item.icon} size={16} />
      </div>
    </button>
  );
}

// One QuickActions card in the demo dashboard. Owns its own icon
// ref so hovering the card (not the icon) drives the animation. Per
// user direction 2026-05-28: cards are 34 px @ stroke 1.5 — slightly
// lighter than the sidebar (20 px @ 2) so the larger glyph doesn't
// read as too heavy.
function DemoQACard({
  card,
  onNavigate,
  dict,
  dir,
}: {
  card: (typeof QUICK_ACTIONS)[number];
  onNavigate: (v: Exclude<View, "dashboard">) => void;
  dict: Dictionary;
  dir: "rtl" | "ltr";
}) {
  const iconRef = useRef<AnimatedIconHandle>(null);
  // Real dashboard quick-action copy (dict.quickActions.*) — card.id matches the
  // dict key directly (create / enhance / mimic / social).
  const copy = dict.quickActions[card.id];
  return (
    <button
      type="button"
      onClick={() => onNavigate(card.id)}
      onMouseEnter={() => iconRef.current?.startAnimation()}
      onMouseLeave={() => iconRef.current?.stopAnimation()}
      // `text-start` matches the real QuickActions card (which computes
      // text-align:start) so icon + title align to the leading edge — left in
      // LTR, right in RTL. Explicit (not inherited) because the marketing hero
      // wraps this demo in a `text-center` context: block-wrapped icons ignore
      // it, but the inline-flex Copy (mimic) icon + the text would inherit
      // center, reading as inconsistent direction against the other three.
      className="qa-card group relative flex min-h-[104px] flex-col gap-1.5 overflow-hidden rounded-xl p-3.5 text-start transition-all duration-200"
      dir={dir}
      aria-label={copy.title}
    >
      {/* Icon at the top; title + desc pinned to the bottom. Demo cards show the
          FULL text (no truncation — user direction) and wrap as needed. */}
      <div
        className="shrink-0 transition-colors group-hover:text-foreground"
        style={{ color: "var(--tq-text-muted)" }}
      >
        <AnimatedIcon
          ref={iconRef}
          name={card.icon}
          size={22}
          strokeWidth={1.5}
        />
      </div>
      <div className="mt-auto w-full">
        <h3 className="text-[11px] font-semibold leading-snug text-foreground">
          {copy.title}
        </h3>
        <p className="mt-0.5 text-[9px] leading-relaxed text-[var(--tq-text-muted)]">
          {copy.desc}
        </p>
      </div>
    </button>
  );
}

// ─── Top utility cluster (§24) ───────────────────────────────────────
// Mirrors the real TopUtilityBar: search (icon + ⌘K hint) pinned to the start
// (visual right in RTL), theme + language icons to the end (visual left).
// Static / non-interactive in the demo.
function DemoTopBar({ dir }: { dir: "rtl" | "ltr" }) {
  return (
    <div
      dir={dir}
      className="pointer-events-none absolute inset-x-0 top-2.5 z-20 flex items-center justify-between px-4"
    >
      {/* Search — start (visual right) */}
      <div className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[var(--tq-text-muted)]">
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
          search
        </span>
        <kbd className="rounded border border-foreground/15 bg-foreground/[0.04] px-1 py-0.5 text-[8px] font-medium leading-none">
          ⌘K
        </kbd>
      </div>
      {/* Theme + language — end (visual left) */}
      <div className="flex items-center gap-2 text-[var(--tq-text-muted)]">
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
          light_mode
        </span>
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
          translate
        </span>
      </div>
    </div>
  );
}

// ─── Dashboard body ─────────────────────────────────────────────────
// Vertical layout: 4 QuickAction cards → 2 widgets (recent / templates)
// → plan-usage strip pinned to the bottom via `mt-auto`. The outer
// container is `flex flex-col` + `h-full` so the column fills the
// preview's 3:2 frame; the widget row gets `flex-1` so it absorbs all
// leftover vertical space (no big black gap below the content — the
// fix to "huge bottom margin" from 2026-05-28 user feedback).
function DashboardBody({
  onNavigate,
  dict,
  dir,
}: {
  onNavigate: (v: Exclude<View, "dashboard">) => void;
  dict: Dictionary;
  dir: "rtl" | "ltr";
}) {
  const scrollRef = useScrollSyncedToPage<HTMLDivElement>();
  return (
    <div
      ref={scrollRef}
      className="relative z-10 flex h-full flex-col overflow-y-auto px-5 pt-11 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {/* Centered launcher — the 4 flow cards, vertically centered (Lovable-
          style), exactly like the real dashboard's `min-h items-center` block. */}
      <section className="flex flex-1 items-center justify-center">
        <div className="grid w-full max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
          {QUICK_ACTIONS.map((card) => (
            <DemoQACard
              key={card.id}
              card={card}
              onNavigate={onNavigate}
              dict={dict}
              dir={dir}
            />
          ))}
        </div>
      </section>

      {/* Bottom "library" card — a segmented toggle (مشاريعي ⇄ القوالب) over a
          peeking row of project tiles (mirrors the real HomeLibrary). */}
      <section className="surface-card shrink-0 rounded-2xl p-3">
        <div className="mb-2.5 flex items-center justify-between">
          <div className="flex items-center gap-0.5 rounded-full bg-[var(--tq-surface)] p-0.5 text-[9px]">
            <span className="rounded-full bg-foreground/10 px-2.5 py-1 font-medium text-foreground">
              {dict.nav.projects}
            </span>
            <span className="px-2.5 py-1 text-[var(--tq-text-muted)]">
              {dict.nav.templates}
            </span>
          </div>
          <span className="text-[9px] text-[var(--tq-text-muted)]">{dict.homeLibrary.viewAll}</span>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {RECENT_PROJECT_SLIDE_COUNTS.slice(0, 5).map((count, i) => (
            <PlaceholderTile
              key={i}
              title={dict.landing.preview.projects[i]}
              subtitle={dict.landing.preview.slides.replace("{n}", String(count))}
              tint={PLACEHOLDER_TINTS[i % PLACEHOLDER_TINTS.length]}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function PlaceholderTile({
  title,
  subtitle,
  tint,
}: {
  title: string;
  subtitle: string;
  tint: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {/* Thumbnail surface — `aspect-video` (16:9) matches the real
          ProjectThumbnail / TemplateTile. Renders a SLIDE WIREFRAME
          inside (title bar + subhead bar + 3 shape blocks) per user
          direction 2026-05-28: "the thumbnails shouldn't be empty …
          like the screenshot but without colors make them diff
          opacities". Wireframe content is left-aligned (slide-content
          left-edge anchored) regardless of page direction — slides
          themselves aren't inherently RTL. */}
      <div
        className="aspect-video w-full overflow-hidden rounded-[10px] border border-[var(--tq-border-hairline)] p-2"
        style={{ background: tint }}
      >
        <SlideWireframe />
      </div>
      {/* Footer — title + subtitle, same hierarchy as the real tile's info row.
          Aligned to the logical start so it reads correctly in both directions
          (start = right in RTL, matching the original Arabic-era intent). */}
      <div className="px-0.5 text-start">
        <p className="truncate text-[10px] font-semibold leading-tight text-foreground">
          {title}
        </p>
        <p className="truncate text-[9px] text-[var(--tq-text-muted)]">
          {subtitle}
        </p>
      </div>
    </div>
  );
}

// ─── SlideWireframe ─────────────────────────────────────────────────
// Mini slide layout drawn inside each PlaceholderTile. Mirrors the
// user-supplied screenshot: a thick title bar at top + a thinner
// subhead bar below + a row of 3 small shape blocks underneath.
// Everything driven by `--tq-tint-opacity` calc multipliers so the
// wireframe scales with the user's Settings → glass preset — no
// hardcoded rgba.
function SlideWireframe() {
  return (
    <div className="flex h-full flex-col justify-between">
      {/* Title cluster — thick title bar + thinner subhead. */}
      <div className="flex flex-col gap-1">
        <div
          className="h-1.5 w-2/3 rounded-sm"
          style={{
            background:
              "rgba(255, 255, 255, calc(var(--tq-tint-opacity) * 3))",
          }}
        />
        <div
          className="h-1 w-1/2 rounded-sm"
          style={{
            background:
              "rgba(255, 255, 255, calc(var(--tq-tint-opacity) * 1.6))",
          }}
        />
      </div>
      {/* Shape row — 3 small rectangles in a row, decreasing opacity
          across the row so the cluster reads as a deliberate
          composition rather than 3 identical chips. */}
      <div className="flex items-end gap-1">
        <div
          className="h-3 flex-1 rounded-sm"
          style={{
            background:
              "rgba(255, 255, 255, calc(var(--tq-tint-opacity) * 2.4))",
          }}
        />
        <div
          className="h-3 flex-1 rounded-sm"
          style={{
            background:
              "rgba(255, 255, 255, calc(var(--tq-tint-opacity) * 1.4))",
          }}
        />
        <div
          className="h-3 flex-1 rounded-sm border border-[var(--tq-border-hairline)]"
          // Outline-only tile (matches the right-most rectangle in the
          // user-supplied screenshot: a "ghost" shape rendered as a
          // border with transparent fill).
          style={{ background: "transparent" }}
        />
      </div>
    </div>
  );
}

// ─── Flow body ──────────────────────────────────────────────────────
// Each flow view renders a static rendering of the real flow page's
// 3- or 4-card layout. Card icons + titles match the real CardHeader
// usage in `/create`, `/enhance`, `/mimic`, `/social` so a returning
// user reads each view as the actual flow. Inputs that would normally
// trigger a file picker are rendered as decorative cards (no
// <input type=file> is mounted) so a marketing visitor can't open the
// OS file dialog from a static demo.

function FlowBody({
  view,
  dict,
  dir,
}: {
  view: Exclude<View, "dashboard">;
  dict: Dictionary;
  dir: "rtl" | "ltr";
}) {
  const flow = getFlows(dict, dir)[view];
  const scrollRef = useScrollSyncedToPage<HTMLDivElement>();

  return (
    // `pt-8` (vs the dashboard body's `pt-5`) so the flow title sits
    // visually below the header bar with breathing room — user
    // direction 2026-05-28: "the headlines is too close to the
    // header" on the previous tight `py-5` spacing. The cards overflow
    // on a phone; the hook reveals them in sync with the PAGE scroll
    // (no nested wheel capture, so it never traps the scroll).
    <div
      ref={scrollRef}
      className="relative z-10 flex h-full flex-col overflow-y-auto px-6 pt-8 pb-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {/* `my-auto` centres the flow vertically when it fits the window; when the
          cards overflow on a phone the auto-margins collapse to 0 so it
          top-anchors and scroll-syncs instead. */}
      <div className="my-auto w-full">
      {/* Header — title + subhead. The back chip used to live here
          but moved to DemoHeader's right slot 2026-05-28 (user
          direction: "remove Taqreer logo … add العودة للوحة التحكم
          there instead") so the dashboard chrome now owns the back
          affordance. Title stays centered inside the flow body. */}
      <header className="mb-5 text-center">
        <h1 className="text-lg font-bold text-foreground">{flow.title}</h1>
        <p className="mt-1 text-[11px] text-[var(--tq-text-muted)]">
          {flow.subtitle}
        </p>
      </header>

      {/* Card grid — variable column count per flow (2-4) so each
          flow's natural shape comes through. Each card uses the
          shared `.surface-card` chrome + same header icon + bottom
          hairline pattern as the real flows. */}
      {/* Fixed-width cards in a centered row — same width across flows
          (regardless of 2 vs 3 cards), mirroring the real flows' `w-[360px]`
          columns. `items-stretch` makes them all match the tallest height. */}
      <div className="flex flex-wrap items-stretch justify-center gap-3">
        {flow.cards.map((card, idx) => (
          <FlowCard key={idx} card={card} />
        ))}
      </div>

      {/* Generate CTA — visual-only, non-functional. Disabled so it
          reads as "ready to act on something" but can't actually
          submit. */}
      <div className="mt-4 flex justify-center">
        <button
          type="button"
          disabled
          className="btn-gradient-anim rounded-full px-6 py-2 text-xs font-medium opacity-90"
          aria-disabled
        >
          {flow.cta}
        </button>
      </div>
      </div>
    </div>
  );
}

// ─── Flow card primitives ──────────────────────────────────────────
type FlowCardSpec = {
  icon: string;
  title: string;
  body: React.ReactNode;
};

type FlowSpec = {
  title: string;
  subtitle: string;
  cta: string;
  cards: FlowCardSpec[];
};

function FakeTextarea({
  placeholder,
  rows = 3,
}: {
  placeholder: string;
  rows?: number;
}) {
  // `.input-dark` sets `border-radius: 9999px` (fully rounded pill) to
  // match the `.btn-pill` vocabulary on single-line inputs. The real
  // `<textarea>` element has a globals.css override that flattens
  // the radius for multi-line inputs — but this fake is a <div>, so
  // the pill radius bleeds through and the textarea reads as a
  // stretched bar. Override inline (`borderRadius: 12`) to give it
  // a rounded-square shape that matches the real /create textarea —
  // user direction 2026-05-28.
  return (
    <div
      className="input-dark flex items-start text-[11px] leading-relaxed text-[var(--tq-text-muted)]"
      style={{
        padding: "8px 12px",
        minHeight: rows * 18 + 16,
        borderRadius: 12,
      }}
      aria-disabled
    >
      {placeholder}
    </div>
  );
}

function FakeDropzone({
  icon = "cloud_upload",
  title,
  hint,
  tall = false,
}: {
  icon?: string;
  title: string;
  hint: string;
  // `tall` = the large centered drop area the real flows use as a card's
  // PRIMARY action (enhance file, mimic reference); it grows
  // to fill the card. The default compact row is for secondary dropzones.
  tall?: boolean;
}) {
  if (tall) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-foreground/20 bg-overlay-soft p-4 text-center"
        aria-disabled
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--tq-surface)]">
          <span
            className="material-symbols-outlined text-foreground/80"
            style={{ fontSize: 18 }}
          >
            {icon}
          </span>
        </span>
        <p className="text-[11px] font-semibold text-foreground">{title}</p>
        <p className="text-[10px] text-foreground/40">{hint}</p>
      </div>
    );
  }
  return (
    <div
      className="flex items-center gap-2 rounded-xl border border-dashed border-foreground/20 bg-overlay-soft p-2.5"
      aria-disabled
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--tq-surface)]">
        <span
          className="material-symbols-outlined text-foreground/80"
          style={{ fontSize: 14 }}
        >
          {icon}
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 truncate text-[10px] text-foreground/40">{hint}</p>
      </div>
    </div>
  );
}

// ─── Real-flow control mirrors ──────────────────────────────────────
// Small static stand-ins for the real flow primitives (PersistentRow,
// BrandFontPicker, AIImagesPanel, DesignStylePicker, SlideSizeFields,
// instructions textarea). All copy reads dict.flows.* so the demo can't
// drift from the app.

// The project's single typeface (CLAUDE.md: Cairo only). A font family name
// is data, not translatable copy — so it stays a literal here.
const DEMO_FONT_FAMILY = "Cairo";

function FakePersistentRow({ dict, dir }: { dict: Dictionary; dir: "rtl" | "ltr" }) {
  return (
    <div
      className="input-dark flex items-center text-[11px] text-[var(--tq-text-muted)]"
      style={{ padding: "7px 12px", borderRadius: 9999 }}
      dir={dir}
      aria-disabled
    >
      {dict.flows.brand.persistentPlaceholder}
    </div>
  );
}

function FakeFontPicker({ dict }: { dict: Dictionary }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold text-foreground/70">
        {dict.flows.fonts.fonts}
      </span>
      <FakeFontSlot label="Aa" family={DEMO_FONT_FAMILY} />
      <div className="flex items-center gap-2 text-[9px] text-foreground/40">
        <div className="h-px flex-1 bg-[var(--tq-border-hairline)]" />
        <span>{dict.flows.fonts.orUpload}</span>
        <div className="h-px flex-1 bg-[var(--tq-border-hairline)]" />
      </div>
    </div>
  );
}

function FakeAIImagesPanel({ dict, dir }: { dict: Dictionary; dir: "rtl" | "ltr" }) {
  return (
    <div
      className="flex items-center gap-2 rounded-xl border border-[var(--tq-border-hairline)] p-2.5"
      style={{ background: "rgba(var(--tq-violet-rgb), 0.08)" }}
    >
      <span
        className="material-symbols-outlined text-foreground/80"
        style={{ fontSize: 16 }}
      >
        image
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-foreground">
          {dict.flows.brand.aiImagesTitle}
        </p>
        <p className="text-[9px] leading-relaxed text-[var(--tq-text-muted)]">
          {dict.flows.brand.aiImagesDesc}
        </p>
      </div>
      <FakeToggle on dir={dir} />
    </div>
  );
}

function FakeDesignStyleRow({ dict, label }: { dict: Dictionary; label?: string }) {
  return (
    <FieldRow label={label ?? dict.flows.designStyle}>
      <span className="rounded-full border border-[var(--tq-border-hairline)] bg-[var(--tq-card)] px-2 py-0.5 text-[10px] text-foreground">
        {dict.flows.stylePicker.auto}
      </span>
    </FieldRow>
  );
}

function FakeSlideSize({ dict }: { dict: Dictionary }) {
  // 16:9 / 9:16 are universal aspect tokens (Latin numerals); the label is
  // localized.
  return (
    <FieldRow label={dict.flows.output.slideSize}>
      <FakeSegmented options={["16:9", "9:16"]} active={0} />
    </FieldRow>
  );
}

// Static stand-in for SocialFormatFields: platform pills + ratio tiles for the
// default platform (Instagram). Driven from the real source of truth
// (lib/social/platforms + SLIDE_DIMENSIONS) so it can't drift, and the px label
// is the ACTUAL export size, mirroring the real picker.
const SOCIAL_RATIO_ASPECT: Record<SlideFormat, string> = {
  "16:9": "16 / 9",
  "9:16": "9 / 16",
  "3:4": "3 / 4",
  "1:1": "1 / 1",
  "4:5": "4 / 5",
};

function FakeSocialFormat({ dict }: { dict: Dictionary }) {
  const f = dict.flows;
  const platform = DEFAULT_PLATFORM; // instagram
  const ratios = ratiosForPlatform(platform); // [4:5, 1:1, 9:16]
  const activeFormat = defaultRatioFor(platform).format; // 4:5
  return (
    <div className="flex flex-col gap-3">
      {/* Platform pills */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold text-foreground/70">
          {f.social.platform}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {SOCIAL_PLATFORMS.map((p) => {
            const active = p === platform;
            return (
              <span
                key={p}
                className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${
                  active
                    ? "border-[var(--tq-blue)] text-[var(--tq-blue)]"
                    : "border-foreground/20 text-foreground/60"
                }`}
              >
                {PLATFORM_LABEL[p]}
              </span>
            );
          })}
        </div>
      </div>
      {/* Ratio tiles for the selected platform */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold text-foreground/70">
          {f.social.ratio}
        </span>
        <div className="grid grid-cols-1 gap-1.5">
          {ratios.map((r) => {
            const active = r.format === activeFormat;
            const d = SLIDE_DIMENSIONS[r.format];
            return (
              <div
                key={r.format}
                className="flex h-9 items-center justify-between gap-2 rounded-lg border px-2.5"
                style={{
                  background: "var(--tq-overlay-soft)",
                  borderColor: active
                    ? "var(--tq-blue)"
                    : "var(--tq-border-hairline)",
                }}
              >
                <span className="flex flex-col items-start leading-tight">
                  <span
                    className={`text-[11px] font-semibold ${active ? "text-[var(--tq-blue)]" : "text-foreground/70"}`}
                  >
                    {f.social.ratios[r.nameKey]}
                  </span>
                  <span
                    dir="ltr"
                    className={`text-[9px] tabular-nums ${active ? "text-foreground/70" : "text-foreground/40"}`}
                  >
                    {d.width} x {d.height} · {r.format}
                  </span>
                </span>
                <span
                  className="rounded-xs border border-foreground/30 bg-foreground/10"
                  style={{ height: 18, aspectRatio: SOCIAL_RATIO_ASPECT[r.format] }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FakePalette({ colors }: { colors: string[] }) {
  return (
    <div className="flex items-center gap-1.5">
      {colors.map((c, i) => (
        <div
          key={i}
          className="h-5 w-5 rounded-md border border-foreground/20"
          style={{ background: c }}
          aria-hidden
        />
      ))}
      <div className="flex h-5 w-5 items-center justify-center rounded-md border border-dashed border-foreground/20 text-foreground/60">
        <span className="material-symbols-outlined" style={{ fontSize: 12 }}>
          add
        </span>
      </div>
    </div>
  );
}

function FakeSegmented({
  options,
  active,
  variant = "default",
}: {
  options: string[];
  active: number;
  variant?: "default" | "primary";
}) {
  // Mirror the real SegmentedToggle (components/create/controls): a --tq-card
  // track with a solid active pill. default = inverse (bg-foreground /
  // text-background); primary = brand-blue + white (the language picker).
  // Both flip correctly in light + dark — the old bg-black/25 track + faint
  // bg-foreground/10 active read as a dark pill in light.
  const activeCls =
    variant === "primary"
      ? "bg-[var(--tq-blue)] text-white"
      : "bg-foreground text-background";
  return (
    <div className="flex items-center gap-0.5 rounded-full border border-[var(--tq-border-hairline)] bg-[var(--tq-card)] p-0.5">
      {options.map((label, i) => (
        <span
          key={i}
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            i === active ? activeCls : "text-foreground/60"
          }`}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function FakeToggle({ on, dir }: { on: boolean; dir: "rtl" | "ltr" }) {
  // The knob rests at the inline-start when off and the inline-end when
  // on. Resolve that to a physical side so it mirrors with the locale:
  // LTR → start=left/end=right (off=left, on=right); RTL flips both.
  const start = dir === "rtl" ? "right" : "left";
  const end = dir === "rtl" ? "left" : "right";
  return (
    <div
      className={`relative h-4 w-7 rounded-full transition-colors ${
        on ? "tq-switch-on" : "bg-foreground/10"
      }`}
    >
      <div
        className="absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)] transition-all"
        style={{ [on ? end : start]: 2 } as React.CSSProperties}
      />
    </div>
  );
}

function FakeFontSlot({
  label,
  family,
}: {
  label: string;
  family: string;
}) {
  return (
    <div
      className="flex items-center justify-between rounded-md border border-[var(--tq-border-hairline)] bg-overlay-soft px-2"
      style={{ height: 28 }}
    >
      <span className="text-[10px] text-[var(--tq-text-muted)]">{label}</span>
      <span className="truncate text-[11px] font-semibold text-foreground">
        {family}
      </span>
    </div>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[20px] items-center justify-between gap-2">
      <span className="text-[11px] font-semibold text-foreground/70">{label}</span>
      {children}
    </div>
  );
}

function CardSeparator() {
  return <div className="border-t border-[var(--tq-border-hairline)]" />;
}

export function FlowCard({ card }: { card: FlowCardSpec }) {
  return (
    <div className="surface-card flex w-[210px] min-h-[300px] shrink-0 flex-col gap-2.5 rounded-2xl p-3">
      {/* Card header — icon + title + hairline separator. Matches the
          real `CardHeader` primitive: `<span class="material-symbols-
          outlined"> + bold title + border-b`. */}
      <div className="flex items-center gap-2 border-b border-[var(--tq-border-hairline)] pb-2">
        <span
          className="material-symbols-outlined text-foreground"
          style={{ fontSize: 14 }}
        >
          {card.icon}
        </span>
        <span className="text-xs font-semibold text-foreground">{card.title}</span>
      </div>
      <div className="flex flex-1 flex-col gap-2">{card.body}</div>
    </div>
  );
}

// ─── Per-flow card specs ────────────────────────────────────────────
// Icons + titles + Arabic copy track the real flow pages verbatim:
//
// Each flow now mirrors the current real pages: MAX 3 cards, with one
// consolidated "الهوية البصرية" card (colors + fonts + logo) — not the old
// split fonts/logo cards.
//   • /create     →  subject (المحتوى) / palette (الهوية البصرية)
//                    / settings (إعدادات الإخراج)
//   • /enhance    →  subject (الملف الأصلي) / palette (الهوية البصرية)
//   • /mimic      →  subject (المحتوى) / palette (الهوية البصرية)
//                    / auto_awesome (ما الذي نحاكيه)
//   • /social     →  edit_note (المحتوى) / palette (الهوية البصرية)
//                    / tune (التصميم)

// Builds the per-flow card specs from the REAL flow dictionary (dict.flows.*)
// so the demo's copy + feature set track the actual /create /enhance /mimic
// /social pages and can't drift. `dir` is threaded into every control that
// mirrors with the locale. Only universal aspect tokens ("16:9", "9:16") and
// the typeface name stay literal (they aren't translatable copy).
export function getFlows(
  dict: Dictionary,
  dir: "rtl" | "ltr",
): Record<Exclude<View, "dashboard">, FlowSpec> {
  const f = dict.flows;
  const cta = f.generate.create;
  // The real flows all render ONE consolidated brand-identity card (palette +
  // fonts + logo + save-default). `withAi` appends the AI-images panel to the
  // BRAND card - only mimic has it there; create + social carry the panel in
  // their CONTENT cards (2026-08-03), enhance has none.
  const brandCard = (palette: string[], withAi: boolean): FlowCardSpec => ({
    icon: "palette",
    title: f.brandCard,
    body: (
      <>
        <FieldRow label={f.colors}>
          <FakePalette colors={palette} />
        </FieldRow>
        <CardSeparator />
        <FakeFontPicker dict={dict} />
        <CardSeparator />
        <FakeDropzone icon="image" title={f.logo} hint={f.brand.svgOnly} />
        <FieldRow label={f.saveAsDefault}>
          <FakeToggle on={false} dir={dir} />
        </FieldRow>
        {withAi ? (
          <>
            <CardSeparator />
            <FakeAIImagesPanel dict={dict} dir={dir} />
          </>
        ) : null}
      </>
    ),
  });
  // Brand-gradient swatches (blue -> violet -> purple). Literal token names on
  // purpose: post-§21 the colour tokens all alias one accent, so this reads
  // monochrome by design.
  const TRIAD = ["var(--tq-brand-blue)", "var(--tq-brand-purple)", "var(--tq-violet)"];
  return {
    create: {
      title: f.create.title,
      subtitle: f.create.subtitle,
      cta,
      cards: [
        {
          icon: "subject",
          title: f.contentCard,
          body: (
            <>
              <FieldRow label={f.language}>
                <FakeSegmented options={[f.langArabic, f.langEnglish]} active={0} variant="primary" />
              </FieldRow>
              <FakeTextarea placeholder={f.contentPlaceholder} rows={3} />
              <div className="flex items-center gap-2 text-[10px] text-foreground/40">
                <div className="h-px flex-1 bg-[var(--tq-border-hairline)]" />
                <span>{f.or}</span>
                <div className="h-px flex-1 bg-[var(--tq-border-hairline)]" />
              </div>
              <FakeDropzone title={f.dropTitle} hint={f.dropSubtitle} />
              <CardSeparator />
              <FakePersistentRow dict={dict} dir={dir} />
            </>
          ),
        },
        brandCard(TRIAD, false),
        {
          icon: "settings",
          title: f.outputCard,
          body: (
            <>
              <FakeSlideSize dict={dict} />
              <CardSeparator />
              <FieldRow label={f.slideCount}>
                <FakeSegmented options={[f.auto, f.custom]} active={0} />
              </FieldRow>
              <CardSeparator />
              <FieldRow label={f.slideNumbering}>
                <FakeToggle on dir={dir} />
              </FieldRow>
              <CardSeparator />
              <FakeDesignStyleRow dict={dict} />
              <CardSeparator />
              <FakeAIImagesPanel dict={dict} dir={dir} />
            </>
          ),
        },
      ],
    },
    enhance: {
      title: f.enhance.title,
      subtitle: f.enhance.subtitle,
      cta,
      cards: [
        {
          icon: "upload_file",
          title: f.enhance.originalFile,
          body: (
            <FakeDropzone
              tall
              icon="upload_file"
              title={f.enhance.dragDrop}
              hint={f.enhance.fileHint}
            />
          ),
        },
        brandCard(["var(--tq-brand-blue)", "var(--tq-violet)"], false),
      ],
    },
    mimic: {
      title: f.mimic.title,
      subtitle: f.mimic.subtitle,
      cta,
      cards: [
        {
          icon: "subject",
          title: f.contentCard,
          body: (
            <>
              <FakeTextarea placeholder={f.contentPlaceholder} rows={3} />
              <div className="flex items-center gap-2 text-[10px] text-foreground/40">
                <div className="h-px flex-1 bg-[var(--tq-border-hairline)]" />
                <span>{f.or}</span>
                <div className="h-px flex-1 bg-[var(--tq-border-hairline)]" />
              </div>
              <FakeDropzone title={f.mimic.dragOrClick} hint={f.mimic.fileHint} />
              <CardSeparator />
              <FakeSlideSize dict={dict} />
            </>
          ),
        },
        brandCard(TRIAD, true),
        {
          icon: "auto_awesome",
          title: f.mimic.whatToMimic,
          body: (
            <>
              <FieldRow label={f.slideCount}>
                <FakeSegmented options={[f.auto, f.custom]} active={0} />
              </FieldRow>
              <CardSeparator />
              <FakeDropzone
                tall
                icon="style"
                title={f.mimic.dragDrop}
                hint={f.mimic.fileHint}
              />
            </>
          ),
        },
      ],
    },
    social: {
      title: f.social.title,
      subtitle: f.social.subtitle,
      cta,
      // Mirrors the real /social content card order (2026-08-08): language →
      // textarea → product-photo dropzone → AI-images panel → persistent row;
      // the design card no longer carries the images panel (it moved to the
      // content card 2026-08-03, same as /create).
      cards: [
        {
          icon: "edit_note",
          title: f.social.contentCard,
          body: (
            <>
              <FieldRow label={f.language}>
                <FakeSegmented options={[f.langArabic, f.langEnglish]} active={0} variant="primary" />
              </FieldRow>
              <FakeTextarea placeholder={f.social.topicPlaceholder} rows={2} />
              <FakeDropzone
                icon="photo_camera"
                title={f.social.productPhoto}
                hint={f.social.productPhotoHint}
              />
              <CardSeparator />
              <FakeAIImagesPanel dict={dict} dir={dir} />
              <CardSeparator />
              <FakePersistentRow dict={dict} dir={dir} />
            </>
          ),
        },
        brandCard(TRIAD, false),
        {
          icon: "tune",
          title: f.social.designCard,
          body: (
            <>
              <FakeSocialFormat dict={dict} />
              <CardSeparator />
              <FieldRow label={f.social.count}>
                <FakeSegmented options={[f.auto, f.custom]} active={0} />
              </FieldRow>
              <CardSeparator />
              <FakeDesignStyleRow dict={dict} label={f.social.style} />
            </>
          ),
        },
      ],
    },
  };
}
