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
import { thinkingOffFor, toSdkThinking } from "@/lib/anthropic/model-thinking";

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

// "Replace all my photos" (owner, 2026-10-26): the redesign keeps logos and
// pictures that carry data, rebuilds every supporting picture as a new
// generated image, and drops the rest so the enhanced deck stays clean.
//   logo     kept, restyled to fit the deck (CARRIED_LOGO note)
//   support  generic photo, clip-art, cartoon, emoji, mascot: a generated image
//   screen   a screenshot of software: rebuilt as a clean mock-up (describeScreens)
//   data     chart, map, scan, a picture the slide's task is about
//   drop     words in a picture, arrows / shapes / frames, specific people or places
export type ReplaceRole = "logo" | "screen" | "support" | "data" | "drop";
export type ReplaceTag = { role: ReplaceRole; shows: string | null };

/** mediaKey -> its role in a replace-all redesign. Failure = no tags (every picture kept, as before). */
export async function tagReplacePictures(
  pictures: readonly { mediaKey: string; bytes: Buffer; context?: string }[],
): Promise<Map<string, ReplaceTag>> {
  const out = new Map<string, ReplaceTag>();
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
        `These pictures come from a slide deck that is being rebuilt with all-new pictures. Give each image one role:\n` +
        `- logo: the logo, emblem, seal or crest of an organisation, school, ministry or brand\n` +
        `- screen: a screenshot of software, a website or an app (a window, menu, ribbon, toolbar or dialog), with or without labels or callouts pointing at it\n` +
        `- data: a chart, graph, table, map, scanned document, infographic, poster, or a technical diagram whose details carry information; an example the slide talks about (a sample design, a sample page); also any picture the slide's activity or question is about (objects students must name, match, count or describe)\n` +
        `- support: a generic picture that only illustrates or decorates the point: a stock or mood photo, clip-art, a cartoon, a mascot, an emoji, a sticker or a generic scene, with no written words on it\n` +
        `- drop: anything else: a picture whose only content is a few written words in any language (a word in a shape, a title, a saying), an arrow, shape, frame, border or ornament, word art, or a photo of a specific real person or a named real place\n` +
        `When unsure between data and another role, answer data.\n` +
        `Also say what it shows in at most 6 plain English words.\n` +
        `Reply with one line per image, exactly: <number>|<logo, screen, data, support or drop>|<what it shows>`,
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
      const m = line.trim().match(/^(\d+)\s*\|\s*(logo|screen|data|support|drop)\s*\|\s*(.*)$/i);
      if (!m) continue;
      const item = list[Number(m[1]) - 1];
      if (!item) continue;
      const shows = m[3].replace(/[|"<>]/g, "").trim().slice(0, MAX_SHOWS_CHARS) || null;
      out.set(item.mediaKey, { role: m[2].toLowerCase() as ReplaceRole, shows });
    }
  } catch (err) {
    console.error("[carry] replace picture tagging failed:", err);
  }
  return out;
}

// Replace-all screenshots (owner, 2026-10-27): an old, soft interface
// screenshot is rebuilt as a clean mock-up in the deck's style. One vision call
// for the deck's screenshots: what to redraw, and every callout's words EXACTLY
// as written (Sonnet: Arabic interface text in small, soft screenshots is past
// Haiku). Failure = no descriptions: those screenshots stay as pictures.
const SCREEN_MODEL = "claude-sonnet-5-5";
const MAX_SCREENS = 12;
const MAX_SCREEN_CHARS = 900;

export async function describeScreens(
  pictures: readonly { mediaKey: string; bytes: Buffer }[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || pictures.length === 0) return out;
  const list = pictures.slice(0, MAX_SCREENS);
  try {
    const content: Anthropic.Messages.ContentBlockParam[] = [];
    for (let i = 0; i < list.length; i++) {
      const png = await sharp(list[i].bytes, { failOn: "none" })
        .resize(1400, 1400, { fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .png()
        .toBuffer();
      content.push({ type: "text", text: `Screenshot ${i + 1}:` });
      content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } });
    }
    content.push({
      type: "text",
      text:
        `Each screenshot will be redrawn as a simple, clean mock-up of the same interface. For each one write a short brief (at most 90 words) a designer can redraw from: ` +
        `the app or page, its main regions in order (top to bottom, start to end), the controls in each region by name, ` +
        `and EVERY callout, label or note drawn on the screenshot with its words copied exactly as written, in their own language, and which control it points to. ` +
        `Leave out anything not readable rather than guess. ` +
        `Reply with one block per screenshot, each starting with a line "### <number>".`,
    });
    const client = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 });
    const msg = await client.messages.create({
      model: SCREEN_MODEL,
      max_tokens: 600 + 320 * list.length,
      // A plain transcription job: thinking ate the budget and cut the
      // briefs mid-way (local test 2026-10-27, stop_reason max_tokens).
      thinking: toSdkThinking(thinkingOffFor(SCREEN_MODEL)),
      messages: [{ role: "user", content }],
    });
    const reply = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    for (const block of reply.split(/^###\s*/m)) {
      const m = block.match(/^(\d+)\s*\n([\s\S]+)$/);
      if (!m) continue;
      const item = list[Number(m[1]) - 1];
      // Latin digits only in what the user reads (house rule); no markdown.
      const brief = m[2]
        .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
        .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
        .replace(/\*\*/g, "")
        .replace(/[<>"]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_SCREEN_CHARS);
      if (item && brief) out.set(item.mediaKey, brief);
    }
  } catch (err) {
    console.error("[carry] screenshot description failed:", err);
  }
  return out;
}
