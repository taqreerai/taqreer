// Text of a repeated ribbon / badge picture, read by Haiku (2026-10-22).
//
// A decorative ribbon that says "Apply what you discovered" is one small
// picture reused on a few slides. Carried over as a picture it repeats, clips
// and cannot be restyled; dropped, its words are lost. classifyPptxPictures
// drops it ("ornament") and this reads the words, so the slide's text carries
// them and the generator rebuilds the ribbon in the deck's own style.
// Best-effort: any failure returns no labels and the slide simply goes without.

import Anthropic from "@anthropic-ai/sdk";
import JSZip from "jszip";
import { extractPptxVisuals, classifyPptxPictures } from "@/lib/extract/pptx-visuals";

const MAX_MEDIA = 6;
const MAX_LABEL_CHARS = 40;
const MEDIA_TYPES: Record<string, "image/png" | "image/jpeg" | "image/gif" | "image/webp"> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

async function readLabel(client: Anthropic, mediaType: string, data: string): Promise<string | null> {
  const msg = await client.messages.create({
    model: "claude-haiku-5-5",
    max_tokens: 400, // room for the model's own thinking before the text
    system:
      "You transcribe the short text written on a ribbon, badge or button image. Reply with only that text exactly as written, on one line. Reply NONE if the image has no readable words.",
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType as "image/png", data } },
          { type: "text", text: "What does it say?" },
        ],
      },
    ],
  });
  const text = msg.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || /^none\b/i.test(text) || text.length > MAX_LABEL_CHARS) return null;
  return text;
}

/** Source slide index -> the label texts of its dropped ornament pictures. */
export async function readOrnamentLabels(buffer: Buffer): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return out;
  try {
    const visuals = await extractPptxVisuals(buffer);
    const classes = classifyPptxPictures(visuals);
    const slidesByMedia = new Map<string, Set<number>>();
    for (const p of visuals.pictures) {
      if (classes.get(p) !== "ornament") continue;
      (slidesByMedia.get(p.mediaPath) ?? slidesByMedia.set(p.mediaPath, new Set()).get(p.mediaPath)!).add(p.slideIndex);
    }
    if (slidesByMedia.size === 0) return out;
    const zip = await JSZip.loadAsync(buffer);
    const client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 });
    for (const [media, slides] of [...slidesByMedia].slice(0, MAX_MEDIA)) {
      const mediaType = MEDIA_TYPES[media.split(".").pop()?.toLowerCase() ?? ""];
      const file = zip.files[media];
      if (!mediaType || !file) continue;
      const bytes = await file.async("nodebuffer");
      if (bytes.length > 3_000_000) continue;
      const label = await readLabel(client, mediaType, bytes.toString("base64")).catch(() => null);
      if (!label) continue;
      for (const slide of slides) (out.get(slide) ?? out.set(slide, []).get(slide)!).push(label);
    }
  } catch (err) {
    console.error("[extract] ornament labels failed:", err);
  }
  return out;
}
