import Anthropic from "@anthropic-ai/sdk";
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import {
  SLIDE_DIMENSIONS,
  SlideManifestSchema,
  type SlideFormat,
  type SlideManifest,
} from "@/lib/schema/slide";

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set in the runtime environment");
  }
  return new Anthropic({ apiKey });
}

// Focused system prompt for single-slide regen. We DON'T re-emit the full
// design rule set from deck-generate.ts — Claude already knows them from
// training and the active slide's existing HTML pins the local style. Instead
// we drill in on the things that go wrong in partial mode: producing only
// HTML (not JSON), matching the surrounding deck's chrome, and minimal-diff
// behaviour (don't redesign the whole slide if the comment only asked to
// change the headline colour). Canvas dims are format-aware so 9:16 decks
// regen at 1080×1920 instead of being silently downgraded to 16:9.
function buildPartialSystemPrompt(format: SlideFormat): string {
  const { width, height } = SLIDE_DIMENSIONS[format];
  return `You are regenerating ONE slide of an existing presentation. The rest of the deck is fixed — chrome (header row, footer row, brand mark, pagination), theme (palette, fonts, background), and slide-level margins stay locked.

OUTPUT — STRICT
- Return ONLY the new HTML for the active slide. No JSON. No markdown fences. No prose. No explanation.
- Start with the slide root element (typically a single \`<div style="position:relative; width:${width}px; height:${height}px; ...">…</div>\`). Inline \`<style>\` tags are allowed inside the slide HTML.
- Do NOT include <!DOCTYPE>, <html>, <head>, <body>. Slide body content only.

CANVAS — same as the rest of the deck
- ${width}×${height} fixed canvas (${format}). The slide root sets width:${width}px / height:${height}px.
- Set \`dir="rtl"\` or \`dir="ltr"\` on the slide root to match the deck's direction (the brief tells you which).
- Use the SAME slide-level margin (inset) as the sibling slides — read it off the SIBLING SLIDE EXCERPTS in the user message and replicate.

CHROME — match siblings exactly
- The deck's chrome is the visual signature that ties slides together: brand mark position, breadcrumb / kicker, pagination ("01 / 12"), footer text. Read the SIBLING SLIDE EXCERPTS, identify the chrome pattern, and reproduce it on this slide IN THE SAME POSITION AND STYLE.
- Pagination must say "(this slide's number) / (total slides)". Use the slide's role to decide whether chrome belongs (cover and closing slides often omit pagination / brand mark — check siblings to see what the deck does).

THEME — locked
- Use the same theme tokens (\`var(--primary)\`, \`var(--accent)\`, \`var(--brand-bg)\`, etc.) as the rest of the deck. Do not introduce new fonts or hex colours not present in the theme.

USER COMMENTS — apply faithfully, minimally
- Each comment carries a slide-space bounding box (x, y, w, h in 0..1920, 0..1080) pointing at the element the user wants changed. Use the box to disambiguate which element they meant.
- Apply only what the comment asks. If the comment says "make this headline bigger", scale 1.2-1.5×, not 3×. If it says "change colour", change just the colour. Aim for minimal diff from the existing slide.
- If the comment is ambiguous, prefer the conservative interpretation.
- If multiple comments conflict, the later one wins (comments are listed in submission order).

STATIC DELIVERABLE
- No animation, no transition, no \`:hover\`, no JavaScript. Same as the rest of the deck.

DESIGN RULES — keep what already works
- The active slide's existing HTML is your strongest style anchor. Match its font sizing scale, line-heights, padding rhythm, decorative SVG style. Don't drift to a different design vocabulary just because you're regenerating.
- For Arabic: keep \`line-height ≥ 1.5\` on bold Arabic ≥ 24 px (export glyph height is taller). Cards with Arabic content use \`padding\` not fixed \`height\`. Don't use \`letter-spacing\` on Arabic.
- Decorative graphics stay inline <svg>. Icons stay inline <svg> (not icon fonts).
- **Icons: use Lucide** (https://lucide.dev/icons) — inline \`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\` with the path data from lucide.dev. Material icons (https://fonts.google.com/icons) are an acceptable fallback. NEVER icon fonts.
- Webfont URLs must be on \`fonts.googleapis.com\` / \`fonts.gstatic.com\`.

DECORATIVE GRAPHICS — keep them relevant
- **Every graphic must mean something.** Don't add generic blobs, random circles, or vague decorative shapes that don't connect to the slide's idea. If you can't name what the shape represents in one phrase, cut it.
- Icons must match the concept on the card: a card about users gets a \`users\` icon, a security card gets a \`shield\` icon. Don't pick a random Lucide glyph because the card looks empty — pick one that names the idea.

Return ONLY the new slide HTML now.`;
}

// Trim a sibling slide's HTML to roughly the chrome-bearing prefix + suffix.
// Chrome typically lives in the first 600-800 chars (slide root style,
// header row, kicker) and the last 400-600 chars (footer, pagination, brand
// mark) — the body is what we want to drop. Returns a single string with an
// elision marker so Claude can see the truncation happened.
function sliceForChrome(html: string): string {
  if (html.length <= 1600) return html;
  const head = html.slice(0, 800);
  const tail = html.slice(-600);
  return `${head}\n  /* ... slide body elided (${html.length - 1400} chars) ... */\n${tail}`;
}

type Bounds = { x: number; y: number; w: number; h: number };
type CommentInput = {
  slideId: string;
  content: string;
  boundsJson: Bounds | null;
};

function buildPartialUserMessage(
  manifest: SlideManifest,
  targetSlideId: string,
  comments: CommentInput[],
): string {
  const slide = manifest.slides.find((s) => s.slideId === targetSlideId);
  if (!slide) throw new Error(`Slide ${targetSlideId} not in manifest`);

  const siblings = manifest.slides
    .filter((s) => s.slideId !== targetSlideId)
    .map((s) => {
      const number = manifest.slides.findIndex((m) => m.slideId === s.slideId) + 1;
      return `--- Slide ${number} (${s.role ?? "content"}, id: ${s.slideId}) ---\n${sliceForChrome(s.html)}`;
    })
    .join("\n\n");

  const activeNumber =
    manifest.slides.findIndex((s) => s.slideId === targetSlideId) + 1;
  const totalSlides = manifest.slides.length;

  const slideComments = comments.filter((c) => c.slideId === targetSlideId);
  const commentLines = slideComments.length
    ? slideComments
        .map((c, idx) => {
          const box = c.boundsJson
            ? `Region (slide-space): x=${Math.round(c.boundsJson.x)} y=${Math.round(c.boundsJson.y)} w=${Math.round(c.boundsJson.w)} h=${Math.round(c.boundsJson.h)}`
            : "Whole-slide comment";
          return `  ${idx + 1}. ${box}\n     "${c.content.replace(/"/g, '\\"')}"`;
        })
        .join("\n")
    : "  (none)";

  return [
    `PARTIAL REGEN — ACTIVE SLIDE`,
    ``,
    `Active slide number: ${activeNumber} of ${totalSlides}`,
    `Active slide ID: ${targetSlideId}`,
    `Active slide role: ${slide.role ?? "content"}`,
    `Deck direction: ${manifest.direction}`,
    `Deck language: ${manifest.language}`,
    ``,
    `USER COMMENTS ON THIS SLIDE:`,
    commentLines,
    ``,
    `THEME (locked, do not change):`,
    JSON.stringify(manifest.theme, null, 2),
    ``,
    `CURRENT ACTIVE SLIDE HTML (regenerate this one):`,
    slide.html,
    ``,
    `SIBLING SLIDE EXCERPTS — read to match chrome / margins / pagination. DO NOT modify any sibling.`,
    siblings,
    ``,
    `Return ONLY the new HTML for the active slide. No JSON, no fences, no prose.`,
  ].join("\n");
}

// Strip code fences or surrounding prose Claude might emit despite the
// instruction. Keep the slide HTML; everything else is noise.
function extractSlideHtml(raw: string): string {
  let text = raw.trim();
  // Strip ```html ... ``` or ``` ... ``` fences.
  const fenceMatch = text.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) text = fenceMatch[1].trim();
  return text;
}

type RegenPartialEvent = {
  projectId: string;
  presentationId: string;
  versionId: string;
  sourceVersionId: string;
  targetSlideIds: string[];
  comments: CommentInput[];
};

export const deckRegeneratePartial = inngest.createFunction(
  {
    id: "deck-regenerate-partial",
    name: "Regenerate Selected Slides with Comments",
    retries: 2,
    triggers: [{ event: "deck.regenerate.partial.requested" }],
    // Terminal failure path — runs once after every retry is exhausted.
    // Marks the queued target version `failed` so the UI's status poller
    // stops spinning and the user can surface the error. Project status
    // is left alone (the previous version is still visible).
    onFailure: async ({ event, error }) => {
      const original = (event.data.event?.data ?? {}) as Partial<RegenPartialEvent>;
      if (!original.versionId) return;
      const { prisma } = await import("@/lib/prisma");
      await prisma.presentationVersion
        .update({
          where: { id: original.versionId },
          data: { status: "failed" },
        })
        .catch((e) => {
          // Last-ditch — the version row may have been deleted; nothing
          // further to do beyond logging the failure (the surrounding
          // Inngest run already records the original error).
          console.error("partial-regen onFailure: status write failed", e, error);
        });
    },
  },
  async ({ event, step, logger }) => {
    const data = event.data as RegenPartialEvent;
    const {
      projectId,
      versionId,
      sourceVersionId,
      targetSlideIds,
      comments,
    } = data;

    // Load the source manifest in a step so a retry doesn't re-read the DB
    // unnecessarily. Source = the previous version's manifest; new version
    // starts as a copy and we splice the regenerated slides in.
    const source = await step.run("load-source-manifest", async () => {
      const version = await prisma.presentationVersion.findUnique({
        where: { id: sourceVersionId },
        select: { slideJson: true },
      });
      if (!version) throw new Error(`Source version ${sourceVersionId} not found`);
      const parsed = SlideManifestSchema.safeParse(version.slideJson);
      if (!parsed.success) {
        throw new Error(
          `Source manifest invalid: ${JSON.stringify(parsed.error.issues).slice(0, 600)}`,
        );
      }
      return parsed.data;
    });

    // Resolve the deck format ONCE per job so every per-slide call uses
    // the same dimensions — Claude needs the right canvas size in the
    // system prompt or vertical decks regen at 16:9.
    const sourceFormat: SlideFormat = source.format ?? "16:9";
    const partialSystemPrompt = buildPartialSystemPrompt(sourceFormat);

    // Fan out per-slide Claude calls. Each runs as its own Inngest step so
    // a single slide's failure produces a partial result we can surface to
    // the user, and step results are cached on retry. Calls run in parallel.
    const regenResults = await Promise.all(
      targetSlideIds.map((slideId) =>
        step.run(`regen-slide-${slideId}`, async () => {
          const client = getClient();
          const userMessage = buildPartialUserMessage(source, slideId, comments);
          // Explicit thinking budget — `adaptive` + `output_config.effort`
          // was load-bearing the wrong way (effort isn't a hard cap, and
          // adaptive can run for 15+ minutes on complex slides). 8000 tokens
          // gives Opus enough headroom for a careful redesign of one slide
          // while keeping wall-clock predictable.
          const message = await client.messages.create({
            model: "claude-opus-4-7",
            max_tokens: 16000,
            thinking: { type: "enabled", budget_tokens: 8000 },
            system: [
              {
                type: "text",
                text: partialSystemPrompt,
                cache_control: { type: "ephemeral" },
              },
            ],
            messages: [{ role: "user", content: userMessage }],
          });
          logger.info("partial_regen_usage", {
            slideId,
            input: message.usage.input_tokens,
            output: message.usage.output_tokens,
            cache_read: message.usage.cache_read_input_tokens,
            cache_write: message.usage.cache_creation_input_tokens,
          });
          const textBlock = message.content.find((b) => b.type === "text");
          if (!textBlock || textBlock.type !== "text") {
            throw new Error(`No text block in Claude response for slide ${slideId}`);
          }
          const html = extractSlideHtml(textBlock.text);
          if (!html) {
            throw new Error(`Empty HTML returned for slide ${slideId}`);
          }
          return { slideId, html };
        }),
      ),
    );

    // Splice the regenerated slides into a fresh copy of the source manifest
    // and persist. We rebuild the manifest object from scratch (vs. mutating
    // the loaded one) so the .slideJson column carries a clean payload — no
    // transient `progress` field left over from the source.
    await step.run("save-new-version", async () => {
      const slides = source.slides.map((s) => {
        const update = regenResults.find((r) => r.slideId === s.slideId);
        if (!update) return s;
        return { ...s, html: update.html };
      });
      const candidate: SlideManifest = {
        version: source.version,
        presentationId: source.presentationId,
        title: source.title,
        language: source.language,
        direction: source.direction,
        // Inherit the source manifest's format (16:9 / 9:16). Without
        // this, the rebuilt manifest has `format: undefined` and every
        // downstream consumer (lightbox, renderer, export) falls back
        // to the 16:9 default — visibly resetting a 9:16 deck back to
        // landscape after a partial regen.
        format: source.format,
        theme: source.theme,
        slides,
      };
      // Validate Claude output before persisting — per inngest/** coding
      // guideline, never write model output to DB without Zod-checking
      // it first. Catches malformed splices (e.g. empty html after
      // sanitisation) before the manifest reaches downstream consumers.
      const parsed = SlideManifestSchema.safeParse(candidate);
      if (!parsed.success) {
        throw new Error(
          `Regenerated manifest failed schema validation: ${JSON.stringify(parsed.error.issues).slice(0, 600)}`,
        );
      }
      const newManifest = parsed.data;

      // Atomic promotion — write the version, flip the currentVersionId
      // pointer, and mark the project completed in a single transaction.
      // Previously the pointer + project status updates were
      // .catch(() => undefined) best-effort, which could leave
      // PresentationVersion.status="completed" but
      // Presentation.currentVersionId still pointing at the old version.
      // If the transaction throws, Inngest retries the step; if all
      // retries exhaust, `onFailure` (above) marks the target version
      // `failed` as a terminal status.
      await prisma.$transaction([
        prisma.presentationVersion.update({
          where: { id: versionId },
          data: {
            slideJson: newManifest as never,
            status: "completed",
          },
        }),
        prisma.presentation.update({
          where: { id: data.presentationId },
          data: { currentVersionId: versionId },
        }),
        prisma.project.update({
          where: { id: projectId },
          data: { status: "completed" },
        }),
      ]);
    });

    return { success: true, regenerated: regenResults.length };
  },
);
