// Parse spreadsheet uploads (xlsx/xls/csv) into a Markdown table Claude
// can read natively. Used by POST /api/datasheet/parse (synchronous)
// for the /datasheet flow — there's no Inngest job, no Supabase staging,
// no Anthropic Files API roundtrip. The whole point is that Claude
// receives structured numbers + column headers (the substrate for
// accurate charts), not a rendered-PDF view of cells.
//
// ─── Why no Files API ────────────────────────────────────────────
// /enhance + /mimic upload PDFs to Anthropic's Files API because the
// LLM needs to SEE the visual layout. For data → charts, the opposite
// is true: vision-based number extraction is lossy (Claude reads "1.2M"
// from a screenshot when the cell actually holds 1,234,567), and
// charts need exact values to compute axis ranges, percentages, etc.
// Inline Markdown sidesteps the vision step entirely.
//
// ─── Truncation strategy ─────────────────────────────────────────
// Claude's context is ~200k tokens; a markdown row is ~150 chars
// (~40 tokens). We aim for the spreadsheet portion to stay under
// ~50k tokens so brand directives + chart instructions + the
// generated HTML still fit. Concretely:
//   • Per-sheet row cap: MAX_ROWS_PER_SHEET (5000)
//   • Per-cell char cap: MAX_CELL_CHARS (500) — long-form text cells
//     get ellipsis-truncated so a single bloated cell can't blow up
//     the whole payload
//   • Total markdown cap: MAX_MARKDOWN_CHARS (~200k chars ≈ 50k
//     tokens) — if exceeded mid-write we stop the current sheet,
//     emit a "[N more rows…]" footer, and mark truncated=true
// Header row + first ~20 data rows are ALWAYS preserved per sheet
// even under heavy truncation so Claude never sees a stub-only sheet.
//
// ─── Column stats ────────────────────────────────────────────────
// For sheets that get truncated, we prepend a compact stats block
// (per-column min/max/avg for numeric cols, distinct-count for
// strings) so Claude can reason about the full range without
// seeing every row. Cheap signal-density boost for charts that
// summarize trends.

import * as XLSX from "xlsx";

// ─── Limits (export so tests / callers can reference) ────────────
export const MAX_ROWS_PER_SHEET = 5_000;
export const MAX_CELL_CHARS = 500;
export const MAX_MARKDOWN_CHARS = 200_000;
export const PRESERVED_HEAD_ROWS = 20;

export type DatasheetParseInput = {
  buffer: Buffer;
  mime: string;
  fileName: string;
};

export type DatasheetParseResult = {
  /** The parsed-and-truncated Markdown payload ready for the prompt. */
  markdown: string;
  /** Total sheets in the workbook (CSVs always report 1). */
  sheetCount: number;
  /** Total rows across all sheets BEFORE truncation. */
  totalRows: number;
  /** True if any sheet was row-truncated or the global cap was hit. */
  truncated: boolean;
};

type ColumnStats = {
  header: string;
  kind: "numeric" | "string" | "mixed" | "empty";
  numericMin: number | null;
  numericMax: number | null;
  numericMean: number | null;
  distinctSample: string[]; // up to 5 distinct values for context
  filledCount: number;
};

// ─── Public entrypoint ───────────────────────────────────────────
export function parseDatasheet(
  input: DatasheetParseInput,
): DatasheetParseResult {
  const { buffer, mime, fileName } = input;

  const workbook = readWorkbook(buffer, mime, fileName);

  if (!workbook.SheetNames.length) {
    throw new Error("Spreadsheet contained no sheets.");
  }

  // Aggregate state across the whole workbook so the global char cap
  // and total row count survive across sheet iterations.
  let totalRows = 0;
  let truncated = false;
  let charsRemaining = MAX_MARKDOWN_CHARS;
  const sections: string[] = [];

  // Flips to true the first time we overflow the markdown budget.
  // From that point onward we keep iterating worksheets ONLY to
  // accumulate row counts into `totalRows` — the per-sheet markdown
  // is no longer pushed into `sections`, so charsRemaining doesn't
  // need to be touched either. Without this guard, an early-overflow
  // case would `break` and the documented "pre-truncation count
  // across the whole workbook" contract on `DatasheetParseResult.
  // totalRows` would silently lie to the UI + the prompt. CR #4
  // (PR #39).
  let budgetOverflowed = false;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    // sheet_to_json with header:1 returns Array<Array<unknown>> — the
    // raw grid, no key inference. `defval:""` fills missing cells so
    // each row has the same length as the header row (otherwise rows
    // with trailing blanks would be short and break Markdown table
    // alignment). `blankrows:false` drops fully-empty rows.
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      blankrows: false,
    });

    if (grid.length === 0) continue;

    const rawHeaderRow = grid[0] ?? [];
    const dataRows = grid.slice(1);
    totalRows += dataRows.length;

    // Once the global budget has overflowed, keep counting rows for
    // accurate `totalRows` reporting but skip the expensive sampling
    // + column-stats + render work — that markdown wouldn't land in
    // the output anyway.
    if (budgetOverflowed) continue;

    // Truncate rows if this sheet alone exceeds the per-sheet cap.
    // We keep the head (first PRESERVED_HEAD_ROWS) so even after a
    // heavy trim Claude sees representative early rows. Beyond that
    // we sample evenly through the remaining rows up to the cap so
    // late-sheet patterns (e.g. quarterly totals at the bottom) still
    // appear. Plain head-only truncation would hide them.
    const rowsForMarkdown = sampleRows(dataRows, MAX_ROWS_PER_SHEET);
    const sheetTruncated = rowsForMarkdown.length < dataRows.length;
    if (sheetTruncated) truncated = true;

    // Column stats are computed on the FULL row set (not the sampled
    // one) so the summary reflects the real distribution. Cheap pass.
    const columnStats = computeColumnStats(rawHeaderRow, dataRows);

    // Compose the sheet section: stats header (only if truncated) +
    // markdown table + truncation footer.
    const sheetMarkdown = renderSheetSection({
      sheetName,
      headerRow: rawHeaderRow,
      rows: rowsForMarkdown,
      columnStats,
      truncated: sheetTruncated,
      totalRowCount: dataRows.length,
      includeStatsHeader: sheetTruncated || dataRows.length > 200,
    });

    // Global char cap — if appending this sheet would blow the budget,
    // append what fits + a "[truncated]" stub, flip the overflow flag,
    // and let the loop continue (so subsequent sheets still contribute
    // to `totalRows`). The renderer + sections list no longer grow
    // after this point because `budgetOverflowed` short-circuits the
    // next iteration. See `buildTruncatedSection` for the slice +
    // footer composition.
    if (sheetMarkdown.length > charsRemaining) {
      const sheetsRemaining =
        workbook.SheetNames.length - sections.length - 1;
      sections.push(
        buildTruncatedSection(sheetMarkdown, charsRemaining, sheetsRemaining),
      );
      truncated = true;
      budgetOverflowed = true;
      continue;
    }
    sections.push(sheetMarkdown);
    charsRemaining -= sheetMarkdown.length;
  }

  return {
    markdown: sections.join("\n\n---\n\n"),
    sheetCount: workbook.SheetNames.length,
    totalRows,
    truncated,
  };
}

// ─── Sheet section renderer ──────────────────────────────────────
function renderSheetSection({
  sheetName,
  headerRow,
  rows,
  columnStats,
  truncated,
  totalRowCount,
  includeStatsHeader,
}: {
  sheetName: string;
  headerRow: unknown[];
  rows: unknown[][];
  columnStats: ColumnStats[];
  truncated: boolean;
  totalRowCount: number;
  includeStatsHeader: boolean;
}): string {
  const parts: string[] = [`## Sheet: "${sheetName}"`];

  if (includeStatsHeader) {
    parts.push(
      `_Rows: ${totalRowCount.toLocaleString()}, Columns: ${columnStats.length}_`,
    );
    parts.push("");
    parts.push("### Column summary");
    parts.push(renderStatsTable(columnStats));
    parts.push("");
    parts.push("### Sample data");
  }

  // Markdown table — header row, alignment row, data rows. Cell
  // contents pipe-escaped + per-cell truncated. Headers get the
  // same escape treatment so a column literally named "a|b" doesn't
  // break the table.
  const escapedHeaders = headerRow.map((c) => escapeCell(c));
  parts.push(`| ${escapedHeaders.join(" | ")} |`);
  parts.push(`|${escapedHeaders.map(() => " --- ").join("|")}|`);
  for (const row of rows) {
    const cells = headerRow.map((_, colIndex) =>
      escapeCell(row[colIndex]),
    );
    parts.push(`| ${cells.join(" | ")} |`);
  }

  if (truncated) {
    const omitted = totalRowCount - rows.length;
    parts.push("");
    parts.push(
      `_[${omitted.toLocaleString()} more row(s) omitted to fit context window. Column summary above reflects the full dataset.]_`,
    );
  }

  return parts.join("\n");
}

function renderStatsTable(stats: ColumnStats[]): string {
  const lines: string[] = [];
  lines.push("| Column | Type | Min | Max | Mean | Sample values |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const s of stats) {
    const sample = s.distinctSample.length
      ? s.distinctSample.map((v) => `\`${v}\``).join(", ")
      : "—";
    lines.push(
      `| ${escapeCell(s.header)} | ${s.kind} | ${fmtNumOrDash(s.numericMin)} | ${fmtNumOrDash(s.numericMax)} | ${fmtNumOrDash(s.numericMean)} | ${sample} |`,
    );
  }
  return lines.join("\n");
}

// Tiny helper for the three "numeric-or-em-dash" cells in the stats
// table row above. Trips the repetition that previously read as
// three near-identical guards.
function fmtNumOrDash(n: number | null): string {
  return n === null ? "—" : formatNumber(n);
}

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Open the workbook from the request buffer. XLSX.read auto-detects
 * xlsx (zip) and xls (CFB) from the magic bytes when `type: "buffer"`,
 * but CSVs need string input + `raw: false` to stop SheetJS eagerly
 * inferring numeric types on every cell. Branch on mime/extension —
 * the route's allowlist already ensures one of these three formats.
 */
function readWorkbook(
  buffer: Buffer,
  mime: string,
  fileName: string,
): XLSX.WorkBook {
  const isCsv =
    mime === "text/csv" ||
    mime === "text/plain" ||
    fileName.toLowerCase().endsWith(".csv");
  return isCsv
    ? XLSX.read(buffer.toString("utf-8"), { type: "string", raw: false })
    : XLSX.read(buffer, { type: "buffer", cellDates: true });
}

/**
 * Build the final-section payload when a sheet's markdown overflows
 * the workbook-wide character cap. Slices the sheet to fit the
 * remaining budget (minus 200 chars headroom for the footer) and
 * appends a "[N more sheet(s) omitted]" stub so Claude knows the
 * payload was cut. Pure transform — caller manages the
 * `budgetOverflowed` + `truncated` flags around it.
 */
function buildTruncatedSection(
  sheetMarkdown: string,
  charsRemaining: number,
  sheetsRemaining: number,
): string {
  const fitted = sheetMarkdown.slice(0, Math.max(0, charsRemaining - 200));
  return `${fitted}\n\n_[Payload truncated to fit Claude's context window. ${sheetsRemaining} more sheet(s) omitted.]_`;
}

/**
 * Classify a column as empty / numeric / string / mixed from the
 * counts collected during the first-pass scan. Lifted out of the
 * profile-builder loop so the decision tree reads top-to-bottom
 * (nested ternaries are banned by project convention).
 */
function classifyColumnKind(
  filled: number,
  numeric: number,
  string: number,
): ColumnStats["kind"] {
  if (filled === 0) return "empty";
  if (numeric > 0 && string === 0) return "numeric";
  if (numeric === 0 && string > 0) return "string";
  return "mixed";
}

/**
 * Sample rows evenly to fit a target count, preserving the head.
 * Strategy: keep the first PRESERVED_HEAD_ROWS verbatim, then sample
 * every Nth row through the rest where N = ceil(remaining / budget).
 * For datasets smaller than the cap, returns the input as-is.
 */
function sampleRows(rows: unknown[][], cap: number): unknown[][] {
  if (rows.length <= cap) return rows;
  const head = rows.slice(0, PRESERVED_HEAD_ROWS);
  const remaining = rows.slice(PRESERVED_HEAD_ROWS);
  const budgetForRest = cap - PRESERVED_HEAD_ROWS;
  if (budgetForRest <= 0) return head;
  const stride = Math.ceil(remaining.length / budgetForRest);
  const sampled: unknown[][] = [];
  for (let i = 0; i < remaining.length; i += stride) {
    sampled.push(remaining[i]!);
    if (sampled.length >= budgetForRest) break;
  }
  return [...head, ...sampled];
}

function computeColumnStats(
  headerRow: unknown[],
  rows: unknown[][],
): ColumnStats[] {
  return headerRow.map((header, colIndex) => {
    let numericMin = Infinity;
    let numericMax = -Infinity;
    let numericSum = 0;
    let numericCount = 0;
    let stringCount = 0;
    let filledCount = 0;
    const distinctValues = new Set<string>();

    for (const row of rows) {
      const cell = row[colIndex];
      if (cell === null || cell === undefined || cell === "") continue;
      filledCount += 1;
      if (typeof cell === "number" && Number.isFinite(cell)) {
        numericCount += 1;
        numericSum += cell;
        if (cell < numericMin) numericMin = cell;
        if (cell > numericMax) numericMax = cell;
      } else {
        stringCount += 1;
        if (distinctValues.size < 50) {
          distinctValues.add(String(cell));
        }
      }
    }

    const kind = classifyColumnKind(filledCount, numericCount, stringCount);

    return {
      header: String(header ?? `Column ${colIndex + 1}`),
      kind,
      numericMin: numericCount > 0 ? numericMin : null,
      numericMax: numericCount > 0 ? numericMax : null,
      numericMean: numericCount > 0 ? numericSum / numericCount : null,
      distinctSample: Array.from(distinctValues).slice(0, 5),
      filledCount,
    };
  });
}

/**
 * Stringify + escape a cell value for a Markdown table.
 *  • Pipes (`|`) → `\|`
 *  • Newlines → ` ` (table rows can't span lines)
 *  • Cap length at MAX_CELL_CHARS with ellipsis
 *  • Dates → ISO date (YYYY-MM-DD) — XLSX gives us a Date object
 *    when cellDates:true is set
 *  • Numbers → formatNumber (locale-free, predictable)
 */
function escapeCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  let str: string;
  if (value instanceof Date) {
    str = value.toISOString().slice(0, 10);
  } else if (typeof value === "number") {
    str = formatNumber(value);
  } else {
    str = String(value);
  }
  // Normalize whitespace + escape pipes. The replace order matters —
  // do newline/CR collapse first so the regex doesn't accidentally
  // eat escaped pipes mid-cell.
  str = str.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
  if (str.length > MAX_CELL_CHARS) {
    str = `${str.slice(0, MAX_CELL_CHARS - 1)}…`;
  }
  return str;
}

/**
 * Locale-free number formatting. Drops trailing zeros after the
 * decimal point and uses regular dots/commas (NOT Arabic-Indic
 * numerals) so Claude reads them as raw numerics. Integers stay
 * integers; floats get 4 sig figs max.
 */
function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  // Round to 4 decimal places then trim trailing zeros.
  const rounded = Math.round(n * 10_000) / 10_000;
  return String(rounded);
}
