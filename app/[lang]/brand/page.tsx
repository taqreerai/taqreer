// Taqreer Design System — LIVE reference route.
//
// This page is rendered UNDER `app/[lang]/layout.tsx`, which imports the real
// `app/globals.css`. So every `--tq-*` token and every utility class
// (`.surface-card`, `.surface-menu`, `.dropdown-item`, `.btn-gradient`,
// `.in-slide-popover`, `.settings-row`, `.text-gradient`, status tokens, …) is
// the EXACT same one the app ships — there is no re-implemented demo CSS to
// drift. Interactive / animated pieces embed the real components
// (`ParagraphWriteIcon`, `ThemeToggle`, `ThemeLogo`) so they behave identically;
// everything else is the real markup rendered in a static "open" state, accurate
// because the classes come straight from globals.
//
// Replaces the old static `public/brand-guidelines.html` (hand-copied tokens,
// which is why it drifted). When a pattern is missing here, ADD it here so this
// stays the single canonical reference. Flat system: no blur, no shadow, one
// blue accent. English doc copy, `dir="ltr"` chrome; RTL is demoed where it is
// the point. No em/en dash, Latin numerals only — same brand rules as the app.

import type { Metadata } from "next";
import Image from "next/image";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { ThemeLogo } from "@/components/brand/ThemeLogo";
import { ParagraphWriteIcon } from "@/components/preview/ParagraphWriteIcon";

export const metadata: Metadata = {
  title: "Design System - taqreer.ai",
  robots: { index: false, follow: false },
};

// Aurora drift keyframes — copied verbatim from the old static brand-guidelines
// page so the ambient glow is the exact same one. Prefixed `pg-` to avoid any
// clash with the app's own `.tq-aurora` keyframes.
const AURORA_CSS = `
@keyframes pg-drift-a {
  0%, 100% { transform: translate3d(-6%, 0, 0) scale(1.05); }
  50%      { transform: translate3d(7%, -3%, 0) scale(1.2); }
}
@keyframes pg-drift-b {
  0%, 100% { transform: translate3d(7%, 0, 0) scale(1.15); }
  50%      { transform: translate3d(-7%, 2%, 0) scale(1); }
}`;

// The exact 3-radial blue aurora fill from the static page.
const AURORA_FILL =
  "radial-gradient(50% 70% at 30% 100%, rgba(0,87,255,.85) 0%, transparent 100%), radial-gradient(56% 76% at 60% 104%, rgba(51,128,255,.8) 0%, transparent 100%), radial-gradient(48% 60% at 45% 96%, rgba(0,66,224,.7) 0%, transparent 100%)";

// ─── Small doc-chrome helpers (real classes only) ────────────────────────────

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-md border border-border bg-overlay-soft px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
      {children}
    </code>
  );
}

function Section({
  id,
  n,
  title,
  lead,
  children,
}: {
  id: string;
  n: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="mb-6">
        <p className="font-mono text-xs text-primary">{n}</p>
        <h2 className="mt-1 text-2xl font-bold text-foreground">{title}</h2>
        {lead ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {lead}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Frame({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-border p-6 ${className}`}>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

function Swatch({
  label,
  varRef,
  gradient = false,
}: {
  label: string;
  varRef: string;
  gradient?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="h-9 w-9 flex-shrink-0 rounded-lg border border-border"
        style={
          gradient
            ? { backgroundImage: `var(${varRef})` }
            : { background: `var(${varRef})` }
        }
      />
      <div className="min-w-0">
        <p className="truncate text-[13px] text-foreground">{label}</p>
        <code className="block truncate font-mono text-[11px] text-muted-foreground">
          {varRef}
        </code>
      </div>
    </div>
  );
}

// Menu row (kebab / account menu demos).
function Item({
  icon,
  label,
  danger = false,
}: {
  icon: string;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`dropdown-item ${
        danger ? "text-red-300 hover:bg-red-500/10! hover:text-red-200!" : ""
      }`}
    >
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
      {label}
    </button>
  );
}

function Divider() {
  return <div aria-hidden className="my-1 h-px bg-foreground/[0.08]" />;
}

// One generation-model row — replicates the real GenerateSplitButton dropdown
// row (check + model label + fast/thinking chip + tier-gate pill + credits).
function PresetRow({
  model,
  thinking,
  gate,
  credits,
  active = false,
  muted,
}: {
  model: string;
  thinking: boolean;
  gate?: string;
  credits: string;
  active?: boolean;
  muted?: string;
}) {
  return (
    <div
      className={`flex w-full items-center gap-3 px-3 py-2.5 text-sm ${
        active ? "bg-foreground/[0.06] text-foreground" : "text-foreground/70"
      }`}
    >
      <span className="flex flex-1 items-center gap-2 min-w-0">
        <span
          className="material-symbols-outlined leading-none"
          style={{ fontSize: 16, opacity: active ? 1 : 0 }}
        >
          check
        </span>
        <span className="truncate">{model}</span>
        {muted ? (
          <span className="text-[10px] text-foreground/40">{muted}</span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {thinking ? (
          <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-emerald-200">
            Thinking
          </span>
        ) : (
          <span className="rounded-full bg-[var(--tq-surface)] px-1.5 py-0.5 text-[9px] font-semibold leading-none text-foreground/50">
            Fast
          </span>
        )}
        {gate ? (
          <span className="rounded-full bg-[var(--tq-purple)] px-1.5 py-0.5 text-[9px] font-semibold leading-none text-white">
            {gate}
          </span>
        ) : null}
        <span className="text-[11px] tabular-nums text-foreground/60" dir="ltr">
          {credits}
        </span>
      </span>
    </div>
  );
}

const TOC: { id: string; n: string; title: string }[] = [
  { id: "tokens", n: "01", title: "Tokens & themes" },
  { id: "logo", n: "02", title: "Logo" },
  { id: "type", n: "03", title: "Typography" },
  { id: "brand", n: "04", title: "Brand, motion & gradients" },
  { id: "surfaces", n: "05", title: "Surfaces & elevation" },
  { id: "buttons", n: "06", title: "Buttons" },
  { id: "icons", n: "07", title: "Icons" },
  { id: "inputs", n: "08", title: "Inputs & controls" },
  { id: "menus", n: "09", title: "Menus & popovers" },
  { id: "toasts", n: "10", title: "Toasts & notifications" },
  { id: "uploads", n: "11", title: "Upload areas" },
  { id: "modals", n: "12", title: "Modals & dialogs" },
  { id: "feedback", n: "13", title: "Tooltip & status" },
  { id: "plan", n: "14", title: "Plan, tiers & tables" },
  { id: "models", n: "15", title: "Models & presets" },
  { id: "email", n: "16", title: "Email" },
];

export default function BrandPage() {
  return (
    <div dir="ltr" className="relative min-h-screen overflow-x-clip text-foreground">
      <style>{AURORA_CSS}</style>
      {/* Panel-coloured base + the exact static-page aurora, pinned behind
          everything — matches the landing backdrop (the page base is --tq-panel,
          NOT white). */}
      <div
        aria-hidden
        className="fixed inset-0 -z-[2]"
        style={{ background: "var(--tq-panel)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 -z-[1] h-[62vh] overflow-hidden"
      >
        <div
          className="absolute"
          style={{
            inset: "-20% -20% -40%",
            filter: "blur(55px) saturate(1.3)",
            background: AURORA_FILL,
            animation: "pg-drift-a 14s ease-in-out infinite",
          }}
        />
      </div>
      {/* Sticky chrome */}
      <header className="sticky top-0 z-40 border-b border-border bg-[var(--tq-panel)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="pw-hover-trigger flex h-9 w-9 items-center justify-center rounded-lg bg-overlay-soft text-foreground">
              <ParagraphWriteIcon mode="hover" size={20} />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-foreground">
                Taqreer Design System
              </p>
              <p className="text-xs text-muted-foreground">
                Live reference, rendered with the app{"’"}s real tokens
              </p>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-6 py-12 lg:grid-cols-[210px_minmax(0,1fr)]">
        {/* TOC */}
        <nav className="hidden lg:block">
          <div className="sticky top-24 space-y-0.5">
            {TOC.map((t) => (
              <a
                key={t.id}
                href={`#${t.id}`}
                className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-overlay-soft hover:text-foreground"
              >
                <span className="font-mono text-[11px] text-foreground/40">
                  {t.n}
                </span>
                {t.title}
              </a>
            ))}
          </div>
        </nav>

        {/* Content */}
        <main className="min-w-0 space-y-20">
          {/* Intro */}
          <div className="space-y-3">
            <h1 className="text-3xl font-bold text-foreground">
              One flat surface, one blue accent
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Everything below renders with the same{" "}
              <Tag>app/globals.css</Tag> the product ships, so it is a true
              replica, not a mock-up. Flip light and dark with the toggle in the
              header. Surfaces are solid with a hairline border: no blur, no
              shadow, no transparency. The single accent is blue (
              <Tag>--tq-purple</Tag>, brighter on dark, the locked{" "}
              <Tag>#0057FF</Tag> on light). Typeface is Cairo, weights 400-700.
            </p>
            {/* Informative chips - same vocabulary as the landing hero. */}
            <div className="flex flex-wrap gap-2 pt-1">
              <span className="hero-stat-pill flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: "#fff" }}
                />
                16 live sections
              </span>
              {[
                "Real tokens from globals.css",
                "Light + dark",
                "Cairo · 400-700",
                "One blue accent",
              ].map((c) => (
                <span
                  key={c}
                  className="rounded-full border border-[var(--tq-border-hairline)] bg-[var(--tq-surface)] px-4 py-1.5 text-xs font-medium text-muted"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>

          {/* 01 — Tokens & themes */}
          <Section
            id="tokens"
            n="01"
            title="Tokens & themes"
            lead="The named CSS variables every class is built from. The .light class (set from the tq_theme cookie, applied SSR so there is no flash) flips the neutral scale; the blue accent stays blue, only its shade swaps."
          >
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              <Frame>
                <Label>Surfaces (elevation low to high)</Label>
                <div className="space-y-3">
                  <Swatch label="Page gutter" varRef="--tq-bg" />
                  <Swatch label="Content panel" varRef="--tq-panel" />
                  <Swatch label="Inset / inactive" varRef="--tq-card" />
                  <Swatch label="Cards & chrome" varRef="--tq-surface" />
                </div>
              </Frame>
              <Frame>
                <Label>Accent & gradients</Label>
                <div className="space-y-3">
                  <Swatch label="Accent (blue)" varRef="--tq-purple" />
                  <Swatch label="Accent hover" varRef="--tq-purple-hover" />
                  <Swatch
                    label="Brand gradient"
                    varRef="--tq-gradient-brand"
                    gradient
                  />
                  <Swatch
                    label="Full ramp"
                    varRef="--tq-gradient-full"
                    gradient
                  />
                </div>
              </Frame>
              <Frame>
                <Label>Text & borders</Label>
                <div className="space-y-3">
                  <Swatch label="Primary text" varRef="--tq-text-primary" />
                  <Swatch label="Muted text" varRef="--tq-text-muted" />
                  <Swatch label="Danger text" varRef="--tq-text-danger" />
                  <Swatch label="Hairline border" varRef="--tq-border-hairline" />
                  <Swatch label="Focus border" varRef="--tq-border-focus" />
                </div>
              </Frame>
              <Frame>
                <Label>Status feedback</Label>
                <div className="space-y-3">
                  <Swatch label="OK" varRef="--tq-status-ok-dot" />
                  <Swatch label="Warning" varRef="--tq-status-warn-dot" />
                  <Swatch label="Down" varRef="--tq-status-down-dot" />
                </div>
              </Frame>
              <Frame>
                <Label>Overlay tints (flip-aware)</Label>
                <div className="space-y-3">
                  <Swatch label="Soft" varRef="--tq-overlay-soft" />
                  <Swatch label="Medium" varRef="--tq-overlay" />
                  <Swatch label="Strong" varRef="--tq-overlay-strong" />
                </div>
              </Frame>
              <Frame>
                <Label>Tokens to consume, never hardcode</Label>
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  Compose <Tag>var(--tq-*)</Tag> or the flip-aware Tailwind
                  aliases: <Tag>text-foreground</Tag>,{" "}
                  <Tag>text-muted-foreground</Tag>, <Tag>border-border</Tag>,{" "}
                  <Tag>bg-overlay-soft</Tag>. Radius token is{" "}
                  <Tag>--tq-radius-md</Tag> (12px); the rest use Tailwind{" "}
                  <Tag>rounded-*</Tag>.
                </p>
              </Frame>
            </div>
          </Section>

          {/* 02 — Logo */}
          <Section
            id="logo"
            n="02"
            title="Logo"
            lead="A single lowercase wordmark, taqreer, with the two e's drawn as stacked horizontal bars - a quiet nod to slides and lines of text. There is no separate icon lockup beyond the bars. ThemeLogo swaps the two assets by theme automatically."
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <div
                className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border p-10"
                style={{ background: "#0A0A0A" }}
              >
                <Image
                  src="/logo-light.svg"
                  alt="taqreer.ai"
                  width={170}
                  height={48}
                />
                <p className="text-[12px] text-white/50">
                  Dark surfaces - white <Tag>/logo-light.svg</Tag>
                </p>
              </div>
              <div
                className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border p-10"
                style={{ background: "#ffffff" }}
              >
                <Image
                  src="/logo-blue.svg"
                  alt="taqreer.ai"
                  width={170}
                  height={48}
                />
                <p className="text-[12px] text-black/50">
                  Light surfaces - solid <Tag>#0057FF</Tag>
                </p>
              </div>
            </div>
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <Frame className="flex items-center gap-5">
                <span className="pw-hover-trigger flex h-14 w-14 items-center justify-center rounded-xl bg-overlay-soft text-foreground">
                  <ParagraphWriteIcon mode="hover" size={30} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    The e-bars mark
                  </p>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                    The standalone glyph (also the app icon / email mark) is the
                    three stacked bars. Keep it flat and monochrome - never add a
                    gradient, shadow or non-brand tint.
                  </p>
                </div>
              </Frame>
              <Frame className="flex items-center gap-5">
                <div
                  className="flex h-14 items-center rounded-xl border border-dashed border-foreground/30 px-4"
                  style={{ background: "var(--tq-overlay-soft)" }}
                >
                  <ThemeLogo width={120} height={34} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Clear space
                  </p>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                    Keep clear space equal to the cap-height on every side.
                    Minimum width 96px on screen. Scale uniformly, never stretch
                    or separate the bars from the wordmark.
                  </p>
                </div>
              </Frame>
            </div>
          </Section>

          {/* 03 — Typography */}
          <Section
            id="type"
            n="03"
            title="Typography"
            lead="One typeface carries the whole product: Cairo, a contemporary Arabic + Latin sans with even rhythm in both directions. It is why Arabic and English sit in the same layout without a seam. Numerals are always Latin (0-9), even inside Arabic."
          >
            <Frame>
              <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
                <span className="text-6xl font-normal text-foreground">
                  Cairo
                </span>
                <span className="text-6xl font-normal text-foreground" dir="rtl">
                  كايرو
                </span>
              </div>
              <p className="mt-4 text-muted-foreground">
                The quick brown fox · تصميم عربي أنيق · 0123456789
              </p>
            </Frame>
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <Frame>
                <Label>Weights (400-700)</Label>
                <div className="space-y-3">
                  {[
                    ["Regular", 400, "MAIN - body, titles & display"],
                    ["Medium", 500, "labels, buttons"],
                    ["SemiBold", 600, "small UI / card titles"],
                    ["Bold", 700, "MAX - emphasis, prices, stats"],
                  ].map(([name, w, use]) => (
                    <div
                      key={w as number}
                      className="flex items-baseline justify-between gap-4 border-b border-foreground/[0.06] pb-2 last:border-0"
                    >
                      <span
                        className="text-xl text-foreground"
                        style={{ fontWeight: w as number }}
                      >
                        {name}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {w} · {use}
                      </span>
                    </div>
                  ))}
                </div>
              </Frame>
              <Frame>
                <Label>Scale</Label>
                <div className="space-y-4">
                  <p
                    className="text-foreground"
                    style={{ fontSize: 34, fontWeight: 400, letterSpacing: "-0.02em" }}
                  >
                    Turn content into decks
                  </p>
                  <p
                    className="text-foreground"
                    style={{ fontSize: 24, fontWeight: 400, letterSpacing: "-0.01em" }}
                  >
                    Section heading
                  </p>
                  <p style={{ fontSize: 18, fontWeight: 600 }} className="text-foreground">
                    Card title text
                  </p>
                  <p style={{ fontSize: 15 }} className="text-muted-foreground">
                    Body copy sits around 15-16px with relaxed line-height for
                    comfortable reading in both scripts.
                  </p>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/40">
                    Eyebrow label
                  </p>
                </div>
              </Frame>
            </div>
          </Section>

          {/* 04 — Brand, motion & gradients */}
          <Section
            id="brand"
            n="04"
            title="Brand, motion & gradients"
            lead="The animated mark is the real ParagraphWriteIcon (three bars that write in). Color energy lives in exactly two places: the ambient aurora that grounds key pages, and the AI mesh that marks generative actions. Both are all-blue; everywhere else stays flat."
          >
            <div className="grid gap-6 lg:grid-cols-3">
              <Frame className="flex flex-col items-center justify-center gap-3">
                <div className="pw-hover-trigger flex h-16 w-16 items-center justify-center rounded-2xl bg-overlay-soft text-foreground">
                  <ParagraphWriteIcon mode="hover" size={34} />
                </div>
                <p className="text-center text-[13px] text-muted-foreground">
                  Mark - <Tag>mode=&quot;hover&quot;</Tag>
                  <br />
                  <span className="text-foreground/40">hover to play once</span>
                </p>
              </Frame>
              <Frame className="flex flex-col items-center justify-center gap-3">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-overlay-soft text-foreground">
                  <ParagraphWriteIcon mode="loop" size={34} />
                </div>
                <p className="text-center text-[13px] text-muted-foreground">
                  Loading - <Tag>mode=&quot;loop&quot;</Tag>
                  <br />
                  <span className="text-foreground/40">
                    slide-nav placeholder, looped
                  </span>
                </p>
              </Frame>
              <Frame className="flex flex-col items-center justify-center gap-4">
                <button
                  type="button"
                  className="btn-gradient-anim rounded-full px-5 py-2 text-sm font-medium text-white"
                >
                  <span className="material-symbols-outlined align-middle text-[18px]">
                    auto_awesome
                  </span>{" "}
                  Generate
                </button>
                <p className="text-center text-[13px] text-muted-foreground">
                  AI mesh - <Tag>.btn-gradient-anim</Tag>
                </p>
              </Frame>
            </div>
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <Frame className="space-y-4">
                <Label>Main gradient</Label>
                <div
                  className="h-16 w-full rounded-xl"
                  style={{ backgroundImage: "var(--tq-gradient-brand)" }}
                />
                <div
                  className="h-16 w-full rounded-xl"
                  style={{ backgroundImage: "var(--tq-gradient-full)" }}
                />
                <p className="text-gradient text-3xl font-bold">
                  Turn content into decks
                </p>
                <p className="text-[12px] text-muted-foreground">
                  <Tag>--tq-gradient-brand</Tag> · <Tag>--tq-gradient-full</Tag>{" "}
                  · <Tag>.text-gradient</Tag>
                </p>
              </Frame>
              <Frame className="space-y-4">
                <Label>Aurora (ambient glow)</Label>
                <div
                  className="relative h-56 w-full overflow-hidden rounded-xl border border-border"
                  style={{
                    background: "var(--tq-card)",
                    display: "grid",
                    placeItems: "end center",
                  }}
                >
                  <div
                    className="absolute"
                    style={{
                      inset: "-20% -20% -40%",
                      filter: "blur(55px) saturate(1.3)",
                      background: AURORA_FILL,
                      animation: "pg-drift-a 14s ease-in-out infinite",
                    }}
                  />
                  <span className="relative z-[2] mb-5 text-[13px] text-muted-foreground">
                    Aurora · ambient page glow
                  </span>
                </div>
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  A soft blue wash anchored to the bottom of home, the creation
                  flows and the editor. Same blue in both themes; only the base
                  flips beneath it. If a surface is not ambient atmosphere or an
                  AI action, it gets no glow.
                </p>
              </Frame>
            </div>
          </Section>

          {/* 05 — Surfaces */}
          <Section
            id="surfaces"
            n="05"
            title="Surfaces & elevation"
            lead="Four solid tones stack from the page gutter up to floating chrome. Every card, menu, popover and modal is the same recipe: solid --tq-surface plus a 1px hairline border. The dim behind a modal is --tq-modal-dim."
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <Frame>
                <Label>Elevation ladder</Label>
                <div className="space-y-2">
                  {[
                    ["--tq-bg", "Page gutter"],
                    ["--tq-panel", "Content panel"],
                    ["--tq-card", "Inset / inactive"],
                    ["--tq-surface", "Cards & floating chrome"],
                  ].map(([v, l]) => (
                    <div
                      key={v}
                      className="flex items-center justify-between rounded-xl border border-border px-4 py-3"
                      style={{ background: `var(${v})` }}
                    >
                      <span className="text-[13px] text-foreground">{l}</span>
                      <code className="font-mono text-[11px] text-muted-foreground">
                        {v}
                      </code>
                    </div>
                  ))}
                </div>
              </Frame>
              <Frame>
                <Label>Surface classes</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="surface-card rounded-xl p-4 text-[13px] text-foreground">
                    .surface-card
                  </div>
                  <div className="surface-popover rounded-xl p-4 text-[13px] text-foreground">
                    .surface-popover
                  </div>
                  <div className="surface-menu rounded-xl p-4 text-[13px] text-foreground">
                    .surface-menu
                  </div>
                  <div className="surface-modal rounded-xl p-4 text-[13px] text-foreground">
                    .surface-modal
                  </div>
                  <div className="in-slide-popover rounded-xl p-4 text-[13px] text-foreground">
                    .in-slide-popover
                  </div>
                  <div className="surface-card-danger rounded-xl p-4 text-[13px] text-foreground">
                    .surface-card-danger
                  </div>
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
                  <Tag>.in-slide-popover</Tag> uses a brighter hairline so it
                  reads when floating over a white slide; everything else shares
                  the standard hairline.
                </p>
              </Frame>
            </div>
          </Section>

          {/* 06 — Buttons */}
          <Section
            id="buttons"
            n="06"
            title="Buttons"
            lead="Primary CTA is solid blue. Secondary is the ghost pill. Destructive is solid red. The AI mesh is its own thing (section 04). Disabled drops opacity; the in-button spinner is a spinning progress_activity glyph, no separate loader."
          >
            <Frame className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn-gradient px-5 py-2 text-sm">
                Primary CTA
              </button>
              <button type="button" className="btn-pill">
                Secondary
              </button>
              <button
                type="button"
                className="btn-pill-danger px-4 py-1.5 text-xs"
              >
                Delete
              </button>
              <button
                type="button"
                className="btn-gradient px-5 py-2 text-sm"
                disabled
              >
                Disabled
              </button>
              <button
                type="button"
                className="btn-gradient inline-flex items-center gap-2 px-5 py-2 text-sm"
              >
                <span className="material-symbols-outlined animate-spin text-[18px]">
                  progress_activity
                </span>
                Working
              </button>
            </Frame>
            <div className="mt-3 flex flex-wrap gap-2 text-[12px] text-muted-foreground">
              <span>
                <Tag>.btn-gradient</Tag> CTA
              </span>
              <span>
                <Tag>.btn-pill</Tag> secondary
              </span>
              <span>
                <Tag>.btn-pill-danger</Tag> destructive
              </span>
            </div>
          </Section>

          {/* 07 — Icons */}
          <Section
            id="icons"
            n="07"
            title="Icons"
            lead="Material Symbols Outlined, loaded at weight 200 (thin) to match the app. Tint with currentColor, mute with text-foreground/30, and use .icon-hover for muted-to-primary interactive glyphs. The FILL axis toggles outlined to filled."
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <Frame>
                <Label>Common glyphs (weight 200)</Label>
                <div className="grid grid-cols-6 gap-4 text-foreground sm:grid-cols-8">
                  {[
                    "home",
                    "dashboard",
                    "add",
                    "edit",
                    "content_copy",
                    "delete",
                    "ios_share",
                    "settings",
                    "person",
                    "logout",
                    "notifications",
                    "search",
                    "light_mode",
                    "dark_mode",
                    "upload",
                    "download",
                    "check_circle",
                    "close",
                    "auto_awesome",
                    "bolt",
                    "palette",
                    "image",
                    "history",
                    "more_vert",
                  ].map((g) => (
                    <span
                      key={g}
                      className="material-symbols-outlined text-[24px]"
                    >
                      {g}
                    </span>
                  ))}
                </div>
              </Frame>
              <Frame className="space-y-5">
                <div>
                  <Label>Sizes</Label>
                  <div className="flex items-end gap-4 text-foreground">
                    <span className="material-symbols-outlined text-[14px]">
                      star
                    </span>
                    <span className="material-symbols-outlined text-[18px]">
                      star
                    </span>
                    <span className="material-symbols-outlined text-[24px]">
                      star
                    </span>
                    <span className="material-symbols-outlined text-[32px]">
                      star
                    </span>
                  </div>
                </div>
                <div>
                  <Label>Treatments</Label>
                  <div className="flex items-center gap-5 text-foreground">
                    <button
                      type="button"
                      className="icon-hover flex h-9 w-9 items-center justify-center rounded-lg"
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        favorite
                      </span>
                    </button>
                    <span className="material-symbols-outlined text-[20px] text-foreground/30">
                      favorite
                    </span>
                    <span
                      className="material-symbols-outlined text-[20px] text-primary"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      favorite
                    </span>
                  </div>
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    <Tag>.icon-hover</Tag> - muted / <Tag>text-foreground/30</Tag>{" "}
                    - FILL 1
                  </p>
                </div>
              </Frame>
            </div>
          </Section>

          {/* 08 — Inputs & controls */}
          <Section
            id="inputs"
            n="08"
            title="Inputs & controls"
            lead="Text fields use .input-dark; the focus ring is the neutral --tq-border-focus, not the accent. Toggles are pill-shaped with a sliding indicator. Choosers use the ghost pill with an active full-white border."
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <Frame className="space-y-3">
                <Label>Fields</Label>
                <input
                  className="input-dark w-full"
                  placeholder="Email address"
                  defaultValue=""
                />
                <input
                  className="input-dark w-full"
                  type="password"
                  placeholder="Password"
                />
                <input
                  className="input-dark w-full"
                  placeholder="Disabled"
                  disabled
                />
              </Frame>
              <Frame className="space-y-5">
                <div>
                  <Label>Segmented toggle</Label>
                  <div
                    className="inline-flex rounded-full p-1"
                    style={{ background: "var(--tq-card)" }}
                  >
                    <span className="rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-[var(--tq-bg)]">
                      Monthly
                    </span>
                    <span className="px-4 py-1.5 text-xs font-medium text-muted-foreground">
                      Yearly
                    </span>
                  </div>
                </div>
                <div>
                  <Label>Pill chooser</Label>
                  <div className="flex gap-2">
                    <span className="btn-pill border-foreground! text-foreground!">
                      Selected
                    </span>
                    <span className="btn-pill">Option</span>
                    <span className="btn-pill">Option</span>
                  </div>
                </div>
              </Frame>
            </div>
          </Section>

          {/* 09 — Menus & popovers */}
          <Section
            id="menus"
            n="09"
            title="Menus & popovers"
            lead="One primitive covers the kebab (3-dots) menus on project / template / brand-kit tiles, the account menu, and the export / history / language popovers: a .surface-popover or .surface-menu shell of .dropdown-item rows, a hairline divider, and a destructive last item. Framer entry 0.18s."
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <Frame className="flex flex-col items-center gap-3">
                <Label>Kebab menu</Label>
                <div className="surface-popover w-[240px] overflow-hidden rounded-2xl p-1.5">
                  <Item icon="edit" label="Rename" />
                  <Item icon="content_copy" label="Duplicate" />
                  <Item icon="ios_share" label="Share" />
                  <Divider />
                  <Item icon="delete" label="Delete" danger />
                </div>
                <p className="text-[12px] text-muted-foreground">
                  <Tag>.surface-popover</Tag> + <Tag>.dropdown-item</Tag>
                </p>
              </Frame>
              <Frame className="flex flex-col items-center gap-3">
                <Label>Account menu</Label>
                <div className="surface-menu w-64 rounded-2xl p-2">
                  <div className="px-3 py-2">
                    <p className="text-sm font-semibold text-foreground">
                      Osama
                    </p>
                    <p className="text-xs text-muted-foreground">
                      dev@taqreer.ai
                    </p>
                  </div>
                  <Divider />
                  <Item icon="person" label="Account" />
                  <Item icon="settings" label="Settings" />
                  <Item icon="light_mode" label="Theme" />
                  <Divider />
                  <Item icon="logout" label="Sign out" danger />
                </div>
                <p className="text-[12px] text-muted-foreground">
                  <Tag>.surface-menu</Tag> w-64 p-2
                </p>
              </Frame>
            </div>
          </Section>

          {/* 10 — Toasts & notifications */}
          <Section
            id="toasts"
            n="10"
            title="Toasts & notifications"
            lead="The bell dropdown and the transient toast share one surface: .in-slide-popover, 320px wide. The unread badge and dot are Tailwind bg-blue-500 (a sky info chip, intentionally not the brand accent). Toasts stack up to 3, ignore items older than 5s, and auto-dismiss after 15s."
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <Frame className="flex flex-col items-center gap-3">
                <Label>Bell dropdown</Label>
                <div className="in-slide-popover w-80 overflow-hidden rounded-2xl">
                  <div className="flex items-center justify-between px-4 py-3">
                    <p className="text-sm font-semibold text-foreground">
                      Notifications
                    </p>
                    <span className="rounded-full bg-blue-500 px-2 py-0.5 text-[10px] font-medium leading-none text-foreground">
                      2 new
                    </span>
                  </div>
                  <div className="group relative flex w-full items-start gap-3 px-4 py-4 transition-colors hover:bg-foreground/[0.04]">
                    <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--tq-surface)] text-foreground/80">
                      <span className="material-symbols-outlined text-[16px]">
                        group_add
                      </span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium leading-snug text-foreground">
                        Sara shared {"“"}Q4 Sales{"”"} with you
                      </p>
                      <p className="text-[11px] leading-relaxed text-foreground/55">
                        2 minutes ago
                      </p>
                    </div>
                    <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-500" />
                  </div>
                  <div className="group relative flex w-full items-start gap-3 px-4 py-4 opacity-50 transition-colors hover:bg-foreground/[0.04]">
                    <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--tq-surface)] text-foreground/80">
                      <span className="material-symbols-outlined text-[16px]">
                        check_circle
                      </span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium leading-snug text-foreground">
                        Your deck finished generating
                      </p>
                      <p className="text-[11px] leading-relaxed text-foreground/55">
                        Yesterday
                      </p>
                    </div>
                  </div>
                </div>
              </Frame>
              <Frame className="flex flex-col items-center gap-3">
                <Label>Transient toast</Label>
                <div className="in-slide-popover relative w-80 overflow-hidden rounded-2xl">
                  <button
                    type="button"
                    className="absolute end-4 top-3 flex h-6 w-6 items-center justify-center rounded-md text-foreground/40 transition-colors hover:bg-foreground/10 hover:text-foreground"
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      close
                    </span>
                  </button>
                  <div className="flex items-start gap-3 px-4 py-4">
                    <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--tq-surface)] text-foreground/80">
                      <span className="material-symbols-outlined text-[16px]">
                        notifications
                      </span>
                    </span>
                    <div className="min-w-0 flex-1 pe-6">
                      <p className="text-[13px] font-medium leading-snug text-foreground">
                        Your deck finished generating
                      </p>
                      <p className="text-[11px] leading-relaxed text-foreground/55">
                        12 slides ready to edit
                      </p>
                    </div>
                  </div>
                </div>
                <p className="text-[12px] text-muted-foreground">
                  <Tag>BellToast</Tag> - Framer slide-in, 15s auto-dismiss
                </p>
              </Frame>
            </div>
          </Section>

          {/* 11 — Upload areas */}
          <Section
            id="uploads"
            n="11"
            title="Upload areas"
            lead="Dropzones are a 1px dashed border on bg-overlay-soft. Idle is border-foreground/15 (brighter on hover); drag-over tints the border and fill blue. The picked state becomes a solid surface row; logos are normalised with the .logo-monochrome filter."
          >
            <div className="grid gap-6 lg:grid-cols-3">
              <Frame>
                <Label>Idle</Label>
                <div
                  className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-foreground/15 bg-overlay-soft p-4 text-center transition-colors hover:border-foreground/30"
                  style={{ minHeight: 100 }}
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--tq-surface)]">
                    <span className="material-symbols-outlined text-[22px] text-foreground/80">
                      upload
                    </span>
                  </span>
                  <p className="text-xs text-muted-foreground">
                    Drop a file or click to upload
                  </p>
                </div>
              </Frame>
              <Frame>
                <Label>Drag-over</Label>
                <div
                  className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--tq-violet)]/60 bg-[var(--tq-violet)]/10 p-4 text-center"
                  style={{ minHeight: 100 }}
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--tq-surface)]">
                    <span className="material-symbols-outlined text-[22px] text-primary">
                      upload
                    </span>
                  </span>
                  <p className="text-xs text-primary">Drop to upload</p>
                </div>
              </Frame>
              <Frame className="space-y-3">
                <Label>Picked</Label>
                <div
                  className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2"
                  style={{
                    background: "var(--tq-surface)",
                    borderColor: "var(--tq-border-hairline)",
                  }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="material-symbols-outlined text-[16px] text-foreground/70">
                      font_download
                    </span>
                    <span className="truncate text-xs font-semibold text-foreground">
                      Cairo-Bold.ttf
                    </span>
                  </span>
                  <button
                    type="button"
                    className="flex h-6 w-6 items-center justify-center rounded-md text-foreground/60 transition-colors hover:bg-foreground/10 hover:text-foreground"
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      close
                    </span>
                  </button>
                </div>
                <div
                  className="relative flex w-full items-center justify-center rounded-xl border border-dashed border-foreground/15 bg-overlay-soft px-3"
                  style={{ minHeight: 72 }}
                >
                  <Image
                    src="/logo-light.svg"
                    alt=""
                    width={120}
                    height={34}
                    className="logo-monochrome object-contain"
                  />
                </div>
                <p className="text-[12px] text-muted-foreground">
                  <Tag>.logo-monochrome</Tag> normalises any logo
                </p>
              </Frame>
            </div>
          </Section>

          {/* 12 — Modals & dialogs (full width, stacked rows) */}
          <Section
            id="modals"
            n="12"
            title="Modals & dialogs"
            lead="A modal is the .modal-dim layer behind a .surface-modal panel: header with a close-X, body, then a footer pill row. Confirms are compact (max-w-md, p-8). The message shape (centered icon, semibold title, muted body) covers success, empty and confirm-email states."
          >
            <div className="space-y-6">
              <Frame>
                <Label>Dialog shell</Label>
                <div className="relative mx-auto max-w-lg overflow-hidden rounded-2xl border border-border">
                  <div className="modal-dim absolute inset-0" />
                  <div className="surface-modal relative m-6 rounded-2xl">
                    <div className="flex items-center justify-between border-b border-foreground/[0.08] px-5 py-4">
                      <p className="text-sm font-semibold text-foreground">
                        Dialog title
                      </p>
                      <button
                        type="button"
                        className="icon-hover flex h-9 w-9 items-center justify-center rounded-lg"
                      >
                        <span className="material-symbols-outlined text-[20px]">
                          close
                        </span>
                      </button>
                    </div>
                    <div className="px-5 py-5 text-[13px] text-muted-foreground">
                      Body content sits here, on the solid modal surface above the
                      dimmed page.
                    </div>
                    <div className="flex items-center justify-end gap-2 border-t border-foreground/[0.08] px-5 py-4">
                      <button type="button" className="btn-pill">
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn-gradient px-4 py-1.5 text-xs"
                      >
                        Confirm
                      </button>
                    </div>
                  </div>
                </div>
              </Frame>
              <Frame>
                <Label>Confirm</Label>
                <div className="surface-modal mx-auto w-full max-w-md rounded-2xl p-8">
                  <p className="text-lg font-semibold text-foreground">
                    Delete this project?
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    This cannot be undone. The deck and its history are removed.
                  </p>
                  <div className="mt-6 flex items-center justify-end gap-2">
                    <button type="button" className="btn-pill">
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn-pill-danger px-4 py-1.5 text-xs"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </Frame>
              <Frame>
                <Label>Message shape (success / empty)</Label>
                <div className="mx-auto grid max-w-2xl gap-6 sm:grid-cols-2">
                  <div className="surface-card flex flex-col items-center gap-3 rounded-2xl p-8 text-center">
                    <span
                      className="material-symbols-outlined text-[44px]"
                      style={{ color: "var(--tq-status-ok-dot)" }}
                    >
                      check_circle
                    </span>
                    <p className="text-lg font-semibold text-foreground">
                      Message sent
                    </p>
                    <p className="text-sm text-muted-foreground">
                      We will reply shortly.
                    </p>
                  </div>
                  <div className="surface-card flex flex-col items-center gap-3 rounded-2xl p-8 text-center">
                    <span className="material-symbols-outlined text-[44px] text-foreground/30">
                      mark_email_unread
                    </span>
                    <p className="text-lg font-semibold text-foreground">
                      Check your inbox
                    </p>
                    <p className="text-sm text-muted-foreground">
                      We sent a confirmation link to your email.
                    </p>
                  </div>
                </div>
              </Frame>
            </div>
          </Section>

          {/* 13 — Tooltip & status */}
          <Section
            id="feedback"
            n="13"
            title="Tooltip & status"
            lead="The tooltip is a dark hairline pill (.sidebar-tooltip), portalled and Framer-faded at 0.16s. The status triad (ok / warn / down) has dot, text, bg and border token variants for chips and banners - now legible in light mode too."
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <Frame className="flex flex-col items-center justify-center gap-3">
                <Label>Tooltip</Label>
                <span className="sidebar-tooltip inline-block">
                  Rename project
                </span>
              </Frame>
              <Frame>
                <Label>Status chips</Label>
                <div className="flex flex-wrap gap-3">
                  {[
                    ["Operational", "ok"],
                    ["Degraded", "warn"],
                    ["Down", "down"],
                  ].map(([label, k]) => (
                    <span
                      key={k}
                      className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium"
                      style={{
                        background: `var(--tq-status-${k}-bg)`,
                        border: `1px solid var(--tq-status-${k}-border)`,
                        color: `var(--tq-status-${k}-text)`,
                      }}
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: `var(--tq-status-${k}-dot)` }}
                      />
                      {label}
                    </span>
                  ))}
                </div>
              </Frame>
            </div>
          </Section>

          {/* 14 — Plan, tiers & tables */}
          <Section
            id="plan"
            n="14"
            title="Plan, tiers & tables"
            lead="Tier badges are the solid-blue .badge-purple pill. The active plan card is .plan-banner (one solid blue border). Usage is the .progress-track / .progress-bar pair. Settings-style data is the .settings-row grid with hairline dividers, never a <table>."
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <Frame className="space-y-4">
                <Label>Tier badges</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="badge-purple">Free</span>
                  <span className="badge-purple">Plus</span>
                  <span className="badge-purple">Pro</span>
                  <span className="badge-purple">Max</span>
                </div>
                <div className="plan-banner p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        Pro plan
                      </p>
                      <p className="text-xs text-muted-foreground">
                        5,000 credits / month
                      </p>
                    </div>
                    <span className="badge-purple">Active</span>
                  </div>
                  <div className="mt-4">
                    <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
                      <span>Credits</span>
                      <span>3,240 left</span>
                    </div>
                    <div className="progress-track">
                      <div className="progress-bar" style={{ width: "65%" }} />
                    </div>
                  </div>
                </div>
                <p className="text-[12px] text-muted-foreground">
                  <Tag>.badge-purple</Tag> · <Tag>.plan-banner</Tag> ·{" "}
                  <Tag>.progress-track</Tag>/<Tag>.progress-bar</Tag>
                </p>
              </Frame>
              <Frame>
                <Label>Settings rows</Label>
                <div className="surface-card rounded-2xl px-5">
                  <div className="settings-row">
                    <div>
                      <p className="settings-row-title">Email</p>
                      <p className="settings-row-desc">
                        Used for sign-in and receipts
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-foreground">
                        dev@taqreer.ai
                      </span>
                      <button type="button" className="btn-pill">
                        Change
                      </button>
                    </div>
                  </div>
                  <div className="settings-row">
                    <div>
                      <p className="settings-row-title">Language</p>
                      <p className="settings-row-desc">Interface direction</p>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-foreground">Arabic</span>
                      <button type="button" className="btn-pill">
                        Change
                      </button>
                    </div>
                  </div>
                  <div className="settings-row">
                    <div>
                      <p className="settings-row-title">Theme</p>
                      <p className="settings-row-desc">Light or dark chrome</p>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-foreground">Dark</span>
                      <button type="button" className="btn-pill">
                        Change
                      </button>
                    </div>
                  </div>
                </div>
              </Frame>
            </div>
          </Section>

          {/* 15 — Models & presets */}
          <Section
            id="models"
            n="15"
            title="Models & presets"
            lead="The generation-model picker (GenerateSplitButton). Each row is the bare model name plus a speed chip - a green Thinking chip for adaptive-reasoning presets, a neutral Fast chip for no-thinking - then a blue tier-gate pill on presets above the user's plan, then the live per-deck credit cost. Credits below assume an 8-slide deck (base + slides x perSlide)."
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <Frame className="flex flex-col items-center gap-3">
                <Label>Picker</Label>
                <div className="surface-popover w-[320px] overflow-hidden rounded-2xl">
                  <div className="border-b border-foreground/[0.08] px-4 py-2.5">
                    <p className="text-xs font-semibold text-foreground">
                      Generation model
                    </p>
                  </div>
                  <div className="p-1.5">
                    <PresetRow
                      model="Opus 4.8"
                      thinking={false}
                      credits="180"
                      active
                    />
                    <PresetRow
                      model="Opus 4.8"
                      thinking
                      gate="Plus"
                      credits="576"
                    />
                    <PresetRow
                      model="Fable 5"
                      thinking
                      gate="Pro"
                      credits="724"
                      muted="parked"
                    />
                  </div>
                </div>
              </Frame>
              <Frame className="space-y-3 text-[13px] leading-relaxed text-muted-foreground">
                <p>
                  <span className="text-foreground">opus-fast</span> is the Free
                  default (no thinking, ~$0.10, fastest). The green chip marks
                  presets that pay the thinking-budget surcharge and wait time.
                </p>
                <p>
                  The blue pill is the tier where a preset unlocks:{" "}
                  <span className="text-foreground">opus-balanced</span> at Plus,{" "}
                  <span className="text-foreground">fable-low</span> at Pro. A
                  gated row upsells instead of selecting.
                </p>
                <p>
                  <span className="text-foreground">fable-low</span> is parked -
                  Fable is disabled upstream, so it stays out of the live picker
                  until re-enabled.
                </p>
                <p className="text-[12px]">
                  Source of truth: <Tag>lib/types/quality.ts</Tag> +{" "}
                  <Tag>lib/credits/cost.ts</Tag>.
                </p>
              </Frame>
            </div>
          </Section>

          {/* 16 — Email */}
          <Section
            id="email"
            n="16"
            title="Email"
            lead="Transactional mail uses its own inline-styled shell (lib/email/shell.ts), not globals.css, because mail clients drop external CSS. A flat #111111 canvas, a 62px baked logo box, weight-400 title, #b4b4b4 body, and one blue pill button (#0057FF). Billing mail sends from billing@taqreer.ai; everything else from share@. Inline styles, Cairo, no em dash, Latin numerals, one locale per send."
          >
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Welcome */}
              <Frame className="!p-0 overflow-hidden">
                <div style={{ background: "#111111", fontFamily: "Cairo, sans-serif" }}>
                  <div style={{ padding: "44px 32px 36px", textAlign: "center" }}>
                    <Image
                      src="/email/icon-box.png"
                      alt="taqreer.ai"
                      width={56}
                      height={56}
                      style={{ display: "inline-block", marginBottom: 28 }}
                    />
                    <div style={{ marginBottom: 16 }}>
                      <span
                        style={{
                          display: "inline-block",
                          background: "#16233a",
                          border: "1px solid rgba(51,128,255,0.30)",
                          borderRadius: 999,
                          padding: "6px 15px",
                          fontSize: 12,
                          fontWeight: 600,
                          color: "#66A3FF",
                        }}
                      >
                        400 free credits added
                      </span>
                    </div>
                    <h3
                      style={{
                        margin: 0,
                        fontSize: 24,
                        fontWeight: 400,
                        color: "#ffffff",
                        lineHeight: 1.3,
                      }}
                    >
                      Welcome to taqreer.ai
                    </h3>
                    <p
                      style={{
                        margin: "16px auto 0",
                        maxWidth: 300,
                        fontSize: 14,
                        lineHeight: 1.7,
                        color: "#b4b4b4",
                      }}
                    >
                      Turn an idea, a brief or a file into a designed deck in
                      Arabic or English.
                    </p>
                    <div style={{ marginTop: 28 }}>
                      <span
                        style={{
                          display: "inline-block",
                          background: "#0057FF",
                          borderRadius: 999,
                          padding: "12px 30px",
                          fontSize: 14,
                          fontWeight: 500,
                          color: "#ffffff",
                        }}
                      >
                        Start creating
                      </span>
                    </div>
                  </div>
                </div>
              </Frame>

              {/* Receipt */}
              <Frame className="!p-0 overflow-hidden">
                <div style={{ background: "#111111", fontFamily: "Cairo, sans-serif" }}>
                  <div style={{ padding: "44px 32px 36px", textAlign: "center" }}>
                    <Image
                      src="/email/icon-box.png"
                      alt="taqreer.ai"
                      width={56}
                      height={56}
                      style={{ display: "inline-block", marginBottom: 28 }}
                    />
                    <h3
                      style={{
                        margin: 0,
                        fontSize: 24,
                        fontWeight: 400,
                        color: "#ffffff",
                        lineHeight: 1.3,
                      }}
                    >
                      Payment received
                    </h3>
                    <p
                      style={{
                        margin: "16px auto 0",
                        maxWidth: 300,
                        fontSize: 14,
                        lineHeight: 1.7,
                        color: "#b4b4b4",
                      }}
                    >
                      Thanks. Here is your receipt, also saved in your billing
                      history.
                    </p>
                    <div
                      style={{
                        margin: "24px auto 0",
                        maxWidth: 320,
                        background: "#0A0A0A",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: 12,
                        textAlign: "left",
                      }}
                    >
                      {[
                        ["Plan", "Pro - monthly"],
                        ["Amount paid", "$30.00"],
                        ["Date", "2026-06-15"],
                      ].map(([k, v], i) => (
                        <div
                          key={k}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            padding: "9px 18px",
                            fontSize: 13,
                            borderBottom:
                              i < 2 ? "1px solid rgba(255,255,255,0.06)" : "none",
                          }}
                        >
                          <span style={{ color: "#b4b4b4" }}>{k}</span>
                          <span style={{ color: "#ffffff" }}>{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </Frame>
            </div>
            <p className="mt-3 text-[12px] text-muted-foreground">
              Source of truth: <Tag>lib/email/shell.ts</Tag> (
              <Tag>renderEmail</Tag>, <Tag>summaryBlock</Tag>,{" "}
              <Tag>creditsPill</Tag>). These are scaled-down previews of the real
              inline-styled output.
            </p>
          </Section>

          <footer className="border-t border-border pt-8 text-xs text-muted-foreground">
            Taqreer Design System - one source of truth lives in{" "}
            <Tag>app/globals.css</Tag>. Add new patterns there first, then
            document them here.
          </footer>
        </main>
      </div>
    </div>
  );
}
