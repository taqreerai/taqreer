// Enhance phase 1, step 4 (docs/enhance-visuals-plan.md): render a source
// chart's EXACT numbers as inline SVG. Same contract as table.ts: the model only
// reserves the box (<div data-chart="s04-c1" style="width:..;height:..">); this
// fills it, so no value, label or series can be invented, reworded or dropped.
//
// Look follows the slide: text and gridlines use currentColor, series use the
// deck's brand variables (var(--primary) / --secondary / --accent) with tints
// after those. Series the source hides (no fill: the invisible base of a
// bridge / waterfall) keep their place in the stack but are not drawn or listed.
// Digits stay Latin. Pure string work, no DOM.

export type ChartSeries = { name: string; values: (number | null)[]; hidden: boolean };
export type ChartSpec = {
  kind: "chart";
  type: "column" | "bar" | "line" | "area" | "pie";
  stacked: boolean;
  percent: boolean;
  title: string;
  categories: string[];
  series: ChartSeries[];
  valueTitle: string;
  categoryTitle: string;
};

export const isChartSpec = (s: unknown): s is ChartSpec =>
  typeof s === "object" && s !== null && (s as { kind?: string }).kind === "chart";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const PALETTE = [
  "var(--primary, #1f4e8c)",
  "var(--secondary, #c9a227)",
  "var(--accent, #2a9d8f)",
  "color-mix(in srgb, var(--primary, #1f4e8c) 55%, white)",
  "color-mix(in srgb, var(--secondary, #c9a227) 55%, white)",
  "color-mix(in srgb, var(--accent, #2a9d8f) 55%, white)",
];
const colorOf = (i: number) => PALETTE[i % PALETTE.length];
const GRID = "color-mix(in srgb, currentColor 16%, transparent)";

// 1,234 / 1.2K / 4.5M / 2.1B: compact enough for an axis tick.
function compact(n: number): string {
  const a = Math.abs(n);
  const trim = (v: number) => String(Math.round(v * 10) / 10);
  if (a >= 1e9) return `${trim(n / 1e9)}B`;
  if (a >= 1e6) return `${trim(n / 1e6)}M`;
  if (a >= 1e4) return `${trim(n / 1e3)}K`;
  return full(n);
}
function full(n: number): string {
  const a = Math.abs(n);
  const d = a >= 100 || Number.isInteger(n) ? 0 : a >= 10 ? 1 : 2;
  return n.toLocaleString("en-US", { maximumFractionDigits: d });
}

function niceScale(min: number, max: number, ticks = 5): { lo: number; hi: number; step: number } {
  if (min === max) max = min + 1;
  const raw = (max - min) / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  return { lo: Math.floor(min / step) * step, hi: Math.ceil(max / step) * step, step };
}

// Up to 3 lines, broken on spaces; the last line keeps whatever is left (never cut).
function wrap(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > maxChars && lines.length < 2) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  lines.push(cur);
  return lines;
}

function textEl(x: number, y: number, s: string, fs: number, anchor: "start" | "middle" | "end", extra = ""): string {
  const lines = s.split("\n");
  const body =
    lines.length === 1
      ? esc(s)
      : lines.map((l, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : fs * 1.15}">${esc(l)}</tspan>`).join("");
  return `<text x="${x}" y="${y}" font-size="${fs}" text-anchor="${anchor}" ${/(^|\s)fill=/.test(extra) ? "" : 'fill="currentColor" '}${extra}>${body}</text>`;
}

export function renderChartHtml(spec: ChartSpec, opts: { boxWidth: number | null; boxHeight: number | null }): string {
  const W = Math.round(Math.min(1700, Math.max(480, opts.boxWidth ?? 1000)));
  const H = Math.round(Math.min(900, Math.max(300, opts.boxHeight ?? 600)));
  const fs = Math.round(Math.max(16, Math.min(26, H / 20)));
  const svg = (inner: string) =>
    `<svg data-tq-source-chart="1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="display:block;font-family:inherit;color:inherit">${inner}</svg>`;
  const shown = spec.series.map((s, i) => ({ s, i })).filter((x) => !x.s.hidden);
  if (shown.length === 0 || spec.categories.length === 0) return svg("");

  // Legend: visible series only, one row at the top.
  let legendH = 0;
  let legend = "";
  const needLegend = spec.type === "pie" ? false : shown.length > 1;
  if (needLegend) {
    legendH = fs * 2;
    let x = 0;
    for (const { s, i } of shown) {
      const w = fs * 1.6 + s.name.length * fs * 0.58 + fs * 1.4;
      legend += `<rect x="${x}" y="${fs * 0.35}" width="${fs * 0.9}" height="${fs * 0.9}" rx="2" fill="${colorOf(i)}"/>`;
      legend += textEl(x + fs * 1.3, fs * 1.2, s.name, fs, "start");
      x += w;
    }
  }

  if (spec.type === "pie") return svg(renderPie(spec, shown[0], W, H, fs));

  const horiz = spec.type === "bar";
  const nCat = spec.categories.length;
  const stacked = spec.stacked || spec.percent || spec.type === "area";

  // Value range (over ALL series incl. hidden bases, so stacks line up).
  let vmin = 0;
  let vmax = 0;
  if (stacked) {
    for (let c = 0; c < nCat; c++) {
      let pos = 0;
      let neg = 0;
      for (const s of spec.series) {
        const v = s.values[c] ?? 0;
        if (v >= 0) pos += v;
        else neg += v;
      }
      if (spec.percent) {
        const tot = pos - neg || 1;
        vmax = Math.max(vmax, (pos / tot) * 100);
        vmin = Math.min(vmin, (neg / tot) * 100);
      } else {
        vmax = Math.max(vmax, pos);
        vmin = Math.min(vmin, neg);
      }
    }
  } else {
    for (const { s } of shown) for (const v of s.values) if (v !== null) { vmax = Math.max(vmax, v); vmin = Math.min(vmin, v); }
    if (spec.type === "line") {
      // Lines need not start at zero when all values are far above it.
      const lo = Math.min(...shown.flatMap(({ s }) => s.values.filter((v): v is number => v !== null)));
      if (lo > 0 && lo > vmax * 0.5) vmin = lo;
    }
  }
  const { lo, hi, step } = niceScale(vmin, vmax);
  const tickVals: number[] = [];
  for (let v = lo; v <= hi + step / 1000; v += step) tickVals.push(Math.round(v / step) * step);
  const tickLabel = (v: number) => (spec.percent ? `${v}%` : compact(v));

  // Plot area.
  const catFs = fs;
  const axisW = horiz
    ? Math.min(W * 0.34, Math.max(...spec.categories.map((c) => Math.min(c.length, 24))) * catFs * 0.56 + 24)
    : Math.max(...tickVals.map((v) => tickLabel(v).length)) * fs * 0.58 + 24;
  const left = horiz ? axisW : axisW;
  const right = 16;
  const top = legendH + 8;
  const slotW = (W - left - right) / nCat;
  const maxChars = Math.max(6, Math.floor(slotW / (catFs * 0.56)));
  const catLines = horiz ? 1 : Math.max(...spec.categories.map((c) => wrap(c, maxChars).length));
  const bottom = horiz ? fs * 1.6 : catLines * fs * 1.2 + 16;
  const pw = W - left - right;
  const ph = H - top - bottom;
  if (pw < 80 || ph < 80) return svg("");

  const vPos = (v: number) => (horiz ? left + ((v - lo) / (hi - lo)) * pw : top + ph - ((v - lo) / (hi - lo)) * ph);
  const cPos = (c: number) => (horiz ? top + ((c + 0.5) / nCat) * ph : left + ((c + 0.5) / nCat) * pw);
  let out = legend ? `<g transform="translate(${left},0)">${legend}</g>` : "";

  // Gridlines + value ticks.
  for (const v of tickVals) {
    const p = vPos(v);
    out += horiz
      ? `<line x1="${p}" y1="${top}" x2="${p}" y2="${top + ph}" stroke="${GRID}" stroke-width="1.5"/>` + textEl(p, H - 6, tickLabel(v), fs * 0.9, "middle", 'opacity="0.75"')
      : `<line x1="${left}" y1="${p}" x2="${left + pw}" y2="${p}" stroke="${v === 0 ? "currentColor" : GRID}" stroke-width="${v === 0 ? 2 : 1.5}" ${v === 0 ? 'stroke-opacity="0.5"' : ""}/>` + textEl(left - 10, p + fs * 0.3, tickLabel(v), fs * 0.9, "end", 'opacity="0.75"');
  }
  // Zero line for horizontal bars.
  if (horiz && lo < 0) out += `<line x1="${vPos(0)}" y1="${top}" x2="${vPos(0)}" y2="${top + ph}" stroke="currentColor" stroke-opacity="0.5" stroke-width="2"/>`;

  // Category labels.
  for (let c = 0; c < nCat; c++) {
    if (horiz) {
      out += textEl(left - 10, cPos(c) + fs * 0.3, spec.categories[c], catFs, "end");
    } else {
      out += textEl(cPos(c), top + ph + catFs * 1.3, wrap(spec.categories[c], maxChars).join("\n"), catFs, "middle");
    }
  }

  const labelOk = nCat * shown.length <= 28;
  if (spec.type === "column" || spec.type === "bar") {
    const group = stacked ? 1 : shown.length;
    const bandW = (horiz ? ph / nCat : slotW) * 0.7;
    const barW = bandW / group;
    for (let c = 0; c < nCat; c++) {
      let pos = 0;
      let neg = 0;
      const tot = spec.percent ? spec.series.reduce((n, s) => n + Math.abs(s.values[c] ?? 0), 0) || 1 : 1;
      let k = 0;
      spec.series.forEach((s, si) => {
        const raw = s.values[c];
        const idx = k;
        if (!s.hidden) k++;
        if (raw === null || raw === undefined) return;
        const v = spec.percent ? (raw / tot) * 100 : raw;
        let a: number;
        let b: number;
        if (stacked) {
          if (v >= 0) { a = pos; b = pos + v; pos = b; } else { a = neg; b = neg + v; neg = b; }
        } else { a = 0; b = v; }
        if (s.hidden) return;
        const off = stacked ? 0 : (idx - (group - 1) / 2) * barW;
        const p0 = vPos(Math.min(a, b));
        const p1 = vPos(Math.max(a, b));
        const mid = cPos(c) + off;
        const x = horiz ? Math.min(vPos(a), vPos(b)) : mid - barW / 2;
        const y = horiz ? mid - barW / 2 : Math.min(p0, p1);
        const w = horiz ? Math.abs(vPos(b) - vPos(a)) : barW;
        const h = horiz ? barW : Math.abs(p0 - p1);
        out += `<rect x="${x}" y="${y}" width="${Math.max(0, w)}" height="${Math.max(0, h)}" rx="2" fill="${colorOf(si)}"/>`;
        if (labelOk && Math.abs(v) > 0) {
          const txt = spec.percent ? `${Math.round(v)}%` : compact(raw);
          if (stacked) {
            const fits = horiz ? w > txt.length * fs * 0.62 : h > fs * 1.4 && w > txt.length * fs * 0.55;
            if (fits) out += textEl(x + w / 2, y + h / 2 + fs * 0.32, txt, fs * 0.9, "middle", 'fill="#fff"');
          } else if (horiz) out += textEl(raw >= 0 ? x + w + 8 : x - 8, mid + fs * 0.3, txt, fs * 0.9, raw >= 0 ? "start" : "end");
          else out += textEl(x + w / 2, raw >= 0 ? y - 8 : y + h + fs, txt, fs * 0.9, "middle");
        }
      });
    }
  } else {
    // line / area
    const cum = new Array<number>(nCat).fill(0);
    spec.series.forEach((s, si) => {
      const pts: { x: number; y: number; y0: number; v: number }[] = [];
      for (let c = 0; c < nCat; c++) {
        const raw = s.values[c];
        if (raw === null || raw === undefined) continue;
        const base = cum[c];
        if (stacked) cum[c] += raw;
        pts.push({ x: cPos(c), y: vPos(stacked ? cum[c] : raw), y0: vPos(stacked ? base : Math.max(lo, 0)), v: raw });
      }
      if (s.hidden || pts.length === 0) return;
      const line = pts.map((p) => `${p.x},${p.y}`).join(" ");
      if (spec.type === "area") {
        out += `<polygon points="${line} ${[...pts].reverse().map((p) => `${p.x},${p.y0}`).join(" ")}" fill="${colorOf(si)}" fill-opacity="0.55"/>`;
      } else {
        out += `<polyline points="${line}" fill="none" stroke="${colorOf(si)}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`;
        for (const p of pts) out += `<circle cx="${p.x}" cy="${p.y}" r="5.5" fill="${colorOf(si)}"/>`;
        if (labelOk) for (const p of pts) out += textEl(p.x, p.y - 12, compact(p.v), fs * 0.9, "middle");
      }
    });
  }
  return svg(out);
}

function renderPie(spec: ChartSpec, pick: { s: ChartSeries; i: number }, W: number, H: number, fs: number): string {
  const vals = pick.s.values.map((v) => (v !== null && v > 0 ? v : 0));
  const total = vals.reduce((n, v) => n + v, 0);
  if (total <= 0) return "";
  const legendW = Math.min(W * 0.45, Math.max(...spec.categories.map((c) => c.length)) * fs * 0.58 + fs * 3);
  const r = Math.min(H / 2 - 8, (W - legendW) / 2 - 8);
  const cx = r + 8;
  const cy = H / 2;
  let out = "";
  let a0 = -Math.PI / 2;
  vals.forEach((v, c) => {
    if (v <= 0) return;
    const a1 = a0 + (v / total) * Math.PI * 2;
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const pt = (a: number) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
    out +=
      vals.filter((x) => x > 0).length === 1
        ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${colorOf(c)}"/>`
        : `<path d="M${cx},${cy} L${pt(a0)} A${r},${r} 0 ${big} 1 ${pt(a1)} Z" fill="${colorOf(c)}" stroke="var(--tq-slide-bg, #fff)" stroke-width="2"/>`;
    const share = (v / total) * 100;
    if (share >= 5) {
      const am = (a0 + a1) / 2;
      out += textEl(cx + r * 0.66 * Math.cos(am), cy + r * 0.66 * Math.sin(am) + fs * 0.32, `${Math.round(share)}%`, fs * 0.95, "middle", 'fill="#fff" font-weight="700"');
    }
    a0 = a1;
  });
  const rowH = Math.min(fs * 1.9, (H - 16) / spec.categories.length);
  const y0 = cy - (rowH * spec.categories.length) / 2;
  spec.categories.forEach((name, c) => {
    const y = y0 + c * rowH;
    out += `<rect x="${cx + r + 28}" y="${y + rowH / 2 - fs * 0.45}" width="${fs * 0.9}" height="${fs * 0.9}" rx="2" fill="${colorOf(c)}"/>`;
    out += textEl(cx + r + 28 + fs * 1.4, y + rowH / 2 + fs * 0.32, `${name}  ${compact(pick.s.values[c] ?? 0)}`, fs, "start");
  });
  return out;
}
