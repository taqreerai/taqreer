"use client";

// Intentional Tailwind deviation: this is a 1920×1080 BiDi regression
// harness — pixel-exact inline styles preserve test fidelity across PPT
// roundtrips. Don't refactor to Tailwind classes; the dimensions are part
// of the test contract.

import { useState } from "react";
import {
  downloadBlob,
  fixBiDiInPptxBlob,
  makeStats,
  type BiDiPostprocessStats,
} from "@/lib/export/bidi-postprocess";

const SLIDES = [
  {
    label: "1 — Mixed-script section header",
    expectation:
      '"02" stays adjacent to "القسم" on the right; "·" stays between them, not jumping to a line edge.',
    body: <h2 style={{ fontSize: 96, margin: 0 }}>القسم 02 · المشكلة</h2>,
  },
  {
    label: "2 — Arabic sentence with trailing period",
    expectation:
      "The period lands on the LEFT end of the line in PowerPoint (logical end of RTL), not stuck against the Arabic glyph.",
    body: (
      <p style={{ fontSize: 72, margin: 0, lineHeight: 1.5 }}>
        هذا نص عربي ينتهي بنقطة.
      </p>
    ),
  },
  {
    label: "3 — Arabic bullet list",
    expectation:
      "Bullets on the RIGHT; text flows right-to-left. EXPECTED TO FAIL without a patch (src/index.js:797 hard-codes align:left for <ul>).",
    body: (
      <ul
        style={{
          fontSize: 64,
          margin: 0,
          lineHeight: 1.6,
          paddingInlineStart: 80,
          listStyleType: "disc",
          listStylePosition: "outside",
        }}
      >
        <li>البند الأول</li>
        <li>البند الثاني</li>
        <li>البند الثالث</li>
      </ul>
    ),
  },
  {
    label: "4 — Mixed-script with neutral punctuation",
    expectation:
      '"12%" stays glued; "Q1 2026" reads LTR inside the otherwise-RTL line; trailing period lands on the LEFT.',
    body: (
      <p style={{ fontSize: 64, margin: 0, lineHeight: 1.5 }}>
        نسبة النمو 12% خلال Q1 2026.
      </p>
    ),
  },
];

type Mode = "raw" | "xml-postprocess";

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

async function readAllSlideXmls(
  blob: Blob,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  JSZip: any
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

type SlideDiagnostic = {
  path: string;
  before: string;
  after: string;
};

type AllDiagnostics = SlideDiagnostic[];

export default function SpikePage() {
  const [busy, setBusy] = useState<Mode | "none">("none");
  const [error, setError] = useState<string | null>(null);
  const [lastFile, setLastFile] = useState<string | null>(null);
  const [xmlStats, setXmlStats] = useState<BiDiPostprocessStats | null>(null);
  const [diag, setDiag] = useState<AllDiagnostics | null>(null);

  async function runExport(mode: Mode) {
    setBusy(mode);
    setError(null);
    setLastFile(null);
    setXmlStats(null);
    setDiag(null);

    try {
      const { exportToPptx } = await import("dom-to-pptx");
      const slides = Array.from(document.querySelectorAll(".bidi-slide"));
      const fileName = `bidi-spike-${mode}-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.pptx`;

      if (mode === "raw") {
        await exportToPptx(slides as HTMLElement[], { fileName });
        setLastFile(fileName);
        return;
      }

      // skipDownload: true → the library does ALL its work (including font
      // embedding) and hands us back the final Blob without auto-downloading.
      // We run BiDi fix on that Blob and trigger our own download.
      const rawBlob = await exportToPptx(slides as HTMLElement[], {
        fileName,
        skipDownload: true,
      } as const);

      if (!(rawBlob instanceof Blob)) {
        throw new Error(
          `Expected exportToPptx to return a Blob with skipDownload, got ${typeof rawBlob}`
        );
      }

      const JSZipImport = await import("jszip");
      const JSZip = ((JSZipImport as { default?: unknown }).default ??
        JSZipImport) as Parameters<typeof fixBiDiInPptxBlob>[1];

      // Diagnostic: read ALL slide XMLs BEFORE the fix.
      const before = await readAllSlideXmls(rawBlob, JSZip);

      const stats = makeStats();
      const fixedBlob = await fixBiDiInPptxBlob(rawBlob, JSZip, stats);

      // Diagnostic: read ALL slide XMLs AFTER the fix.
      const after = await readAllSlideXmls(fixedBlob, JSZip);

      downloadBlob(fixedBlob, fileName);

      const paths = Object.keys(before).sort();
      setDiag(
        paths.map((p) => ({
          path: p,
          before: before[p] ?? "(missing)",
          after: after[p] ?? "(missing)",
        }))
      );

      setXmlStats(stats);
      setLastFile(fileName);
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.name}: ${e.message}\n${e.stack ?? ""}`
          : String(e)
      );
    } finally {
      setBusy("none");
    }
  }

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap"
        crossOrigin="anonymous"
      />

      <div
        style={{
          background: "#0D0B1F",
          color: "#FFFFFF",
          padding: 24,
          fontFamily: "system-ui, -apple-system, sans-serif",
          minHeight: "100vh",
        }}
      >
        <header style={{ maxWidth: 980, marginBottom: 24 }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 28 }}>
            BiDi spike — dom-to-pptx (gate 1)
          </h1>
          <p style={{ color: "#9A94A8", margin: "0 0 16px", lineHeight: 1.6 }}>
            Four RTL test slides covering the failure modes from last week. Click
            <strong style={{ color: "#FFFFFF" }}> Export</strong>, open the .pptx
            in <strong style={{ color: "#FFFFFF" }}>both PowerPoint and Keynote</strong>,
            and judge each slide against the expectation. Slide 3 is expected to
            fail out of the box (known hard-coded <code>align: &apos;left&apos;</code>);
            the verdict hinges on 1, 2, 4.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              onClick={() => runExport("raw")}
              disabled={busy !== "none"}
              style={btnStyle(busy === "raw", "#5A5A5A", busy !== "none")}
            >
              {busy === "raw" ? "Exporting…" : "Baseline (unpatched)"}
            </button>
            <button
              onClick={() => runExport("xml-postprocess")}
              disabled={busy !== "none"}
              style={btnStyle(
                busy === "xml-postprocess",
                "#7D2DFF",
                busy !== "none"
              )}
            >
              {busy === "xml-postprocess"
                ? "Exporting…"
                : "Export with BiDi fix (skipDownload + XML post)"}
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
                maxWidth: 1200,
                lineHeight: 1.5,
              }}
            >
              <strong style={{ color: "#F5B547" }}>Expected:</strong> {s.expectation}
            </p>
            <div
              className="bidi-slide"
              dir="rtl"
              lang="ar"
              style={{
                width: 1920,
                height: 1080,
                background: "#FFFFFF",
                color: "#03030D",
                fontFamily: "'Cairo', sans-serif",
                padding: 120,
                textAlign: "right",
                boxSizing: "border-box",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
              }}
            >
              {s.body}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
