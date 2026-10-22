// Language of a source with no text layer, read by Haiku off its first pages.
//
// detectPptxLanguage / detectStringLanguage count characters, so a PPTX whose
// slides are pasted screenshots or a scanned PDF gives them nothing and the
// Enhance page fell back to "ar": a French deck was built right-to-left in the
// Arabic font (prod 2026-10-22, 38 picture-only slides). This looks at the
// pages instead. "en" stands for any Latin-script language (the deck is
// left-to-right), matching the text detectors. Null on any failure, so the
// caller keeps its old default.

import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";

const SAMPLE_PAGES = 3;

export async function detectLanguageFromPages(
  pdfBytes: Uint8Array,
): Promise<"ar" | "en" | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const src = await PDFDocument.load(pdfBytes);
    const n = Math.min(SAMPLE_PAGES, src.getPageCount());
    if (n === 0) return null;
    const sample = await PDFDocument.create();
    const pages = await sample.copyPages(src, Array.from({ length: n }, (_, i) => i));
    pages.forEach((p) => sample.addPage(p));
    const data = Buffer.from(await sample.save()).toString("base64");

    const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
    const msg = await client.messages.create({
      model: "claude-haiku-5-5",
      max_tokens: 10,
      system:
        "You identify the script of the main text on presentation pages. Reply with exactly one word: " +
        "ar if most of the text is Arabic script, en if most of it is Latin script (English, French, Spanish and so on), none if the pages carry almost no text.",
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data } },
            { type: "text", text: "Which script is the main text written in?" },
          ],
        },
      ],
    });
    const out = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim()
      .toLowerCase();
    if (/^ar\b/.test(out)) return "ar";
    if (/^en\b/.test(out)) return "en";
    return null;
  } catch (err) {
    console.error("[extract] vision language check failed:", err);
    return null;
  }
}
