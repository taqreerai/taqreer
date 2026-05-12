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

USER RULES (HIGHEST PRIORITY)
- The user message ends with "Generation rules" — those directives OVERRIDE matching defaults in this system prompt.
- Examples: if rules disable pagination, do NOT emit a pagination element on any slide even though PAGINATION below is normally required. If rules specify a tone, adapt headlines/body to that tone throughout. If rules specify a persistent element, place it on the indicated slides at the indicated position, identically on every applicable slide.

CANVAS
- 1920 × 1080 pixel canvas (top-left origin).
- All x, y, width, height are pixels on this canvas.

LANGUAGE & DIRECTION
- Arabic content: direction "rtl", textAlign "right". Anchor headlines, badges, and hero visuals to the right edge.
- English content: direction "ltr", textAlign "left".
- Use the language and direction from the brief.

TYPOGRAPHY
- In element.fontFamily, use ONLY the font names declared in fonts.heading.name and fonts.body.name. Do not invent or substitute other names.
- **Pick the font by SCRIPT, not by role.** Arabic content must use a font that supports Arabic shaping. If the brief's heading font is Arabic-capable, use it for Arabic text; otherwise use the body font. Latin (English, digits) uses whichever font has clearer Latin shaping — typically the body font unless they're the same. "Arial" supports BOTH Arabic and Latin and can be used universally. Never tag Arabic content with a Latin-only font (e.g. Poppins) — PowerPoint will fall back to a system font without Arabic shaping and the letters will visibly disconnect.
- A single text element rarely mixes scripts; if it does (e.g. "تقرير موجز • 2024"), pick the font of the dominant script.
- Typical sizes (all values are CANVAS PIXELS, not pt — the export multiplies by 0.375 to get real pt): headline 56–96, subheading 32–48, body 18–24, caption 14–18.
- **Box height ≥ fontSize × lineHeight × (line count).** A 220-px headline with lineHeight 1.2 needs at least 264 px of height for one line. A 24-px body paragraph with lineHeight 1.5 across 3 wrapped lines needs ≥ 108 px. If you under-size the box, the text overflows into the next element — that's the #1 cause of overlapping slides. ALWAYS budget vertical space for the actual font metrics.
- Default lineHeight by role: headline 1.1, subheading 1.2, body 1.5, caption 1.4.
- Set role on text elements ("headline" | "subheading" | "body" | "caption" | "label") — role drives visual weight (size/boldness/color), NOT font choice.

LAYOUT
- Each slide needs a clear visual hierarchy: one primary focus, supporting elements, breathing room.
- Outer margin: 80–120 px from canvas edges is a healthy starting point — your choice.
- Avoid overlapping text and images unless intentional layered composition.

DESIGN-SYSTEM LOCK — design freely, then commit
- Before laying out slide 1, decide the deck's CHROME pattern as a small internal spec, then reuse it identically on every slide. "Chrome" means the persistent frame around content: where the headline lives, where the eyebrow / kicker / breadcrumb lives, where the pagination strip lives, and any persistent decorative element (corner accent, brand mark, divider line).
- You pick the coordinates, sizes, colors, fonts. ONCE PICKED, every content slide reuses the EXACT same x, y, width, height, fontSize, fontWeight, color, fontFamily, textAlign for each chrome role. No drift between slide 2, slide 5, and slide 17 — they must look like the same template.
- Example chrome systems you can pick (these are illustrations, not requirements):
  - "Headline pinned top-right (RTL), breadcrumb above it in muted color, pagination bottom-right small."
  - "Headline centered top under a thin horizontal accent rule, pagination bottom-center."
  - "Headline left-anchored mid-slide, breadcrumb top-left tiny caps, pagination top-right corner."
  - Many more are valid — pick whatever fits the brief's brand and content.
- Cover (role: "cover") and closing (role: "closing") slides MAY break the headline/eyebrow pattern for a hero composition. But pagination still appears in the locked position even on cover and closing.
- A section-divider slide may invert the background dark/light and flip headline color for contrast — POSITION AND SIZE still match the rest.
- Vary BODY composition across slides (asymmetric layouts, different image placement, stat cards, quotes, paragraphs). Variation lives in the body, NEVER in the chrome.

PAGINATION — required on every slide
- Every slide MUST include a pagination text element with content "N / Total" — e.g. "1 / 5", "2 / 5", … "5 / 5", where Total is the deck's slide count.
- Use direction "ltr" and the Latin-digit body font on this element (Latin digits + slash; never Arabic-Indic numerals). This way the "1 / 5" reads left-to-right even in an RTL deck.
- You pick the position and size — but use the EXACT SAME x, y, width, height, fontSize, color, fontFamily on every slide. Bottom-right, bottom-center, bottom-left, or even a corner is fine; just lock it.
- Typical size 16–24 canvas-px, muted color from the palette. Caption-weight, not bold.

COLOR
- Use only the brief's palette (primary, secondary, background, text, muted) plus pure white / pure black where contrast requires.
- **Gradients are allowed on SHAPE fills** ({type:"gradient", gradient:{type:"linear", angle, stops:[{color,position:0},{color,position:100}]}}). The export pipeline rasterizes gradient shapes to PNG (via SVG → sharp) and embeds them as images, so they round-trip cleanly. Use sparingly — solid color is still the default; gradients are for accent shapes (circles, rounded rects) that benefit from depth.
- **Slide backgrounds must stay SOLID** ({type:"color", value:"#hex"}) — gradient backgrounds at 1920×1080 inflate the PPTX with a giant raster. For a two-color background effect, paint a full-canvas solid rectangle and overlay a gradient shape (circle/ellipse) at any opacity.
- Maintain WCAG-acceptable text/background contrast on every slide.

SHAPES
- Allowed kinds only: rectangle, circle, ellipse, line, triangle.
- Use shapes for accents, dividers, decorative geometry, background bands.

EFFECTS
- Allowed: drop shadow (color + blur 0–50 + offsetX/offsetY), solid/dashed/dotted borders, single corner radius, element rotation in degrees (-360 to 360).
- Forbidden: CSS filters, backdrop-blur, multi-stop gradients, conic/radial gradients, transforms beyond rotation, mix-blend-mode, per-corner radii, clip-path, animations, text strokes, multiple shadows. The renderer cannot reproduce these and PPTX export will break.

OUTPUT — JSON only, no prose
- Return EXACTLY one JSON object. No markdown fences. No prose before or after. No explanations.
- Top-level required: version "1.0", presentationId (string), **title (concise 3–8 word presentation title in the deck's language — this becomes the dashboard project name and the exported PPTX filename, so make it descriptive and memorable, not a generic "عرض تقديمي")**, language ("ar"|"en"), direction ("rtl"|"ltr"), canvas {width: 1920, height: 1080}, fonts {heading: {name, url}, body: {name, url}}, palette {primary, secondary, background, text, muted — all hex like "#370BF4"}, slides[] (≥ 1).
- Each slide: slideId (unique non-empty string), optional role ("cover"|"agenda"|"content"|"stats"|"quote"|"image"|"closing"), background ({type:"color", value:"#hex"} — solid only, see COLOR section), elements[].
- Text element: {id, type:"text", x, y, width, height, content, fontFamily, fontSize, color (hex), textAlign ("left"|"right"|"center"), direction ("ltr"|"rtl"), optional role, fontWeight (100–900), lineHeight, italic, underline}.
- Image element: {id, type:"image", x, y, width, height, src (absolute URL), optional role, objectFit ("contain"|"cover"|"fill")}.
- Shape element: {id, type:"shape", x, y, width, height, kind ("rectangle"|"circle"|"ellipse"|"triangle"|"line"), optional role, fill ({type:"color", value:"#hex"} — solid only, see COLOR section)}.
- All x, y, width, height are pixel numbers on the 1920×1080 canvas.
- Slide count: match the brief's slideCount; if null or absent, choose 8–12 based on content depth.
- Element IDs must be unique within their slide.

QUALITY BAR
- Avoid generic "AI slop" output — no cookie-cutter centered-text layouts on every slide, no purple-gradient defaults, no Inter/Roboto fallbacks.
- The deck should read like the work of one designer using one template — chrome perfectly consistent, body composition freely varied. Consistency at the chrome level + variety at the body level is the target.`;

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

type Rules = {
  tone: string | null;
  designStyle: string | null;
  fixTypos: boolean;
  pagination: boolean;
  persistent: {
    text: string;
    position: "auto" | "top-right" | "top-left" | "bottom-right" | "bottom-left";
    exclude: ("cover" | "closing")[];
  } | null;
} | null;

// Design-style directives — each style cracks open the layout pattern
// otherwise enforced by DESIGN-SYSTEM LOCK. Chrome stays locked across the
// deck; the style determines WHAT chrome and body compositions look like.
const DESIGN_STYLE_DIRECTIVES: Record<string, string> = {
  "إبداعي":
    "Creative: lean into asymmetric compositions, full-bleed background shapes, rotated accent elements, and unusual content placements. Whitespace as a design element. Diagonal energy.",
  "بسيط":
    "Minimal: generous whitespace, single focal point per slide, restrained typography, tiny palette of accents, no decorative shapes unless they earn their place.",
  "احترافي":
    "Corporate: structured grid alignments, conservative palette usage, formal hierarchy with clear headline → subhead → body relationships, business-deck composure.",
  "مرح":
    "Playful: rounded shapes (circles, soft rectangles), bright accent colors used liberally, varied compositions, friendly visual rhythm. Not childish — just warm.",
  "صحفي":
    "Editorial / newspaper: multi-column body layouts, sidebars with secondary content, mixed type sizes within a slide (headline + deck + caption), kicker labels, byline-style metadata.",
  "جريء":
    "Bold: oversized typography that dominates the canvas, high-contrast color pairings, edge-to-edge headlines, aggressive negative space. Cinematic.",
  "كلاسيكي":
    "Classic: centered hierarchy, traditional book-cover style on cover, balanced compositions, restrained accents. Timeless rather than trendy.",
};

function ruleLines(rules: Rules): string[] {
  if (!rules) return [];
  const lines = ["", "Generation rules (user-specified, OVERRIDE matching defaults):"];
  if (rules.tone) {
    lines.push(`- Tone of voice: "${rules.tone}". Adapt headline and body copy to this register throughout the deck.`);
  }
  if (rules.designStyle) {
    const directive = DESIGN_STYLE_DIRECTIVES[rules.designStyle];
    if (directive) {
      lines.push(`- Design style: "${rules.designStyle}". ${directive}`);
    } else {
      lines.push(`- Design style: "${rules.designStyle}". Compose every slide accordingly.`);
    }
  }
  lines.push(
    rules.fixTypos
      ? `- Fix typos: correct spelling and grammar errors in the source content silently while preserving meaning.`
      : `- Preserve user text verbatim: do NOT auto-correct spelling or grammar — keep the source content as-written.`,
  );
  lines.push(
    rules.pagination
      ? `- Pagination: REQUIRED on every slide. Follow the PAGINATION section in the system prompt.`
      : `- Pagination: DISABLED. Do NOT emit any "N / Total" page-number text element on any slide. This overrides the system prompt's PAGINATION requirement entirely.`,
  );
  if (rules.persistent && rules.persistent.text.trim()) {
    const excludeCover = rules.persistent.exclude.includes("cover");
    const excludeClosing = rules.persistent.exclude.includes("closing");
    const exclusions = [
      excludeCover ? "cover slides (role: cover)" : null,
      excludeClosing ? "closing slides (role: closing)" : null,
    ].filter(Boolean);
    const scope = exclusions.length === 0
      ? "EVERY slide including cover and closing"
      : `every slide EXCEPT ${exclusions.join(" and ")}`;
    const position =
      rules.persistent.position === "auto"
        ? "a position you pick once and reuse on every applicable slide"
        : rules.persistent.position;
    lines.push(
      `- Persistent overlay: place the text "${rules.persistent.text}" on ${scope}, at ${position}. Use the EXACT same x/y/width/height/fontSize/fontFamily/color on every slide it appears on (chrome-lock — see DESIGN-SYSTEM LOCK).`,
    );
  }
  return lines;
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

  // Verbatim mode (create flow, content.keepVerbatim = true): the user opted
  // out of letting us reorganize their text. Slides must surface the source
  // exactly as written — no invented headings, no paraphrasing, no expansion.
  const briefContent = (event.brief as { content?: { keepVerbatim?: boolean } } | null)?.content;
  if ((event.type ?? "create") === "create" && briefContent?.keepVerbatim) {
    lines.push(
      ``,
      `VERBATIM MODE (user opted out of auto-organization):`,
      `- Render the brief.content.text EXACTLY as written. Preserve word order, punctuation, line breaks.`,
      `- DO NOT invent slide headings or section labels. If the source has no explicit heading for a slide, leave the headline element empty / omit it entirely.`,
      `- DO NOT paraphrase, summarize, expand, translate, or add sentences. Numbers, names, quotes — preserve verbatim.`,
      `- Split the source across slides at natural boundaries (paragraph breaks, blank lines, list-item boundaries) — do not rewrite the chunks themselves.`,
    );
  }

  const rules = (event.brief as { rules?: Rules } | null)?.rules ?? null;
  lines.push(...ruleLines(rules));

  // Logo placement — when the brand has a logo URL, instruct Claude to emit
  // an image element with role:"logo" on every applicable slide at the
  // user's chosen corner. Same chrome-lock principle as the persistent text:
  // identical position/size on every slide it appears on.
  type LogoBrief = {
    storageUrl?: string;
    position?: "auto" | "top-right" | "top-left" | "bottom-right" | "bottom-left";
    exclude?: ("cover" | "closing")[];
  };
  const logo = ((event.brief as { brand?: { logo?: LogoBrief | null } } | null)?.brand?.logo ?? null) as LogoBrief | null;
  if (logo?.storageUrl) {
    const LOGO_COORDS: Record<string, { x: number; y: number }> = {
      "top-right": { x: 1720, y: 80 },
      "top-left": { x: 80, y: 80 },
      "bottom-right": { x: 1720, y: 880 },
      "bottom-left": { x: 80, y: 880 },
    };
    const pos = logo.position ?? "auto";
    const placement =
      pos === "auto"
        ? "a corner you pick once (top-right is conventional for RTL decks) and reuse identically on every slide it appears on"
        : `the ${pos} corner at coordinates ${JSON.stringify(LOGO_COORDS[pos])}`;
    const excludes = Array.isArray(logo.exclude) ? logo.exclude : [];
    const excludeCover = excludes.includes("cover");
    const excludeClosing = excludes.includes("closing");
    const scopeParts = [
      excludeCover ? "cover slides (role: cover)" : null,
      excludeClosing ? "closing slides (role: closing)" : null,
    ].filter(Boolean);
    const scope =
      scopeParts.length === 0
        ? "EVERY slide including cover and closing"
        : `every slide EXCEPT ${scopeParts.join(" and ")}`;
    lines.push(
      ``,
      `LOGO PLACEMENT (brand logo provided):`,
      `- Emit an image element with role:"logo", src:"${logo.storageUrl}", objectFit:"contain", width:120, height:120 on ${scope}.`,
      `- Position: ${placement}.`,
      `- Use the EXACT same x/y/width/height on every slide where the logo appears (chrome-lock).`,
      `- Do NOT place the logo behind text or other elements; keep it on top of decorative layers.`,
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

    // Estimated total slides for the progress UI. Use the brief's slideCount
    // if the user picked a custom value; otherwise default to 8 (we ask Claude
    // for 8–12 in the prompt). Updated to the actual count once we see it
    // streamed in.
    const briefSlideCount = (data.brief as { slideCount?: number | null } | null)?.slideCount;
    const estimatedTotal = typeof briefSlideCount === "number" && briefSlideCount > 0 ? briefSlideCount : 8;

    const validated = await step.run("call-claude-and-validate", async () => {
      const client = getClient();
      const baseUserMessage = buildUserMessage(data);
      let lastError = "";

      // Persists a transient progress payload to the version's slideJson.
      // Best-effort — failed writes don't block generation. Supabase Realtime
      // surfaces these updates to the client's <DeckView> generating state.
      const writeProgress = (stage: "thinking" | "designing" | "validating" | "saving", currentSlide: number, total: number) =>
        prisma.presentationVersion
          .update({
            where: { id: versionId },
            data: {
              slideJson: {
                status: "generating",
                progress: { stage, currentSlide, estimatedTotal: Math.max(total, currentSlide) },
                slides: [],
              } as never,
            },
          })
          .catch(() => undefined);

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const userMessage =
          attempt === 1
            ? baseUserMessage
            : `${baseUserMessage}\n\nThe previous attempt was rejected:\n${lastError}\n\nReturn corrected JSON now. JSON only, no prose, no fences.`;

        await writeProgress("thinking", 0, estimatedTotal);

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

        // Watch the streamed text — count `"slideId":` occurrences to know
        // which slide Claude is currently emitting. Throttle DB writes so we
        // don't hammer Prisma on every token.
        let buffer = "";
        let currentSlide = 0;
        let lastPushedSlide = -1;
        let lastWriteAt = 0;
        stream.on("text", (delta) => {
          buffer += delta;
          const matches = buffer.match(/"slideId"\s*:/g);
          const seen = matches ? matches.length : 0;
          if (seen > currentSlide) currentSlide = seen;
          const now = Date.now();
          if (currentSlide !== lastPushedSlide && now - lastWriteAt > 800) {
            lastPushedSlide = currentSlide;
            lastWriteAt = now;
            void writeProgress("designing", currentSlide, estimatedTotal);
          }
        });

        const message = await stream.finalMessage();
        logger.info("claude_usage", {
          attempt,
          input: message.usage.input_tokens,
          output: message.usage.output_tokens,
          cache_read: message.usage.cache_read_input_tokens,
          cache_write: message.usage.cache_creation_input_tokens,
        });

        await writeProgress("validating", currentSlide, estimatedTotal);

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
        if (result.success) {
          await writeProgress("saving", result.data.slides.length, result.data.slides.length);
          return result.data;
        }

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

      // Promote Claude's generated title to the Project (dashboard name) and
      // the Presentation (also used for new versions). The truncated paste
      // that seeded the row at /api/projects time is now replaced by a real
      // human-readable title.
      await prisma.project.update({
        where: { id: projectId },
        data: { status: "completed", title: validated.title },
      });
      await prisma.presentation
        .update({
          where: { projectId },
          data: { title: validated.title },
        })
        .catch(() => undefined);

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
