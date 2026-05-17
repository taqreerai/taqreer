"use client";

// Step 3 — Output settings. 2×2 grid of glass cards covering slide
// size, slide count, logo placement, and generation rules. Each
// field originally lived on `/create/brand`; moved here per the
// 4-step refactor (`context/plan-create-flow.md`).
//
// State strategy:
//   1. Read `taqreer:create:output` first — the canonical source.
//   2. If that's empty, fall back to `taqreer:create:brand` (legacy
//      shape that mixed brand + output) so users mid-flow on the
//      old layout keep their settings.
//   3. Write `taqreer:create:output` on submit and re-write the
//      slimmed `taqreer:create:brand` (without size/count/rules/
//      logo-placement) for backward-compat with downstream code.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
  "كلاسيكي",
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

// Legacy brand-page shape — includes the fields we now own here.
type LegacyBrand = StoredOutput & {
  // Brand-only fields we DON'T touch here (just preserve when
  // round-tripping the legacy key on submit).
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
    // Fall back to legacy brand key for users mid-flow.
    const legacy = window.sessionStorage.getItem(BRAND_KEY);
    if (!legacy) return null;
    const parsed = JSON.parse(legacy) as LegacyBrand;
    // Pull out only the fields we own. Logo placement was nested as
    // { position, exclude: ["cover","closing"] } in the legacy
    // shape; normalise it.
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

// Detect whether the brand page has a logo upload to enable the
// logo-placement card. Without a logo, the placement controls are
// disabled (no point picking a corner for nothing).
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

  const stored = useMemo(() => readStoredOutput(), []);

  const [slideSize, setSlideSize] = useState<SlideSize>(stored?.slideSize ?? "16:9");
  const [slideCountMode, setSlideCountMode] = useState<SlideCountMode>(
    stored?.slideCount?.mode ?? "auto",
  );
  const [slideCountValue, setSlideCountValue] = useState<number>(
    stored?.slideCount?.value ?? 10,
  );

  const [logoPosition, setLogoPosition] = useState<LogoPosition>(
    stored?.logo?.position ?? "top-right",
  );
  const [logoExcludeCover, setLogoExcludeCover] = useState<boolean>(
    stored?.logo?.excludeCover ?? false,
  );
  const [logoExcludeClosing, setLogoExcludeClosing] = useState<boolean>(
    stored?.logo?.excludeClosing ?? false,
  );

  const [designStyle, setDesignStyle] = useState<string | null>(
    stored?.rules?.designStyle ?? null,
  );
  const [fixTypos, setFixTypos] = useState<boolean>(
    stored?.rules?.fixTypos ?? false,
  );
  const [pagination, setPagination] = useState<boolean>(
    stored?.rules?.pagination !== false,
  );
  const [persistentText, setPersistentText] = useState<string>(
    stored?.rules?.persistent?.text ?? "",
  );
  const [persistentPosition, setPersistentPosition] = useState<PersistentPosition>(
    stored?.rules?.persistent?.position ?? "bottom-center",
  );
  const [excludeCover, setExcludeCover] = useState<boolean>(
    stored?.rules?.persistent?.excludeCover ?? false,
  );
  const [excludeClosing, setExcludeClosing] = useState<boolean>(
    stored?.rules?.persistent?.excludeClosing ?? false,
  );

  // Hydrate logo-presence + content-type on mount (sessionStorage
  // is client-only). Both inform UI affordances but neither
  // contributes to the page's own form state.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHasLogo(readHasLogo());
    setContentType(readContentType());
  }, []);

  // If the brief is a free-text paste, "match file pages" is
  // meaningless — fall back to "auto" so the saved mode doesn't
  // strand the user on an option they can't actually use.
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
              excludeCover,
              excludeClosing,
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
      {/* 2×2 grid — top row: size + count, bottom row: logo + rules.
          `auto-rows-fr` keeps both rows the same height so the cards
          line up visually even when content lengths differ. */}
      <div className="grid grid-cols-1 gap-5 auto-rows-fr lg:grid-cols-2">
        <SizeCard value={slideSize} onChange={setSlideSize} />
        <SlideCountCard
          mode={slideCountMode}
          value={slideCountValue}
          onModeChange={setSlideCountMode}
          onValueChange={setSlideCountValue}
          contentType={contentType}
        />
        <LogoPlacementCard
          enabled={hasLogo}
          position={logoPosition}
          excludeCover={logoExcludeCover}
          excludeClosing={logoExcludeClosing}
          onPositionChange={setLogoPosition}
          onExcludeCover={setLogoExcludeCover}
          onExcludeClosing={setLogoExcludeClosing}
        />
        <RulesCard
          designStyle={designStyle}
          fixTypos={fixTypos}
          pagination={pagination}
          persistentText={persistentText}
          persistentPosition={persistentPosition}
          excludeCover={excludeCover}
          excludeClosing={excludeClosing}
          onDesignStyle={setDesignStyle}
          onFixTypos={setFixTypos}
          onPagination={setPagination}
          onPersistentText={setPersistentText}
          onPersistentPosition={setPersistentPosition}
          onExcludeCover={setExcludeCover}
          onExcludeClosing={setExcludeClosing}
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

// ─── Card components ──────────────────────────────────────────────

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
    <div className="glass-card flex flex-col gap-4 rounded-2xl p-5">
      <header className="flex items-center gap-2 border-b border-white/[0.08] pb-3">
        <span
          className="material-symbols-outlined text-white/70"
          style={{ fontSize: "18px" }}
        >
          {icon}
        </span>
        <h2 className="text-sm font-semibold text-white">{title}</h2>
      </header>
      <div className="flex flex-1 flex-col gap-4">{children}</div>
    </div>
  );
}

function SizeCard({
  value,
  onChange,
}: {
  value: SlideSize;
  onChange: (v: SlideSize) => void;
}) {
  return (
    <CardShell title="حجم الشريحة" icon="aspect_ratio">
      <div className="grid grid-cols-2 gap-3">
        <SizeChoice
          active={value === "16:9"}
          onClick={() => onChange("16:9")}
          label="16:9"
          sub="أفقي"
          ratio="16 / 9"
        />
        <SizeChoice
          active={value === "9:16"}
          onClick={() => onChange("9:16")}
          label="9:16"
          sub="عمودي"
          ratio="9 / 16"
        />
      </div>
    </CardShell>
  );
}

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
      className={`flex flex-col items-center justify-center gap-2 rounded-xl border p-3 transition-colors ${
        active ? "btn-gradient" : "backdrop-blur-glass hover:opacity-90"
      }`}
      style={
        active
          ? undefined
          : {
              background: "rgba(255, 255, 255, var(--glass-opacity))",
              borderColor: "rgba(255, 255, 255, var(--glass-border-opacity))",
            }
      }
    >
      <span
        className="rounded-md border border-white/20 bg-white/5"
        style={{ width: 48, aspectRatio: ratio }}
      />
      <span className="text-sm font-semibold text-white">{label}</span>
      <span className={`text-xs ${active ? "text-white/80" : "text-white/50"}`}>
        {sub}
      </span>
    </button>
  );
}

function SlideCountCard({
  mode,
  value,
  onModeChange,
  onValueChange,
  contentType,
}: {
  mode: SlideCountMode;
  value: number;
  onModeChange: (m: SlideCountMode) => void;
  onValueChange: (n: number) => void;
  contentType: "file" | "text" | null;
}) {
  const fileSourced = contentType === "file";
  return (
    <CardShell title="عدد الشرائح" icon="format_list_numbered">
      <div className="flex flex-wrap gap-2">
        <Pill
          active={mode === "auto"}
          onClick={() => onModeChange("auto")}
        >
          اتركها لنا
        </Pill>
        <Pill
          active={mode === "match"}
          onClick={() => onModeChange("match")}
          disabled={!fileSourced}
        >
          طابق عدد صفحات الملف
        </Pill>
        <Pill
          active={mode === "custom"}
          onClick={() => onModeChange("custom")}
        >
          حدد عدداً
        </Pill>
      </div>
      {mode === "custom" ? (
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={20}
            value={value}
            onChange={(e) => onValueChange(Number(e.target.value))}
            className="input-dark max-w-28"
          />
          <span className="text-xs text-muted">شريحة (١–٢٠)</span>
        </div>
      ) : (
        <p className="text-xs text-muted">
          {mode === "auto"
            ? "سنقرر العدد المناسب بناءً على المحتوى."
            : "سيتم اختيار عدد الشرائح ليطابق عدد صفحات الملف المرفوع."}
        </p>
      )}
    </CardShell>
  );
}

function LogoPlacementCard({
  enabled,
  position,
  excludeCover,
  excludeClosing,
  onPositionChange,
  onExcludeCover,
  onExcludeClosing,
}: {
  enabled: boolean;
  position: LogoPosition;
  excludeCover: boolean;
  excludeClosing: boolean;
  onPositionChange: (p: LogoPosition) => void;
  onExcludeCover: (b: boolean) => void;
  onExcludeClosing: (b: boolean) => void;
}) {
  return (
    <CardShell title="موقع الشعار" icon="my_location">
      {!enabled ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <span
            className="material-symbols-outlined text-white/30"
            style={{ fontSize: "28px" }}
          >
            image_not_supported
          </span>
          <p className="text-xs text-white/50">لم يتم رفع شعار في الخطوة السابقة</p>
          <p className="text-[10px] leading-relaxed text-white/30">
            ارفع شعاراً من «الهوية البصرية» لتفعيل خيارات الموقع
          </p>
        </div>
      ) : (
        <>
          <PositionPicker value={position} onChange={onPositionChange} />
          <div className="space-y-2">
            <p className="text-xs text-muted">استثناء من</p>
            <div className="flex flex-wrap gap-2">
              <Pill active={excludeCover} onClick={() => onExcludeCover(!excludeCover)}>
                صفحة الغلاف
              </Pill>
              <Pill
                active={excludeClosing}
                onClick={() => onExcludeClosing(!excludeClosing)}
              >
                صفحة الشكر
              </Pill>
            </div>
          </div>
        </>
      )}
    </CardShell>
  );
}

function RulesCard({
  designStyle,
  fixTypos,
  pagination,
  persistentText,
  persistentPosition,
  excludeCover,
  excludeClosing,
  onDesignStyle,
  onFixTypos,
  onPagination,
  onPersistentText,
  onPersistentPosition,
  onExcludeCover,
  onExcludeClosing,
}: {
  designStyle: string | null;
  fixTypos: boolean;
  pagination: boolean;
  persistentText: string;
  persistentPosition: PersistentPosition;
  excludeCover: boolean;
  excludeClosing: boolean;
  onDesignStyle: (s: string | null) => void;
  onFixTypos: (b: boolean) => void;
  onPagination: (b: boolean) => void;
  onPersistentText: (s: string) => void;
  onPersistentPosition: (p: PersistentPosition) => void;
  onExcludeCover: (b: boolean) => void;
  onExcludeClosing: (b: boolean) => void;
}) {
  return (
    <CardShell title="قواعد التوليد" icon="rule">
      <div className="space-y-2">
        <p className="text-xs text-muted">نمط التصميم</p>
        <div className="flex flex-wrap gap-2">
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
      </div>

      <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-3">
        <Toggle label="تصحيح الأخطاء الإملائية" value={fixTypos} onChange={onFixTypos} />
        <Toggle
          label="ترقيم الشرائح"
          value={pagination}
          onChange={onPagination}
        />
      </div>

      <div className="space-y-2 border-t border-white/[0.06] pt-3">
        <p className="text-xs text-muted">عنصر ثابت على كل الشرائح</p>
        <input
          type="text"
          value={persistentText}
          onChange={(e) => onPersistentText(e.target.value)}
          placeholder="مثل: التاريخ، الموقع الإلكتروني"
          className="input-dark"
        />
        {persistentText.trim() ? (
          <div className="space-y-2 pt-1">
            <PositionPicker
              value={persistentPosition}
              onChange={onPersistentPosition}
            />
            <div className="flex flex-wrap gap-2">
              <Pill active={excludeCover} onClick={() => onExcludeCover(!excludeCover)}>
                استثناء الغلاف
              </Pill>
              <Pill
                active={excludeClosing}
                onClick={() => onExcludeClosing(!excludeClosing)}
              >
                استثناء الشكر
              </Pill>
            </div>
          </div>
        ) : null}
      </div>
    </CardShell>
  );
}
