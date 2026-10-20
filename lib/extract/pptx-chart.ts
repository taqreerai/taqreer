// Enhance phase 1, step 4: read a native PPTX chart part (ppt/charts/chartN.xml)
// into a ChartSpec: type, categories, series values, titles. Numbers are read
// from the chart's own caches, never estimated. Returns null for charts we do
// not redraw (combo charts, scatter, bubble, radar, surface, 3-D ...): the
// caller then keeps the old placeholder handling for that frame.

import { DOMParser, type Element as XmlElement } from "@xmldom/xmldom";
import type { ChartSpec, ChartSeries } from "@/lib/deck/visuals/chart";

const NS_C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";

const kids = (el: XmlElement | null | undefined, ns: string, name: string): XmlElement[] => {
  const out: XmlElement[] = [];
  for (let n = el?.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as XmlElement).localName === name && (n as XmlElement).namespaceURI === ns) out.push(n as XmlElement);
  }
  return out;
};
const first = (el: XmlElement | null | undefined, name: string) => kids(el, NS_C, name)[0] ?? null;
const attrVal = (el: XmlElement | null | undefined) => el?.getAttribute("val") ?? null;

// Text of a c:title / c:tx: all a:t runs joined.
function richText(el: XmlElement | null | undefined): string {
  if (!el) return "";
  const ts = el.getElementsByTagNameNS(NS_A, "t");
  let s = "";
  for (let i = 0; i < ts.length; i++) s += ts[i].textContent ?? "";
  return s.trim();
}

// c:strRef / c:numRef / c:strLit / c:numLit -> ordered points by c:idx.
function points(holder: XmlElement | null): { count: number; at: Map<number, string> } {
  const out = new Map<number, string>();
  if (!holder) return { count: 0, at: out };
  const cache =
    first(first(holder, "strRef"), "strCache") ??
    first(first(holder, "numRef"), "numCache") ??
    first(holder, "strLit") ??
    first(holder, "numLit") ??
    first(first(holder, "multiLvlStrRef"), "multiLvlStrCache");
  if (!cache) return { count: 0, at: out };
  const level = first(cache, "lvl") ?? cache; // multi-level: the innermost level is the first
  for (const pt of kids(level, NS_C, "pt")) {
    const idx = Number(pt.getAttribute("idx"));
    const v = first(pt, "v")?.textContent ?? "";
    if (Number.isFinite(idx)) out.set(idx, v);
  }
  return { count: Number(attrVal(first(cache, "ptCount")) ?? 0) || (out.size ? Math.max(...out.keys()) + 1 : 0), at: out };
}

// A series with no fill (and no line) is the invisible base of a bridge chart.
function isHidden(ser: XmlElement): boolean {
  const spPr = first(ser, "spPr");
  if (!spPr) return false;
  const noFill = kids(spPr, NS_A, "noFill").length > 0;
  const ln = kids(spPr, NS_A, "ln")[0];
  const lineGone = !ln || kids(ln, NS_A, "noFill").length > 0;
  return noFill && lineGone;
}

// ─── Newer chart types (chartex, PowerPoint 2016+): waterfall only ────────────
// Values are STEPS; the points listed under cx:subtotals are TOTALS (a bar from
// zero to that value, and the running level continues from it). Drawn as a
// stacked column: an invisible base plus up / down / total bars.

const NS_CX = "http://schemas.microsoft.com/office/drawing/2014/chartex";
const cx = (el: XmlElement | null | undefined, name: string) => kids(el, NS_CX, name);

function exLevel(dim: XmlElement | undefined): Map<number, string> {
  const out = new Map<number, string>();
  const lvl = cx(dim, "lvl")[0];
  for (const pt of cx(lvl, "pt")) {
    const idx = Number(pt.getAttribute("idx"));
    if (Number.isFinite(idx)) out.set(idx, pt.textContent ?? "");
  }
  return out;
}

function parseChartEx(root: XmlElement): ChartSpec | null {
  const series = root.getElementsByTagNameNS(NS_CX, "series");
  if (series.length !== 1) return null;
  const ser = series[0] as unknown as XmlElement;
  if (ser.getAttribute("layoutId") !== "waterfall") return null;
  const data = root.getElementsByTagNameNS(NS_CX, "data")[0] as unknown as XmlElement | undefined;
  if (!data) return null;
  const cat = exLevel(cx(data, "strDim").find((d) => d.getAttribute("type") === "cat"));
  const val = exLevel(cx(data, "numDim").find((d) => d.getAttribute("type") === "val"));
  const n = Math.max(cat.size ? Math.max(...cat.keys()) + 1 : 0, val.size ? Math.max(...val.keys()) + 1 : 0);
  if (n === 0) return null;
  const totals = new Set<number>();
  const sub = ser.getElementsByTagNameNS(NS_CX, "subtotals")[0] as unknown as XmlElement | undefined;
  for (const i of cx(sub, "idx")) totals.add(Number(i.getAttribute("val")));

  const base: (number | null)[] = [];
  const total: (number | null)[] = [];
  const up: (number | null)[] = [];
  const down: (number | null)[] = [];
  const extra: (number | null)[] = []; // the part of a step that crosses zero, below the axis
  const step: string[] = [];
  let level = 0;
  for (let i = 0; i < n; i++) {
    const raw = val.get(i);
    const v = raw === undefined || raw === "" ? NaN : Number(raw);
    const isTotal = totals.has(i);
    const none = !Number.isFinite(v);
    const a = isTotal ? 0 : level;
    const b = isTotal ? (none ? level : v) : level + (none ? 0 : v);
    if (!none || isTotal) level = b;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    // Visible bar = [lo, hi]; the invisible base fills from zero to the near edge.
    base.push(lo >= 0 ? lo : hi <= 0 ? hi : 0);
    const seg = lo >= 0 ? hi - lo : hi <= 0 ? lo - hi : hi;
    const kind = isTotal ? total : b >= a ? up : down;
    for (const arr of [total, up, down]) arr.push(arr === kind && !none ? seg : null);
    extra.push(lo < 0 && hi > 0 ? lo : null);
    step.push(none ? "" : isTotal ? compactLabel(v) : `${v > 0 ? "+" : v < 0 ? "-" : ""}${compactLabel(Math.abs(v))}`);
  }
  const fill = (color: string, vals: (number | null)[], name: string, labelsFrom: (i: number) => string | null): ChartSeries => ({
    name,
    values: vals,
    hidden: false,
    color,
    labels: vals.map((x, i) => (x === null ? null : labelsFrom(i))),
  });
  const out: ChartSeries[] = [
    { name: "", values: base, hidden: true },
    fill("var(--primary, #1f4e8c)", total, "", (i) => step[i]),
    fill("var(--accent, #2a9d8f)", up, "", (i) => step[i]),
    fill("var(--danger, #c0392b)", down, "", (i) => step[i]),
  ];
  const crossing = extra.some((x) => x !== null);
  if (crossing) {
    // Below-axis part of a bar that crosses zero: coloured like its bar, no label.
    const pick = (i: number) => (total[i] !== null ? "var(--primary, #1f4e8c)" : up[i] !== null ? "var(--accent, #2a9d8f)" : "var(--danger, #c0392b)");
    for (const color of new Set(extra.map((x, i) => (x === null ? "" : pick(i))).filter(Boolean))) {
      out.push({ name: "", values: extra.map((x, i) => (x !== null && pick(i) === color ? x : null)), hidden: false, color, labels: extra.map(() => "") });
    }
  }
  const title = root.getElementsByTagNameNS(NS_CX, "title")[0] as unknown as XmlElement | undefined;
  return {
    kind: "chart",
    type: "column",
    stacked: true,
    percent: false,
    title: richText(title),
    categories: Array.from({ length: n }, (_, i) => cat.get(i) ?? String(i + 1)),
    series: out,
    valueTitle: "",
    categoryTitle: "",
    legend: false,
    outsideLabels: true,
  };
}

function compactLabel(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 || Number.isInteger(n) ? 0 : 2 });
}

export function parseChartXml(xml: string): ChartSpec | null {
  let doc;
  try {
    doc = new DOMParser().parseFromString(xml, "text/xml");
  } catch {
    return null;
  }
  if (doc.documentElement?.namespaceURI === NS_CX) return parseChartEx(doc.documentElement as unknown as XmlElement);
  const chart = first(first(doc.documentElement as unknown as XmlElement, "chart"), "plotArea");
  if (!chart) return null;
  const groups = kids(chart, NS_C, "barChart").concat(
    kids(chart, NS_C, "lineChart"),
    kids(chart, NS_C, "areaChart"),
    kids(chart, NS_C, "pieChart"),
    kids(chart, NS_C, "doughnutChart"),
  );
  // One plot only (a combo of two chart types is not redrawn).
  if (groups.length !== 1) return null;
  const g = groups[0];
  const tag = g.localName;
  const grouping = attrVal(first(g, "grouping")) ?? "clustered";
  let type: ChartSpec["type"];
  if (tag === "barChart") type = attrVal(first(g, "barDir")) === "bar" ? "bar" : "column";
  else if (tag === "lineChart") type = "line";
  else if (tag === "areaChart") type = "area";
  else type = "pie";

  const series: ChartSeries[] = [];
  let categories: string[] = [];
  for (const ser of kids(g, NS_C, "ser")) {
    const cat = points(first(ser, "cat"));
    const val = points(first(ser, "val"));
    const n = Math.max(cat.count, val.count);
    if (categories.length < n) categories = Array.from({ length: n }, (_, i) => cat.at.get(i) ?? categories[i] ?? String(i + 1));
    const name = first(first(first(ser, "tx"), "strRef"), "strCache") ? [...points(first(ser, "tx")).at.values()].join(" ") : richText(first(ser, "tx"));
    const values = Array.from({ length: n }, (_, i) => {
      const raw = val.at.get(i);
      const num = raw === undefined || raw === "" ? NaN : Number(raw);
      return Number.isFinite(num) ? num : null;
    });
    series.push({ name: name || `Series ${series.length + 1}`, values, hidden: isHidden(ser) });
  }
  if (series.length === 0 || categories.length === 0) return null;
  for (const s of series) while (s.values.length < categories.length) s.values.push(null);

  const axisTitle = (axName: string) => richText(first(first(chart, axName), "title"));
  const catAx = kids(chart, NS_C, "catAx").length ? "catAx" : "dateAx";
  const title = first(first(doc.documentElement as unknown as XmlElement, "chart"), "title");
  return {
    kind: "chart",
    type,
    stacked: grouping === "stacked" || grouping === "percentStacked",
    percent: grouping === "percentStacked",
    title: attrVal(first(first(doc.documentElement as unknown as XmlElement, "chart"), "autoTitleDeleted")) === "1" ? "" : richText(title),
    categories,
    series,
    valueTitle: axisTitle("valAx"),
    categoryTitle: axisTitle(catAx),
  };
}
