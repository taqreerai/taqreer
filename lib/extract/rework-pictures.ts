// "Redesign freely" (rework) decks: what each carried picture shows, and which
// ones may be swapped.
//
// Owner rule (2026-10-22): in a rework, keep the pictures that ARE content
// (photos of real things, diagrams, charts, scans, anything with labels or
// text, anything the slide's activity is about) and replace only those that
// do not fit the new deck's feel: generic clip-art, cartoons and decorative
// icons. Haiku looks at each picture once per file. It also names what the
// picture shows, so the redesign can match a slide's labels to the right
// pictures (a local test paired "car" with a calculator when every picture
// was just "Picture N"). Any failure tags nothing: every picture is kept and
// listed as before (the safe side).

import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";

const MODEL = "claude-haiku-5-5";
const MAX_TAGGED = 80;
const MAX_SHOWS_CHARS = 80;

export type PictureTag = { swap: boolean; shows: string | null };

/** mediaKey -> whether it may be swapped, and what it shows. */
export async function tagReworkPictures(
  // context: the words on the slide the picture sits on, so a picture an
  // exercise asks about (appliances to name) reads as content, not clip-art.
  pictures: readonly { mediaKey: string; bytes: Buffer; context?: string }[],
): Promise<Map<string, PictureTag>> {
  const out = new Map<string, PictureTag>();
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
        `- swap: generic clip-art, a cartoon or mascot, a stock icon or sticker, a decorative frame, border, texture or ornament, that only decorates and could be replaced by a different picture of the same idea\n` +
        `When unsure, answer keep.\n` +
        `Also say whether the image has any written words on it (any language, any size, including a title or a saying), ` +
        `and what it shows in at most 6 plain English words ` +
        `(one object: its name; several objects in one picture: "group: " and their names; a blank or texture: "blank").\n` +
        `Reply with one line per image, exactly: <number>|<words: yes or no>|<keep or swap>|<what it shows>`,
    });
    const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 600 + 40 * list.length,
      thinking: { type: "disabled" },
      messages: [{ role: "user", content }],
    });
    const reply = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    for (const line of reply.split("\n")) {
      const m = line.trim().match(/^(\d+)\s*\|\s*(yes|no)\s*\|\s*(keep|swap)\s*\|\s*(.*)$/i);
      if (!m) continue;
      const item = list[Number(m[1]) - 1];
      if (!item) continue;
      const shows = m[4].replace(/[|"<>]/g, "").trim().slice(0, MAX_SHOWS_CHARS) || null;
      // Written words make it content, whatever the overall call (Haiku called
      // a key photo with a saying on it "swap" while told to keep text).
      out.set(item.mediaKey, { swap: m[2].toLowerCase() === "no" && m[3].toLowerCase() === "swap", shows });
    }
  } catch (err) {
    console.error("[carry] rework picture tagging failed:", err);
  }
  return out;
}
