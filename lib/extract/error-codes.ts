// Shared classification of source-extract failures into stable codes
// the UI can localize. Lives in ONE place because the matching is by
// message text: the server routes stamp `errorCode` from it, and the
// client flows fall back to it for messages that arrive without a
// code (older failed Job rows, HTTP-layer errors).
//
// The patterns are bound to the throw sites they match:
//   file_too_large    — Supabase storage's EntityTooLarge rejection
//                       ("The object exceeded the maximum allowed
//                       size") in POST /api/extract's staging upload.
//   pdf_encrypted     — lib/extract/index.ts's PDFDocument.load
//                       wrapper ("password-protected" / pdf-lib's
//                       "is encrypted").
//   conversion_failed — lib/extract/pptx-to-pdf.ts's LibreOffice
//                       errors ("LibreOffice ... produced no PDF" /
//                       "LibreOffice conversion failed").
//   upload_interrupted — POST /api/extract when the multipart body
//                       arrived cut off ("Upload interrupted").
//   start_failed      — POST /api/extract's catch-all / enqueue
//                       failure ("Failed to start extraction").
// Changing wording at any of those sites means updating the pattern
// here in the same pass.
//
// Client-safe: no Node imports.

export type ExtractErrorCode =
  | "file_too_large"
  | "pdf_encrypted"
  | "conversion_failed"
  | "upload_interrupted"
  | "start_failed";

export function classifyExtractError(
  message: string | null | undefined,
): ExtractErrorCode | null {
  if (!message) return null;
  if (/exceeded the maximum allowed size|payload too large/i.test(message)) {
    return "file_too_large";
  }
  // Producer-stable phrases only (CR PR #190): a generic /password/
  // would swallow unrelated errors, and matching every "LibreOffice"
  // mention would hide the "not installed" message whose remedy is a
  // server-side install, not a user retry.
  if (/PDFDocument\.load.*is encrypted|password-protected/i.test(message)) {
    return "pdf_encrypted";
  }
  if (/LibreOffice (conversion failed|ran but produced no PDF)/i.test(message)) {
    return "conversion_failed";
  }
  if (/^Upload interrupted/i.test(message)) return "upload_interrupted";
  if (/^Failed to start extraction/i.test(message)) return "start_failed";
  return null;
}
