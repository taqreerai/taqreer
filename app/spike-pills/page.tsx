"use client";

// Pill / badge / chip stress-test harness for dom-to-pptx.
//
// What we're trying to learn: when does Arabic text top-anchor visibly
// inside a pill-shaped styled box, and at what height does the gap
// disappear (i.e. where do we draw the "is a pill" threshold for the
// auto-center patch). Side-by-side variants on the simple slides show
// the gap directly; dense slides (rows, stacks, edge cases) test layout
// regressions and confirm the patch doesn't over-fire on cards.
//
// Workflow: hit /spike-pills, export, open .pptx in PowerPoint, grade
// each slide against its `expected` string. Compare padding-only (what
// Claude defaults to) to inline-flex (the prompt's recommended pattern).

import { useState } from "react";
import {
  downloadBlob,
  fixBiDiInPptxBlob,
  makeStats,
  type BiDiPostprocessStats,
} from "@/lib/export/bidi-postprocess";

// ── shared visual tokens ───────────────────────────────────────────────
const NAVY = "#0B1A4A";
const NAVY_BG = "#E8ECF7";
const SLIDE_BG = "#FFFFFF";
const SLIDE_BG_DARK = "#0D0B1F";

// Padding-only pill — the exact failure pattern. Bare `padding + height`,
// no line-height adjustment, no flex centering. Default CSS line-box
// height is `font-size × 1.2`, which is SHORTER than the pill height
// for any height ≳ font-size × 1.3, so the inline text top-anchors in
// the pill (line-box sticks to the content-area top edge). This is the
// pattern Claude defaults to when the prompt rule doesn't enforce
// inline-flex, and what we want the dom-to-pptx patch to auto-fix.
function PadPill({
  text,
  height = 48,
  fontSize = 24,
  width,
  minWidth,
  style: extra,
}: {
  text: string;
  height?: number;
  fontSize?: number;
  width?: number | string;
  minWidth?: number | string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0 22px",
        height,
        fontSize,
        // No line-height, no vertical-align, no align-items — this is
        // the bare failure pattern. Browser will already show the
        // top-anchor visually; PPT should match.
        // text-align: center matches typical pill design (and the
        // prompt rule); without it, RTL pills right-anchor the text
        // and look off-balance after PASS 3 slack widens them.
        textAlign: "center",
        color: NAVY,
        background: SLIDE_BG,
        border: `1px solid ${NAVY}`,
        borderRadius: 9999,
        boxSizing: "border-box",
        width,
        minWidth,
        whiteSpace: "nowrap",
        ...extra,
      }}
    >
      {text}
    </span>
  );
}

// Inline-flex pill — the prompt's recommended pattern. dom-to-pptx
// reads `alignItems: 'center'` → `valign='middle'` (Path B at
// bundle:64709). Should centre Arabic glyphs in the export.
function FlexPill({
  text,
  height = 48,
  fontSize = 24,
  width,
  minWidth,
  style: extra,
}: {
  text: string;
  height?: number;
  fontSize?: number;
  width?: number | string;
  minWidth?: number | string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 22px",
        height,
        fontSize,
        lineHeight: 1,
        color: NAVY,
        background: SLIDE_BG,
        border: `1px solid ${NAVY}`,
        borderRadius: 9999,
        boxSizing: "border-box",
        width,
        minWidth,
        whiteSpace: "nowrap",
        ...extra,
      }}
    >
      {text}
    </span>
  );
}

const colHeader: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: "#666",
  marginBottom: 16,
  letterSpacing: 0.5,
};

const slideTitle: React.CSSProperties = {
  fontSize: 32,
  fontWeight: 700,
  color: NAVY,
  margin: "0 0 8px",
};

const slideSub: React.CSSProperties = {
  fontSize: 16,
  color: "#555",
  margin: "0 0 40px",
  maxWidth: 1600,
  lineHeight: 1.4,
};

// ── slide bodies ────────────────────────────────────────────────────────

const SLIDES: Array<{
  label: string;
  expected: string;
  dir?: "rtl" | "ltr";
  body: React.ReactNode;
}> = [
  {
    label: "1 — Height ladder (Arabic)",
    expected:
      "Padding-only pills (left column): Arabic glyphs top-anchor; mis-alignment most visible at 32-64px, fades at 100-120px. Inline-flex pills (right column): centered at every height. The gap WIDTH between top and bottom of the text vs box edges is the diagnostic.",
    body: (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80 }}>
        <div>
          <div style={colHeader}>PADDING-ONLY (Claude default)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {[32, 48, 64, 80, 100, 120].map((h) => (
              <div key={h} style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <span style={{ fontSize: 14, color: "#888", width: 56 }}>{h}px</span>
                {/* Pinned minWidth + uniform font-size keeps the capsule
                    geometry constant across heights so the only variable
                    we're measuring is vertical anchoring. */}
                <PadPill
                  text="رؤيتنا"
                  height={h}
                  fontSize={24}
                  minWidth={200}
                />
              </div>
            ))}
          </div>
        </div>
        <div>
          <div style={colHeader}>INLINE-FLEX (prompt rule)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {[32, 48, 64, 80, 100, 120].map((h) => (
              <div key={h} style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <span style={{ fontSize: 14, color: "#888", width: 56 }}>{h}px</span>
                <FlexPill
                  text="رؤيتنا"
                  height={h}
                  fontSize={24}
                  minWidth={200}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
  },
  {
    label: "2 — Padding-only vs inline-flex (Arabic, single pill)",
    expected:
      'Both pills should LOOK identical in the browser (line-height: <height>px on padding-only does the work). In PPT, padding-only top-anchors "رؤيتنا" — the gap above the text < gap below.',
    body: (
      <div
        style={{
          display: "flex",
          gap: 120,
          justifyContent: "center",
          alignItems: "center",
          marginTop: 80,
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={colHeader}>PADDING-ONLY</div>
          <PadPill text="رؤيتنا" height={56} fontSize={28} />
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={colHeader}>INLINE-FLEX</div>
          <FlexPill text="رؤيتنا" height={56} fontSize={28} />
        </div>
      </div>
    ),
  },
  {
    label: "3 — Padding-only vs inline-flex (Latin control)",
    expected:
      'Latin glyphs sit lower in their line-box than Arabic, so the visual mis-alignment should be SMALLER than slide 2 — almost imperceptible. This confirms the bug is Arabic-specific (glyph metric mismatch), not a general padding-only issue.',
    dir: "ltr",
    body: (
      <div
        style={{
          display: "flex",
          gap: 120,
          justifyContent: "center",
          alignItems: "center",
          marginTop: 80,
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={colHeader}>PADDING-ONLY</div>
          <PadPill text="Our vision" height={56} fontSize={28} />
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={colHeader}>INLINE-FLEX</div>
          <FlexPill text="Our vision" height={56} fontSize={28} />
        </div>
      </div>
    ),
  },
  {
    label: "4 — Multi-pill rows (padding-only)",
    expected:
      "2-pill / 3-pill / 4-pill rows. All padding-only. Top-anchor visible in every pill, AND consistent — the patch should fix every pill in every row uniformly. Watch for any row that gets a different vertical anchor than its neighbours (signals an over-narrow size threshold).",
    body: (
      <div style={{ display: "flex", flexDirection: "column", gap: 48 }}>
        <div>
          <div style={colHeader}>2 PILLS</div>
          <div style={{ display: "flex", gap: 16 }}>
            <PadPill text="الرؤية" />
            <PadPill text="الرسالة" />
          </div>
        </div>
        <div>
          <div style={colHeader}>3 PILLS</div>
          <div style={{ display: "flex", gap: 16 }}>
            <PadPill text="الرؤية" />
            <PadPill text="الرسالة" />
            <PadPill text="القيم" />
          </div>
        </div>
        <div>
          <div style={colHeader}>4 PILLS</div>
          <div style={{ display: "flex", gap: 16 }}>
            <PadPill text="الرؤية" />
            <PadPill text="الرسالة" />
            <PadPill text="القيم" />
            <PadPill text="الأهداف" />
          </div>
        </div>
      </div>
    ),
  },
  {
    label: "5 — Stacked pills (padding-only, vertical column)",
    expected:
      "4 pills stacked. Each top-anchors independently — the cumulative effect should look like a uniformly mis-aligned column, not a diverging one. Confirms the bug is per-pill, not layout-cascading.",
    body: (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          alignItems: "flex-start",
        }}
      >
        <PadPill text="الإستراتيجية" />
        <PadPill text="التنفيذ" />
        <PadPill text="المتابعة" />
        <PadPill text="التقييم" />
      </div>
    ),
  },
  {
    label: "6 — Long text behaviour",
    expected:
      "Pill A: `white-space: nowrap` — text overflows to the right of the pill (visible clip). Pill B: width:auto — text expands the pill horizontally. Pill C: fixed width + wrap — text breaks to a second line; box height stays fixed, text overflows DOWNWARDS. We need to know if dom-to-pptx truncates, wraps, or overflows.",
    body: (
      <div
        style={{ display: "flex", flexDirection: "column", gap: 56, marginTop: 40 }}
      >
        <div>
          <div style={colHeader}>A — nowrap (overflow horizontally)</div>
          <PadPill
            text="نص طويل جداً لا ينكسر داخل الحبة"
            width={300}
            style={{ overflow: "visible" }}
          />
        </div>
        <div>
          <div style={colHeader}>B — width:auto (pill expands)</div>
          <PadPill text="نص طويل جداً يجعل الحبة تتمدد أفقياً بدلاً من الكسر" />
        </div>
        <div>
          <div style={colHeader}>C — fixed width + wrap (text overflows down)</div>
          <PadPill
            text="نص طويل ينكسر إلى سطرين"
            width={300}
            style={{ whiteSpace: "normal", lineHeight: "24px", paddingTop: 12 }}
          />
        </div>
      </div>
    ),
  },
  {
    label: "7 — Mixed-script pills",
    expected:
      "Each pill has BOTH Arabic and Latin/digits. The mixed-script splitter (`taqreer_hasUniformScript`) may split each pill into 2 text shapes — if so, EACH split shape needs to centre. The patch must fire on each split half, not just the original element.",
    body: (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        <PadPill text="Q1 2026" />
        <PadPill text="تقرير A/B" />
        <PadPill text="النسخة 2.4" />
        <PadPill text="2025 خطة" />
        <PadPill text="KPI · الأداء" />
        <FlexPill text="Q1 2026" />
        <FlexPill text="تقرير A/B" />
        <FlexPill text="النسخة 2.4" />
      </div>
    ),
  },
  {
    label: "8 — Style variations (each padding-only)",
    expected:
      "5 pills, same Arabic text, different styling. The patch's detection (`hasBorder || (hasVisibleBg && hasBorderRadius)`) MUST fire on all five: border-only, bg+radius only, both, shadow variant, gradient bg variant. Inline-flex versions below are the visual target.",
    body: (
      <div
        style={{ display: "flex", flexDirection: "column", gap: 40, marginTop: 24 }}
      >
        <div>
          <div style={colHeader}>PADDING-ONLY VARIANTS</div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {/* border-only */}
            <PadPill
              text="حد فقط"
              style={{ background: "transparent" }}
            />
            {/* bg+radius only, no border */}
            <PadPill
              text="خلفية"
              style={{ background: NAVY_BG, border: "none", color: NAVY }}
            />
            {/* both */}
            <PadPill text="كلاهما" />
            {/* shadow */}
            <PadPill
              text="ظل"
              style={{
                boxShadow: "0 4px 12px rgba(11,26,74,0.18)",
                background: SLIDE_BG,
              }}
            />
            {/* gradient bg */}
            <PadPill
              text="تدرج"
              style={{
                background:
                  "linear-gradient(90deg, #0B1A4A 0%, #4A5FBF 100%)",
                color: "#FFF",
                border: "none",
              }}
            />
          </div>
        </div>
        <div>
          <div style={colHeader}>INLINE-FLEX REFERENCE</div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <FlexPill text="حد فقط" style={{ background: "transparent" }} />
            <FlexPill
              text="خلفية"
              style={{ background: NAVY_BG, border: "none", color: NAVY }}
            />
            <FlexPill text="كلاهما" />
            <FlexPill
              text="ظل"
              style={{ boxShadow: "0 4px 12px rgba(11,26,74,0.18)" }}
            />
            <FlexPill
              text="تدرج"
              style={{
                background:
                  "linear-gradient(90deg, #0B1A4A 0%, #4A5FBF 100%)",
                color: "#FFF",
                border: "none",
              }}
            />
          </div>
        </div>
      </div>
    ),
  },
  {
    label: "9 — Edge cases (threshold check)",
    expected:
      'Three deliberately-edge-case bordered shapes. (a) 1-char pill: tiny shape, must center. (b) 800px-wide pill: wide but pill-tall, must center. (c) 160px-tall card with "heading + body": this is NOT a pill — must STAY top-anchored after the patch. If (c) gets centered, the height threshold is too generous.',
    body: (
      <div style={{ display: "flex", flexDirection: "column", gap: 48 }}>
        <div>
          <div style={colHeader}>A — single char pill</div>
          <PadPill text="١" width={48} />
        </div>
        <div>
          <div style={colHeader}>B — ultra-wide pill</div>
          <PadPill
            text="مرحباً"
            width={800}
            style={{ textAlign: "center" }}
          />
        </div>
        <div>
          <div style={colHeader}>
            C — CARD (160px tall, must STAY top-anchored)
          </div>
          <div
            style={{
              width: 600,
              height: 160,
              padding: "20px 24px",
              border: `1px solid ${NAVY}`,
              borderRadius: 16,
              color: NAVY,
              background: SLIDE_BG,
              boxSizing: "border-box",
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
              عنوان البطاقة
            </div>
            <div style={{ fontSize: 16, lineHeight: 1.5 }}>
              نص الجسم في البطاقة. يجب أن يبقى محاذياً للأعلى بعد إصلاح
              الحبات.
            </div>
          </div>
        </div>
      </div>
    ),
  },
  {
    label: "10 — LTR slide control",
    expected:
      "Same pills as slide 4, but on an LTR slide. The mis-alignment in Arabic pills should be IDENTICAL to slide 4 — direction of the slide root doesn't affect glyph baselines. Sanity check that the patch isn't accidentally direction-gated.",
    dir: "ltr",
    body: (
      <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
        <div style={{ display: "flex", gap: 16 }}>
          <PadPill text="الرؤية" />
          <PadPill text="الرسالة" />
          <PadPill text="القيم" />
          <PadPill text="الأهداف" />
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          <FlexPill text="الرؤية" />
          <FlexPill text="الرسالة" />
          <FlexPill text="القيم" />
          <FlexPill text="الأهداف" />
        </div>
      </div>
    ),
  },
];

// ── export plumbing (mirrors /spike) ────────────────────────────────────

type Mode = "raw" | "xml-postprocess";

async function readAllSlideXmls(
  blob: Blob,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  JSZip: any,
): Promise<Record<string, string>> {
  const buf = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const out: Record<string, string> = {};
  for (const path of Object.keys(zip.files)) {
    if (/^ppt\/slides\/slide\d+\.xml$/.test(path)) {
      out[path] = await zip.file(path).async("text");
    }
  }
  return out;
}

function btnStyle(active: boolean, color: string, anyBusy: boolean): React.CSSProperties {
  return {
    padding: "12px 24px",
    fontSize: 15,
    fontWeight: 600,
    background: active ? "#3A2A5C" : color,
    color: "#FFFFFF",
    border: "none",
    borderRadius: 10,
    cursor: anyBusy ? "wait" : "pointer",
  };
}

const statBlockStyle: React.CSSProperties = {
  color: "#9A94A8",
  marginTop: 8,
  fontFamily: "ui-monospace, monospace",
  fontSize: 12,
  background: "transparent",
};

const diagXmlStyle: React.CSSProperties = {
  color: "#E8E4F0",
  fontSize: 11,
  fontFamily: "ui-monospace, monospace",
  background: "#03030D",
  padding: 10,
  borderRadius: 6,
  maxHeight: 360,
  overflow: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
};

type SlideDiagnostic = { path: string; before: string; after: string };

export default function SpikePillsPage() {
  const [busy, setBusy] = useState<Mode | "none">("none");
  const [error, setError] = useState<string | null>(null);
  const [lastFile, setLastFile] = useState<string | null>(null);
  const [xmlStats, setXmlStats] = useState<BiDiPostprocessStats | null>(null);
  const [diag, setDiag] = useState<SlideDiagnostic[] | null>(null);

  async function runExport(mode: Mode) {
    setBusy(mode);
    setError(null);
    setLastFile(null);
    setXmlStats(null);
    setDiag(null);

    try {
      const { exportToPptx } = await import("dom-to-pptx");
      const slides = Array.from(document.querySelectorAll(".pill-slide"));
      const fileName = `pills-spike-${mode}-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.pptx`;

      if (mode === "raw") {
        await exportToPptx(slides as HTMLElement[], { fileName });
        setLastFile(fileName);
        return;
      }

      const rawBlob = await exportToPptx(slides as HTMLElement[], {
        fileName,
        skipDownload: true,
      } as const);

      if (!(rawBlob instanceof Blob)) {
        throw new Error(
          `Expected exportToPptx to return a Blob with skipDownload, got ${typeof rawBlob}`,
        );
      }

      const JSZipImport = await import("jszip");
      const JSZip = ((JSZipImport as { default?: unknown }).default ??
        JSZipImport) as Parameters<typeof fixBiDiInPptxBlob>[1];

      const before = await readAllSlideXmls(rawBlob, JSZip);
      const stats = makeStats();
      const fixedBlob = await fixBiDiInPptxBlob(rawBlob, JSZip, stats);
      const after = await readAllSlideXmls(fixedBlob, JSZip);

      downloadBlob(fixedBlob, fileName);

      const paths = Object.keys(before).sort();
      setDiag(
        paths.map((p) => ({
          path: p,
          before: before[p] ?? "(missing)",
          after: after[p] ?? "(missing)",
        })),
      );
      setXmlStats(stats);
      setLastFile(fileName);
    } catch (e) {
      setError(
        e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ""}` : String(e),
      );
    } finally {
      setBusy("none");
    }
  }

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        rel="preconnect"
        href="https://fonts.gstatic.com"
        crossOrigin="anonymous"
      />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;700&display=swap"
        crossOrigin="anonymous"
      />

      <div
        style={{
          background: SLIDE_BG_DARK,
          color: "#FFFFFF",
          padding: 24,
          fontFamily: "system-ui, -apple-system, sans-serif",
          minHeight: "100vh",
        }}
      >
        <header style={{ maxWidth: 1100, marginBottom: 24 }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 28 }}>
            Pill / badge stress test
          </h1>
          <p style={{ color: "#9A94A8", margin: "0 0 16px", lineHeight: 1.6 }}>
            10 slides isolating the pill-anchor problem. Each slide compares the
            <strong style={{ color: "#FFFFFF" }}> padding-only</strong> pattern
            (what Claude defaults to) vs the
            <strong style={{ color: "#FFFFFF" }}> inline-flex anchored</strong>{" "}
            pattern (the prompt rule). Export → open in PowerPoint → grade each
            slide against its <em style={{ color: "#F5B547" }}>Expected</em>{" "}
            line.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              onClick={() => runExport("raw")}
              disabled={busy !== "none"}
              style={btnStyle(busy === "raw", "#5A5A5A", busy !== "none")}
            >
              {busy === "raw" ? "Exporting…" : "Export raw (no BiDi post)"}
            </button>
            <button
              onClick={() => runExport("xml-postprocess")}
              disabled={busy !== "none"}
              style={btnStyle(
                busy === "xml-postprocess",
                "#7D2DFF",
                busy !== "none",
              )}
            >
              {busy === "xml-postprocess"
                ? "Exporting…"
                : "Export with BiDi post-process"}
            </button>
          </div>
          {lastFile && (
            <p
              style={{
                color: "#4AE3A1",
                marginTop: 12,
                fontFamily: "ui-monospace, monospace",
                fontSize: 13,
              }}
            >
              Downloaded: {lastFile}
            </p>
          )}
          {xmlStats && (
            <pre style={statBlockStyle}>
              {`XML postprocess — invocations: ${xmlStats.invocations} · slides: ${xmlStats.slidesFixed}/${xmlStats.slidesScanned} · txBody rtlCol→1: ${xmlStats.txBodiesFlipped} · paragraphs: ${xmlStats.paragraphsModified} · runs merged: ${xmlStats.runsMerged} · lang→ar-SA: ${xmlStats.langsRetagged} · LTR forced: ${xmlStats.ltrParagraphsForced} · shapes widened: ${xmlStats.shapesWidened}`}
            </pre>
          )}
          {diag &&
            diag.map((d, i) => (
              <details
                key={d.path}
                open={i === diag.length - 1}
                style={{
                  marginTop: 12,
                  background: "#07060F",
                  border: "1px solid #2A243B",
                  borderRadius: 10,
                  padding: 12,
                  maxWidth: 1400,
                }}
              >
                <summary
                  style={{
                    cursor: "pointer",
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 13,
                    color: "#E8E4F0",
                  }}
                >
                  {d.path}
                </summary>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                    marginTop: 12,
                  }}
                >
                  <div>
                    <div style={{ color: "#F5B547", fontSize: 12, marginBottom: 4 }}>
                      BEFORE (dom-to-pptx output)
                    </div>
                    <pre style={diagXmlStyle}>{d.before}</pre>
                  </div>
                  <div>
                    <div style={{ color: "#4AE3A1", fontSize: 12, marginBottom: 4 }}>
                      AFTER (post-processed download)
                    </div>
                    <pre style={diagXmlStyle}>{d.after}</pre>
                  </div>
                </div>
              </details>
            ))}
          {error && (
            <pre
              style={{
                color: "#FF6B6B",
                marginTop: 12,
                whiteSpace: "pre-wrap",
                background: "#1A0A14",
                padding: 12,
                borderRadius: 8,
                fontSize: 12,
                overflow: "auto",
                maxHeight: 280,
              }}
            >
              {error}
            </pre>
          )}
        </header>

        {SLIDES.map((s, i) => (
          <section key={i} style={{ marginBottom: 32 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 16 }}>{s.label}</h3>
            <p
              style={{
                color: "#9A94A8",
                margin: "0 0 12px",
                fontSize: 13,
                maxWidth: 1400,
                lineHeight: 1.5,
              }}
            >
              <strong style={{ color: "#F5B547" }}>Expected:</strong>{" "}
              {s.expected}
            </p>
            <div
              className="pill-slide"
              dir={s.dir ?? "rtl"}
              lang={s.dir === "ltr" ? "en" : "ar"}
              style={{
                width: 1920,
                height: 1080,
                background: SLIDE_BG,
                color: NAVY,
                fontFamily: "'Cairo', sans-serif",
                padding: "80px 120px",
                boxSizing: "border-box",
                overflow: "hidden",
              }}
            >
              <div style={slideTitle}>{s.label}</div>
              <div style={slideSub}>{s.expected}</div>
              {s.body}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
