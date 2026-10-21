// Prompts for re-rolling ONE AI image box (2026-10-21; route:
// app/api/projects/[id]/slides/[slideKey]/images/[genid]/regen).
//
// An image's identity is (genid, hash(prompt, ref)), so the same prompt always
// resolves to the same stored image. "New version" therefore changes the prompt
// a little (an "alternative take N" line, which also nudges the model to a new
// composition) and "describe the change" lets Haiku fold a short request in the
// user's language into the English scene prompt. The user never has to edit
// the raw prompt (that stays behind "Advanced").

import Anthropic from "@anthropic-ai/sdk";
import { IMAGE_CREDITS_PER_IMAGE } from "@/lib/credits/cost";

// A re-rolled image costs what an image costs at generation.
export const IMAGE_REGEN_CREDITS = IMAGE_CREDITS_PER_IMAGE;
export const MAX_IMAGE_PROMPT_LEN = 1000;
export const MAX_IMAGE_CHANGE_LEN = 300;

const TAKE_RE = /\s*Alternative take (\d+) with a fresh composition and camera angle\.\s*$/;

/** The same idea, a different image: bump the trailing "alternative take" line. */
export function bumpVariant(prompt: string): string {
  const m = prompt.match(TAKE_RE);
  const base = m ? prompt.slice(0, m.index).trimEnd() : prompt.trimEnd();
  const n = m ? Number(m[1]) + 1 : 2;
  const line = ` Alternative take ${n} with a fresh composition and camera angle.`;
  return `${base.slice(0, MAX_IMAGE_PROMPT_LEN - line.length)}${line}`;
}

/** Fold the user's short change request into the scene prompt (Haiku; append on failure). */
export async function mergeImageChange(prompt: string, change: string): Promise<string> {
  const base = prompt.replace(TAKE_RE, "").trim();
  const fallback = `${base} Change: ${change}.`.slice(0, MAX_IMAGE_PROMPT_LEN);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallback;
  try {
    const client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 });
    const msg = await client.messages.create({
      model: "claude-haiku-5-5",
      max_tokens: 500,
      system:
        "You edit prompts for an image generation model. Rewrite the scene prompt so it applies the user's requested change (the request may be in any language) and keeps everything else: subject, style, palette, mood and framing unless the change says otherwise. " +
        "The result is ONE English paragraph under 120 words describing a photo or illustration with no text, letters, logos or watermarks in it. If the request asks for text in the image, leave that part out. Reply with the new prompt only.",
      messages: [{ role: "user", content: `Scene prompt:\n${base}\n\nRequested change:\n${change}` }],
    });
    const out = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .replace(/[–—]/g, ", ")
      .trim();
    return out.length >= 20 ? out.slice(0, MAX_IMAGE_PROMPT_LEN) : fallback;
  } catch {
    return fallback;
  }
}
