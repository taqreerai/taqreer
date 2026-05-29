"use client";

// ─── DashboardPreview ────────────────────────────────────────────────
//
// Interactive HTML demo that replaces the static `/hero.png` screenshot
// inside the landing hero's browser-chrome frame. The four QuickActions
// cards on the dashboard view are the ONLY interactive elements — each
// one swaps the panel to a static rendering of the corresponding flow
// (/create, /enhance, /mimic, /datasheet). Files cannot actually be
// uploaded — the dropzones are visual chrome only (no <input type=file>
// is rendered) so this is purely an HTML view.
//
// User direction (2026-05-28):
//   • Cards reveal a static HTML rendering of each flow, NOT navigation
//     to the real protected routes
//   • Recent projects + templates render as the SAME layout as the real
//     dashboard (3 cols × 2 rows = 6 tiles per widget), but as plain
//     glass surfaces with varied --glass-opacity — no AI-slop gradients
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
// classes (`.qa-card`, `.glass-card`, `.nav-active`, `.nav-item`,
// `.sidebar-bg`, `.btn-pill`, `.input-dark`, `.divider-dark`,
// `.badge-purple`, `.progress-track`, `.progress-bar`) and brand
// tokens (`--tq-violet`, `--tq-blue`, `--tq-magenta`, `--tq-lavender`,
// `--tq-bg-glass`, `--tq-border-glass`, `--glass-opacity`, etc.) —
// no hardcoded hex.
//
// The component sits inside the browser-chrome frame in
// `components/marketing/Hero.tsx`. The frame owns the rounded outer
// border + bottom-fade mask; this component owns the dashboard content
// + flow swap.

import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AnimatedIcon } from "@/components/icons/AnimatedIcon";
import type { AnimatedIconHandle } from "@/components/icons/types";
import { ParagraphWriteIcon } from "@/components/preview/ParagraphWriteIcon";

type View = "dashboard" | "create" | "enhance" | "mimic" | "datasheet";

const QUICK_ACTIONS: Array<{
  id: Exclude<View, "dashboard">;
  icon: string;
  title: string;
  desc: string;
}> = [
  {
    id: "create",
    icon: "add_circle",
    title: "إنشاء عرض جديد",
    desc: "ابدأ من الصفر بمحتواك",
  },
  {
    id: "enhance",
    icon: "auto_fix_high",
    title: "تحسين عرض موجود",
    desc: "ارفع ملفك واحصل على نسخة محسّنة",
  },
  {
    id: "mimic",
    icon: "content_copy",
    title: "محاكاة أسلوب عرض",
    desc: "انسخ أسلوب عرض آخر وطبّقه",
  },
  {
    id: "datasheet",
    icon: "dataset",
    title: "إنشاء من بيانات",
    desc: "حوّل ملف Excel إلى عرض احترافي",
  },
];

// Sidebar icon list — mirrors `components/app/Sidebar.tsx` exactly so a
// returning user reads the demo as "yes, this is the same app". `home`
// is the active item on the dashboard view; flow views activate the
// matching action button instead.
const SIDEBAR_ITEMS: Array<{
  id: View | "projects" | "templates" | "brand-kits" | "favorites" | "settings";
  icon: string;
  // Accessible name for the icon-only nav dot (no visible text label).
  label: string;
  group: "home" | "actions" | "library";
  comingSoon?: boolean;
}> = [
  { id: "dashboard", icon: "home", label: "الرئيسية", group: "home" },
  { id: "create", icon: "add_circle", label: "إنشاء عرض جديد", group: "actions" },
  { id: "enhance", icon: "auto_fix_high", label: "تحسين عرض موجود", group: "actions" },
  { id: "mimic", icon: "content_copy", label: "محاكاة أسلوب عرض", group: "actions" },
  { id: "datasheet", icon: "dataset", label: "إنشاء من بيانات", group: "actions", comingSoon: true },
  { id: "projects", icon: "folder_copy", label: "المشاريع", group: "library" },
  { id: "templates", icon: "grid_view", label: "القوالب", group: "library" },
  { id: "brand-kits", icon: "id_card", label: "الهويات البصرية", group: "library" },
  { id: "favorites", icon: "star", label: "المفضلة", group: "library" },
  { id: "settings", icon: "settings", label: "الإعدادات", group: "library" },
];

// Six placeholder titles per widget — 3 cols × 2 rows mirrors the real
// dashboard's `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` layout
// (RecentProjects.tsx). Latin numerals per project rule.
const RECENT_PROJECTS = [
  { title: "خطة عمل 2026", subtitle: "12 شريحة" },
  { title: "تقرير المبيعات", subtitle: "8 شرائح" },
  { title: "عرض المنتج الجديد", subtitle: "16 شريحة" },
  { title: "ملخص الربع الثالث", subtitle: "10 شرائح" },
  { title: "استراتيجية التسويق", subtitle: "14 شريحة" },
  { title: "نتائج الحملة", subtitle: "6 شرائح" },
];

const TEMPLATES = [
  { title: "قالب احترافي", subtitle: "16:9" },
  { title: "قالب إبداعي", subtitle: "16:9" },
  { title: "قالب تقني", subtitle: "16:9" },
  { title: "قالب تسويقي", subtitle: "16:9" },
  { title: "قالب تعليمي", subtitle: "16:9" },
  { title: "قالب مالي", subtitle: "16:9" },
];

// Three glass tints cycled across placeholder tiles. All driven from
// the user's `--glass-opacity` preset so they scale with the same
// Settings → glass slider that controls every other surface — no
// hardcoded numbers, no random rgba.
const PLACEHOLDER_TINTS = [
  "rgba(255, 255, 255, var(--glass-opacity))",
  "rgba(255, 255, 255, calc(var(--glass-opacity) * 1.8))",
  "rgba(255, 255, 255, calc(var(--glass-opacity) * 0.6))",
];

// View → path mapping. Used by the demo to report the "current URL"
// up to the browser chrome bar (rendered in Hero.tsx) so the URL pill
// reflects the active flow — user direction 2026-05-28.
const VIEW_TO_PATH: Record<View, string> = {
  dashboard: "/dashboard",
  create: "/create",
  enhance: "/enhance",
  mimic: "/mimic",
  datasheet: "/datasheet",
};

export function DashboardPreview({
  onPathChange,
}: {
  /**
   * Fired whenever the active view changes. Parent uses this to update
   * the browser chrome bar's URL pill so the demo reads as a real
   * navigation between flows.
   */
  onPathChange?: (path: string) => void;
}) {
  const [view, setViewRaw] = useState<View>("dashboard");

  // Wrap setView so every view change emits the new path to the
  // parent. Keeps DashboardPreview the source of truth for the
  // current view; Hero just mirrors the path for the URL pill.
  const setView = (next: View) => {
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
      dir="rtl"
      className="absolute inset-0 flex"
      style={{
        overflow: "hidden",
        backgroundColor: "var(--tq-bg)",
      }}
    >
      {/* ── Sidebar (collapsed, icon-only) ── */}
      <DemoSidebar view={view} onNavigate={setView} />

      {/* ── Main content column ── */}
      <div className="flex flex-1 flex-col">
        <DemoHeader
          view={view}
          onBack={() => setView("dashboard")}
        />

        <div className="relative flex-1 overflow-hidden">
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
                <DashboardBody onNavigate={setView} />
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
                <FlowBody view={view} />
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
}: {
  view: View;
  onNavigate: (v: View) => void;
}) {
  const interactiveIds = new Set<string>([
    "dashboard",
    "create",
    "enhance",
    "mimic",
    "datasheet",
  ]);

  const groupedItems = {
    home: SIDEBAR_ITEMS.filter((i) => i.group === "home"),
    actions: SIDEBAR_ITEMS.filter((i) => i.group === "actions"),
    library: SIDEBAR_ITEMS.filter((i) => i.group === "library"),
  };

  return (
    <aside
      aria-label="Sidebar (demo)"
      // 64 px wide — shrunk one rung from the real 80 px collapsed
      // sidebar so the preview's inner content has more horizontal
      // room inside the hero's 3:2 frame.
      className="sidebar-bg flex h-full w-[64px] shrink-0 flex-col border-l border-[var(--tq-border-glass)]"
    >
      {/* Logo — icon-only (matches the real Sidebar's collapsed state).
          Animated `ParagraphWriteIcon` in "hover" mode: idle static
          rest state by default, infinite write-loop only while the
          button is hovered. Clicking returns the demo to the
          dashboard view. `pw-hover-trigger` is the CSS hook the
          icon's hover-mode rules gate on. User direction 2026-05-28. */}
      <div className="flex h-14 flex-shrink-0 items-center justify-center border-b border-white/[0.05]">
        <button
          type="button"
          onClick={() => onNavigate("dashboard")}
          aria-label="الرئيسية"
          // No background-on-hover — the icon's hover-mode write
          // animation IS the hover feedback (user direction 2026-05-28).
          className="pw-hover-trigger flex h-8 w-8 items-center justify-center"
        >
          <ParagraphWriteIcon mode="hover" size={30} />
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col">
        <div className="flex flex-col items-center py-1">
          {groupedItems.home.map((item) => (
            <SidebarDot
              key={item.id}
              item={item}
              active={view === item.id}
              interactive={interactiveIds.has(item.id)}
              onClick={() => {
                if (item.id === "dashboard") onNavigate("dashboard");
              }}
            />
          ))}
        </div>

        <div className="divider-dark" />

        <div className="flex flex-col items-center py-1">
          {groupedItems.actions.map((item) => (
            <SidebarDot
              key={item.id}
              item={item}
              active={view === item.id}
              interactive={interactiveIds.has(item.id)}
              onClick={() => {
                if (
                  item.id === "create" ||
                  item.id === "enhance" ||
                  item.id === "mimic" ||
                  item.id === "datasheet"
                ) {
                  onNavigate(item.id);
                }
              }}
            />
          ))}
        </div>

        <div className="divider-dark" />

        <nav className="flex flex-1 flex-col items-center py-1">
          {groupedItems.library.map((item) => (
            <SidebarDot
              key={item.id}
              item={item}
              active={false}
              interactive={false}
              onClick={() => {
                /* non-interactive in the demo */
              }}
            />
          ))}
        </nav>

        <div className="flex items-center justify-center py-2">
          <div
            className="h-8 w-8 rounded-full"
            style={{ backgroundImage: "var(--tq-gradient-brand)" }}
            aria-hidden
          />
        </div>
      </div>
    </aside>
  );
}

function SidebarDot({
  item,
  active,
  interactive,
  onClick,
}: {
  item: (typeof SIDEBAR_ITEMS)[number];
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
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      className={`my-1.5 flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200 ${
        active ? "nav-active" : "nav-item"
      } ${interactive ? "cursor-pointer" : "cursor-default"}`}
    >
      <div
        style={{
          color: active ? "var(--tq-text-primary)" : "var(--tq-text-muted)",
        }}
      >
        <AnimatedIcon ref={iconRef} name={item.icon} size={18} />
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
}: {
  card: (typeof QUICK_ACTIONS)[number];
  onNavigate: (v: Exclude<View, "dashboard">) => void;
}) {
  const iconRef = useRef<AnimatedIconHandle>(null);
  return (
    <button
      type="button"
      onClick={() => onNavigate(card.id)}
      onMouseEnter={() => iconRef.current?.startAnimation()}
      onMouseLeave={() => iconRef.current?.stopAnimation()}
      className="qa-card group flex flex-col gap-2 p-3 text-right transition-all duration-200"
      dir="rtl"
      aria-label={card.title}
    >
      <div
        className="transition-colors"
        style={{ color: "var(--tq-text-muted)" }}
      >
        <AnimatedIcon
          ref={iconRef}
          name={card.icon}
          size={27}
          strokeWidth={1.5}
        />
      </div>
      <div>
        <h3 className="mb-0.5 text-[12px] font-semibold leading-snug text-white">
          {card.title}
        </h3>
        <p className="text-[10px] leading-relaxed text-[var(--tq-text-muted)]">
          {card.desc}
        </p>
      </div>
    </button>
  );
}

// ─── Header ─────────────────────────────────────────────────────────
// User direction 2026-05-28: drop the Taqreer wordmark + احترافي badge
// from the dashboard header permanently. The visual-right slot is empty
// on the dashboard view and holds the "العودة للوحة التحكم" back chip
// when a flow view is active — replacing the in-flow body's local back
// button. Search + bell + avatar stay on the visual-left side.
function DemoHeader({
  view,
  onBack,
}: {
  view: View;
  onBack: () => void;
}) {
  return (
    <header className="header-bg flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--tq-border-glass)] px-4">
      {/* Right side (RTL: visually right) — back chip on flow views,
          empty on dashboard view. AnimatePresence-free fade since the
          whole pane swaps on view change anyway. */}
      <div className="flex shrink-0 items-center">
        {view !== "dashboard" ? (
          <button
            type="button"
            onClick={onBack}
            // Back chip mirrors `.btn-pill` so the affordance reads as
            // native. Arrow_forward is the RTL "back" glyph (right-
            // pointing arrow = "go back" in an RTL reading order).
            className="btn-pill flex items-center gap-1.5 px-3 text-xs"
            style={{ height: 32 }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 14 }}
            >
              arrow_forward
            </span>
            <span>العودة للوحة التحكم</span>
          </button>
        ) : null}
      </div>

      {/* Search field — static, non-interactive */}
      <div className="hidden flex-1 justify-center md:flex">
        <div className="flex h-8 w-full max-w-xs items-center gap-2 rounded-full bg-[var(--tq-bg-glass)] px-3 text-xs text-[var(--tq-text-muted)]">
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
            search
          </span>
          <span>ابحث في مشاريعك...</span>
        </div>
      </div>

      {/* Left side (RTL: visually left) — bell + avatar */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="الإشعارات"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--tq-bg-glass)] text-[var(--tq-text-muted)]"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            notifications
          </span>
        </button>
        <div
          className="h-8 w-8 rounded-full"
          style={{ backgroundImage: "var(--tq-gradient-brand)" }}
          aria-hidden
        />
      </div>
    </header>
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
}: {
  onNavigate: (v: Exclude<View, "dashboard">) => void;
}) {
  return (
    <div className="relative z-10 flex h-full flex-col overflow-y-auto px-6 py-8">
      {/* QuickActions grid — same 4-card row the real dashboard uses,
          shrunk one rung (gap-3 / p-3 instead of gap-4 / p-4) so the
          row fits inside the preview's 1024 px frame at 3:2. */}
      <section>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {QUICK_ACTIONS.map((card) => (
            <DemoQACard
              key={card.id}
              card={card}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </section>

      {/* Two-widget row — `flex-1` so the row stretches to fill all
          leftover vertical space, and each widget inside it stretches
          via `h-full` + `flex flex-col`. The tile grid grows to match
          the widget's height (`flex-1` on the grid itself). 3 cols × 2
          rows = 6 placeholders per widget, mirroring the real
          RecentProjects.tsx `grid-cols-1 sm:grid-cols-2 lg:grid-cols-
          3` layout. */}
      <div className="mt-10 grid flex-1 grid-cols-1 gap-10 lg:grid-cols-2">
        <PlaceholderSection title="أحدث المشاريع" items={RECENT_PROJECTS} />
        <PlaceholderSection title="قوالبي" items={TEMPLATES} />
      </div>

      {/* Plan usage strip — pinned to the bottom of the column via
          `mt-auto` so it sits hard against the bottom-fade mask
          regardless of how tall the widgets above grew. Latin
          numerals per project rule. */}
      <section className="mt-auto pt-4">
        <div className="glass-card rounded-2xl p-3">
          <div className="flex items-center justify-between gap-3 text-xs text-[var(--tq-text-muted)]">
            <span className="font-semibold text-white">خطة الاحتراف</span>
            <div className="flex flex-1 items-center gap-2">
              <div className="progress-track flex-1">
                <div className="progress-bar" style={{ width: "20%" }} />
              </div>
            </div>
            <span>6 / 30 عرضًا</span>
          </div>
        </div>
      </section>
    </div>
  );
}

function PlaceholderSection({
  title,
  items,
}: {
  title: string;
  items: { title: string; subtitle: string }[];
}) {
  return (
    // `flex flex-col` so the grid below can grow to fill the widget's
    // vertical space via `flex-1`. The h2 sits at the top, the grid
    // takes everything else.
    <section className="flex flex-col">
      <h2 className="mb-2 text-right text-sm font-semibold text-white">
        {title}
      </h2>
      {/* 3 cols × 2 rows = 6 tiles, same as the real RecentProjects /
          MyTemplates widget. `gap-x-3 gap-y-3` is tighter than the real
          `gap-x-10 gap-y-8` so the cluster fits in the preview frame. */}
      <div className="grid flex-1 grid-cols-3 gap-x-3 gap-y-3 content-start">
        {items.slice(0, 6).map((item, i) => (
          <PlaceholderTile
            key={i}
            title={item.title}
            subtitle={item.subtitle}
            tint={PLACEHOLDER_TINTS[i % PLACEHOLDER_TINTS.length]}
          />
        ))}
      </div>
    </section>
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
        className="aspect-video w-full overflow-hidden rounded-[10px] border border-[var(--tq-border-glass)] p-2"
        style={{ background: tint }}
      >
        <SlideWireframe />
      </div>
      {/* Footer — title + subtitle, same hierarchy as the real tile's
          info row. Right-aligned per user direction 2026-05-28:
          "remember we are trying to replicate a miniature of the
          dashboard". */}
      <div className="px-0.5 text-right">
        <p className="truncate text-[10px] font-semibold leading-tight text-white">
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
// Everything driven by `--glass-opacity` calc multipliers so the
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
              "rgba(255, 255, 255, calc(var(--glass-opacity) * 3))",
          }}
        />
        <div
          className="h-1 w-1/2 rounded-sm"
          style={{
            background:
              "rgba(255, 255, 255, calc(var(--glass-opacity) * 1.6))",
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
              "rgba(255, 255, 255, calc(var(--glass-opacity) * 2.4))",
          }}
        />
        <div
          className="h-3 flex-1 rounded-sm"
          style={{
            background:
              "rgba(255, 255, 255, calc(var(--glass-opacity) * 1.4))",
          }}
        />
        <div
          className="h-3 flex-1 rounded-sm border border-[var(--tq-border-glass)]"
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
// usage in `/create`, `/enhance`, `/mimic`, `/datasheet` so a returning
// user reads each view as the actual flow. Inputs that would normally
// trigger a file picker are rendered as decorative cards (no
// <input type=file> is mounted) so a marketing visitor can't open the
// OS file dialog from a static demo.

function FlowBody({
  view,
}: {
  view: Exclude<View, "dashboard">;
}) {
  const flow = FLOWS[view];

  return (
    // `pt-8` (vs the dashboard body's `pt-5`) so the flow title sits
    // visually below the header bar with breathing room — user
    // direction 2026-05-28: "the headlines is too close to the
    // header" on the previous tight `py-5` spacing.
    <div className="relative z-10 flex h-full flex-col overflow-y-auto px-6 pt-8 pb-5">
      {/* Header — title + subhead. The back chip used to live here
          but moved to DemoHeader's right slot 2026-05-28 (user
          direction: "remove Taqreer logo … add العودة للوحة التحكم
          there instead") so the dashboard chrome now owns the back
          affordance. Title stays centered inside the flow body. */}
      <header className="mb-5 text-center">
        <h1 className="text-lg font-bold text-white">{flow.title}</h1>
        <p className="mt-1 text-[11px] text-[var(--tq-text-muted)]">
          {flow.subtitle}
        </p>
      </header>

      {/* Card grid — variable column count per flow (2-4) so each
          flow's natural shape comes through. Each card uses the
          shared `.glass-card` chrome + same header icon + bottom
          hairline pattern as the real flows. */}
      <div className={`grid gap-3 ${flow.gridCols}`}>
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
  gridCols: string;
  cards: FlowCardSpec[];
};

function FakeTextarea({
  placeholder = "اكتب محتوى عرضك هنا...",
  rows = 3,
}: {
  placeholder?: string;
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
  title = "اسحب أو انقر لاختيار ملف",
  hint = "PDF / PPTX / DOCX / TXT — حتى 100 ميجابايت",
}: {
  icon?: string;
  title?: string;
  hint?: string;
}) {
  return (
    <div
      className="flex items-center gap-2 rounded-xl border border-dashed border-white/20 bg-black/20 p-2.5"
      aria-disabled
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--tq-bg-glass)]">
        <span
          className="material-symbols-outlined text-white/80"
          style={{ fontSize: 14 }}
        >
          {icon}
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-semibold text-white">{title}</p>
        <p className="mt-0.5 truncate text-[10px] text-white/40">{hint}</p>
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
          className="h-5 w-5 rounded-md border border-white/20"
          style={{ background: c }}
          aria-hidden
        />
      ))}
      <div className="flex h-5 w-5 items-center justify-center rounded-md border border-dashed border-white/20 text-white/60">
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
}: {
  options: string[];
  active: number;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-full border border-[var(--tq-border-glass)] bg-black/25 p-0.5">
      {options.map((label, i) => (
        <span
          key={i}
          className={`rounded-full px-2 py-0.5 text-[10px] ${
            i === active
              ? "bg-white/10 text-white"
              : "text-[var(--tq-text-muted)]"
          }`}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function FakeToggle({ on }: { on: boolean }) {
  return (
    <div
      className={`relative h-4 w-7 rounded-full transition-colors ${
        on ? "tq-switch-on" : "bg-white/10"
      }`}
    >
      <div
        className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all"
        style={{ [on ? "left" : "right"]: 2 } as React.CSSProperties}
      />
    </div>
  );
}

function FakePositionDropdown({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-[var(--tq-border-glass)] bg-black/25 px-2 py-0.5 text-[10px] text-white">
      <span>{label}</span>
      <span className="material-symbols-outlined" style={{ fontSize: 12 }}>
        expand_more
      </span>
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
      className="flex items-center justify-between rounded-md border border-[var(--tq-border-glass)] bg-black/20 px-2"
      style={{ height: 28 }}
    >
      <span className="text-[10px] text-[var(--tq-text-muted)]">{label}</span>
      <span className="truncate text-[11px] font-semibold text-white">
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
      <span className="text-[11px] font-semibold text-white/70">{label}</span>
      {children}
    </div>
  );
}

function CardSeparator() {
  return <div className="border-t border-[var(--tq-border-glass)]" />;
}

function FlowCard({ card }: { card: FlowCardSpec }) {
  return (
    <div className="glass-card flex min-h-[230px] flex-col gap-2.5 rounded-2xl p-3">
      {/* Card header — icon + title + hairline separator. Matches the
          real `CardHeader` primitive: `<span class="material-symbols-
          outlined"> + bold title + border-b`. */}
      <div className="flex items-center gap-2 border-b border-[var(--tq-border-glass)] pb-2">
        <span
          className="material-symbols-outlined text-white"
          style={{ fontSize: 14 }}
        >
          {card.icon}
        </span>
        <span className="text-xs font-semibold text-white">{card.title}</span>
      </div>
      <div className="flex flex-1 flex-col gap-2">{card.body}</div>
    </div>
  );
}

// ─── Per-flow card specs ────────────────────────────────────────────
// Icons + titles + Arabic copy track the real flow pages verbatim:
//
//   • /create     →  subject (المحتوى) / palette (الخطوط والألوان)
//                    / image (الشعار)  / settings (إعدادات الإخراج)
//   • /enhance    →  subject (الملف الأصلي) / palette (الهوية البصرية)
//   • /mimic      →  subject (المحتوى) / palette (الهوية البصرية)
//                    / auto_awesome (ما الذي نُحاكيه)
//   • /datasheet  →  dataset (البيانات) / palette (الخطوط والألوان)
//                    / image (الشعار)  / settings (إعدادات الإخراج)

const FLOWS: Record<Exclude<View, "dashboard">, FlowSpec> = {
  create: {
    title: "أنشئ عرضاً جديداً",
    subtitle:
      "اكتب محتواك أو ارفع ملفاً، اختر هويتك البصرية، وسنبني عرضاً يحاكي ذوقك.",
    cta: "إنشاء العرض",
    gridCols: "grid-cols-2 lg:grid-cols-4",
    cards: [
      {
        icon: "subject",
        title: "المحتوى",
        body: (
          <>
            <FieldRow label="اللغة">
              <FakeSegmented options={["العربية", "الإنجليزية"]} active={0} />
            </FieldRow>
            <FakeTextarea rows={3} />
            <div className="flex items-center gap-2 text-[10px] text-white/40">
              <div className="h-px flex-1 bg-[var(--tq-border-glass)]" />
              <span>أو</span>
              <div className="h-px flex-1 bg-[var(--tq-border-glass)]" />
            </div>
            <FakeDropzone />
          </>
        ),
      },
      {
        icon: "palette",
        title: "الخطوط والألوان",
        body: (
          <>
            <FieldRow label="الألوان">
              <FakePalette
                colors={[
                  "var(--tq-violet)",
                  "var(--tq-magenta)",
                  "var(--tq-blue)",
                ]}
              />
            </FieldRow>
            <CardSeparator />
            <FieldRow label="خط العناوين">
              <FakeSegmented options={["ملف", "Google"]} active={1} />
            </FieldRow>
            <FakeFontSlot label="Aa" family="Cairo" />
            <FieldRow label="خط النص">
              <FakeSegmented options={["ملف", "Google"]} active={1} />
            </FieldRow>
            <FakeFontSlot label="Aa" family="Cairo" />
          </>
        ),
      },
      {
        icon: "image",
        title: "الشعار",
        body: (
          <>
            <FakeDropzone
              icon="image"
              title="ارفع شعارك"
              hint="SVG فقط"
            />
            <CardSeparator />
            <FieldRow label="موضع الشعار">
              <FakePositionDropdown label="أعلى يمين" />
            </FieldRow>
            <FieldRow label="حفظ كهوية افتراضية">
              <FakeToggle on={false} />
            </FieldRow>
          </>
        ),
      },
      {
        icon: "settings",
        title: "إعدادات الإخراج",
        body: (
          <>
            <FieldRow label="مقاس الشريحة">
              <FakeSegmented options={["16:9", "9:16"]} active={0} />
            </FieldRow>
            <CardSeparator />
            <FieldRow label="عدد الشرائح">
              <FakeSegmented options={["تلقائي", "مخصص"]} active={0} />
            </FieldRow>
            <CardSeparator />
            <FieldRow label="ترقيم الشرائح">
              <FakeToggle on={true} />
            </FieldRow>
            <CardSeparator />
            <FieldRow label="عنصر ثابت">
              <FakePositionDropdown label="أسفل وسط" />
            </FieldRow>
          </>
        ),
      },
    ],
  },
  enhance: {
    title: "حسّن عرضك الحالي",
    subtitle:
      "ارفع عرضاً موجوداً وسنعيد تصميمه بهويتك البصرية مع الحفاظ على محتواك.",
    cta: "تحسين العرض",
    gridCols: "grid-cols-1 sm:grid-cols-2",
    cards: [
      {
        icon: "subject",
        title: "الملف الأصلي",
        body: (
          <>
            <FakeDropzone
              icon="upload_file"
              title="اسحب ملف العرض هنا"
              hint="PPTX / PDF — حتى 100 ميجابايت"
            />
            <p className="text-[10px] leading-relaxed text-[var(--tq-text-muted)]">
              سنستخرج النص والصور والخطوط من ملفك تلقائياً.
            </p>
            <CardSeparator />
            <FakeDropzone
              icon="image"
              title="ارفع شعارك (اختياري)"
              hint="SVG فقط"
            />
            <FieldRow label="موضع الشعار">
              <FakePositionDropdown label="أعلى يمين" />
            </FieldRow>
          </>
        ),
      },
      {
        icon: "palette",
        title: "الهوية البصرية",
        body: (
          <>
            <FieldRow label="الألوان">
              <FakePalette
                colors={["var(--tq-blue)", "var(--tq-lavender)"]}
              />
            </FieldRow>
            <CardSeparator />
            <FieldRow label="خط العناوين">
              <FakeSegmented options={["ملف", "Google"]} active={1} />
            </FieldRow>
            <FakeFontSlot label="Aa" family="Cairo" />
            <FieldRow label="خط النص">
              <FakeSegmented options={["ملف", "Google"]} active={1} />
            </FieldRow>
            <FakeFontSlot label="Aa" family="Cairo" />
            <CardSeparator />
            <FieldRow label="حفظ كهوية افتراضية">
              <FakeToggle on={false} />
            </FieldRow>
          </>
        ),
      },
    ],
  },
  mimic: {
    title: "حاكِ أسلوب عرض",
    subtitle:
      "أرفق عرضاً مرجعياً وسنطبّق أسلوبه على محتواك الجديد.",
    cta: "إنشاء العرض",
    gridCols: "grid-cols-1 md:grid-cols-3",
    cards: [
      {
        icon: "subject",
        title: "المحتوى",
        body: (
          <>
            <FieldRow label="اللغة">
              <FakeSegmented options={["العربية", "الإنجليزية"]} active={0} />
            </FieldRow>
            <FakeTextarea rows={4} />
          </>
        ),
      },
      {
        icon: "palette",
        title: "الهوية البصرية",
        body: (
          <>
            <FakeDropzone
              icon="image"
              title="ارفع شعارك (اختياري)"
              hint="SVG فقط"
            />
            <CardSeparator />
            <FieldRow label="موضع الشعار">
              <FakePositionDropdown label="أعلى يمين" />
            </FieldRow>
            <CardSeparator />
            <FieldRow label="مقاس الشريحة">
              <FakeSegmented options={["16:9", "9:16"]} active={0} />
            </FieldRow>
            <FieldRow label="عدد الشرائح">
              <FakeSegmented options={["تلقائي", "مخصص"]} active={0} />
            </FieldRow>
          </>
        ),
      },
      {
        icon: "auto_awesome",
        title: "ما الذي نُحاكيه",
        body: (
          <>
            <FakeDropzone
              icon="style"
              title="ارفع العرض المرجعي"
              hint="PPTX / PDF"
            />
            <p className="text-[10px] leading-relaxed text-[var(--tq-text-muted)]">
              سنستخرج الألوان والخطوط والتخطيط من المرجع.
            </p>
            <CardSeparator />
            <FieldRow label="نسخ النص">
              <FakeToggle on={false} />
            </FieldRow>
          </>
        ),
      },
    ],
  },
  datasheet: {
    title: "أنشئ عرضاً من بياناتك",
    subtitle:
      "حوّل ملف Excel أو CSV إلى عرض احترافي مع الرسوم البيانية المناسبة.",
    cta: "إنشاء العرض",
    gridCols: "grid-cols-2 lg:grid-cols-4",
    cards: [
      {
        icon: "dataset",
        title: "البيانات",
        body: (
          <>
            <FakeDropzone
              icon="dataset"
              title="ارفع ملف البيانات"
              hint="XLSX / CSV — حتى 25 ميجابايت"
            />
            <CardSeparator />
            <FieldRow label="الجدول">
              <FakeSegmented options={["تلقائي", "Sheet 1"]} active={0} />
            </FieldRow>
            <FieldRow label="نوع الرسم">
              <FakeSegmented options={["تلقائي", "أعمدة", "خطي"]} active={0} />
            </FieldRow>
          </>
        ),
      },
      {
        icon: "palette",
        title: "الخطوط والألوان",
        body: (
          <>
            <FieldRow label="الألوان">
              <FakePalette
                colors={[
                  "var(--tq-violet)",
                  "var(--tq-magenta)",
                  "var(--tq-blue)",
                ]}
              />
            </FieldRow>
            <CardSeparator />
            <FieldRow label="خط العناوين">
              <FakeSegmented options={["ملف", "Google"]} active={1} />
            </FieldRow>
            <FakeFontSlot label="Aa" family="Cairo" />
            <FieldRow label="خط النص">
              <FakeSegmented options={["ملف", "Google"]} active={1} />
            </FieldRow>
            <FakeFontSlot label="Aa" family="Cairo" />
          </>
        ),
      },
      {
        icon: "image",
        title: "الشعار",
        body: (
          <>
            <FakeDropzone
              icon="image"
              title="ارفع شعارك"
              hint="SVG فقط"
            />
            <CardSeparator />
            <FieldRow label="موضع الشعار">
              <FakePositionDropdown label="أعلى يمين" />
            </FieldRow>
            <FieldRow label="حفظ كهوية افتراضية">
              <FakeToggle on={false} />
            </FieldRow>
          </>
        ),
      },
      {
        icon: "settings",
        title: "إعدادات الإخراج",
        body: (
          <>
            <FieldRow label="مقاس الشريحة">
              <FakeSegmented options={["16:9", "9:16"]} active={0} />
            </FieldRow>
            <CardSeparator />
            <FieldRow label="عدد الشرائح">
              <FakeSegmented options={["تلقائي", "مخصص"]} active={0} />
            </FieldRow>
            <CardSeparator />
            <FieldRow label="ترقيم الشرائح">
              <FakeToggle on={true} />
            </FieldRow>
          </>
        ),
      },
    ],
  },
};
