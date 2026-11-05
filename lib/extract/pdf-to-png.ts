// Phase 18 (Enhance overhaul) — PDF → per-page PNG via poppler `pdftoppm`.
//
// We feed Claude pre-rendered per-slide IMAGES (not a PDF document
// block), so we control resolution and pair each image with its exact
// text. `pdftoppm` is the canonical headless PDF rasterizer: fast (a
// 31-page deck → ~12 s), deterministic, browser-free — it runs as a
// subprocess exactly like LibreOffice (lib/extract/pptx-to-pdf.ts), and
// avoids the pdfjs/canvas/Turbopack bundling pain we deleted in 17.B-8.
//
// Pipeline: PPTX → PDF (pptx-to-pdf.ts) → THIS → per-page PNG buffers.
// PDF uploads skip the LibreOffice step and rasterize directly.
//
//   pdftoppm -r <dpi> input.pdf out/page   →   out/page-01.ppm …   →   sharp → PNG
//
// pdftoppm writes raw PPM here, not its own -png: its PNG encoder took 3-5 s
// per image-heavy page and sharp takes about 0.3 s. Prod 2026-11-05: a 34-page
// PDF went from 114 s, 6 s short of the timeout below, to about 30 s. Adaptive
// filtering keeps the files as small as before, for vision uploads.
//
// ─── DPI / format ─────────────────────────────────────────────────
// Default 72 DPI. Anthropic's vision pipeline downsamples images to
// ~1568 px on the long edge, and a 16:9 PDF page at 72 DPI renders to
// ~1584×891 px (~650 KB) — i.e. exactly that ceiling, so rendering
// larger is wasted upload for identical vision tokens. Bump via `dpi`
// only if small-text legibility ever needs a cushion. PNG (not JPEG):
// slides are text + vector, where JPEG ringing hurts small-text reads.
//
// Unlike LibreOffice, `pdftoppm` is stateless — no per-call profile
// dir / lock-file dance needed.
//
// ─── Deployment ───────────────────────────────────────────────────
// Local dev (macOS):  `brew install poppler`
// Production (Linux): `apt-get install -y poppler-utils`
// The runtime image must include poppler alongside LibreOffice.

import { MissingToolError } from "@/lib/extract/missing-tool";
import sharp from "sharp";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

// Conservative ceiling on the rasterization subprocess. 31 pages at
// 72 DPI is ~12 s; large/dense decks can take longer. 120 s leaves
// headroom without leaving a hung subprocess if poppler deadlocks.
const RASTER_TIMEOUT_MS = 120_000;

// Default render DPI — see header for the ~1568 px vision-ceiling
// reasoning.
const DEFAULT_DPI = 72;

// `pdftoppm`'s command name is stable across installs. Caller-supplied
// PDFTOPPM_BIN wins (non-standard installs / pinning); then PATH; then
// the common Homebrew + Linux locations as a fallback when PATH is
// thin (some serverless/runtime PATHs don't include /opt/homebrew).
const CANDIDATE_BINS = [
  process.env.PDFTOPPM_BIN,
  "pdftoppm",
  "/opt/homebrew/bin/pdftoppm",
  "/usr/bin/pdftoppm",
  "/usr/local/bin/pdftoppm",
].filter((v): v is string => typeof v === "string" && v.length > 0);

/** One raw PPM page, as pdftoppm writes it, as a PNG. */
export async function ppmToPng(ppm: Buffer): Promise<Buffer> {
  const head = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(ppm.subarray(0, 64).toString("latin1"));
  if (!head) throw new Error("pdftoppm wrote an unexpected page format");
  return sharp(ppm.subarray(head[0].length), {
    raw: { width: Number(head[1]), height: Number(head[2]), channels: 3 },
  })
    .png({ adaptiveFiltering: true })
    .toBuffer();
}

export type PdfToPngsOptions = {
  /** Render DPI. Defaults to 72 (≈ Anthropic's vision ceiling). */
  dpi?: number;
};

/**
 * Rasterize a PDF buffer to one PNG buffer per page, in page order.
 *
 * Throws with a clear, user-facing message when poppler isn't
 * installed (caller wraps as NonRetriableError so Inngest doesn't
 * loop). Throws with the CLI's stderr when rasterization fails for a
 * specific file (e.g. a malformed PDF).
 *
 * Implementation: write the PDF to a unique temp dir, shell out to
 * `pdftoppm`, read the produced PNGs in sorted (page) order, clean up.
 */
export async function pdfToPngs(
  pdfBuffer: Buffer,
  options: PdfToPngsOptions = {},
): Promise<Buffer[]> {
  const dpi = options.dpi ?? DEFAULT_DPI;

  // Isolated tmp namespace for this conversion. Deleted in `finally`.
  const workDir = await mkdtemp(path.join(tmpdir(), "taqreer-pdfpng-"));
  const inputPath = path.join(workDir, "input.pdf");
  const outDir = path.join(workDir, "out");
  // `pdftoppm <prefix>` writes `<prefix>-01.ppm`, `-02.ppm`, … with
  // zero-padded indices wide enough for the page count, so a plain
  // lexicographic sort preserves page order.
  const outPrefix = path.join(outDir, "page");

  try {
    await writeFile(inputPath, pdfBuffer);
    // pdftoppm won't create the output directory itself.
    await mkdir(outDir, { recursive: true });

    const args = [
      "-r",
      String(dpi),
      inputPath,
      outPrefix,
    ];

    let lastError: Error | null = null;
    for (const bin of CANDIDATE_BINS) {
      try {
        await execFileAsync(bin, args, { timeout: RASTER_TIMEOUT_MS });
        // Success — turn every produced page into a PNG, in page order. One
        // at a time: a raw page is several MB.
        const files = (await readdir(outDir))
          .filter((f) => f.toLowerCase().endsWith(".ppm"))
          .sort();
        if (files.length === 0) {
          throw new Error("pdftoppm produced no pages");
        }
        const pngs: Buffer[] = [];
        for (const f of files) {
          pngs.push(await ppmToPng(await readFile(path.join(outDir, f))));
        }
        return pngs;
      } catch (err) {
        // ENOENT = the binary doesn't exist; try the next candidate.
        if (isMissingBinary(err)) {
          lastError = err instanceof Error ? err : new Error(String(err));
          continue;
        }
        // Other errors (timeout, non-zero exit, malformed PDF, the
        // empty-output guard above) — bail with the actual message.
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`pdftoppm rasterization failed: ${message}`);
      }
    }

    // None of the candidate binaries existed (never retried, see
    // missing-tool.ts).
    throw new MissingToolError(
      `poppler (pdftoppm) is not installed on the server. To enable ` +
        `per-slide image rendering, install poppler on the host:\n` +
        `  • macOS:  brew install poppler\n` +
        `  • Linux:  apt-get install -y poppler-utils\n` +
        `Original error: ${lastError?.message ?? "no binary found"}`,
    );
  } finally {
    // Best-effort cleanup — the rendered PNGs are transient; once the
    // caller has them in memory the temp dir is flushed immediately.
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Heuristic: detect the "binary not found" error from execFile so we
 * can fall through to the next candidate name. Node's spawn surfaces
 * this as `err.code === "ENOENT"`.
 */
function isMissingBinary(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === "ENOENT";
}
