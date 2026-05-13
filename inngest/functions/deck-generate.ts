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

const SYSTEM_PROMPT = `You are Taqreer's presentation design engine. You are a DESIGNER — you author each slide as HTML/CSS, and the browser does layout. There are no coordinates, no bbox arithmetic, no per-element JSON manifests. Just slide HTML.

CANVAS
- Every slide is rendered inside a fixed 1920×1080 box. Write CSS that fills exactly that. Use any layout you like — flexbox, grid, absolute positioning, transforms — the browser handles all of it.
- Don't include <!DOCTYPE>, <html>, <head>, or <body>. Emit slide body content only. Include <style> tags inline in each slide as needed.

LANGUAGE & DIRECTION
- Set \`dir="rtl"\` (or \`dir="ltr"\`) on the slide's root element. That is the ONLY direction signal you need to emit — the export pipeline handles all BiDi metadata downstream. Do not try to anchor neutral characters, do not insert U+200E/U+200F marks, do not use <bdi>.
- A trailing period on an Arabic line, mixed-script content like "القسم 02 · المشكلة", and numerals inside Arabic prose all render correctly without any special handling. Just write the content.

DESIGN TOKENS
The renderer injects these CSS variables on the slide root — use them rather than hardcoding hex / font names:
- \`var(--brand-bg)\`     — slide background you chose
- \`var(--brand-text)\`   — main text color you chose
- \`var(--primary)\`      — strongest brand accent (palette[0])
- \`var(--secondary)\`    — palette[1]
- \`var(--accent)\`       — palette[2]
- \`var(--brand-1)\` … \`var(--brand-N)\` — every brand accent indexed 1-based
- \`var(--font-heading)\` — heading font with system fallback
- \`var(--font-body)\`    — body font with system fallback
You fill out the matching \`theme\` object in the OUTPUT JSON; the renderer maps it to the vars above.

DESIGN FREEDOM (use it)
- Use \`linear-gradient\` / \`radial-gradient\` / \`conic-gradient\` freely on backgrounds, shapes, text-fill (background-clip:text).
- Use \`box-shadow\` (any number of shadows), \`text-shadow\`, \`filter: blur()\` / \`drop-shadow()\`, \`backdrop-filter: blur()\`, \`mix-blend-mode\`, \`clip-path\`, \`mask\`, \`transform\` (rotate, skew, scale, perspective), any \`border-radius\` per-corner, any \`opacity\`.
- The export round-trips these correctly. The PPTX-compat restrictions from prior versions of this prompt are GONE — design for what looks great in a browser.

SVG (use inline <svg> for icons, logos, decorative geometry)
- Logos: when the brief provides a logo URL, emit \`<img>\` for it. When the brand mark fits a simple geometric shape (a wordmark with no raster), prefer \`<svg>\` with inline paths so it stays vector in PowerPoint and can be recoloured by changing \`fill\` / \`stroke\`.
- Icons: prefer inline \`<svg>\` over Google Material Icons font (smaller, vector, recolourable). For Material Icons specifically, use the SVG variant — copy the path from material-icons.com and inline it. 24×24 viewBox is standard; size it via CSS width/height.
- Decorative shapes (circles, blobs, arcs, dividers): inline \`<svg>\` with path / circle / rect elements. Set \`fill="var(--primary)"\` to use brand tokens.

TYPOGRAPHY
- Use \`var(--font-heading)\` for headlines, \`var(--font-body)\` for body. Both have system fallbacks so they degrade gracefully if the webfont URL is unavailable.
- For Arabic content: the heading font you reference must support Arabic shaping — name an Arabic-capable Google Font (Cairo, Tajawal, Almarai, Noto Sans Arabic) in \`theme.fontHeading.name\`. The renderer + dom-to-pptx auto-embed it from the URL in the manifest.

CHROME CONSISTENCY
- Decide a chrome pattern on slide 1 — where the headline / kicker / pagination / brand mark lives — and reuse the SAME CSS classes and layout on every content slide. Variation lives in the BODY composition (stats grid vs. quote vs. two-column vs. hero image); the chrome is locked.
- Cover (\`role: "cover"\`) and closing (\`role: "closing"\`) may break the chrome for a hero composition.

OUTPUT — JSON only, no prose, no markdown fences
{
  "version": "2.0",
  "presentationId": "<echo from brief>",
  "title": "<3–8 word presentation title in the deck's language>",
  "language": "ar" | "en",
  "direction": "rtl" | "ltr",
  "theme": {
    "palette": ["#hex", "#hex", ...]      // 2–8 brand accent colors
    "fontHeading": { "name": "Cairo", "url": "https://fonts.googleapis.com/..." }
    "fontBody":    { "name": "Cairo", "url": "https://fonts.googleapis.com/..." }
    "background": "#hex"                  // slide bg
    "text": "#hex"                        // main text color
  },
  "slides": [
    {
      "slideId": "<unique within deck>",
      "role": "cover" | "section" | "content" | "stats" | "quote" | "image" | "closing",
      "html": "<div class='slide' dir='rtl'> ... slide body HTML ... </div>"
    },
    ...
  ]
}

QUALITY BAR
- Avoid AI slop: don't centre everything, don't default to purple gradients, don't pick generic Inter/Roboto. Compose like a senior designer — strong hierarchy, real grids, considered whitespace, asymmetric balance.
- The deck should read like one designer using one template — same chrome on every slide, body composition freely varied.
- Slide count: match the brief's slideCount; if absent, choose 8–12 based on content depth.
- Every \`slideId\` is unique within the deck.`;

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

type CornerPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

type Rules = {
  designStyle: string | null;
  fixTypos: boolean;
  pagination: boolean;
  persistent: {
    text: string;
    position: CornerPosition;
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
    lines.push(
      `- Persistent overlay: place the text "${rules.persistent.text}" on ${scope}, at the ${rules.persistent.position} corner. Use the EXACT same x/y/width/height/fontSize/fontFamily/color on every slide it appears on (chrome-lock — see DESIGN-SYSTEM LOCK).`,
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

  // Logo placement — brand logo, if provided, is up to Claude to compose
  // into the chrome. We tell him *where* the user wants it and *whether*
  // contrast matters; how to recolour for contrast (recolouring inline SVG,
  // adding a contrast band, etc.) is a design decision Claude makes.
  type LogoBrief = {
    storageUrl?: string;
    url?: string;
    position?: CornerPosition;
    exclude?: ("cover" | "closing")[];
  };
  const logo = ((event.brief as { brand?: { logo?: LogoBrief | null } } | null)?.brand?.logo ?? null) as LogoBrief | null;
  if (logo?.url || logo?.storageUrl) {
    const pos: CornerPosition = logo.position ?? "top-right";
    const excludes = Array.isArray(logo.exclude) ? logo.exclude : [];
    const scopeParts = [
      excludes.includes("cover") ? "cover slides" : null,
      excludes.includes("closing") ? "closing slides" : null,
    ].filter(Boolean);
    const scope =
      scopeParts.length === 0
        ? "every slide"
        : `every slide except ${scopeParts.join(" and ")}`;
    const logoSrc = logo.url ?? logo.storageUrl;
    lines.push(
      ``,
      `Brand logo:`,
      `- Source: ${logoSrc}`,
      `- Place it in the ${pos} of ${scope}. Use the same position + size on every slide where it appears (chrome-lock).`,
      `- If the logo's tonal value clashes with the slide background, design a contrast solution (small painted band underneath, inverted-colour variant if it's a wordmark SVG, etc.) — your call.`,
    );
  }

  lines.push(``, `Return the deck JSON now. No prose, no markdown fences.`);
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

      // Progress shown to the user must never go backward. The self-healing
      // retry restarts Claude from slide 1, so we track the high-watermark
      // across all attempts and write that to the DB instead of the raw
      // per-attempt counter.
      let maxSlideSeen = 0;

      // Persists a transient progress payload to the version's slideJson.
      // Best-effort — failed writes don't block generation. The client polls
      // /api/projects/[id]/status to surface these into <DeckView>.
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

        await writeProgress("thinking", maxSlideSeen, estimatedTotal);

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
        // don't hammer Prisma on every token. `maxSlideSeen` is the
        // non-monotonic ratchet that prevents retry-induced regressions.
        let buffer = "";
        let lastPushedSlide = -1;
        let lastWriteAt = 0;
        stream.on("text", (delta) => {
          buffer += delta;
          const matches = buffer.match(/"slideId"\s*:/g);
          const seen = matches ? matches.length : 0;
          if (seen > maxSlideSeen) maxSlideSeen = seen;
          const now = Date.now();
          if (maxSlideSeen !== lastPushedSlide && now - lastWriteAt > 800) {
            lastPushedSlide = maxSlideSeen;
            lastWriteAt = now;
            void writeProgress("designing", maxSlideSeen, estimatedTotal);
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

        await writeProgress("validating", maxSlideSeen, estimatedTotal);

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
