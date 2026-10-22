// "Redesign freely" (rework) decks: which carried pictures may be swapped.
//
// Owner rule (2026-10-22): in a rework, keep the pictures that ARE content
// (photos of real things, diagrams, charts, scans, anything with labels or
// text) and replace only those that do not fit the new deck's feel: generic
// clip-art, cartoons and decorative icons. Haiku looks at small thumbnails
// once per file; the generator may then leave a swappable picture out or put
// a generated image in its place. Any failure marks nothing swappable, so the
// deck keeps every picture (the safe side).

import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";

const MODEL = "claude-haiku-5-5";
const MAX_TAGGED = 40;

/** mediaKey -> true when the picture is generic clip-art / decoration. */
export async function findSwappablePictures(
  // context: the words on the slide the picture sits on, so a picture an
  // exercise asks about (appliances to name) reads as content, not clip-art.
  pictures: readonly { mediaKey: string; bytes: Buffer; context?: string }[],
): Promise<Set<string>> {
  const out = new Set<string>();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || pictures.length === 0) return out;
  const list = pictures.slice(0, MAX_TAGGED);
  try {
    const content: Anthropic.Messages.ContentBlockParam[] = [];
    for (let i = 0; i < list.length; i++) {
      const jpg = await sharp(list[i].bytes, { failOn: "none" })
        .resize(448, 448, { fit: "inside" })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 70 })
        .toBuffer();
      const said = list[i].context?.replace(/\s+/g, " ").trim().slice(0, 160);
      content.push({ type: "text", text: said ? `Image ${i + 1} (its slide says: "${said}"):` : `Image ${i + 1}:` });
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpg.toString("base64") } });
    }
    content.push({
      type: "text",
      text:
        `These pictures come from a slide deck that will be redesigned. For each image answer keep or swap:\n` +
        `- keep: a photo of a real person, place, object or event; a diagram, chart, map, table, scan or screenshot; anything with labels, arrows, numbers, or words written on it in any language (a quote, a title, a saying on a photo); a logo; anything a teacher or presenter would need as itself\n` +
        `- keep: any picture the slide's activity or question is about: objects students must name, list, match, count or describe (household appliances to list, tools to name), even when it is plain stock or clip-art\n` +
        `- swap: generic clip-art, a cartoon or mascot, a stock icon or sticker, a decorative frame, border or ornament, that only decorates and could be replaced by a different picture of the same idea\n` +
        `When unsure, answer keep.\n` +
        `Also say whether the image has any written words on it (any language, any size, including a title or a saying).\n` +
        `Reply with one line per image, exactly: <number>|<words: yes or no>|<keep or swap>`,
    });
    const client = new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 600 + 16 * list.length,
      thinking: { type: "disabled" },
      messages: [{ role: "user", content }],
    });
    const reply = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    for (const line of reply.split("\n")) {
      const m = line.trim().match(/^(\d+)\s*\|\s*(yes|no)\s*\|\s*(keep|swap)\b/i);
      if (!m) continue;
      const item = list[Number(m[1]) - 1];
      // Written words make it content, whatever the overall call (Haiku called
      // a key photo with a saying on it "swap" while told to keep text).
      if (item && m[2].toLowerCase() === "no" && m[3].toLowerCase() === "swap") out.add(item.mediaKey);
    }
  } catch (err) {
    console.error("[carry] rework picture tagging failed:", err);
  }
  return out;
}
