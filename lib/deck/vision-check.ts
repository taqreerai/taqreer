// Vision detector — the "eyes" half of the see-and-fix loop
// (context/plan-create-feedback-loop.md). The geometry detector (validate-layout)
// only catches overflow; the bugs that actually hurt — invisible/low-contrast
// text, "looks empty" dividers, misalignment — are SUBJECTIVE and only a human
// (or a vision model) can see them. So: WE render each slide in headless
// Chromium and screenshot it, then hand the PNG to Claude via a plain
// Messages-API IMAGE input and ask "anything broken?". No Agent SDK, no
// autonomous browser — we're the eyes-and-hands, the model is the judgment.

import puppeteer from "puppeteer";
import type Anthropic from "@anthropic-ai/sdk";
import { buildHtmlDocumentServer } from "@/lib/export/html-document-server";
import { dimensionsForFormat, type SlideManifest } from "@/lib/schema/slide";

export type SlideShot = { slideId: string; pngBase64: string };
export type VisionVerdict = { slideId: string; ok: boolean; issues: string[]; raw: string };

const NETWORK_IDLE_TIMEOUT_MS = 30_000;

// Render the deck once and screenshot every slide, clipped to its W×H frame.
// Same Chromium path as thumbnail-render / the geometry validator.
export async function renderSlideShots(
  manifest: SlideManifest,
): Promise<SlideShot[]> {
  const { width, height } = dimensionsForFormat(manifest.format);
  const html = buildHtmlDocumentServer(manifest);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height: height + 1, deviceScaleFactor: 1 });
    await page.setContent(html, {
      waitUntil: ["domcontentloaded", "networkidle0"],
      timeout: NETWORK_IDLE_TIMEOUT_MS,
    });
    await page.evaluate(
      () =>
        (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts
          ?.ready ?? Promise.resolve(),
    );

    const shots: SlideShot[] = [];
    for (const slide of manifest.slides) {
      // Scroll the slide into view (single-slide viewport), measure its DOC-coord
      // box, clip the screenshot to it. (Same coord-space handling as
      // thumbnail-render: getBoundingClientRect is viewport-relative; add scroll
      // back for page.screenshot's document-coord clip.)
      const bbox = await page.evaluate((id: string) => {
        const el = document.querySelector(`[data-slide-id="${id}"]`);
        if (!el) return null;
        el.scrollIntoView({ block: "start", inline: "start" });
        const r = el.getBoundingClientRect();
        return {
          x: r.x + window.scrollX,
          y: r.y + window.scrollY,
          width: r.width,
          height: r.height,
        };
      }, slide.slideId);
      if (!bbox) continue;
      const buf = await page.screenshot({
        clip: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
        type: "png",
      });
      shots.push({
        slideId: slide.slideId,
        pngBase64: Buffer.from(buf).toString("base64"),
      });
    }
    return shots;
  } finally {
    await browser.close();
  }
}

const VISION_PROMPT = `You are a meticulous presentation-design reviewer. The attached image is ONE slide (1920×1080) from a deck, rendered EXACTLY as the viewer sees it. Flag only CLEAR visual defects a designer would never ship:
- text that is invisible or very low-contrast against what is behind it
- content cut off or running off the slide edges
- elements overlapping / colliding so text is unreadable
- a large empty or broken-looking area where content clearly should be
- badly misaligned blocks (e.g. a heading shoved to the wrong side)

Do NOT flag subjective taste — colour choices, which font, how "nice" or "creative" it looks, or minor spacing. Only concrete defects that make the slide look broken.

Respond with ONLY a JSON object and nothing else: {"ok": true} if the slide is clean, or {"ok": false, "issues": ["short defect description", ...]}.`;

// Ask Claude to judge ONE slide screenshot. Returns {ok, issues}. Parsing is
// lenient — a non-JSON reply collapses to ok:true (fail-open: never block a
// deck on a flaky judge response), with the raw text kept for debugging.
export async function visionCheckSlide(
  client: Anthropic,
  model: string,
  pngBase64: string,
): Promise<{ ok: boolean; issues: string[]; raw: string }> {
  const res = await client.messages.create({
    model,
    max_tokens: 400,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: pngBase64 },
          },
          { type: "text", text: VISION_PROMPT },
        ],
      },
    ],
  });
  const raw = res.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
  try {
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")) as {
      ok?: boolean;
      issues?: unknown;
    };
    return {
      ok: parsed.ok !== false,
      issues: Array.isArray(parsed.issues)
        ? parsed.issues.filter((i): i is string => typeof i === "string")
        : [],
      raw,
    };
  } catch {
    return { ok: true, issues: [], raw };
  }
}
