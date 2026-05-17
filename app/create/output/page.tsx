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

function SectionLabel({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-semibold text-white/80">
      <span
        className="material-symbols-outlined text-white/50"
        style={{ fontSize: "14px" }}
      >
        {icon}
      </span>
      {children}
    </p>
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
        <SectionLabel icon="crop_landscape">حجم الشريحة</SectionLabel>
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
        <SectionLabel icon="layers">عنصر ثابت على كل الشرائح</SectionLabel>
        <input
          type="text"
          value={persistentText}
          onChange={(e) => onPersistentText(e.target.value)}
          placeholder="مثل: التاريخ، الموقع الإلكتروني"
          className="input-dark"
        />
        {persistentText.trim() ? (
          <div className="grid grid-cols-2 gap-3 pt-1">
            {/* Position picker on the start side, excludes on the end
                side — keeps the persistent block compact rather than
                stacking + double-widthing into a full-row position
                picker that pushes the card height past the viewport. */}
            <PositionPicker
              value={persistentPosition}
              onChange={onPersistentPosition}
            />
            <div className="flex flex-col gap-1.5">
              <Pill
                active={persistentExcludeCover}
                onClick={() => onPersistentExcludeCover(!persistentExcludeCover)}
              >
                استثناء الغلاف
              </Pill>
              <Pill
                active={persistentExcludeClosing}
                onClick={() => onPersistentExcludeClosing(!persistentExcludeClosing)}
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
      className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border p-2.5 transition-colors ${
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
        style={{ width: 36, aspectRatio: ratio }}
      />
      <span className="text-xs font-semibold text-white">{label}</span>
      <span className={`text-[10px] ${active ? "text-white/80" : "text-white/50"}`}>
        {sub}
      </span>
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
      {/* Slide count */}
      <div className="space-y-2">
        <SectionLabel icon="format_list_numbered">عدد الشرائح</SectionLabel>
        <div className="flex flex-wrap items-center gap-2">
          <Pill active={slideCountMode === "auto"} onClick={() => onSlideCountMode("auto")}>
            تلقائي
          </Pill>
          <Pill
            active={slideCountMode === "match"}
            onClick={() => onSlideCountMode("match")}
            disabled={contentType !== "file"}
          >
            طابق الملف
          </Pill>
          <Pill
            active={slideCountMode === "custom"}
            onClick={() => onSlideCountMode("custom")}
          >
            مخصص
          </Pill>
          {slideCountMode === "custom" ? (
            <input
              type="number"
              min={1}
              max={20}
              value={slideCountValue}
              onChange={(e) => onSlideCountValue(Number(e.target.value))}
              className="input-dark w-20"
            />
          ) : null}
        </div>
      </div>

      {/* Logo placement */}
      <div className="space-y-2 border-t border-white/[0.06] pt-3">
        <SectionLabel icon="my_location">موقع الشعار</SectionLabel>
        {!hasLogo ? (
          <p className="text-[11px] text-white/40">
            لم يتم رفع شعار في الخطوة السابقة
          </p>
        ) : (
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
        )}
      </div>

      {/* Generation rules */}
      <div className="space-y-2 border-t border-white/[0.06] pt-3">
        <SectionLabel icon="rule">قواعد التوليد</SectionLabel>
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
