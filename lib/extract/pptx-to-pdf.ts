// Phase 17.B — PPTX → PDF conversion via headless LibreOffice.
//
// LibreOffice is the canonical headless renderer for PPTX (free,
// accurate, single dep). We use the standard CLI invocation:
//
//   libreoffice --headless --convert-to pdf --outdir <tmp> <input.pptx>
//
// The resulting PDF is then handed to `rasterizePdf` in rasterize.ts
// — same code path PDFs already take. This keeps the dispatcher
// shape simple: every input format normalizes to PDF before
// rasterization.
//
// ─── Why a unique profile directory per call ──────────────────────
// LibreOffice maintains a per-user "profile" (lock files, config,
// recovery state) in ~/.config/libreoffice. Two concurrent
// invocations against the same profile RACE on that lock file —
// the second invocation either blocks or silently dies, leaving a
// stale lock that breaks subsequent runs. We pass an isolated
// profile directory via `-env:UserInstallation=file://<path>` so
// every conversion gets its own scratch state. The dir lives in
// the same tmp directory we use for the input/output files and is
// removed at the end (even on error).
//
// ─── Deployment ───────────────────────────────────────────────────
// Local dev (macOS):  `brew install --cask libreoffice`
// Production (Linux): `apt-get install -y libreoffice-impress libreoffice-writer`
//   BOTH subpackages are required: -impress imports PPTX, -writer
//   imports DOCX. With -writer missing, DOCX conversion "succeeds"
//   (exit 0) but writes no PDF - that outage ran for weeks before
//   the 2026-08-09 prod audit caught it. The full libreoffice
//   meta-package is ~600 MB and still overkill.
// The Dockerfile / Vercel buildpack must include LibreOffice on the
// runtime image for this to work in production.

import { MissingToolError } from "@/lib/extract/missing-tool";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

// Conservative ceiling on the conversion subprocess. A typical
// 12-slide PPTX converts in 5-15 seconds; complex decks with lots
// of embedded SVGs / charts can take 30+. 90 s gives headroom
// without leaving a hung subprocess if LibreOffice deadlocks.
const CONVERT_TIMEOUT_MS = 90_000;

// LibreOffice's command name varies by install — `libreoffice` on
// most Linux, `soffice` on macOS / some Linux distros. Try the
// canonical name first; fall back to soffice. Caller-supplied
// LIBREOFFICE_BIN env var wins if set (useful for non-standard
// installs or when we want to pin to a specific version).
const CANDIDATE_BINS = [
  process.env.LIBREOFFICE_BIN,
  "libreoffice",
  "soffice",
].filter((v): v is string => typeof v === "string" && v.length > 0);

/**
 * Convert a PPTX buffer to a PDF buffer via headless LibreOffice.
 *
 * Throws with a clear, user-facing message when LibreOffice isn't
 * installed (caller wraps as NonRetriableError so Inngest doesn't
 * loop). Throws with the CLI's stderr when conversion fails for a
 * specific file (e.g. malformed PPTX) — same NonRetriable wrapping.
 *
 * Implementation: write the PPTX to a unique temp dir, shell out
 * to LibreOffice with an isolated user-profile dir (concurrency-
 * safe — see file header), read the resulting PDF, clean up.
 */
export async function pptxToPdf(pptxBuffer: Buffer): Promise<Buffer> {
  return officeConvert(pptxBuffer, "pptx");
}

/**
 * Convert a DOCX (Word) buffer to a PDF buffer via the SAME headless
 * LibreOffice path. Used by the /create content flow so an uploaded
 * Word brief becomes a PDF Claude reads as a `document` block. DOCX
 * carries no slide/theme structure, so callers skip the PPTX-only
 * font/colour/text extraction.
 */
export async function docxToPdf(docxBuffer: Buffer): Promise<Buffer> {
  return officeConvert(docxBuffer, "docx");
}

/**
 * Convert a legacy binary PowerPoint (.ppt) to .pptx via the same headless
 * LibreOffice path (owner, 2026-10-27). Every PPTX reader in the pipeline
 * (text, theme colours, fonts, pictures, tables) walks the OOXML zip, so a
 * .ppt read as one came back empty: no exact text, no carried pictures and
 * no pictures question in Enhance.
 */
export async function pptToPptx(pptBuffer: Buffer): Promise<Buffer> {
  return officeConvert(pptBuffer, "ppt", "pptx");
}

/**
 * Shared headless-LibreOffice conversion (PDF by default, or .pptx for a
 * legacy .ppt). `inputExt` sets the temp input filename's extension so
 * LibreOffice selects the right import filter (.pptx / .ppt → Impress,
 * .docx → Writer); the output is `out/input.<outExt>` (LibreOffice names
 * the output by input basename).
 */
async function officeConvert(
  buffer: Buffer,
  inputExt: "pptx" | "docx" | "ppt",
  outExt: "pdf" | "pptx" = "pdf",
): Promise<Buffer> {
  // Isolated tmp namespace for this conversion: input, output, AND
  // the LibreOffice profile. Deleted in the finally block.
  const workDir = await mkdtemp(path.join(tmpdir(), `taqreer-${inputExt}-`));
  const inputPath = path.join(workDir, `input.${inputExt}`);
  const outDir = path.join(workDir, "out");
  const profileDir = path.join(workDir, "profile");

  try {
    await writeFile(inputPath, buffer);

    // LibreOffice writes `out/<basename>.pdf` — basename matches
    // the input file's basename without extension, so we control it
    // by naming the input `input.pptx` → output is `input.pdf`.
    const expectedOutPath = path.join(outDir, `input.${outExt}`);

    const args = [
      // pathToFileURL, not "file://" + path (2026-10-07): on Windows the
      // old form gave a backslash URL LibreOffice can't use (it failed with
      // "libpng error: Write Error"); this yields file:///C:/Users/... there
      // and the same file:///tmp/... as before on Linux.
      `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
      "--headless",
      "--norestore",
      "--nologo",
      "--nodefault",
      "--nofirststartwizard",
      "--convert-to",
      outExt,
      "--outdir",
      outDir,
      inputPath,
    ];

    let lastError: Error | null = null;
    for (const bin of CANDIDATE_BINS) {
      let run: { stdout: string; stderr: string };
      try {
        run = await execFileAsync(bin, args, { timeout: CONVERT_TIMEOUT_MS });
      } catch (err) {
        // ENOENT = the binary doesn't exist; try the next candidate.
        if (isMissingBinary(err)) {
          lastError = err instanceof Error ? err : new Error(String(err));
          continue;
        }
        // Other errors (timeout, non-zero exit code, malformed
        // PPTX) - bail with the actual error message.
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `LibreOffice conversion failed: ${message}`,
        );
      }

      // The binary ran, but LibreOffice exits 0 even when it cannot
      // load the input (e.g. the import filter's package isn't
      // installed) - it just prints the error and writes nothing. So
      // a missing output PDF here is a CONVERSION failure, and must
      // not fall through to the "not installed" branch below (that
      // misclassification shipped once: readFile's ENOENT looked
      // identical to spawn's). Surface LibreOffice's own output.
      try {
        return await readFile(expectedOutPath);
      } catch {
        const detail = [run.stderr, run.stdout]
          .map((s) => s.trim())
          .filter(Boolean)
          .join(" | ");
        throw new Error(
          `LibreOffice ran but produced no ${outExt.toUpperCase()} for the ${inputExt} input` +
            (detail ? `: ${detail}` : ""),
        );
      }
    }

    // None of the candidate binaries existed (never retried, see
    // missing-tool.ts).
    throw new MissingToolError(
      `LibreOffice is not installed on the server. To enable PPTX/DOCX uploads, ` +
        `install LibreOffice on the host:\n` +
        `  • macOS:  brew install --cask libreoffice\n` +
        `  • Linux:  apt-get install -y libreoffice-impress libreoffice-writer\n` +
        `Original error: ${lastError?.message ?? "no binary found"}`,
    );
  } finally {
    // Best-effort cleanup. force:true so an interrupted profile
    // dir (still-open file handles) doesn't leave files behind.
    await rm(workDir, { recursive: true, force: true }).catch(() => {
      /* swallowed — tmp will eventually GC */
    });
  }
}

/**
 * Heuristic: detect the "binary not found" error from execFile so
 * we can fall through to the next candidate name. Node's spawn
 * surfaces this as `err.code === "ENOENT"`.
 */
function isMissingBinary(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === "ENOENT";
}
