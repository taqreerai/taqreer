import { apiError } from "@/lib/api/error-message";
// Client helper: upload a presentation the user likes the LOOK of and get back the
// Anthropic file id the generator reads as the design reference. Same two calls
// the old /mimic page made for its design file: POST /api/extract (kind "mimic",
// role "design"), then poll GET /api/extract/[jobId] until the job completes.
// Used by /create's Templates tab ("Upload your own", 2026-10-15).

const POLL_INTERVAL_MS = 2_500;
const POLL_TIMEOUT_MS = 5 * 60 * 1_000;

export type DesignUploadResult = {
  anthropicFileId: string;
  colors: string[];
  format: "16:9" | "9:16";
};

type StatusBody =
  | { status: "queued" | "processing" }
  | { status: "failed"; error?: string }
  | {
      status: "completed";
      result: { anthropicFileId: string; colors?: string[]; format?: "16:9" | "9:16" };
    };

/**
 * Upload + analyse the reference deck. Rejects with an Error whose message is the
 * server's extract error code/text (callers map it with useErrorText), or
 * a DOMException named "AbortError" when `signal` aborts.
 */
export async function uploadDesignReference(
  file: File,
  signal: AbortSignal,
): Promise<DesignUploadResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("kind", "mimic");
  formData.append("mimicRole", "design");
  formData.append("format", "16:9");
  const start = await fetch("/api/extract", { method: "POST", body: formData, signal });
  if (!start.ok) {
    throw await apiError(start, `Upload failed (${start.status})`);
  }
  const { jobId } = (await start.json()) as { jobId?: string };
  if (!jobId) throw new Error("No jobId returned from /api/extract");

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const res = await fetch(`/api/extract/${jobId}`, { signal });
    if (!res.ok) {
      throw await apiError(res, `Status ${res.status}`);
    }
    const body = (await res.json()) as StatusBody;
    if (body.status === "completed") {
      return {
        anthropicFileId: body.result.anthropicFileId,
        colors: body.result.colors ?? [],
        format: body.result.format === "9:16" ? "9:16" : "16:9",
      };
    }
    if (body.status === "failed") throw new Error(body.error ?? "Extraction failed");
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error("Extraction timed out. Try a smaller file.");
}
