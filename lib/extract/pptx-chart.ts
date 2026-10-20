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

export function parseChartXml(xml: string): ChartSpec | null {
  let doc;
  try {
    doc = new DOMParser().parseFromString(xml, "text/xml");
  } catch {
    return null;
  }
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
