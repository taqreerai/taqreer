// Editor assistant (2026-10-21): the studio's "Assistant" tab. The user asks a
// question or describes a change, scoped to an area, a slide or the whole deck.
// Haiku reads a text digest of the deck and replies with an answer and, when
// the request is an edit, a proposal (instruction + target slides). The route
// prices the proposal and the user confirms; applying it creates forAi
// comments for exactly those slides and runs the normal partial regen
// (lib/api/partial-regen.ts), so pricing, versioning and realtime are unchanged.
//
// Questions are free (Haiku, capped per user per day); only applied edits
// cost points.

import Anthropic from "@anthropic-ai/sdk";
import { tracked } from "@/lib/anthropic/usage-log";
import type { CreditGate402 } from "@/lib/api/regen-helpers";
import { scanGenImages } from "@/lib/images/slide-images";
import { PICTURE_ASSET_ID_RE, pictureTextInstruction } from "@/lib/assistant/picture-text";

export const ASSISTANT_MODEL = "claude-haiku-5-5";
export const ASSISTANT_DAILY_CAP = 30;
const MAX_SLIDE_CHARS = 500;
const MAX_DIGEST_CHARS = 16000;

export type AssistantScope =
  | { kind: "deck" }
  | { kind: "slide"; slideId: string }
  | { kind: "area"; slideId: string; bounds: { x: number; y: number; w: number; h: number } };

export type AssistantProposal = {
  instruction: string;
  slideIds: string[];
  slideNumbers: number[];
  cost: number;
  bounds: { x: number; y: number; w: number; h: number } | null;
  // "image": re-roll ONE AI image (genid) with a described change; it runs
  // through the image regen route from the studio, not the partial regen.
  kind?: "slides" | "image";
  genid?: string;
  change?: string;
  // Why it can't run as is (free plan, or not enough points); null = it can.
  gate: CreditGate402 | null;
  versionId?: string;
};

export type AssistantReply = {
  reply: string;
  // An edit to run on existing slides (1-based slide numbers of the deck).
  edit: { instruction: string; slides: number[] } | null;
  // A different picture for ONE AI image (its id from the digest).
  image: { slide: number; genid: string; change: string } | null;
  // Turn the words in ONE of the user's own pictures into slide text
  // (lib/assistant/picture-text.ts); becomes `edit` in askAssistant.
  pictureText?: { slide: number; asset: string } | null;
};

/** The user's own pictures on a slide: id, and whether it holds words. */
function userPictures(html: string): { id: string; words: boolean }[] {
  const out: { id: string; words: boolean }[] = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const id = m[0].match(/\sdata-asset\s*=\s*"([^"]+)"/i)?.[1];
    if (id && PICTURE_ASSET_ID_RE.test(id)) out.push({ id, words: /\sdata-asset-text\s*=/i.test(m[0]) });
  }
  return out;
}

/** The visible text of one slide's html, collapsed and bounded. */
export function slideText(html: string): string {
  return html
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function deckDigest(slides: readonly { html: string }[], pictureNotes?: ReadonlyMap<string, string>): string {
  let out = "";
  for (let i = 0; i < slides.length; i++) {
    const label = slides[i].html.match(/data-label="([^"]{0,60})"/)?.[1] ?? "";
    const pics = (slides[i].html.match(/<img\b/gi) ?? []).length;
    const ai = scanGenImages(slides[i].html)
      .map((g) => ` [AI image ${g.genid}: ${g.prompt.slice(0, 90)}]`)
      .join("");
    const own = userPictures(slides[i].html)
      .map((p) => {
        const shows = pictureNotes?.get(p.id)?.replace(/[\[\]\n]/g, " ");
        return ` [user picture ${p.id}${shows ? `: ${shows}` : ""}${p.words ? ", has words" : ""}]`;
      })
      .join("");
    let text = slideText(slides[i].html);
    if (text.length > MAX_SLIDE_CHARS) text = `${text.slice(0, MAX_SLIDE_CHARS)}...`;
    const line = `Slide ${i + 1}${label ? ` (${label})` : ""}${pics ? ` [${pics} picture${pics > 1 ? "s" : ""}]` : ""}${ai}${own}: ${text || "(no text)"}\n`;
    if (out.length + line.length > MAX_DIGEST_CHARS) {
      out += `(slides ${i + 1} to ${slides.length} omitted for length)\n`;
      break;
    }
    out += line;
  }
  return out;
}

// What the studio can do, so how-to questions get a real answer. Keep in step
// with the toolbar (dictionaries editor.toolbar) when it changes.
const PRODUCT_HELP = `Taqreer studio, where things are (Arabic UI label in brackets; name buttons in the user's language):
- Top bar, far end: Export [تصدير] (PowerPoint, PDF, PNG images) and Share [مشاركة] (invite people with view, comment or edit access, or a public link).
- Bottom toolbar: Edit [تحرير] mode (click any text to type, drag to move; a style pill changes font, size and colour), AI [ذكاء] mode (drag a box on the slide and type a change for that area), Redesign this slide [أعد تصميم الشريحة], Redesign all [أعد تصميم الكل], Undo [تراجع] / Redo [إعادة], Add text [إضافة نص], Comments [إضافة تعليق], Version history [سجل الإصدارات] (restore any earlier version), Deck colours [ألوان العرض], Deck font [خط العرض], Save [حفظ].
- Right panel: Slides [الشرائح] (the list, click to open a slide) and Comments [التعليقات] for collaborators.
- Left panel: Layers [الطبقات] (every element of the slide; lock or hide one) and this Assistant.
- A slide can be locked against AI changes (lock icon); locked slides are never edited by the AI.
- Pictures: click a picture to replace it with an upload, switch Fill / Show whole, or (paid plans) Enhance with AI.
- NOT available in the studio: adding, deleting, duplicating or reordering slides. Say so plainly; suggest instead a new deck from the Create page, or reusing an existing slide's space for the new content (which you can do as an edit).
- Points: AI edits after generation cost points per slide changed, a new AI image costs points per image; questions to this assistant are free.`;

function systemPrompt(language: "ar" | "en"): string {
  return `You are the assistant inside Taqreer's presentation editor. The user is looking at their deck and either asks a question or describes a change.

You can do two things:
1. ANSWER: questions about the deck (is slide 4 too wordy? what is missing? is the story clear?), advice, or how to do something in the editor (use the product notes below; never invent a feature).
2. PROPOSE AN EDIT: a change to the content or design of EXISTING slides (rewrite, shorten, translate, change the tone, restyle, rearrange elements on a slide, fix a typo, make a slide more visual). The system rewrites each target slide with your instruction; the user sees the price and confirms first.

3. CHANGE AN AI IMAGE: when the user wants a different picture for an image listed as [AI image ID], propose an image change: the slide number, that ID, and the change in a few words (the user's own words are fine; "a new version" when they just want another one). Only [AI image ...] entries can be changed this way; for the user's own pictures, tell them to click the picture and use Replace.

4. PICTURE WORDS TO TEXT: when the user says the words in one of their own pictures (listed as [user picture ID], often "has words") are too small, hard to read, or should be editable text, propose turning that picture's words into real slide text: the slide number and that ID. The picture is then taken off the slide and its words rebuilt as text, so say so in the reply. Only for [user picture ...] entries; ask which one when the slide has several and the user did not say.

You CANNOT add, delete, duplicate or reorder slides, change the deck's colours or font for the whole deck, export, share or upload: for those, ANSWER with where to do it in the editor.

Scope: the message says which part the user selected. "area" or "slide" means that ONE slide; "deck" means you choose the slides the request is about (every slide when it is about the whole deck, only the named ones when the user names slides).

Write the reply in the language the user writes in (their interface is ${language === "ar" ? "Arabic" : "English"}). Keep it short: 1 to 4 sentences, no markdown headings. Use Latin digits (0-9) only, and never use the em dash or en dash characters.

The edit instruction is for the slide designer model, in English, specific and self-contained (what to change, what to keep). Never invent facts, numbers or names in an instruction.

Reply with ONLY a JSON object, no prose around it:
{"reply": "<what you tell the user>", "edit": null}
or
{"reply": "<one sentence: what will change>", "edit": {"instruction": "<instruction>", "slides": [<1-based slide numbers>]}}
or
{"reply": "<one sentence: what the new picture will be>", "edit": null, "image": {"slide": <1-based slide number>, "id": "<AI image ID>", "change": "<the change>"}}
or
{"reply": "<one sentence: the picture's words become slide text and the picture is removed>", "edit": null, "pictureText": {"slide": <1-based slide number>, "id": "<user picture ID>"}}

${PRODUCT_HELP}`;
}

function parseReply(raw: string, slideCount: number): AssistantReply | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const o = obj as { reply?: unknown; edit?: unknown; image?: unknown; pictureText?: unknown };
  if (typeof o.reply !== "string" || !o.reply.trim()) return null;
  const reply = o.reply.replace(/[–—]/g, ", ").trim().slice(0, 2000);
  let edit: AssistantReply["edit"] = null;
  const e = o.edit as { instruction?: unknown; slides?: unknown } | null | undefined;
  if (e && typeof e.instruction === "string" && e.instruction.trim() && Array.isArray(e.slides)) {
    const slides = [...new Set(e.slides.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= slideCount))].sort((a, b) => a - b);
    if (slides.length > 0) edit = { instruction: e.instruction.trim().slice(0, 1500), slides };
  }
  let image: AssistantReply["image"] = null;
  const im = o.image as { slide?: unknown; id?: unknown; change?: unknown } | null | undefined;
  if (
    !edit &&
    im &&
    Number.isInteger(im.slide) &&
    (im.slide as number) >= 1 &&
    (im.slide as number) <= slideCount &&
    typeof im.id === "string" &&
    /^[A-Za-z0-9._-]{1,64}$/.test(im.id)
  ) {
    const change = typeof im.change === "string" && im.change.trim() ? im.change.trim().slice(0, 300) : "a new version";
    image = { slide: im.slide as number, genid: im.id, change };
  }
  let pictureText: AssistantReply["pictureText"] = null;
  const pt = o.pictureText as { slide?: unknown; id?: unknown } | null | undefined;
  if (
    !edit &&
    !image &&
    pt &&
    Number.isInteger(pt.slide) &&
    (pt.slide as number) >= 1 &&
    (pt.slide as number) <= slideCount &&
    typeof pt.id === "string" &&
    PICTURE_ASSET_ID_RE.test(pt.id)
  ) {
    pictureText = { slide: pt.slide as number, asset: pt.id };
  }
  return { reply, edit, image, pictureText };
}

export async function askAssistant(args: {
  slides: readonly { html: string }[];
  // assetId -> what the picture shows (from the Enhance analysis).
  pictureNotes?: ReadonlyMap<string, string>;
  scope: AssistantScope;
  scopeSlideNumber: number | null; // 1-based, for slide / area scopes
  message: string;
  history: readonly { role: "user" | "assistant"; content: string }[];
  language: "ar" | "en";
}): Promise<AssistantReply> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("assistant: no API key");
  const scopeLine =
    args.scope.kind === "deck"
      ? "Scope: deck (the whole presentation)."
      : `Scope: ${args.scope.kind} on slide ${args.scopeSlideNumber}${args.scope.kind === "area" ? " (the user drew a box around one area of that slide; the edit applies to that area)" : ""}.`;
  const client = tracked(new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 }), "assistant");
  const messages: Anthropic.Messages.MessageParam[] = [
    {
      role: "user",
      content: `THE DECK (${args.slides.length} slides, text only):\n${deckDigest(args.slides, args.pictureNotes)}`,
    },
    { role: "assistant", content: "Understood. I have the deck." },
    // Recent turns, so "do the same for slide 5" works.
    ...args.history.slice(-6).map((m) => ({ role: m.role, content: m.content.slice(0, 1500) })),
    { role: "user", content: `${scopeLine}\nUser message: ${args.message}` },
  ];
  // The API needs alternating roles: merge consecutive same-role turns.
  const merged: Anthropic.Messages.MessageParam[] = [];
  for (const m of messages) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role) prev.content = `${prev.content as string}\n\n${m.content as string}`;
    else merged.push({ ...m });
  }
  let parsed: AssistantReply | null = null;
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    const msg = await client.messages.create({
      model: ASSISTANT_MODEL,
      max_tokens: 1600,
      system: systemPrompt(args.language),
      messages: merged,
    });
    const raw = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    parsed = parseReply(raw, args.slides.length);
    if (!parsed) console.warn("assistant_unparseable", { attempt, stop: msg.stop_reason, chars: raw.length });
  }
  if (!parsed) throw new Error("assistant: unparseable reply");
  // Picture words to text: only a picture that is really on that slide (and
  // the selected one, for a slide / area scope); it runs as a one-slide edit.
  const pt = parsed.pictureText;
  if (pt) {
    parsed.pictureText = null;
    const onSlide = userPictures(args.slides[pt.slide - 1]?.html ?? "").some((p) => p.id === pt.asset);
    const inScope = args.scope.kind === "deck" || pt.slide === args.scopeSlideNumber;
    if (onSlide && inScope) parsed.edit = { instruction: pictureTextInstruction(pt.asset), slides: [pt.slide] };
  }
  // A slide / area scope pins the edit to that slide, whatever the model chose.
  if (parsed.edit && args.scope.kind !== "deck" && args.scopeSlideNumber) {
    parsed.edit.slides = [args.scopeSlideNumber];
  }
  // An image change outside the selected slide is dropped (the reply stays).
  if (parsed.image && args.scope.kind !== "deck" && parsed.image.slide !== args.scopeSlideNumber) {
    parsed.image = null;
  }
  return parsed;
}
