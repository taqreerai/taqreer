"use client";

// Step 3 — Output settings. Two side-by-side glass cards covering
// every output-shaping field. Each field originally lived on
// `/create/brand`; moved here per the 4-step refactor
// (`context/plan-create-flow.md`).
//
// Layout (2 cards, no scroll at 1280×720):
//   • RIGHT card — Slide canvas:
//       - slide size (16:9 ↔ 9:16)
//       - persistent overlay text + corner position + excludes
//   • LEFT card — Output content:
//       - slide count (auto / match-file / custom 1-20)
//       - logo placement (corner picker + cover/closing excludes)
//       - generation rules (designStyle + fixTypos + pagination)
//
// State strategy: read `taqreer:create:output` first; fall back to
// the legacy `taqreer:create:brand` shape so users mid-flow on the
// old layout keep their settings. Write `taqreer:create:output` on
// submit.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { CreateShell } from "@/components/create/CreateShell";
import { PillButton } from "@/components/create/PillButton";
import {
  Pill,
  PositionPicker,
  Toggle,
  type CornerPosition,
} from "@/components/create/controls";
import { notifyCreateStateChange } from "@/components/create/CreateStepper";

type SlideSize = "16:9" | "9:16";
type SlideCountMode = "match" | "auto" | "custom";
type LogoPosition = CornerPosition;
type PersistentPosition = CornerPosition;

const DESIGN_STYLE_OPTIONS = [
  "إبداعي",
  "بسيط",
  "احترافي",
  "مرح",
  "صحفي",
  "جريء",
];

const OUTPUT_KEY = "taqreer:create:output";
const BRAND_KEY = "taqreer:create:brand";
const CONTENT_KEY = "taqreer:create:content";

type StoredOutput = {
  slideSize?: SlideSize;
  slideCount?: { mode?: SlideCountMode; value?: number | null };
  logo?: {
    position?: LogoPosition;
    excludeCover?: boolean;
    excludeClosing?: boolean;
  };
  rules?: {
    designStyle?: string | null;
    fixTypos?: boolean;
    pagination?: boolean;
    persistent?: {
      text?: string;
      position?: PersistentPosition;
      excludeCover?: boolean;
      excludeClosing?: boolean;
    } | null;
  };
};

type LegacyBrand = StoredOutput & {
  colors?: unknown;
  paletteMode?: unknown;
  paletteScreenshotUrl?: unknown;
  fonts?: unknown;
  logo?: StoredOutput["logo"] & {
    name?: string | null;
    storageUrl?: string | null;
    previewDataUrl?: string | null;
    exclude?: ("cover" | "closing")[];
  };
};

function readStoredOutput(): StoredOutput | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.sessionStorage.getItem(OUTPUT_KEY);
    if (v) return JSON.parse(v) as StoredOutput;
    const legacy = window.sessionStorage.getItem(BRAND_KEY);
    if (!legacy) return null;
    const parsed = JSON.parse(legacy) as LegacyBrand;
    const exclude = Array.isArray(parsed.logo?.exclude)
      ? parsed.logo!.exclude!
      : [];
    return {
      slideSize: parsed.slideSize,
      slideCount: parsed.slideCount,
      logo: parsed.logo
        ? {
            position: parsed.logo.position,
            excludeCover: exclude.includes("cover"),
            excludeClosing: exclude.includes("closing"),
          }
        : undefined,
      rules: parsed.rules,
    };
  } catch {
    return null;
  }
}

function readContentType(): "file" | "text" | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.sessionStorage.getItem(CONTENT_KEY);
    if (!v) return null;
    const parsed = JSON.parse(v) as { type?: "file" | "text" };
    return parsed.type ?? null;
  } catch {
    return null;
  }
}

function readHasLogo(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = window.sessionStorage.getItem(BRAND_KEY);
    if (!v) return false;
    const parsed = JSON.parse(v) as { logo?: { storageUrl?: string | null } | null };
    return Boolean(parsed.logo?.storageUrl);
  } catch {
    return false;
  }
}

export default function CreateOutputPage() {
  const router = useRouter();
  const [hasLogo, setHasLogo] = useState(false);
  const [contentType, setContentType] = useState<"file" | "text" | null>(null);

  // Defaults match the server render exactly; the post-hydration
  // useEffect below pulls real values from sessionStorage if any.
  const [slideSize, setSlideSize] = useState<SlideSize>("16:9");
  const [slideCountMode, setSlideCountMode] = useState<SlideCountMode>("auto");
  const [slideCountValue, setSlideCountValue] = useState<number>(10);
  const [logoPosition, setLogoPosition] = useState<LogoPosition>("top-right");
  const [logoExcludeCover, setLogoExcludeCover] = useState<boolean>(false);
  const [logoExcludeClosing, setLogoExcludeClosing] = useState<boolean>(false);
  const [designStyle, setDesignStyle] = useState<string | null>(null);
  const [fixTypos, setFixTypos] = useState<boolean>(false);
  const [pagination, setPagination] = useState<boolean>(true);
  const [persistentText, setPersistentText] = useState<string>("");
  const [persistentPosition, setPersistentPosition] = useState<PersistentPosition>(
    "bottom-center",
  );
  const [persistentExcludeCover, setPersistentExcludeCover] = useState<boolean>(false);
  const [persistentExcludeClosing, setPersistentExcludeClosing] = useState<boolean>(false);

  // Hydrate from sessionStorage post-mount. Default-state render
  // matches server output, so the swap here happens before paint
  // without a hydration warning.
  useEffect(() => {
    const stored = readStoredOutput();
    if (stored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored.slideSize) setSlideSize(stored.slideSize);
      if (stored.slideCount?.mode) setSlideCountMode(stored.slideCount.mode);
      if (typeof stored.slideCount?.value === "number") {
        setSlideCountValue(stored.slideCount.value);
      }
      if (stored.logo?.position) setLogoPosition(stored.logo.position);
      if (typeof stored.logo?.excludeCover === "boolean") {
        setLogoExcludeCover(stored.logo.excludeCover);
      }
      if (typeof stored.logo?.excludeClosing === "boolean") {
        setLogoExcludeClosing(stored.logo.excludeClosing);
      }
      if (stored.rules?.designStyle !== undefined) {
        setDesignStyle(stored.rules.designStyle);
      }
      if (typeof stored.rules?.fixTypos === "boolean") {
        setFixTypos(stored.rules.fixTypos);
      }
      if (typeof stored.rules?.pagination === "boolean") {
        setPagination(stored.rules.pagination);
      }
      if (stored.rules?.persistent?.text) {
        setPersistentText(stored.rules.persistent.text);
      }
      if (stored.rules?.persistent?.position) {
        setPersistentPosition(stored.rules.persistent.position);
      }
      if (typeof stored.rules?.persistent?.excludeCover === "boolean") {
        setPersistentExcludeCover(stored.rules.persistent.excludeCover);
      }
      if (typeof stored.rules?.persistent?.excludeClosing === "boolean") {
        setPersistentExcludeClosing(stored.rules.persistent.excludeClosing);
      }
    }
    setHasLogo(readHasLogo());
    setContentType(readContentType());
  }, []);

  // If the brief is free-text, "match file pages" is meaningless —
  // fall back to "auto" so the saved mode doesn't strand the user.
  useEffect(() => {
    if (contentType === "text" && slideCountMode === "match") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSlideCountMode("auto");
    }
  }, [contentType, slideCountMode]);

  const handleNext = () => {
    if (typeof window === "undefined") return;
    const payload: StoredOutput = {
      slideSize,
      slideCount: {
        mode: slideCountMode,
        value: slideCountMode === "custom" ? slideCountValue : null,
      },
      logo: hasLogo
        ? {
            position: logoPosition,
            excludeCover: logoExcludeCover,
            excludeClosing: logoExcludeClosing,
          }
        : undefined,
      rules: {
        designStyle,
        fixTypos,
        pagination,
        persistent: persistentText.trim()
          ? {
              text: persistentText.trim(),
              position: persistentPosition,
              excludeCover: persistentExcludeCover,
              excludeClosing: persistentExcludeClosing,
            }
          : null,
      },
    };
    try {
      window.sessionStorage.setItem(OUTPUT_KEY, JSON.stringify(payload));
      notifyCreateStateChange();
    } catch {
      /* storage blocked — let the next step's hydrate find nothing */
    }
    router.push("/create/summary");
  };

  const handleBack = () => router.push("/create/brand");

  return (
    <CreateShell
      currentStep="output"
      title="إعدادات الإخراج"
      subtitle="حدد حجم الشريحة وعددها، وكذلك موقع الشعار والقواعد المخصصة للتوليد."
    >
      {/* 2 cards side by side. Each card stacks its sections
          vertically. Designed to fit 1280×720 without scroll. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <CanvasCard
          slideSize={slideSize}
          onSlideSize={setSlideSize}
          persistentText={persistentText}
          persistentPosition={persistentPosition}
          persistentExcludeCover={persistentExcludeCover}
          persistentExcludeClosing={persistentExcludeClosing}
          onPersistentText={setPersistentText}
          onPersistentPosition={setPersistentPosition}
          onPersistentExcludeCover={setPersistentExcludeCover}
          onPersistentExcludeClosing={setPersistentExcludeClosing}
        />
        <ContentCard
          slideCountMode={slideCountMode}
          slideCountValue={slideCountValue}
          contentType={contentType}
          hasLogo={hasLogo}
          logoPosition={logoPosition}
          logoExcludeCover={logoExcludeCover}
          logoExcludeClosing={logoExcludeClosing}
          designStyle={designStyle}
          fixTypos={fixTypos}
          pagination={pagination}
          onSlideCountMode={setSlideCountMode}
          onSlideCountValue={setSlideCountValue}
          onLogoPosition={setLogoPosition}
          onLogoExcludeCover={setLogoExcludeCover}
          onLogoExcludeClosing={setLogoExcludeClosing}
          onDesignStyle={setDesignStyle}
          onFixTypos={setFixTypos}
          onPagination={setPagination}
        />
      </div>

      <div className="flex items-center justify-between pt-2">
        <PillButton variant="secondary" onClick={handleBack} icon="arrow_forward">
          السابق
        </PillButton>
        <PillButton variant="primary" onClick={handleNext} icon="arrow_back">
          الخطوة التالية
        </PillButton>
      </div>
    </CreateShell>
  );
}

// ─── Card primitives ──────────────────────────────────────────────

// `layout` on motion.div animates the card's height when its
// contents change size (e.g. custom-input toggle, logo placement
// appearing/disappearing). 250 ms ease-out matches the rest of the
// flow's hover/active timings; no spring tail.
function CardShell({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      layout
      transition={{ layout: { duration: 0.25, ease: [0.16, 1, 0.3, 1] } }}
      className="glass-card flex flex-col gap-4 rounded-2xl p-5"
    >
      <header className="flex items-center gap-2 border-b border-white/[0.08] pb-3">
        <span
          className="material-symbols-outlined text-[#7D2DFF]"
          style={{ fontSize: "18px" }}
        >
          {icon}
        </span>
        <h2 className="text-sm font-semibold text-white">{title}</h2>
      </header>
      <motion.div layout className="flex flex-1 flex-col gap-4">
        {children}
      </motion.div>
    </motion.div>
  );
}

// Sub-section heading inside a card. Icon-free per the design pass
// — only the card-level header carries a glyph; sub-sections rely on
// the white/80 weight + spacing to read as a heading.
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-white/80">{children}</p>
  );
}

// Number stepper for the custom slide-count input. Native number
// arrows look glued-on against the glass chrome; this replaces them
// with two `−` / `+` pill buttons flanking a centered, full-width
// input. Native spinners are hidden via the `.no-spinner` rule in
// globals.css so the input renders as a clean numeric field.
function SlideCountStepper({
  value,
  onChange,
  min,
  max,
}: {
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className="flex items-stretch gap-2">
      <button
        type="button"
        onClick={() => onChange(clamp(value - 1))}
        disabled={value <= min}
        aria-label="إنقاص"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-white transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          background: "rgba(255, 255, 255, var(--glass-opacity))",
          borderColor: "rgba(255, 255, 255, var(--glass-border-opacity))",
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          remove
        </span>
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(event) => {
          const n = Number(event.target.value);
          onChange(Number.isFinite(n) ? clamp(n) : min);
        }}
        className="input-dark no-spinner flex-1 text-center text-sm"
        style={{ paddingTop: 6, paddingBottom: 6 }}
      />
      <button
        type="button"
        onClick={() => onChange(clamp(value + 1))}
        disabled={value >= max}
        aria-label="زيادة"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-white transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          background: "rgba(255, 255, 255, var(--glass-opacity))",
          borderColor: "rgba(255, 255, 255, var(--glass-border-opacity))",
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          add
        </span>
      </button>
    </div>
  );
}

// ─── RIGHT card — Canvas (size + persistent overlay) ────────────

function CanvasCard({
  slideSize,
  onSlideSize,
  persistentText,
  persistentPosition,
  persistentExcludeCover,
  persistentExcludeClosing,
  onPersistentText,
  onPersistentPosition,
  onPersistentExcludeCover,
  onPersistentExcludeClosing,
}: {
  slideSize: SlideSize;
  onSlideSize: (v: SlideSize) => void;
  persistentText: string;
  persistentPosition: PersistentPosition;
  persistentExcludeCover: boolean;
  persistentExcludeClosing: boolean;
  onPersistentText: (s: string) => void;
  onPersistentPosition: (p: PersistentPosition) => void;
  onPersistentExcludeCover: (b: boolean) => void;
  onPersistentExcludeClosing: (b: boolean) => void;
}) {
  return (
    <CardShell title="الشريحة" icon="aspect_ratio">
      <div className="space-y-2">
        <SectionLabel>حجم الشريحة</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          <SizeChoice
            active={slideSize === "16:9"}
            onClick={() => onSlideSize("16:9")}
            label="16:9"
            sub="أفقي"
            ratio="16 / 9"
          />
          <SizeChoice
            active={slideSize === "9:16"}
            onClick={() => onSlideSize("9:16")}
            label="9:16"
            sub="عمودي"
            ratio="9 / 16"
          />
        </div>
      </div>

      <div className="space-y-2 border-t border-white/[0.06] pt-3">
        <SectionLabel>عنصر ثابت على كل الشرائح</SectionLabel>
        <input
          type="text"
          value={persistentText}
          onChange={(e) => onPersistentText(e.target.value)}
          placeholder="مثل: التاريخ، الموقع الإلكتروني"
          className="input-dark"
        />
        {/* Position picker is ALWAYS rendered so the card height
            doesn't jump when the user starts typing. Controls are
            disabled (faded) until there's text — same affordance
            as the toolbar's disabled-but-visible chips. */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <PositionPicker
            value={persistentPosition}
            onChange={onPersistentPosition}
            disabled={!persistentText.trim()}
          />
          <div className="flex flex-col gap-1.5">
            <Pill
              active={persistentExcludeCover}
              onClick={() => onPersistentExcludeCover(!persistentExcludeCover)}
              disabled={!persistentText.trim()}
            >
              استثناء الغلاف
            </Pill>
            <Pill
              active={persistentExcludeClosing}
              onClick={() => onPersistentExcludeClosing(!persistentExcludeClosing)}
              disabled={!persistentText.trim()}
            >
              استثناء الشكر
            </Pill>
          </div>
        </div>
      </div>
    </CardShell>
  );
}

// Compact horizontal size choice — title + subtitle on the start
// side (right in RTL), aspect-ratio preview icon on the end side.
// Original layout had everything centered with a huge preview tile
// which made the buttons read as banners rather than options.
function SizeChoice({
  active,
  onClick,
  label,
  sub,
  ratio,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sub: string;
  ratio: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-11 items-center justify-between gap-3 rounded-xl border px-3 transition-colors ${
        active ? "btn-gradient" : "backdrop-blur-glass hover:opacity-90"
      }`}
      style={
        active
          ? { borderRadius: 12 }
          : {
              background: "rgba(255, 255, 255, var(--glass-opacity))",
              borderColor: "rgba(255, 255, 255, var(--glass-border-opacity))",
            }
      }
    >
      <span className="flex flex-col items-start leading-tight">
        <span className="text-xs font-semibold text-white">{label}</span>
        <span className={`text-[10px] ${active ? "text-white/80" : "text-white/50"}`}>
          {sub}
        </span>
      </span>
      <span
        className="rounded-sm border border-white/30 bg-white/10"
        style={{ height: 18, aspectRatio: ratio }}
      />
    </button>
  );
}

// ─── LEFT card — Content (count + logo + rules) ─────────────────

function ContentCard({
  slideCountMode,
  slideCountValue,
  contentType,
  hasLogo,
  logoPosition,
  logoExcludeCover,
  logoExcludeClosing,
  designStyle,
  fixTypos,
  pagination,
  onSlideCountMode,
  onSlideCountValue,
  onLogoPosition,
  onLogoExcludeCover,
  onLogoExcludeClosing,
  onDesignStyle,
  onFixTypos,
  onPagination,
}: {
  slideCountMode: SlideCountMode;
  slideCountValue: number;
  contentType: "file" | "text" | null;
  hasLogo: boolean;
  logoPosition: LogoPosition;
  logoExcludeCover: boolean;
  logoExcludeClosing: boolean;
  designStyle: string | null;
  fixTypos: boolean;
  pagination: boolean;
  onSlideCountMode: (m: SlideCountMode) => void;
  onSlideCountValue: (n: number) => void;
  onLogoPosition: (p: LogoPosition) => void;
  onLogoExcludeCover: (b: boolean) => void;
  onLogoExcludeClosing: (b: boolean) => void;
  onDesignStyle: (s: string | null) => void;
  onFixTypos: (b: boolean) => void;
  onPagination: (b: boolean) => void;
}) {
  return (
    <CardShell title="المحتوى" icon="tune">
      {/* Slide count — pill row stays stable; the custom number input
          appears as its own full-width row underneath when "مخصص" is
          active, with `−` / `+` step buttons replacing the native
          arrows (which never match our chrome). The pill row no
          longer shifts vertically because no taller sibling slides
          into it. */}
      <div className="space-y-2">
        <SectionLabel>عدد الشرائح</SectionLabel>
        <div className="flex items-center gap-1.5">
          <Pill active={slideCountMode === "auto"} onClick={() => onSlideCountMode("auto")}>
            تلقائي
          </Pill>
          {contentType === "file" ? (
            <Pill
              active={slideCountMode === "match"}
              onClick={() => onSlideCountMode("match")}
            >
              طابق الملف
            </Pill>
          ) : null}
          <Pill
            active={slideCountMode === "custom"}
            onClick={() => onSlideCountMode("custom")}
          >
            مخصص
          </Pill>
        </div>
        {slideCountMode === "custom" ? (
          <SlideCountStepper
            value={slideCountValue}
            onChange={onSlideCountValue}
            min={1}
            max={20}
          />
        ) : null}
      </div>

      {/* Logo placement — entire section hidden when no logo was
          uploaded. Avoids the "لم يتم رفع شعار..." placeholder which
          served no purpose (the user already knows they skipped logo
          upload; reminding them here adds noise). */}
      {hasLogo ? (
        <div className="space-y-2 border-t border-white/[0.06] pt-3">
          <SectionLabel>موقع الشعار</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <PositionPicker value={logoPosition} onChange={onLogoPosition} />
            <div className="flex flex-col gap-1.5">
              <Pill
                active={logoExcludeCover}
                onClick={() => onLogoExcludeCover(!logoExcludeCover)}
              >
                استثناء الغلاف
              </Pill>
              <Pill
                active={logoExcludeClosing}
                onClick={() => onLogoExcludeClosing(!logoExcludeClosing)}
              >
                استثناء الشكر
              </Pill>
            </div>
          </div>
        </div>
      ) : null}

      {/* Generation rules */}
      <div className="space-y-2 border-t border-white/[0.06] pt-3">
        <SectionLabel>قواعد التوليد</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {DESIGN_STYLE_OPTIONS.map((option) => (
            <Pill
              key={option}
              active={designStyle === option}
              onClick={() => onDesignStyle(designStyle === option ? null : option)}
            >
              {option}
            </Pill>
          ))}
        </div>
        <div className="flex flex-col gap-1.5 pt-1">
          <Toggle label="تصحيح الأخطاء" value={fixTypos} onChange={onFixTypos} />
          <Toggle label="ترقيم الشرائح" value={pagination} onChange={onPagination} />
        </div>
      </div>
    </CardShell>
  );
}
