// A required host program (LibreOffice, poppler's pdftoppm) is not installed
// (2026-10-07). Retrying can never fix that, so the Inngest functions turn
// it into a NonRetriableError: the job fails at once instead of sitting on a
// stuck progress bar through every retry and backoff.
export class MissingToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingToolError";
  }
}
