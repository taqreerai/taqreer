// PDF → plain text via poppler `pdftotext` (2026-07-11, mimic overhaul).
//
// Sibling to pdf-to-png.ts: same poppler-utils package, same subprocess
// pattern. Where pdf-to-png rasterizes pages for VISION, this pulls the
// PDF's TEXT LAYER so a content document reaches Claude as FACTS, not as a
// picture of its own layout (which made /mimic reproduce the source's
// boxes as content). Also feeds language detection (an Arabic-vs-Latin
// glyph count over the extracted text).
//
//   pdftotext -enc UTF-8 input.pdf -   →   text on stdout
//
// ‼️ `-enc UTF-8` is REQUIRED: pdftotext defaults to Latin1 and would
// mojibake every Arabic document otherwise.
//
// Reading-order (default) output, NOT `-layout`: we want the substance in
// a sensible flow, not a spatial reconstruction that interleaves a
// two-column form. Image-only / scanned PDFs have no text layer and yield
// "" — the caller falls back to the vision document block.
//
// ─── Deployment ───────────────────────────────────────────────────
// Local dev (macOS):  `brew install poppler`
// Production (Linux): `apt-get install -y poppler-utils`
// (Already installed for pdf-to-png.ts — same binary family.)

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

// Text extraction is far cheaper than rasterization, but a huge/dense PDF
// can still take a few seconds. 120 s matches pdf-to-png's ceiling.
const EXTRACT_TIMEOUT_MS = 120_000;

// Extracted text can be large for long documents; lift execFile's default
// 1 MB stdout cap to 32 MB so a big deck's text isn't truncated mid-stream.
const MAX_BUFFER = 32 * 1024 * 1024;

// `pdftotext`'s command name is stable; caller-supplied PDFTOTEXT_BIN wins,
// then PATH, then the common Homebrew + Linux locations (mirrors
// pdf-to-png.ts CANDIDATE_BINS for thin serverless PATHs).
const CANDIDATE_BINS = [
  process.env.PDFTOTEXT_BIN,
  "pdftotext",
  "/opt/homebrew/bin/pdftotext",
  "/usr/bin/pdftotext",
  "/usr/local/bin/pdftotext",
].filter((v): v is string => typeof v === "string" && v.length > 0);

/**
 * Extract the text layer of a PDF buffer to a single UTF-8 string.
 *
 * Returns the trimmed text, or `""` when the PDF has no text layer
 * (scanned/image-only) — callers treat "" as "fall back to vision".
 *
 * Throws with a clear, install-guidance message when poppler isn't on the
 * host; other failures (timeout, malformed PDF) throw with the CLI's
 * message. Callers decide how to handle it: the /mimic + language path in
 * lib/extract/index.ts logs and DEGRADES to the vision document block (a
 * best-effort enrichment must never fail the whole extraction), whereas a
 * caller that hard-requires the text layer should surface it as a
 * NonRetriableError so Inngest doesn't loop.
 */
export async function pdfToText(pdfBuffer: Buffer): Promise<string> {
  const workDir = await mkdtemp(path.join(tmpdir(), "taqreer-pdftxt-"));
  const inputPath = path.join(workDir, "input.pdf");

  try {
    await writeFile(inputPath, pdfBuffer);
    // `-` writes to stdout; `-enc UTF-8` keeps Arabic (and every other
    // non-Latin script) intact.
    const args = ["-enc", "UTF-8", inputPath, "-"];

    let lastError: Error | null = null;
    for (const bin of CANDIDATE_BINS) {
      try {
        const { stdout } = await execFileAsync(bin, args, {
          timeout: EXTRACT_TIMEOUT_MS,
          maxBuffer: MAX_BUFFER,
          encoding: "utf8",
        });
        return stdout.trim();
      } catch (err) {
        if (isMissingBinary(err)) {
          lastError = err instanceof Error ? err : new Error(String(err));
          continue;
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`pdftotext extraction failed: ${message}`);
      }
    }

    throw new Error(
      `poppler (pdftotext) is not installed on the server. To enable ` +
        `PDF text extraction, install poppler on the host:\n` +
        `  • macOS:  brew install poppler\n` +
        `  • Linux:  apt-get install -y poppler-utils\n` +
        `Original error: ${lastError?.message ?? "no binary found"}`,
    );
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function isMissingBinary(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as { code?: unknown }).code === "ENOENT";
}
