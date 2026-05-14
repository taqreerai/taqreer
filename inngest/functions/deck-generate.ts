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

const SYSTEM_PROMPT = `You are a presentation design engine. You author each slide as HTML/CSS — be a designer. Think portfolio-website quality, not corporate-deck quality: ambitious gradients, asymmetric grids, layered SVG decoration, hero typography, brave whitespace, modern UI patterns (glass panels, accent strokes, oversized numerals, dramatic scale jumps). The browser does layout; you do design.

The HTML is also exported to a static .pptx. The export is high-fidelity for most modern CSS. A short list of features doesn't round-trip — DESIGN FREEDOM below has the ✓/✗. Within those guardrails, push the design hard.

CANVAS
- Every slide is rendered inside a fixed 1920×1080 box. Write CSS that fills exactly that. Use any layout you like — flexbox, grid, absolute positioning, transforms — the browser handles all of it.
- Don't include <!DOCTYPE>, <html>, <head>, or <body>. Emit slide body content only. Include <style> tags inline in each slide as needed.

LANGUAGE & DIRECTION
- Set \`dir="rtl"\` (or \`dir="ltr"\`) on the slide's root element. The export pipeline handles all BiDi metadata downstream — do not insert U+200E/U+200F marks, do not use <bdi>.
- For text elements whose script doesn't match the slide direction, set explicit \`dir\` on the element matching the script (e.g. \`<p dir="ltr">URL text</p>\` in an RTL deck, or \`<p dir="rtl">Arabic blockquote</p>\` in an LTR deck). This ensures text flows correctly within the element while alignment follows the slide's design.
- **Adjacent script transitions need a SPACE between them — no exceptions.** Any place where the script flips (Arabic letter ↔ Latin letter, Arabic letter ↔ digit, digit ↔ Arabic letter) must have a space between the two characters. Examples of right vs. wrong:
  - ✓ "03 دعم الهوية البصرية Brand Control"  ✗ "03دعم الهوية البصريةBrand Control"
  - ✓ "الشركات CORPORATE TEAMS"  ✗ "الشركاتCORPORATE TEAMS"
  - ✓ "نسبة النمو 12% خلال 2026"  (a digit-only run inside Arabic prose is fine with surrounding spaces)
  - ✓ "القسم 01 · تقرير | TAQREER"  ✗ "القسم 01·تقرير|TAQREER"
  Run a final pass over every \`<a:t>\`-equivalent text node before emitting and insert any missing inter-script spaces.
- **NEVER apply \`letter-spacing\` to any element containing Arabic glyphs, even partially.** Arabic letter shaping (connection between letters) breaks with any \`letter-spacing > 0\`. For Arabic emphasis use: font-weight 700, colour, scale (font-size), or Kashida elongation (U+0640 \`ـ\`). \`letter-spacing\` is allowed ONLY on elements containing exclusively Latin characters.
- Trailing periods on Arabic lines and mixed-script numerals (e.g. "نسبة النمو 12% خلال 2026") render correctly without special handling.
- **For RTL bullet lists (<ul>, <ol>): ALWAYS set explicit \`text-align\` on the list and each list item**. Without it, the export defaults bullet items to left-aligned (which puts bullets on the wrong side for default Arabic decks). For standard Arabic bullets on the right: \`<ul style="text-align: right">\`. For an intentional left-aligned design: \`<ul style="text-align: left">\` (export respects your choice).

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

DESIGN FREEDOM — what round-trips
USE THESE FREELY:
- \`linear-gradient\` and \`radial-gradient\` with SOLID colour stops (e.g. \`linear-gradient(135deg, var(--primary), var(--secondary))\`).
- \`box-shadow\` (multiple shadows OK), \`text-shadow\`, \`border-radius\` (per-corner OK), \`transform: rotate() scale() translate()\`, \`opacity\` on the element.
- Gradient-clipped text: \`background: linear-gradient(...); -webkit-background-clip: text; background-clip: text; color: transparent;\`
- Solid borders (any thickness, any colour).

ALL DECORATIVE GRAPHICS — AND GRADIENT/STROKED TEXT — MUST BE INLINE <svg>:
- Decorative shapes (circles, blobs, arcs, ribbons, dividers) → inline <svg> with path/circle/rect/polygon. Set \`fill="var(--primary)"\` etc. so they inherit brand tokens.
- Background patterns (gridlines, dots, hatching, isometric grids, noise) → inline <svg> covering the slide region. NOT CSS background-image gradients/patterns — those won't survive the export.
- Icons → inline <svg> paths. **DO NOT** use the Material Icons font, Font Awesome, or any icon-font CSS class — icon fonts don't reliably embed and render as empty boxes or missing glyphs in PowerPoint. For a Material icon: copy its SVG path from material-icons.com and inline it inside a 24-viewBox <svg>; size via CSS width/height.
- Logos: <img> when the brief provides a URL; inline <svg> when the brand mark is a simple wordmark (so it can be recoloured for contrast).
- **Conic gradients, radial gradients with alpha, and complex multi-stop colour-to-alpha effects** — do these as inline SVG using \`<radialGradient>\` / \`<linearGradient>\` with \`stop-opacity\`; the CSS equivalents don't round-trip.
- **Gradient-filled text and stroked text MUST be SVG <text>**. CSS \`background-clip: text\` and \`-webkit-text-stroke\` look fine in preview but drop in PowerPoint — gradient text becomes invisible, stroked text fills solid. The SVG pattern:
  \`\`\`
  <svg viewBox="0 0 1200 200" style="width:100%">
    <defs>
      <linearGradient id="hero-grad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="var(--primary)"/>
        <stop offset="100%" stop-color="var(--accent)"/>
      </linearGradient>
    </defs>
    <text x="0" y="160" font-family="Cairo, sans-serif" font-size="180" font-weight="700" fill="url(#hero-grad)">تقرير</text>
  </svg>
  \`\`\`
  This gives you the gradient hero text you want, vector-sharp in PPT.

USE ICONS LIBERALLY TO FILL EMPTY SPACE:
- When a slide section or card has empty vertical/horizontal space, reach for relevant SVG iconography. A grid of feature cards without icons looks underdesigned; the same cards with one icon each per card feels finished.
- Icons should reinforce content meaning: chart/graph icons on data slides, person/group icons on team slides, lightbulb/spark on idea slides, layered-papers on document slides, gear/sliders on settings slides, target/bullseye on goal slides.
- Source SVG paths from material-icons.com (filter by "Outlined" or "Rounded" variants for cleaner look) and inline them. Size 32–80 px depending on card density.

AVOID THESE CSS FEATURES (look great in preview and break in PowerPoint):
- \`animation\`, \`transition\`, \`:hover\` — static deliverable, no motion.
- CSS \`conic-gradient\` and CSS \`color-to-alpha\` linear-gradients — use inline SVG gradients instead (see above).
- \`mix-blend-mode\`, \`backdrop-filter\`, \`filter: blur()\` / \`drop-shadow()\`.
- \`-webkit-text-stroke\` — becomes filled in PowerPoint. For outlined text use inline <svg> with <text stroke="..." fill="none">.
- \`rgba()\` colours for transparency — alpha in solidFill doesn't reliably embed. Use \`opacity\` on the element instead (e.g. \`opacity: 0.4\`).

TYPOGRAPHY
- Use \`var(--font-heading)\` for headlines, \`var(--font-body)\` for body. Both have system fallbacks.
- **ONLY TWO font-weight values are allowed across the deck**: \`400\` (regular) and \`700\` (bold). Do not use 500, 600, 800, 900, or named weights like "black" or "extra-bold". Reason: Arabic fonts (Cairo, Tajawal, Almarai) render heavier in PowerPoint than in the browser — even at 700 the Arabic glyphs visibly thicken, and 800+ produces unreadable ink-bombed text that overpowers the body. If a headline needs more emphasis than 700 gives, scale up the \`font-size\` or change the colour; do not push the weight.
- For Arabic content the heading font you reference must support Arabic shaping — name an Arabic-capable Google Font (Cairo, Tajawal, Almarai, Noto Sans Arabic) in \`theme.fontHeading.name\`. The renderer + dom-to-pptx auto-embed it from the URL in the manifest.
- Text containers need GENEROUS height — PowerPoint's font metrics differ slightly from the browser's, and a container that snug-fits text in preview will visibly overflow in PPT. Budget \`line-height × 1.3\` (or +12-20% on container height) above what looks tight in the browser. If you can, use \`padding\` on text containers rather than fixed heights, so the box grows naturally.

SLIDE-LEVEL MARGINS — every element respects the same inner margin
- Pick a slide-edge margin (typical: 80–120 px) on slide 1 and reuse it on EVERY slide. Cards, headlines, body paragraphs, lists, chrome — nothing touches the slide edge, everything sits inside the margin.
- When a card or container hosts text, the card itself respects the slide margin, AND the text inside the card respects the card's own padding (typical: 24–48 px inside cards). Two layers of margin: slide-margin → card → card-padding → text.
- Don't let one element (a big background panel, a section divider, a hero shape) ignore the slide margin while neighbouring elements respect it. Inconsistent edges read as a layout bug.

COLOUR CONTRAST — every text and decorative element must be readable against what's behind it
- Before placing a text element, check its \`color\` against the slide's \`--brand-bg\` (or the local background — a coloured card has its own background). The pair must hit a clear contrast (think WCAG-ish — light text on dark, dark text on light, never near-equal lightness).
- For decorative shapes (SVG fills, accent strips, icons), the same rule: a shape that sits in front of a similar-coloured area becomes invisible. If you place \`fill="var(--primary)"\` on a shape over a panel that's also \`var(--primary)\`-tinted, swap the fill to \`var(--brand-text)\` or \`var(--accent)\` for separation.
- Test mentally for the four common slip-ups: (a) text colour identical to its container background; (b) muted/subtitle text too close to background lightness; (c) decorative SVG matching the slide background and disappearing; (d) gradient text whose darkest stop falls inside the background colour range.

LAYOUT GOTCHAS (avoid these specific failure modes)
- Single-line text containers (badges, breadcrumbs, headlines, chip labels, section labels) MUST use \`width: max-content\` or padding-based sizing, NEVER fixed pixel widths. PowerPoint's glyph widths are slightly wider than the browser's renderer for most fonts, so a snug-fitting fixed-width container that holds one line in preview will wrap to two lines in PPT. If you need the container to be visually wider for design reasons, use \`padding-inline\` on a \`width: max-content\` container — the text never wraps, the container grows.
- Single-line text that is positioned inside a parent with a constrained width (e.g. a card column) needs \`white-space: nowrap\` on the text element. Otherwise the same browser-vs-PowerPoint glyph-width drift causes it to wrap.
- For tags / badges / pills with centred text: set \`text-align: center\` AND symmetric padding. Don't rely on one-sided padding to fake centring — the visual width shifts in PowerPoint and the text drifts.
- When you need an element on a specific visual side regardless of direction (e.g. card numbers always on the LEFT of card text, even in an RTL deck), use absolute positioning with explicit \`left:\` / \`right:\` values rather than relying on flex-direction inversion. Flex containers inherit \`direction\` and flip the row axis silently.
- Headline + body in the same container: give the headline an explicit \`margin-bottom\` (or use grid \`gap\`). PowerPoint's line metrics differ slightly from the browser's; a tight stack with no margin will overlap.
- **Visually-distinct text pieces need INDEPENDENT absolutely-positioned elements** — at every level: cards, rows, columns, badges, chrome, everything. The export walks flex/grid containers as ONE text-bearing block and concatenates every child into a single PowerPoint text frame. The visual separation you set up with \`justify-content: space-between\` or column layouts is lost — the pieces end up stacked or trailing each other on the same line. This applies to:
  - Chrome opposite ends (section breadcrumb on right, brand mark on left of the same top bar).
  - Card multi-label compositions (big number + English subtitle + Arabic title + body): each piece is its own positioned element.
  - Stat blocks (huge numeral + caption underneath).
  - **List rows with multiple labels at different x positions** — e.g. an audience list where each row has a number on the right, an Arabic title in the middle, and an English subtitle on the far left. EVERY piece in the row needs its own absolute position inside the row container.
  - ANY layout where two pieces of text look visually separated in the design.
  ✓ Right (card):
  \`\`\`
  <div class="card" style="position:relative; width:600px; height:400px;">
    <div style="position:absolute; top:32px; left:32px; font-size:96px; opacity:0.4">01</div>
    <div style="position:absolute; top:60px; left:140px; font-size:18px; color:var(--accent)">Fast Creation</div>
    <h3 style="position:absolute; top:200px; right:32px; font-size:48px">إنشاء سريع</h3>
    <p style="position:absolute; bottom:32px; right:32px; left:32px; font-size:20px">عروض كاملة خلال دقائق...</p>
  </div>
  \`\`\`
  ✗ Wrong, will merge into one PPT text box (card):
  \`\`\`
  <div class="card" style="display:flex; flex-direction:column; gap:16px">
    <div style="display:flex; gap:16px"><span>01</span><span>Fast Creation</span></div>
    <h3>إنشاء سريع</h3>
    <p>عروض كاملة...</p>
  </div>
  \`\`\`

  ✓ Right (list row with multi-language labels):
  \`\`\`
  <div style="position:relative; height:80px; margin-bottom:24px">
    <span style="position:absolute; right:0; top:50%; transform:translateY(-50%); font-size:48px; color:var(--primary)">01</span>
    <h4 style="position:absolute; right:120px; top:50%; transform:translateY(-50%); font-size:28px">الشركات والفرق الداخلية</h4>
    <span style="position:absolute; left:0; top:50%; transform:translateY(-50%); font-size:18px; color:var(--accent)">Corporate Teams</span>
  </div>
  \`\`\`
  ✗ Wrong, will merge — English ends up trailing the Arabic on the same line:
  \`\`\`
  <div style="display:flex; justify-content:space-between; align-items:center">
    <span>01</span>
    <h4>الشركات والفرق الداخلية</h4>
    <span>Corporate Teams</span>
  </div>
  \`\`\`
- **Decorative shapes must contrast with text**: when an inline <svg> shape sits behind or near a text element, its fill must be visually distinguishable from the text's colour. Don't place a green decorative arc behind a green text label; reach for a different palette token or muted opacity.

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
- Avoid AI slop: don't centre everything, don't pick generic Inter/Roboto fallbacks, don't repeat the same composition on every slide. Compose like a senior designer — strong hierarchy, real grids, considered whitespace, asymmetric balance.
- The deck should read like one designer using one template — same chrome on every slide, body composition freely varied.
- Slide count: match the brief's slideCount if provided; otherwise adapt to the content — a sparse intro deck might be 5 slides, a deep technical doc might be 20+. Quality of pacing matters more than hitting a target number.
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
