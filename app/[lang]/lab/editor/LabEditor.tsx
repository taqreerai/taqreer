"use client";

// Lab shell — mounts the PRODUCTION <SlideEditor> (the exact engine /project uses)
// so the lab stays 100% identical to live, plus a breadcrumb, the flat Layers list
// (lib/editor/leaves), and the A1/A2/A3 round-trip harness — all against a REAL deck.
// Edits live only in the browser DOM; nothing persists. See context/phase-0-checklist.md.
import { useEffect, useMemo, useState } from "react";
import { SlideEditor } from "@/components/preview/editor/SlideEditor";
import { dimensionsForFormat, type SlideManifest } from "@/lib/schema/slide";
import { buildLayerTree, type LayerNode } from "@/lib/editor/leaves";
import {
  a1ForSlide,
  a2a3ForSlide,
  type A1Result,
  type A2Result,
} from "./harness";

export function LabEditor({ manifest }: { manifest: SlideManifest }) {
  const [idx, setIdx] = useState(0);
  const [tab, setTab] = useState<"layers" | "tests">("layers");
  const [selected, setSelected] = useState<HTMLElement | null>(null);
  const [doc, setDoc] = useState<Document | null>(null);
  const [treeV, setTreeV] = useState(0);
  const [layers, setLayers] = useState<LayerNode[]>([]);
  const [a1, setA1] = useState<A1Result | null>(null);
  const [a2, setA2] = useState<A2Result | null>(null);
  const [sweep, setSweep] = useState<string | null>(null);

  const slides = manifest.slides;
  const slide = slides[idx];
  const dims = dimensionsForFormat(manifest.format);
  const scale = Math.min(0.6, 1080 / dims.width);

  const goto = (i: number) => {
    setSelected(null);
    setIdx(i);
  };

  // Rebuild the layers tree after SlideRenderer's async sanitize effect paints
  // (and whenever the user asks via ↻). Reading the DOM into state is the
  // legitimate "derive from external system" effect.
  useEffect(() => {
    const t = setTimeout(() => setTreeV((v) => v + 1), 60);
    return () => clearTimeout(t);
  }, [idx]);

  useEffect(() => {
    const sec = doc?.querySelector("section") as HTMLElement | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayers(sec ? buildLayerTree(sec) : []);
  }, [treeV, idx, doc]);

  // Keyboard: Esc / ArrowUp escalate to parent.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selected || e.key !== "Escape") return;
      if (document.activeElement?.getAttribute("contenteditable") === "true") return;
      e.preventDefault();
      setSelected(null); // only leaves are selectable — Esc just deselects
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const breadcrumb = useMemo(() => {
    if (!selected) return [];
    const chain: HTMLElement[] = [];
    let n: HTMLElement | null = selected;
    while (n) {
      chain.unshift(n);
      if (n.tagName === "SECTION") break;
      n = n.parentElement;
    }
    return chain;
  }, [selected]);

  const runTests = () => {
    setA1(a1ForSlide(slide.html));
    setA2(a2a3ForSlide(slide.html));
    setSweep(null);
  };
  const runTestsAll = () => {
    let a1ok = 0;
    let a2ok = 0;
    const a1fail: number[] = [];
    const a2fail: number[] = [];
    slides.forEach((s, i) => {
      const r1 = a1ForSlide(s.html);
      if (r1.dblStable && r1.drift10 === 0) a1ok++;
      else a1fail.push(i + 1);
      const r2 = a2a3ForSlide(s.html);
      const clean =
        r2.injectedJunk.length === 0 &&
        !r2.bidiInjected &&
        r2.dirPreserved &&
        r2.latinNumeralsKept &&
        r2.diffFrac < 0.25 &&
        r2.cycle10Junk === 0;
      if (clean) a2ok++;
      else a2fail.push(i + 1);
    });
    setSweep(
      `A1: ${a1ok}/${slides.length}${a1fail.length ? ` ⚠️ ${a1fail.join(",")}` : " ✅"}   ` +
        `A2/A3: ${a2ok}/${slides.length}${a2fail.length ? ` ⚠️ ${a2fail.join(",")}` : " ✅"}`,
    );
    setA1(a1ForSlide(slide.html));
    setA2(a2a3ForSlide(slide.html));
  };

  return (
    <div style={S.root}>
      <div style={S.bar}>
        <strong style={{ fontSize: 13 }}>/lab/editor</strong>
        <span style={S.dim}>{manifest.title}</span>
        <span style={S.dim}>
          {manifest.format} · {manifest.direction} · {manifest.language}
        </span>
        <div style={{ flex: 1 }} />
        <button style={S.btn} onClick={() => goto(Math.max(0, idx - 1))}>
          ‹
        </button>
        <span style={S.dim}>
          {idx + 1} / {slides.length}
        </span>
        <button
          style={S.btn}
          onClick={() => goto(Math.min(slides.length - 1, idx + 1))}
        >
          ›
        </button>
      </div>

      <div style={S.body}>
        <div style={S.canvasWrap}>
          {/* Breadcrumb */}
          <div style={S.crumbs}>
            {selected ? (
              breadcrumb.map((el, i) => (
                <button
                  key={i}
                  style={S.crumb}
                  onClick={() => setSelected(el)}
                  title={el.className}
                >
                  {crumbLabel(el)}
                  {i < breadcrumb.length - 1 ? " ›" : ""}
                </button>
              ))
            ) : (
              <span style={S.dim}>click an element · dbl-click text to edit · Esc to deselect</span>
            )}
          </div>
          {/* SlideEditor speaks the §20 multi-select SET; the lab shell stays
              single-select, so adapt at the boundary (first element ⇄ array). */}
          <SlideEditor
            slide={slide}
            theme={manifest.theme}
            direction={manifest.direction}
            language={manifest.language}
            width={dims.width}
            height={dims.height}
            scale={scale}
            selected={selected ? [selected] : []}
            onSelect={(els) => setSelected(els[0] ?? null)}
            onDocReady={setDoc}
          />
        </div>

        {/* Right rail */}
        <div style={S.panel}>
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            <Tab on={tab === "layers"} onClick={() => setTab("layers")}>
              Layers
            </Tab>
            <Tab on={tab === "tests"} onClick={() => setTab("tests")}>
              Tests
            </Tab>
          </div>

          {tab === "layers" && (
            <div style={{ display: "grid", gap: 2 }}>
              <button style={{ ...S.btn, marginBottom: 6 }} onClick={() => setTreeV((v) => v + 1)}>
                ↻ rebuild ({layers.length})
              </button>
              {layers.map((n, i) => (
                <button
                  key={i}
                  style={{ ...S.layer, ...(selected === n.el ? S.layerActive : {}) }}
                  onClick={() => setSelected(n.el)}
                >
                  <span style={{ opacity: 0.5, marginInlineEnd: 6 }}>{kindIcon(n.kind)}</span>
                  {n.label}
                </button>
              ))}
            </div>
          )}

          {tab === "tests" && (
            <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <button style={S.btnPrimary} onClick={runTests}>
                  Run (slide)
                </button>
                <button style={S.btnPrimary} onClick={runTestsAll}>
                  Run (all)
                </button>
              </div>
              {sweep && <div style={S.sweep}>{sweep}</div>}
              {a1 && (
                <>
                  <div style={S.h}>A1 — round-trip</div>
                  <Row ok={a1.dblStable} label="Double-serialize stable" v={a1.dblStable ? "fixpoint" : "DRIFTS"} />
                  <Row ok={a1.drift10 === 0} label="10× round-trip" v={`${a1.drift10}/10`} />
                </>
              )}
              {a2 && (
                <>
                  <div style={S.h}>A2/A3 — edit round-trip ({a2.tag})</div>
                  <Row ok={a2.injectedJunk.length === 0} label="No injected junk" v={a2.injectedJunk.join(",") || "clean"} />
                  <Row ok={a2.diffFrac < 0.25} label="Diff localized" v={`${(a2.diffFrac * 100).toFixed(0)}% (${a2.diffLen}b)`} />
                  <Row ok={a2.dirPreserved} label="RTL dir preserved" v={a2.dirPreserved ? "yes" : "LOST"} />
                  <Row ok={!a2.bidiInjected} label="No bidi controls" v={a2.bidiInjected ? "INJECTED" : "clean"} />
                  <Row ok={a2.latinNumeralsKept} label="Latin numerals kept" v={a2.latinNumeralsKept ? "yes" : "CONVERTED"} />
                  <Row ok={a2.cycle10Junk === 0} label="10× edit cycle clean" v={`${a2.cycle10Junk} junk, +${a2.cycle10Growth}b`} />
                  <pre style={S.html}>{a2.sample}</pre>
                </>
              )}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

function Tab({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...S.btn,
        background: on ? "#15B04F" : "rgba(255,255,255,0.08)",
        color: on ? "#04140a" : "#fff",
        fontWeight: on ? 700 : 400,
      }}
    >
      {children}
    </button>
  );
}

function Row({ ok, label, v }: { ok: boolean; label: string; v: string }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <span style={{ width: 16 }}>{ok ? "✅" : "❌"}</span>
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ opacity: 0.75, fontSize: 11 }}>{v}</span>
    </div>
  );
}

function crumbLabel(el: HTMLElement): string {
  const t = (el.textContent ?? "").trim();
  if (el.children.length === 0 && t) return `"${t.slice(0, 12)}"`;
  return el.tagName.toLowerCase() + (el.className ? `.${String(el.className).split(/\s+/)[0]}` : "");
}
function kindIcon(k: LayerNode["kind"]): string {
  return k === "text" ? "T" : k === "image" ? "🖼" : "◆";
}

const S: Record<string, React.CSSProperties> = {
  root: { position: "fixed", inset: 0, background: "#0D0B1F", color: "#fff", fontFamily: "Cairo, system-ui, sans-serif", display: "flex", flexDirection: "column" },
  bar: { display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.1)" },
  dim: { opacity: 0.55, fontSize: 12 },
  body: { flex: 1, display: "flex", minHeight: 0 },
  canvasWrap: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", overflow: "auto", padding: 24, gap: 10 },
  crumbs: { display: "flex", gap: 4, flexWrap: "wrap", fontSize: 11, minHeight: 20 },
  crumb: { background: "rgba(255,255,255,0.08)", color: "#fff", border: "none", borderRadius: 6, padding: "2px 6px", cursor: "pointer", fontSize: 11 },
  panel: { width: 320, borderLeft: "1px solid rgba(255,255,255,0.1)", padding: 14, overflow: "auto" },
  h: { fontWeight: 700, marginTop: 6 },
  layer: { display: "flex", alignItems: "center", width: "100%", textAlign: "start", background: "transparent", color: "#fff", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 12 },
  layerActive: { background: "rgba(21,176,79,0.22)" },
  sweep: { fontSize: 12, padding: "6px 8px", borderRadius: 8, background: "rgba(255,255,255,0.06)" },
  btn: { background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 12 },
  btnPrimary: { background: "#15B04F", color: "#04140a", border: "none", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 700 },
  html: { fontSize: 10, background: "rgba(255,255,255,0.05)", padding: 8, borderRadius: 8, maxHeight: 200, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" },
};
