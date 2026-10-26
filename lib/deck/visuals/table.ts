// Enhance phase 1, step 3 (docs/enhance-visuals-plan.md): render a source
// table's EXACT cells as slide HTML. The model only reserves the box
// (<div data-table="s05-t1" style="width:..;height:..">); this fills it, so no
// cell can be reworded, dropped or invented.
//
// Look follows the slide, not a fixed palette: text inherits the slide's own
// colour (contrast always right on light and dark slides), the header gets a
// rule in var(--primary), zebra rows and separators are tints of currentColor.
// Inline styles only (slide CSS is scoped and dom-to-pptx exports a plain
// <table> as a native, editable PowerPoint table). Digits stay as written.

export type TableCell = { text: string; colSpan: number; rowSpan: number };
export type TableSpec = { rows: TableCell[][]; headerRow: boolean; columns: number };

const NUMERIC_RE = /^[\s\d.,%+\-~≈×x^()/:$€£¥]+$/i;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Font size from the box height and the amount of text (1920-wide canvas px).
function fontSizeFor(t: TableSpec, boxHeight: number | null): number {
  const rows = Math.max(1, t.rows.length);
  const cells = t.rows.flat();
  const avgChars = cells.reduce((n, c) => n + c.text.length, 0) / Math.max(1, cells.length);
  const byHeight = boxHeight ? (boxHeight / rows) * 0.36 : 26;
  const byDensity = avgChars > 60 ? 18 : avgChars > 30 ? 21 : avgChars > 14 ? 24 : 30;
  return Math.round(Math.max(16, Math.min(30, byHeight, byDensity)));
}

const isNumeric = (s: string) => s !== "" && NUMERIC_RE.test(s);

// Many decks never set PowerPoint's header-row flag. A first row of plain
// labels sitting over columns that hold numbers is a header all the same.
function hasHeader(t: TableSpec): boolean {
  if (t.headerRow) return true;
  if (t.rows.length < 2) return false;
  const first = t.rows[0];
  if (first.some((c) => isNumeric(c.text) || c.text === "")) return false;
  return t.rows.slice(1).some((r) => r.some((c) => isNumeric(c.text)));
}

// A column is numeric when most of its non-empty body cells are numbers;
// its header then aligns with them (end), not with the labels (start).
function numericColumns(t: TableSpec, header: boolean): boolean[] {
  const cols = Array.from({ length: t.columns }, () => ({ num: 0, all: 0 }));
  for (const row of t.rows.slice(header ? 1 : 0)) {
    let c = 0;
    for (const cell of row) {
      if (cell.colSpan === 1 && cell.text !== "" && cols[c]) {
        cols[c].all++;
        if (isNumeric(cell.text)) cols[c].num++;
      }
      c += cell.colSpan;
    }
  }
  return cols.map((c) => c.all > 0 && c.num / c.all >= 0.6);
}

// Zebra stripes follow row GROUPS: rows tied together by a merged (rowspan)
// cell share one stripe, so the merged value sits in one clean band with the
// rows it covers. Striping single rows cut a merge into a staircase that read
// as values on the wrong row (prod 2026-10-26, a grammar table).
function rowGroups(t: TableSpec, header: boolean): number[] {
  const out: number[] = [];
  let group = -1;
  let openUntil = -1;
  t.rows.forEach((row, r) => {
    if (header && r === 0) {
      out.push(-1);
      return;
    }
    if (r > openUntil) group++;
    for (const c of row) openUntil = Math.max(openUntil, r + c.rowSpan - 1);
    out.push(group);
  });
  return out;
}

export function renderTableHtml(t: TableSpec, opts: { boxHeight: number | null }): string {
  const header = hasHeader(t);
  t = { ...t, headerRow: header };
  const numericCol = numericColumns(t, header);
  const fs = fontSizeFor(t, opts.boxHeight);
  const line = "color-mix(in srgb, currentColor 18%, transparent)";
  const zebra = "color-mix(in srgb, currentColor 5%, transparent)";
  const groups = rowGroups(t, header);
  const body = t.rows
    .map((row, r) => {
      const isHead = t.headerRow && r === 0;
      const tag = isHead ? "th" : "td";
      const bg = !isHead && groups[r] % 2 === 1 ? `background:${zebra};` : "";
      let col = 0;
      const cells = row
        .map((c, ci) => {
          const at = col;
          col += c.colSpan;
          const numeric = isNumeric(c.text);
          // Header labels follow their column; body cells follow their own text.
          const alignEnd = isHead ? c.colSpan === 1 && numericCol[at] === true : numeric;
          const style = [
            "padding:0.45em 0.8em",
            "vertical-align:middle",
            `text-align:${alignEnd ? "end" : "start"}`,
            numeric ? "font-variant-numeric:tabular-nums;white-space:nowrap" : "",
            isHead
              ? "font-weight:700;border-bottom:3px solid var(--primary, currentColor)"
              : `border-bottom:1px solid ${line}`,
            !isHead && ci === 0 && t.columns >= 3 ? "font-weight:600" : "",
          ]
            .filter(Boolean)
            .join(";");
          const span = `${c.colSpan > 1 ? ` colspan="${c.colSpan}"` : ""}${c.rowSpan > 1 ? ` rowspan="${c.rowSpan}"` : ""}`;
          return `<${tag}${span} style="${style}">${esc(c.text).replace(/\n/g, "<br>")}</${tag}>`;
        })
        .join("");
      return `<tr style="${bg}">${cells}</tr>`;
    })
    .join("");
  return `<table data-tq-source-table="1" style="width:100%;height:100%;border-collapse:collapse;font-size:${fs}px;line-height:1.3;color:inherit;font-family:inherit">${body}</table>`;
}
