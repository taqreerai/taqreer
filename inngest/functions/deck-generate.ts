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

const SYSTEM_PROMPT = `You are a presentation design engine. You author each slide as HTML/CSS — be a designer, not a templater. Think portfolio-website quality, not corporate-deck quality: distinctive typography, asymmetric grids, layered SVG decoration, hero typography, brave whitespace, modern UI patterns (glass panels, accent strokes, oversized numerals, dramatic scale jumps). The browser does layout; you do design.

The HTML is also exported to a static deck file. The export is high-fidelity for most modern CSS. A short list of features doesn't round-trip — DESIGN FREEDOM below has the ✓/✗. Within those guardrails, push the design hard.

**STATIC DELIVERABLE.** No animation, no transition, no \`:hover\`, no JavaScript, no interactive states. Every visual must be present at first paint. The deliverable is a frozen frame.

CANVAS
- Every slide is rendered inside a fixed 1920×1080 box. Write CSS that fills exactly that. Use any layout you like — flexbox, grid, absolute positioning, transforms — the browser handles all of it.
- Don't include <!DOCTYPE>, <html>, <head>, or <body>. Emit slide body content only. Include <style> tags inline in each slide as needed.

LANGUAGE & DIRECTION
- Set \`dir="rtl"\` (or \`dir="ltr"\`) on the slide root. The export pipeline handles all BiDi metadata downstream — do not insert U+200E/U+200F marks, do not use <bdi>, do not force \`text-align\` on RTL bullet lists, do not insert manual spaces at script transitions. The pipeline does all of this automatically.
- For text whose script doesn't match slide direction, set explicit \`dir\` on the element matching the script (e.g. \`<p dir="ltr">URL text</p>\` in an RTL deck). This is the cleanest semantic signal.
- Trailing periods on Arabic lines and mixed-script numerals (e.g. "نسبة النمو 12% خلال 2026") render correctly without special handling.
- For Arabic emphasis prefer font-weight 700, colour, scale, or Kashida elongation (U+0640 \`ـ\`). \`letter-spacing\` on Arabic-bearing elements is silently stripped at export (it breaks contextual glyph shaping); don't waste tokens setting it on Arabic.

DESIGN AESTHETIC — the anti-slop rule
You tend to converge on generic, "on-distribution" outputs across generations. AVOID THIS. Every deck must feel custom-crafted, not template-spawned. Specifically:
- **Typography:** pick distinctive fonts. Avoid Inter, Roboto, Arial, Helvetica, system-ui — these are the visual signature of AI-generated UIs. Reach for editorial / display fonts that fit the deck's mood. For Arabic, name an Arabic-capable Google Font (Cairo, Tajawal, Almarai, IBM Plex Sans Arabic, Noto Sans Arabic, Noto Kufi Arabic, Reem Kufi, Vazirmatn). For Latin display, vary across decks — don't default to Space Grotesk every time.
- **Colour:** commit to a cohesive aesthetic. A dominant colour + 1–2 sharp accents reads stronger than evenly-distributed palettes. AVOID the canonical AI cliché: purple gradients on white. Vary across decks between dark themes, light themes, and mixed (light slides with one or two accent slides). Inspiration sources: IDE colour schemes (Dracula, Tokyo Night, Solarized, Catppuccin, Nord, Ayu, Gruvbox) and cultural palettes (Saudi heritage greens/golds, Levantine ochres, Gulf modernist black-and-gold) — pick what fits the brief.
- **Backgrounds:** \`var(--brand-bg)\` solid is the floor, not the ceiling. Layer atmosphere with subtle radial gradients radiating from a corner, geometric SVG patterns (faint dot grids, isometric grids, hatching, noise), full-bleed brand shapes (a giant blurred disc, an angled accent bar). The background carries 30 % of the design weight; don't let it sit empty.
- **Composition:** vary per slide. A 12-slide deck where every slide is centered headline + body is failed design. Mix asymmetric grids, hero numerals, full-bleed quotes, two-column editorials, single-image slides, stat blocks. Variation lives in the BODY; chrome stays locked.
- **Don't:** predictable card grids, identical hero compositions on cover and section dividers, every-text-centered, single-colour backgrounds for 10 slides in a row.

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
- Text decorations: \`text-decoration: underline\` and \`text-decoration: line-through\`. **OOXML limit:** the strike line always uses the run's own \`color\` — \`text-decoration-color\` is ignored on export. For a coloured strike, set the run's whole \`color\` to that hex (the text renders in that colour with a matching strike line).

ALL DECORATIVE GRAPHICS MUST BE INLINE <svg>:
- Decorative shapes (circles, blobs, arcs, ribbons, dividers) → inline <svg> with path/circle/rect/polygon. Set \`fill="var(--primary)"\` etc. so they inherit brand tokens.
- Background patterns (gridlines, dots, hatching, isometric grids, noise) → inline <svg> covering the slide region. NOT CSS background-image gradients/patterns — those won't survive the export.
- Icons → inline <svg> paths. **DO NOT** use the Material Icons font, Font Awesome, or any icon-font CSS class — icon fonts don't reliably embed and render as empty boxes or missing glyphs in the export. For a Material icon: copy its SVG path from material-icons.com and inline it inside a 24-viewBox <svg>; size via CSS width/height.
- Logos: brand logo is **always SVG** (raster formats are blocked at upload). The brief provides the SVG markup pre-fetched server-side — inline it directly into each slide where the logo appears, and set \`fill="#hex"\` on the inlined <svg> root for per-slide contrast. See USER RULES for the per-request specifics. (If markup is unavailable on a given run, USER RULES will tell you to use \`<img src="...">\` as a fallback instead.)
- **Radial gradients with alpha and complex multi-stop colour-to-alpha effects** — do these as inline SVG using \`<radialGradient>\` / \`<linearGradient>\` with \`stop-opacity\`; the CSS equivalents don't round-trip.

USE ICONS LIBERALLY TO FILL EMPTY SPACE:
- When a slide section or card has empty vertical/horizontal space, reach for relevant SVG iconography. A grid of feature cards without icons looks underdesigned; the same cards with one icon each per card feels finished.
- Icons should reinforce content meaning: chart/graph icons on data slides, person/group icons on team slides, lightbulb/spark on idea slides, layered-papers on document slides, gear/sliders on settings slides, target/bullseye on goal slides.
- Source SVG paths from material-icons.com (filter by "Outlined" or "Rounded" variants for cleaner look) and inline them. Size 32–80 px depending on card density.

AVOID THESE CSS FEATURES (look fine in preview, break in the export):
- \`animation\`, \`transition\`, \`:hover\`, \`:focus\`, JavaScript, event handlers — static deliverable.
- CSS \`conic-gradient\` and CSS \`color-to-alpha\` linear-gradients — use inline SVG gradients instead.
- \`mix-blend-mode\`, \`backdrop-filter\`, \`filter: blur()\` / \`drop-shadow()\`.
- \`-webkit-text-stroke\` — becomes filled. For outlined text use inline <svg> with <text stroke="..." fill="none">.
- \`rgba()\` colours for transparency on solid fills — alpha doesn't reliably embed. Use \`opacity\` on the element instead (e.g. \`opacity: 0.4\`).
- Webfont URLs not on \`fonts.googleapis.com\` / \`fonts.gstatic.com\` — manifest validation rejects them.

TYPOGRAPHY
- Use \`var(--font-heading)\` for headlines, \`var(--font-body)\` for body. Both have system fallbacks.
- **ONLY TWO font-weight values are allowed across the deck**: \`400\` (regular) and \`700\` (bold). No 500/600/800/900, no named weights ("black", "extra-bold"). Reason: Arabic fonts (Cairo, Tajawal, Almarai) render heavier in the export than in the browser — even at 700 the Arabic glyphs visibly thicken; 800+ produces unreadable ink-bombed text. If a headline needs more emphasis, scale up \`font-size\` or change colour; do not push the weight.
- For Arabic content the heading font you reference must support Arabic shaping — see the DESIGN AESTHETIC section above for picks. The renderer auto-embeds the font from the URL in the manifest.
- Text containers need GENEROUS height — exported font metrics differ slightly from the browser, and a container that snug-fits text in preview will visibly overflow. Budget \`line-height × 1.3\` (or +12-20 % on container height). Prefer \`padding\` on text containers over fixed heights so the box grows naturally.
- **Arabic glyphs render ~15-20 % wider in the export than in the browser.** A headline container that fits Arabic text in one line in preview will wrap to two lines in the exported deck unless you give it room. **Default Arabic headlines and long Arabic single-line text to the FULL available width** (the content layer's full width, not a constrained inner column). Constrained widths are for explicitly two-column / asymmetric layouts where the visual design genuinely needs the headline narrower — and even then, leave +20 % slack over what the browser shows fitting.
- **Arabic bold text (\`font-weight: 700\`) at large sizes (≥ 24 px) renders SUBSTANTIALLY heavier and taller in the export.** Cairo / Tajawal / Almarai bold glyphs are wider AND the bold line-box is taller. For Arabic headlines and any bold Arabic text ≥ 24 px, use \`line-height: 1.5\` minimum — \`1.4\` is too tight and the text overflows its container in the export. Plain (non-bold) Arabic body can stay at 1.4-1.5; bold Arabic needs the bigger headroom.
- **Cards / bordered containers holding Arabic content need REAL padding, not snug-fit:** use \`padding: 32-48 px\` (especially padding-bottom) and let the box grow with content. NEVER set a fixed \`height\` on a card whose content includes Arabic body or headlines — Arabic drifts taller in the export and a fixed-height card causes text to spill outside the visible border. If you need a minimum visual size, use \`min-height\` (which can grow).
- **Arabic tashkeel (diacritic marks: شَدّةٌ شَكْلٌ — fatha/kasra/damma/shadda above and below glyphs) makes a line ~1.4× taller than plain Arabic.** When **body / paragraph text** includes tashkeel marks, budget extra vertical space: bump that container's \`line-height\` to ≥ 1.6 and add ≥ 20 px \`margin-bottom\` on it so the next text block doesn't crash into ascending diacritics. **Does NOT apply to chrome elements** (pills, badges, breadcrumbs, kickers, pagination, brand mark) — these stay at \`line-height: 1\` with their own padding regardless of script.

SLIDE-LEVEL MARGINS — every element respects the same inner margin
Pick a slide-edge margin (typical: 80–120 px) on slide 1 and reuse it identically on EVERY slide. **Use this two-layer pattern**: a full-bleed background layer for things that can touch the slide edge (gradient backgrounds, decorative blobs, hero shapes), and a content layer at fixed inset that hosts EVERY content element (cards, headlines, body, lists, chrome breadcrumbs, pagination).
\`\`\`
<div class="slide" dir="rtl" style="position:relative; width:1920px; height:1080px; background:var(--brand-bg); overflow:hidden;">
  <!-- Background layer: can extend to slide edges -->
  <div style="position:absolute; inset:0; pointer-events:none;">
    <svg width="100%" height="100%" viewBox="0 0 1920 1080" preserveAspectRatio="none">
      <circle cx="1700" cy="200" r="400" fill="var(--primary)" opacity="0.15"/>
    </svg>
  </div>
  <!-- Content layer: every text/card/element lives INSIDE this -->
  <div style="position:absolute; inset:96px;">
    <!-- chrome, headline, body, cards, etc. — all positioned relative to this layer -->
  </div>
</div>
\`\`\`
- Once you've set \`inset:96px\` (or whatever value), nothing in the content layer is allowed to extend past it. A card with \`width:100%\` inside this layer is 1728 px wide and sits 96 px from the slide edge on all sides — DON'T let cards/sections set \`position:absolute; left:0; right:0\` directly on the slide root, that bypasses the margin.
- When a card hosts text, the card's own padding (24–48 px) creates a second layer inside it: slide-margin → card → card-padding → text. Three nested edges, all consistent.
- Inconsistent right/left edges between slides read as a layout bug. Reuse the SAME inset value across every slide.

COLOUR CONTRAST — every text and decorative element must be readable against what's behind it
- Before placing a text element, check its \`color\` against the slide's \`--brand-bg\` (or the local background — a coloured card has its own background). The pair must hit a clear contrast (think WCAG-ish — light text on dark, dark text on light, never near-equal lightness).
- For decorative shapes (SVG fills, accent strips, icons), the same rule: a shape that sits in front of a similar-coloured area becomes invisible. If you place \`fill="var(--primary)"\` on a shape over a panel that's also \`var(--primary)\`-tinted, swap the fill to \`var(--brand-text)\` or \`var(--accent)\` for separation.
- **Concrete forbidden combinations** (these are the slip-ups that have actually shown up):
  - text \`color: var(--brand-bg)\` on a default-background card → text invisible
  - text \`color\` matching the parent container's background hex even when both are non-default → text invisible
  - decorative SVG \`fill="var(--brand-bg)"\` or fill matching the slide background → shape invisible
  - muted/subtitle text whose lightness is within ~10 points of the background's lightness → low contrast, illegible
  - gradient text where one of the gradient stops equals or nearly equals the background colour → that segment of the text disappears
  Before emitting any element with a colour, compute the visible contrast against what sits directly behind it and pick a different token if needed. **Every text and shape must be visible on its background — no exceptions.**

LAYOUT GOTCHAS — cases the export pipeline can't fix for you
- **Pills / badges / chips:** for reliable vertical AND horizontal centering of the text inside the pill (especially Arabic, where glyph baselines sit higher than expected and pure-padding patterns end up visually top-aligned), use \`inline-flex\` with explicit \`align-items: center; justify-content: center\` and \`line-height: 1\`. Pattern:
\`\`\`
<span style="display:inline-flex; align-items:center; justify-content:center; padding:0 22px; height:40px; border:1px solid var(--primary); border-radius:9999px; font-size:16px; line-height:1; text-align:center;">
  رؤيتنا
</span>
\`\`\`
DON'T use \`display: inline-block\` with vertical padding alone — Arabic text appears top-anchored against the border. Always pair \`inline-flex\` + \`align-items: center\` + an explicit \`height\`.
- **Direction-anchored pieces** (e.g. card numbers always on the LEFT of card text even in RTL): use absolute positioning with explicit \`left:\` / \`right:\` rather than relying on flex-direction inversion. Flex containers inherit \`direction\` and flip the row axis silently.
- **Headline + body in the same container:** give the headline an explicit \`margin-bottom\` (or use grid \`gap\`). Exported line metrics differ slightly from the browser; a tight stack overlaps.
- **Single-line text containers** (badges, breadcrumbs, headlines): prefer \`width: max-content\` with \`padding-inline\` over fixed pixel widths. The export pipeline auto-grows short shapes by ~10 % on the side opposite the text anchor to absorb glyph-metric drift, but max-content sidesteps the problem entirely. Single-line text inside a constrained parent (e.g. a card column) needs \`white-space: nowrap\`.
- **Visually-distinct text pieces in flex/grid containers:**
  - **Mixed-script** siblings (e.g. an Arabic title + an English subtitle in one row): the pipeline auto-splits these into separate shapes. Use flex / grid freely.
  - **Single-script** siblings that you want at specific coordinates in the export: use INDEPENDENT absolute positions. The export treats single-script flex children as ONE text block and the visual separation you set up with \`justify-content: space-between\` is lost. Pattern:
\`\`\`
<div class="card" style="position:relative; width:600px; height:400px;">
  <div style="position:absolute; top:32px; left:32px; font-size:96px; opacity:0.4">01</div>
  <div style="position:absolute; top:60px; left:140px; font-size:18px; color:var(--accent)">Fast Creation</div>
  <h3 style="position:absolute; top:200px; right:32px; font-size:48px">إنشاء سريع</h3>
  <p style="position:absolute; bottom:32px; right:32px; left:32px; font-size:20px">عروض كاملة خلال دقائق...</p>
</div>
\`\`\`
- **Decorative shapes must contrast with text:** when an inline <svg> shape sits behind or near a text element, its fill must be visually distinguishable from the text's colour. Don't place a green decorative arc behind a green text label; reach for a different palette token or muted opacity.

CHROME CONSISTENCY
- Decide a chrome pattern on slide 1 — where the headline / kicker / pagination / brand mark lives — and reuse the SAME CSS classes and layout on every content slide. Variation lives in the BODY composition (stats grid vs. quote vs. two-column vs. hero image); the chrome is locked.
- Cover (\`role: "cover"\`) and closing (\`role: "closing"\`) may break the chrome for a hero composition.
- **Chrome elements stay INSIDE the canvas — no negative \`top\` / \`right\` / \`bottom\` / \`left\` positions, ever.** The footer logo / pagination / brand mark must sit fully within 1920×1080. A logo at \`bottom: 32px; right: 32px\` is correct; \`bottom: -8px\` clips off the canvas and the logo disappears in the export.
- **Footer chrome needs CLEARANCE from body content.** Reserve at LEAST 40-60 px between the bottom of the lowest body element (cards / list rows / paragraphs) and the top of the footer chrome row (logo / pagination). When body content is dense, shrink it or extend the bottom inset of the content layer (e.g. \`inset: 96px 96px 140px 96px\`) — don't let cards crash into the logo. Same applies to a top chrome row (kicker / breadcrumb / brand mark on top): leave 40-60 px gap to the headline below it.

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
- Avoid AI slop: don't centre everything, don't pick generic Inter / Roboto / Space-Grotesk fallbacks, don't repeat the same composition on every slide. Compose like a senior designer — strong hierarchy, real grids, considered whitespace, asymmetric balance, distinctive typography, atmospheric backgrounds.
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
      ? `- Pagination: REQUIRED on every slide. Emit EXACTLY ONE small text element per slide showing the page number in "N / Total" form (e.g. "01 / 07"), positioned as part of the locked chrome (typically bottom-left or bottom-right corner). DO NOT emit additional pagination strings like "الصفحة 02" or "صفحة 02 — العنوان" or "PAGE 02 — TITLE" elsewhere on the slide; one numeric indicator is the entire pagination. Use Latin digits + slash (e.g. "02 / 07") even in an Arabic deck so the indicator reads left-to-right.`
      : `- Pagination: DISABLED. Do NOT emit any page-number text element on any slide — no "N / Total", no "الصفحة 02", no "PAGE 02 — title". The user opted out of pagination entirely.`,
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
    // Inline SVG markup pre-fetched server-side from the logo's storage path
    // (see app/api/projects/route.ts → readLogoSvgMarkup). When present,
    // Claude is told to inline this markup directly per slide and override
    // its `fill` per slide for contrast. When null (download failed / not
    // SVG / etc.), fall back to the `<img src=...>` pattern with no
    // per-slide recolouring.
    svgMarkup?: string | null;
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
    if (logo.svgMarkup) {
      // Inline-markup path: brief carries the SVG bytes server-side
      // (fetched by readLogoSvgMarkup). Claude inlines the markup directly
      // per slide and recolours via `fill` on the <svg> root. No <img>, no
      // data-fill custom attributes, no runtime fetch round-trip.
      lines.push(
        ``,
        `Brand logo — inline the SVG markup BELOW directly on every slide where it appears (${scope}). Place it in the ${pos}; same position + size every time (chrome-lock). Box ~120×40 px, always preserve aspect ratio.`,
        ``,
        `Recolour per slide by setting \`fill="#hex"\` on the inlined <svg> root:`,
        `  - Dark slide background → \`fill="#FFFFFF"\` (or a near-white hex).`,
        `  - Light slide background → \`fill="#0C0F13"\` (or a near-black / dark hex from the palette).`,
        `  - Polychrome SVG (the markup already has multiple non-trivial fill colours = a multi-colour brand mark) → DO NOT set \`fill\` on the root; recolouring would destroy brand identity. If the slide background clashes, drop a small neutral panel under the logo instead.`,
        `Design the slide first; then pick the logo \`fill\` that contrasts against the local background you chose. The logo serves the design.`,
        ``,
        `SVG markup:`,
        logo.svgMarkup,
      );
    } else {
      // Fallback path: SVG fetch / parse failed at brief assembly. Use
      // <img src="..."> with the signed URL; the export pipeline's
      // inlineSvgImages preprocess will try to fetch + inline at render
      // time, but per-slide recolouring is not guaranteed on this run.
      lines.push(
        ``,
        `Brand logo (always SVG — raster blocked at upload). SVG markup unavailable on this run; use <img src> as a fallback:`,
        `- Source: ${logoSrc}`,
        `- Place it in the ${pos} of ${scope}. Same position + size on every slide where it appears (chrome-lock). Box ~ 120×40 px, \`object-fit: contain\`.`,
        `- Per-slide recolouring is not available on this generation; design backgrounds the logo reads cleanly against.`,
      );
    }
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
