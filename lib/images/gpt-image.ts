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

import { findStockPhoto } from "@/lib/images/pexels";
import { mustNotGenerate } from "@/lib/images/never-generate";
import OpenAI, { toFile } from "openai";

import { isAllowedProductRefUrl } from "@/lib/images/product-ref";
import { logImageUsage } from "@/lib/anthropic/usage-log";

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

// Product-reference variant of the guard: the supplied photo IS the
// subject, and real products carry printed labels/branding that must
// survive faithfully - so the blanket "no logos" rule would fight the
// input. Forbid only ADDED typography around it.
const PRODUCT_GUARD =
  "Feature the supplied product photo as the subject: keep the product " +
  "exactly faithful in shape, proportions, colors, materials, and any " +
  "label or text printed on the product itself. Add no other text, words, " +
  "letters, numbers, captions, watermarks, logos, signage, or UI anywhere " +
  "else in the image.";

// Reference-photo fetch bounds: the pipeline downloads the product photo
// from OUR public uploads prefix (isAllowedProductRefUrl) before handing
// it to images.edit. Upload route caps files at 10MB; mirror it here.
const REF_FETCH_TIMEOUT_MS = 20_000;
const REF_MAX_BYTES = 10 * 1024 * 1024;

const MODEL = "gpt-image-2";
const QUALITY = "medium";
export type ImageQuality = "low" | "medium";
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

// Download the product reference photo for an images.edit call. Refuses
// anything outside our public uploads prefix (data-genref lives in
// user-editable slide HTML - an arbitrary URL here would be SSRF).
async function fetchReferenceImage(url: string): Promise<{
  bytes: Buffer;
  type: string;
}> {
  if (!isAllowedProductRefUrl(url)) {
    throw new Error("Reference image URL is not an allowed uploads URL");
  }
  const res = await fetch(url, {
    signal: AbortSignal.timeout(REF_FETCH_TIMEOUT_MS),
    redirect: "error",
  });
  if (!res.ok) {
    throw new Error(`Reference image fetch failed: ${res.status}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > REF_MAX_BYTES) {
    throw new Error(`Reference image size out of bounds: ${bytes.byteLength}`);
  }
  return { bytes, type: res.headers.get("content-type") ?? "image/png" };
}

/**
 * Generate a single textless image for a reserved slide box.
 * With `referenceUrl` (a product photo), the call switches to
 * `images.edit` so gpt-image composes the scene AROUND the supplied
 * photo instead of imagining a product from text.
 * Throws on API error or moderation rejection — the caller decides the
 * fallback (e.g. keep the box as a branded gradient).
 */
export async function generateImage(opts: {
  prompt: string;
  aspect: ImageAspect;
  referenceUrl?: string | null;
  // "low" for free accounts' few AI images (lib/images/image-source.ts).
  quality?: ImageQuality;
}): Promise<GeneratedImageResult> {
  const size = SIZE_FOR_ASPECT[opts.aspect];

  if (opts.referenceUrl) {
    const ref = await fetchReferenceImage(opts.referenceUrl);
    const image = await toFile(ref.bytes, "product.png", { type: ref.type });
    // NO input_fidelity: the SDK types allow it but the gpt-image-2 API
    // rejects it with a 400 ("does not support the 'input_fidelity'
    // parameter") - every product box in the 2026-08-08 launch decks
    // failed on exactly this. Product faithfulness rides PRODUCT_GUARD.
    const res = await getClient().images.edit({
      model: MODEL,
      image,
      prompt: `${opts.prompt.trim()} ${PRODUCT_GUARD}`,
      size,
      quality: opts.quality ?? QUALITY,
      n: 1,
    });
    logImageUsage("image-product", `${MODEL}:${opts.quality ?? QUALITY}`, res.usage);
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) throw new Error("gpt-image-2 returned no image data");
    return { b64, size };
  }

  const res = await getClient().images.generate({
    model: MODEL,
    prompt: `${opts.prompt.trim()} ${TEXTLESS_GUARD}`,
    size,
    quality: opts.quality ?? QUALITY,
    n: 1,
  });
  logImageUsage("image-gen", `${MODEL}:${opts.quality ?? QUALITY}`, res.usage);

  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error("gpt-image-2 returned no image data");
  return { b64, size };
}

// A failure is TRANSIENT (worth retrying) when it's a rate-limit, a server
// error, or a network/timeout blip — vs PERMANENT (a 400 / content-policy /
// moderation rejection) which will never recover, so we surface it at once.
// Enhance (owner rule 2026-10-15): an original photo may be enhanced, never
// swapped. The model gets the photo itself and may only repair it.
const RESTORE_PROMPT =
  "Restore and enhance THIS exact photograph. Keep the same scene, subject, " +
  "composition, framing, camera angle, people, faces, expressions, objects and " +
  "their positions. Fix fading, low contrast, colour casts, noise, blur, low " +
  "resolution and compression artefacts; recover natural colour and fine detail so " +
  "it looks like a sharp, well-exposed modern photo. Do not add, remove or move " +
  "anything, do not change any visible text, logo or sign, and do not turn it into " +
  "an illustration or change its style.";

/**
 * AI photo restoration (studio, user-initiated). Returns PNG bytes at one of
 * the model's sizes; the caller fits them back to the photo's own proportions.
 */
export async function restorePhoto(opts: {
  bytes: Buffer;
  contentType: string;
  aspect: number; // width / height of the original
}): Promise<GeneratedImageResult> {
  return editPhoto({ ...opts, prompt: RESTORE_PROMPT });
}

/** Model size closest to a picture's proportions. */
export function aspectForRatio(ratio: number): ImageAspect {
  return ratio > 1.2 ? "landscape" : ratio < 0.83 ? "portrait" : "square";
}

/**
 * Photo refresh (Enhance, opt-in): re-shoot a generic photo in the deck's
 * style, from the photo itself so the subject stays what the slide needs.
 */
export async function restylePhoto(opts: {
  bytes: Buffer;
  contentType: string;
  aspect: number;
  prompt: string;
}): Promise<GeneratedImageResult> {
  return editPhoto({ ...opts, prompt: `${opts.prompt.trim()} ${TEXTLESS_GUARD}` });
}

async function editPhoto(opts: {
  bytes: Buffer;
  contentType: string;
  aspect: number;
  prompt: string;
}): Promise<GeneratedImageResult> {
  const size = SIZE_FOR_ASPECT[aspectForRatio(opts.aspect)];
  const image = await toFile(opts.bytes, opts.contentType === "image/png" ? "photo.png" : "photo.jpg", {
    type: opts.contentType,
  });
  const res = await getClient().images.edit({
    model: MODEL,
    image,
    prompt: opts.prompt,
    size,
    quality: QUALITY,
    n: 1,
  });
  logImageUsage("photo-edit", `${MODEL}:${QUALITY}`, res.usage);
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error("gpt-image-2 returned no image data");
  return { b64, size };
}

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
  opts: { prompt: string; aspect: ImageAspect; referenceUrl?: string | null; stock?: boolean; quality?: ImageQuality },
  attempts = 3,
): Promise<GeneratedImageResult> {
  // A stock box: a real photo from Pexels (size "pexels:<id>"). With no key or
  // no result it falls back to the image model, except for subjects the model
  // must never draw (a flag): those fail and the box keeps its placeholder.
  if (opts.stock) {
    const photo = await findStockPhoto(opts.prompt, opts.aspect, opts.prompt);
    if (photo) {
      console.info("[images] stock photo", { query: opts.prompt.slice(0, 80), id: photo.size, photographer: photo.photographer });
      return { b64: photo.b64, size: photo.size };
    }
    if (mustNotGenerate(opts.prompt)) throw new Error("no stock photo found for a subject that is never generated");
  }
  // Clamp to ≥1 so a 0/negative `attempts` can't skip the loop and fall through
  // to `throw lastErr` while it's still undefined.
  const total = Math.max(1, Math.floor(attempts));
  const backoffMs = [1500, 4000];
  let lastErr: unknown;
  for (let i = 0; i < total; i++) {
    try {
      return await generateImage(opts);
    } catch (err) {
      lastErr = err;
      if (i === total - 1 || !isTransientImageError(err)) throw err;
      await new Promise((r) => setTimeout(r, backoffMs[i] ?? 4000));
    }
  }
  throw lastErr;
}
