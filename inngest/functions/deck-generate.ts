import Anthropic from "@anthropic-ai/sdk";
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { SlideManifestSchema } from "@/lib/schema/slide";

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set in the runtime environment");
  }
  return new Anthropic({ apiKey });
}

const SYSTEM_PROMPT = `You are Taqreer's presentation design engine. You generate slide JSON manifests for Arabic-RTL and English-LTR presentations.

CANVAS
- 1920 × 1080 pixel canvas (top-left origin).
- All x, y, width, height are pixels on this canvas.

LANGUAGE & DIRECTION
- Arabic content: direction "rtl", textAlign "right". Anchor headlines, badges, and hero visuals to the right edge.
- English content: direction "ltr", textAlign "left".
- Use the language and direction from the brief.

TYPOGRAPHY
- In element.fontFamily, use ONLY the font names declared in fonts.heading.name and fonts.body.name. Do not invent or substitute other names.
- **Pick the font by SCRIPT, not by role.** If the text content is Arabic (or any RTL script), use the font that supports Arabic — in this project that is the heading font (Cairo). If the text content is Latin (English, Western digits-only, etc.), use the body font (Poppins). Never tag Arabic content with a Latin-only font (e.g. Poppins) — PowerPoint will fall back to a font without Arabic shaping and the letters will visibly disconnect.
- A single text element rarely mixes scripts; if it does (e.g. "تقرير موجز • 2024"), pick the font of the dominant script. Western digits render correctly in Arabic-capable fonts like Cairo.
- Typical sizes: headline 56–96pt, subheading 32–48pt, body 16–22pt, caption 10–14pt.
- Set role on text elements ("headline" | "subheading" | "body" | "caption" | "label") — role drives visual weight (size/boldness/color), NOT font choice.

LAYOUT
- Each slide needs a clear visual hierarchy: one primary focus, supporting elements, breathing room.
- Outer margin: 80–120 px from canvas edges.
- Avoid overlapping text and images unless intentional layered composition.
- Vary layouts across the deck — do not center every headline; mix left, right, asymmetric, and full-bleed compositions.

COLOR
- Use only the brief's palette (primary, secondary, background, text, muted) plus pure white / pure black where contrast requires.
- **NO GRADIENTS.** Backgrounds and shape fills must always be solid colors ({type: "color", value: "#hex"}). Do not emit {type: "gradient", ...} on any slide.background or shape.fill — gradients don't round-trip cleanly to PPTX export and degrade the exported deck. If you want a two-color effect on a slide, paint a full-canvas rectangle in one color and overlay a separate shape (circle, rectangle, etc.) in the second color at lower opacity.
- Maintain WCAG-acceptable text/background contrast on every slide.

SHAPES
- Allowed kinds only: rectangle, circle, ellipse, line, triangle.
- Use shapes for accents, dividers, decorative geometry, background bands.

EFFECTS
- Allowed: drop shadow (color + blur 0–50 + offsetX/offsetY), solid/dashed/dotted borders, single corner radius, element rotation in degrees (-360 to 360).
- Forbidden: CSS filters, backdrop-blur, multi-stop gradients, conic/radial gradients, transforms beyond rotation, mix-blend-mode, per-corner radii, clip-path, animations, text strokes, multiple shadows. The renderer cannot reproduce these and PPTX export will break.

OUTPUT — JSON only, no prose
- Return EXACTLY one JSON object. No markdown fences. No prose before or after. No explanations.
- Top-level required: version "1.0", presentationId (string), language ("ar"|"en"), direction ("rtl"|"ltr"), canvas {width: 1920, height: 1080}, fonts {heading: {name, url}, body: {name, url}}, palette {primary, secondary, background, text, muted — all hex like "#370BF4"}, slides[] (≥ 1).
- Each slide: slideId (unique non-empty string), optional role ("cover"|"agenda"|"content"|"stats"|"quote"|"image"|"closing"), background ({type:"color", value:"#hex"} — solid only, see COLOR section), elements[].
- Text element: {id, type:"text", x, y, width, height, content, fontFamily, fontSize, color (hex), textAlign ("left"|"right"|"center"), direction ("ltr"|"rtl"), optional role, fontWeight (100–900), lineHeight, italic, underline}.
- Image element: {id, type:"image", x, y, width, height, src (absolute URL), optional role, objectFit ("contain"|"cover"|"fill")}.
- Shape element: {id, type:"shape", x, y, width, height, kind ("rectangle"|"circle"|"ellipse"|"triangle"|"line"), optional role, fill ({type:"color", value:"#hex"} — solid only, see COLOR section)}.
- All x, y, width, height are pixel numbers on the 1920×1080 canvas.
- Slide count: match the brief's slideCount; if null or absent, choose 8–12 based on content depth.
- Element IDs must be unique within their slide.

QUALITY BAR
- Avoid generic "AI slop" output — no cookie-cutter centered-text layouts on every slide, no purple-gradient defaults, no Inter/Roboto fallbacks.
- Compose each slide intentionally. Vary scale, alignment, and decorative elements across the deck.`;

type EnhanceData = {
  level?: "light" | "medium" | "radical";
  keepColors?: boolean;
  keepFonts?: boolean;
  instructions?: string;
} | null;

type DeckGenerateEvent = {
  projectId: string;
  presentationId: string;
  versionId: string;
  jobId?: string | null;
  type?: "create" | "enhance";
  enhance?: EnhanceData;
  brief: unknown;
};

function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) return fenceMatch[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text.trim();
}

function buildUserMessage(event: DeckGenerateEvent) {
  const lines = [
    `Generate a slide manifest for this presentation.`,
    ``,
    `Flow: ${event.type ?? "create"}`,
    ``,
    `Brief:`,
    JSON.stringify(event.brief, null, 2),
  ];

  if (event.type === "enhance" && event.enhance) {
    lines.push(``, `Enhancement settings:`, JSON.stringify(event.enhance, null, 2));
    lines.push(
      ``,
      `For enhance flow: PRESERVE the original visual identity (palette, fonts, logo) while improving layout, hierarchy, typography, and spacing. Do not invent new colors or fonts unless explicitly overridden.`,
    );
  }

  lines.push(``, `Return the slide manifest JSON now.`);
  return lines.join("\n");
}

export const deckGenerate = inngest.createFunction(
  {
    id: "deck-generate",
    name: "Generate Presentation Deck",
    retries: 3,
    triggers: [{ event: "deck.generate.requested" }],
  },
  async ({ event, step, logger }) => {
    const data = event.data as DeckGenerateEvent;
    const { projectId, versionId, jobId } = data;

    const validated = await step.run("call-claude-and-validate", async () => {
      const client = getClient();
      const baseUserMessage = buildUserMessage(data);
      let lastError = "";

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const userMessage =
          attempt === 1
            ? baseUserMessage
            : `${baseUserMessage}\n\nThe previous attempt was rejected:\n${lastError}\n\nReturn corrected JSON now. JSON only, no prose, no fences.`;

        const stream = client.messages.stream({
          model: "claude-opus-4-7",
          max_tokens: 32000,
          thinking: { type: "adaptive" },
          system: [
            {
              type: "text",
              text: SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          output_config: { effort: "high" },
          messages: [{ role: "user", content: userMessage }],
        });

        const message = await stream.finalMessage();
        logger.info("claude_usage", {
          attempt,
          input: message.usage.input_tokens,
          output: message.usage.output_tokens,
          cache_read: message.usage.cache_read_input_tokens,
          cache_write: message.usage.cache_creation_input_tokens,
        });

        const textBlock = message.content.find((b) => b.type === "text");
        if (!textBlock || textBlock.type !== "text") {
          lastError = "No text block in Claude response";
          continue;
        }

        const jsonStr = extractJson(textBlock.text);
        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonStr);
        } catch (error) {
          lastError = `JSON.parse failed: ${error instanceof Error ? error.message : String(error)}`;
          continue;
        }

        const result = SlideManifestSchema.safeParse(parsed);
        if (result.success) return result.data;

        lastError = JSON.stringify(result.error.issues).slice(0, 1200);
      }

      throw new Error(`Validation failed after 3 attempts: ${lastError}`);
    });

    await step.run("save-to-database", async () => {
      await prisma.presentationVersion.update({
        where: { id: versionId },
        data: {
          slideJson: validated as never,
          status: "completed",
        },
      });

      await prisma.project.update({
        where: { id: projectId },
        data: { status: "completed" },
      });

      if (jobId) {
        await prisma.job
          .update({
            where: { id: jobId },
            data: {
              status: "succeeded",
              outputJson: validated as never,
            },
          })
          .catch((error) => {
            logger.warn("job_update_failed", { jobId, error: String(error) });
          });
      }
    });

    return { success: true, projectId };
  },
);
