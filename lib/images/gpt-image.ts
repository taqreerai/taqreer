// gpt-image-2 wrapper — Phase 0 of context/images.md.
//
// Turns a textless prompt + a box aspect into a base64 PNG via OpenAI's
// Images API. The caller (Inngest, Phase 2) stores the bytes and patches
// the slide HTML's <img src>. This module does ONE thing: prompt → pixels.
//
// Why textless: image models (gpt-image-2 included) render text poorly —
// catastrophically so for Arabic. So every prompt is hard-guarded to
// forbid ALL typography; words always stay as real HTML overlaid on the
// box, never baked into the generated pixels.

import OpenAI from "openai";

export type ImageAspect = "landscape" | "portrait" | "square";

// gpt-image-2's supported output sizes, keyed by box aspect. The reserved
// box `cover`-crops whatever doesn't match exactly, so "nearest of three"
// is all we need. (16:9 decks → landscape heroes; 9:16 → portrait.)
const SIZE_FOR_ASPECT: Record<ImageAspect, "1536x1024" | "1024x1536" | "1024x1024"> = {
  landscape: "1536x1024",
  portrait: "1024x1536",
  square: "1024x1024",
};

// Appended to EVERY prompt. gpt-image-2 has no negative-prompt field, so
// the no-text instruction lives in the prompt string itself.
const TEXTLESS_GUARD =
  "Absolutely no text, words, letters, numbers, captions, labels, " +
  "watermarks, logos, signage, or UI of any kind anywhere in the image.";

const MODEL = "gpt-image-2";
const QUALITY = "medium";
// Images can take up to ~2 min on complex prompts; give the SDK headroom.
const TIMEOUT_MS = 120_000;

let client: OpenAI | null = null;
function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  if (!client) client = new OpenAI({ apiKey, timeout: TIMEOUT_MS });
  return client;
}

export type GeneratedImageResult = {
  /** Base64-encoded PNG (gpt-image-2 only ever returns base64, no URL). */
  b64: string;
  /** The size actually requested, e.g. "1536x1024". */
  size: string;
};

/**
 * Generate a single textless image for a reserved slide box.
 * Throws on API error or moderation rejection — the caller decides the
 * fallback (e.g. keep the box as a branded gradient).
 */
export async function generateImage(opts: {
  prompt: string;
  aspect: ImageAspect;
}): Promise<GeneratedImageResult> {
  const size = SIZE_FOR_ASPECT[opts.aspect];
  const prompt = `${opts.prompt.trim()} ${TEXTLESS_GUARD}`;

  const res = await getClient().images.generate({
    model: MODEL,
    prompt,
    size,
    quality: QUALITY,
    n: 1,
  });

  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error("gpt-image-2 returned no image data");
  return { b64, size };
}

// A failure is TRANSIENT (worth retrying) when it's a rate-limit, a server
// error, or a network/timeout blip — vs PERMANENT (a 400 / content-policy /
// moderation rejection) which will never recover, so we surface it at once.
function isTransientImageError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  if (typeof status === "number") return status === 429 || status >= 500;
  // SDK connection / timeout errors carry no HTTP status.
  const text = `${(err as { name?: string } | null)?.name ?? ""} ${
    err instanceof Error ? err.message : ""
  }`;
  return /timeout|timed out|connection|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up/i.test(
    text,
  );
}

/**
 * `generateImage` + automatic retry on TRANSIENT failures (429 rate-limit,
 * 5xx, network/timeout) with exponential backoff. Permanent failures
 * (content-policy / 400) re-throw immediately. This is what the warm-fill
 * and end-reconcile callers use so a single unlucky call doesn't leave a
 * permanent empty box (observed 2026-06-03: one box failed mid-deck while
 * three identical-theme prompts succeeded — a one-off 429).
 */
export async function generateImageWithRetry(
  opts: { prompt: string; aspect: ImageAspect },
  attempts = 3,
): Promise<GeneratedImageResult> {
  const backoffMs = [1500, 4000];
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await generateImage(opts);
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isTransientImageError(err)) throw err;
      await new Promise((r) => setTimeout(r, backoffMs[i] ?? 4000));
    }
  }
  throw lastErr;
}
