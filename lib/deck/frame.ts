// FRAME architecture (context/frame-architecture-2026-07-10.md) - the system-
// owned slide frame - the ONLY generation contract since the 2026-07-10
// cutover. It splits ownership:
// the SYSTEM renders everything edge-touching / identity / direction-dependent
// (margins, 6-slot chrome, backgrounds, photo panels, scrims, brand mark, dir),
// and CLAUDE designs composition inside a clipped content WELL, in FLOW ONLY
// (flex/grid - overlap impossible by construction). The freeze bake
// (deck-freeze-bake) later pins the flow layout to absolute boxes for the
// freeform editor.
//
// This module is pure string assembly (no DOM): it parses the declared section
// attributes Claude emits and wraps the well with the system layers. Photo
// backgrounds/panels are emitted as data-genimage boxes so the EXISTING image
// pipeline (warm dispatch + reconcile) generates and fills them - the frame
// adds no new image machinery.

import { isolateLatinRuns } from "@/lib/deck/bidi-isolate";

// ── geometry ────────────────────────────────────────────────────────────────
// Derived from the canvas so every format gets proportional framing. 16:9
// values: margin 64, split 768, band 378, gap 64 at 1920x1080; portrait 3:4
// (1080x1440): margin 36, split 432, band 504, gap 36.
//
// Margin history: the spike used 5% (96px at 16:9) SIZED FOR THE CHROME TEXT
// BANDS that used to render between the well and the canvas edge; the chrome
// was removed 2026-07-10 (owner direction) and the margin shrank in steps.
// The "margins are huge" report turned out to be TWO stacked gaps: the frame
// margin PLUS the model's own .well padding - which is the model's DESIGN.
// Final contract (owner, same day): the frame keeps a 10px SAFETY inset only
// (clearance so content never kisses the canvas edge; overflow is already
// impossible via the clipped well) and the model owns ALL visual margins -
// the prompt says nothing about spacing. Old stored decks are untouched
// (their geometry is baked into their own <style>).
export type FrameCanvas = { width: number; height: number };

export function frameGeometry(canvas: FrameCanvas) {
  const margin = 10; // SAFETY inset only - the model designs its own margins
  const splitW = Math.round(canvas.width * 0.4); // tier-2 split panel width
  const bandH = Math.round(canvas.height * 0.35); // tier-2 band height
  const gap = Math.round(canvas.width / 30); // panel-to-well gap
  return {
    margin,
    splitW,
    bandH,
    gap,
    wellW: canvas.width - margin * 2,
    wellH: canvas.height - margin * 2,
    splitWellW: canvas.width - splitW - gap - margin,
    bandWellH: canvas.height - bandH - gap - margin,
  };
}

// Social carousel playbook (owner direction 2026-10-08): how high-performing
// carousels are built, applied to EVERY social post, with the user's own text
// always winning where it is explicit. Replaces the deck text budget for
// social (decks want 50-90 words a slide; a feed card is read in seconds).
const SOCIAL_PLAYBOOK = `CAROUSEL PLAYBOOK - build every carousel the way top-performing feed carousels are built, shaped by THIS brief. ‼️ The user's own input wins: when the brief states a count, an order, the points to cover, a tone, an offer or a call to action, follow it exactly; this playbook fills only what the user left open.

1. PICK THE FORMAT from the topic (and the product photo, if any), then build to it:
   - Tips / list ("5 ways to..."): hook, one tip per card, recap, CTA.
   - How-to / steps: hook with the end result, one numbered step per card in order, the result, CTA.
   - Product or offer showcase: hook on the main benefit, then the product's real features and uses (one per card), who it is for, the offer only if the user gave one, CTA.
   - Myth vs fact, mistakes vs fixes, before / after, this vs that: hook, one pair per card in a repeated split layout, takeaway, CTA.
   - Story / case: hook on the outcome, problem, turning point, result, lesson, CTA.
   - Insight / data: hook with the key finding, one point per card, what it means, CTA.
   - Announcement / event: hook with the news, what, when and where (only details the user gave), why it matters, CTA.
2. CARD 1 IS THE HOOK: it alone decides whether anyone swipes. One bold promise, question, number or tension in at most 8 words, set very large, with one strong visual and a quiet swipe cue. Never a plain title like "About our product".
3. CARD 2 DELIVERS AT ONCE: feeds re-show a carousel starting from card 2, so it must stand alone and give real value immediately (the first tip, the core benefit), never an intro or a table of contents.
4. ONE IDEA PER CARD: a short headline (at most 8 words) and at most about 25 words of supporting text, so each card is read in 3 seconds on a phone. Type stays large: the main text on a body card is never smaller than one twenty-fifth of the card width. Never the deck habit of dense cards.
5. A SERIES, NOT SEPARATE POSTS: keep one layout system and type scale across the body cards (same headline position, same number badge for lists and steps) so the swipe feels continuous; change emphasis, not structure. Number the cards only when the content is a list or steps.
6. KEEP THEM SWIPING: each body card should earn the next (an open question, "next:", a progression); never resolve everything early.
7. THE LAST CARD IS ONE CALL TO ACTION that fits the format: save for later, share, follow, comment, send a message, or shop / order for a product. One action, said plainly. Use the user's own contact, handle, link or price only when the brief gives it; never invent one. A short recap card before it is welcome for lists and steps.
8. NO DECK HABITS: no chapter or section divider cards ("Part 2", "Chapter two"), no agenda, no "Thank you" card, no page numbers like "01 / 07".
9. TRUTHFUL CONTENT: never invent facts the user did not give: no statistics, percentages, durations, counts, prices, discounts, awards, certifications, guarantees, customer quotes or testimonials, and no "our customers say". Without real numbers, use qualitative wording. A quote card needs a quote from the brief.
10. STAY ON THE SUBJECT: every card and every image is about the user's actual subject. Images show that subject, its use, its details or its setting, never a different item of the same kind (another product, another place) and never unrelated decoration. Facts about use, care and materials must suit what the subject really is (a bag is carried and stored, not washed or worn; suede is brushed, not washed). When the brief does not say, stay general rather than guess.`;

// ── the frame prompt ────────────────────────────────────────────────────────
// Parameterized variant of SYSTEM_PROMPT_CREATE_HTML for frame decks. Proven
// on the 2026-07-10 spike (scratchpad/frame-gen): first-shot compliance was 0
// dir attrs / 0 hotlinked images / 0 absolute-in-well across every run.
export function frameSystemPrompt(opts: {
  canvas: FrameCanvas;
  language: "ar" | "en";
  imagesMode: boolean;
  // "social" = the 3:4 carousel variant: posts persona, phone-feed framing,
  // no PPTX AVOID list (3:4 exports PDF/PNG rendered by real Chrome), bands
  // favored over splits (splits are narrow at 1080 wide). Defaults to "deck".
  kind?: "deck" | "social";
  // Haiku and Sonnet runs: appends LAYOUT_RULES (usesLayoutRules). Off for Opus and
  // Fable, so their prompt (and its cache) stays byte-identical.
  layoutRules?: boolean;
}): string {
  const { canvas, language, imagesMode } = opts;
  const social = opts.kind === "social";
  // Social posts can be portrait (4:5/9:16), square (1:1), or landscape (16:9),
  // so the persona describes the card shape from the canvas, never assumes it.
  const orient =
    canvas.height > canvas.width
      ? "portrait"
      : canvas.width > canvas.height
        ? "landscape"
        : "square";
  const g = frameGeometry(canvas);
  const { wellW, wellH, splitWellW, bandWellH } = g;
  const ar = language === "ar";

  // Direction is NATIVE to the deck language (owner contract 2026-07-10): no
  // authored-LTR mirroring - bg photos don't flip, so mirrored compositions
  // break against them. RTL drift is caught downstream, never guess-rewritten.
  const langBlock = ar
    ? `‼️ LANGUAGE & DIRECTION - this deck is ARABIC: design natively RTL. The system sets dir="rtl" on every slide root (do NOT set dir yourself). The eye enters from the RIGHT: lead text blocks and columns anchor to the visual RIGHT, secondary/decorative elements to the LEFT; body text right-aligned. Flex keywords are LOGICAL under RTL: align-items/justify-content flex-START anchors to the reading side (the RIGHT) and flex-END anchors LEFT - to anchor content to the reading edge use flex-start, never flex-end. Do NOT set dir on child blocks that contain Latin letters; for an inline Latin run inside an Arabic sentence (URL, email, English word) wrap just that run in <span dir="ltr">. Digit-only blocks (pagination "01 / 07", dates, phone numbers) - dir="ltr" on that block IS fine (the digits would otherwise reorder under the RTL paragraph direction), but give it an explicit text-align: dir=ltr makes start-alignment mean LEFT. Numbers are ALWAYS Latin digits (0-9), never Arabic-Indic (٠-٩). letter-spacing on Arabic-bearing elements is stripped at export.`
    : `LANGUAGE & DIRECTION - this deck is ENGLISH (LTR). The system sets dir="ltr" on every slide root (do NOT set dir yourself).`;

  const bgKinds = imagesMode
    ? `data-bg="color|image|split-start|split-end|band-top|band-bottom"`
    : `data-bg="color"`;

  const imageBlocks = imagesMode
    ? `
BACKGROUND KINDS -
- "color": flat/gradient ground (data-bg-css).
- "image": FULL-BLEED photo behind everything (data-bg-prompt + data-bg-scrim). ‼️ The ONLY layout where your text may sit over a photo - the system's scrim guarantees legibility.
- "split-start"/"split-end": a full-height photo panel (${g.splitW}px wide) bleeding to that edge. LOGICAL sides: start = the reading side (${ar ? "visual RIGHT in this RTL deck" : "visual LEFT"}). Your well sits on the opposite side. Add data-bg-css to tint the remaining ground.
- "band-top"/"band-bottom": a full-width photo band (${g.bandH}px tall) on that edge; your well takes the rest. Add data-bg-css for the remaining ground.${social ? " Portrait cards favor bands and full-bleed; splits are narrow at this width." : ""}

IN-WELL CONTENT IMAGES - inside the well you may reserve FRAMED photo slots as content blocks (photo cards, gallery tiles, a portrait beside a quote):
  <img data-genimage="<textless photo prompt - SUBJECT/SCENE/MOOD>" data-genid="<unique-id>" alt="" style="width:…px;height:…px;object-fit:cover;display:block;background:<a brand-tinted placeholder gradient>;"/>
  • NO src - the system generates and fills it. Set width/height in px (the system reads the shape). Round corners/borders welcome.
  • data-genimage describes SUBJECT / SCENE / MOOD only - never text, letters, numbers, logos, signage, charts, or UI inside the image (stripped server-side); keep it trademark-safe (no real brand / person / team / character names). One consistent medium + mood across the whole deck.
  • ‼️ NEVER place text on top of a well image, and never draw a scrim/overlay on one - text-over-photo happens ONLY via data-bg="image" or a split/band panel. Well images are clean framed blocks BESIDE/AROUND text.

REAL PEOPLE, TEAMS AND BRANDS (every photo prompt, background or in-well) - the image generator cannot and must not depict a real, named person. When a slide is about one (a footballer, a CEO, a founder, a historical figure) or a real team / brand, picture THEIR WORLD instead: the arena, stadium, pitch, stage, workplace, city, era, equipment or trophy, in their colours and setting. Never a stand-in or lookalike person, never an unrelated metaphor (a random child, a stranger), and no identifiable face meant to read as them; people in that scene are an anonymous crowd, distant or from behind. Real PLACES and landmarks are fine to depict as they are.
`
    : `
BACKGROUND KINDS - "color" only for this deck: a flat or gradient ground via data-bg-css. Do not reference photos anywhere.
`;

  const wellSizes = imagesMode
    ? `   - data-bg="color" or "image": well = ${wellW}x${wellH}px
   - data-bg="split-start" or "split-end": well = ${splitWellW}x${wellH}px (the panel takes the other side)
   - data-bg="band-top" or "band-bottom": well = ${wellW}x${bandWellH}px (the band takes the other edge)`
    : `   - well = ${wellW}x${wellH}px`;

  // Deck text budget; social uses the playbook's own (rule 4) instead.
  const textBudget = social
    ? `- ‼️ CARD FIT - every card must FIT its well on the first try at the playbook's sizes (rule 4). When the source has more than fits, SUMMARIZE: keep the strongest points and cut the rest. Never shrink fonts or squeeze spacing to cram text in. Before closing each card, estimate its height (each text line is roughly font-size x line-height, plus padding and gaps) against the well; if it would not fit, cut words until it does.`
    : `- ‼️ TEXT BUDGET - every slide must feel COMPLETE and still FIT on the first try. Content slides: aim for 50 to 90 words in total (subtitle, cards, bullets, captions and footers all count), enough substance that the slide is worth reading, never a near-empty slide. Cover, section, quote and closing slides stay short. Headline: at most 12 words. Cards, bullets or rows: at most 6, each at most 18 words, and never a list of one (use 3 or more items, or no list at all). When the source has more than fits, SUMMARIZE: keep the strongest points and cut the rest. Never shrink fonts below a comfortable reading size or squeeze spacing to cram text in. Before closing each slide, estimate its height (each text line is roughly font-size x line-height, plus padding and gaps) against the well; if it would not fit, cut words until it does.`;

  return `${social ? `You are an elite social media designer. Design an original carousel of ${canvas.width}x${canvas.height} ${orient} cards for a social feed, fresh for this brief, as one HTML fragment. Open with a hook that stops the scroll.

${SOCIAL_PLAYBOOK}` : `You are a world-class presentation designer. Design a complete, ORIGINAL slide deck - your own visual system, fresh for this brief - as one HTML fragment. Bespoke and editorial, never a generic template.`}

THE FRAME IS SYSTEM-OWNED. Each slide has two layers; you author only what is declared here:
1. BACKGROUND - you DECLARE it per slide via section attributes (below); the system renders it. You never draw backgrounds or edge-to-edge imagery yourself.
2. CONTENT WELL - your canvas. Inside each <section>, emit EXACTLY ONE <div class="well">…</div> and design everything in it. Treat the well's edges as the slide edges. Content outside it is clipped. Its size depends on the background you declare:
${wellSizes}

${langBlock}

OUTPUT - emit exactly this, with NOTHING else (no prose, no fences, no JSON, no <!DOCTYPE>/<html>/<head>/<body>):
1. ONE <style> block FIRST - your design system: CSS custom properties + component classes built ON the injected brand variables. Define styling ONCE and reuse via classes.
2. THEN the slides, each:
<section data-label="<short ${ar ? "Arabic" : ""} name>" data-role="cover|content|section|stats|quote|image|closing"
         ${bgKinds}
         data-bg-css="<any CSS background value for the non-photo area, e.g. var(--brand-1) or a linear-gradient>"${imagesMode ? `
         data-bg-prompt="<for image/split/band: a concrete textless photo prompt - SUBJECT / SCENE / MOOD, no text/logos/people-brands>"
         data-bg-scrim="none|soft|strong"` : ""}>
  <div class="well"> …your design… </div>
</section>
${imageBlocks}
- The FIRST character of your response is \`<\` (your <style>).
- The COVER <section> also carries data-deck-title="…" (3-8 words, in the deck's language, a real title - becomes the project name) AND data-deck-slides="N" = the TOTAL number of slides you intend to produce for this deck (your honest plan, cover + body + closing, within any maximum the Brief sets). It drives the generating progress bar, so make it match the deck you actually build.
- Slides are TOP-LEVEL siblings - never nest a <section>. Exactly one .well per section, nothing else inside the section.
- There is NO wrapper element around your output: never write CSS through an imagined container (e.g. \`.deck x\`, \`.wrapper x\` - those selectors match NOTHING). Base styles go on .well or your own classes.
- ‼️ Design the well in FLOW ONLY: flex and grid (display:flex/grid, flex-direction, gap, padding, margin, flex:1, aspect-ratio, align-items/justify-content). NEVER position:absolute/relative offsets, NEVER left/top, NEVER transforms, NEVER negative margins inside the well - the layout must be pure document flow, so nothing can ever overlap. Give .well itself display:flex;flex-direction:column (or grid) filling its box; distribute space with gap, flex:1, and auto margins. Px font sizes and fixed px sizes for images/cards are fine. Plan each slide so content FITS its well without overflowing.
${textBudget}
- ‼️ FILL THE SLIDE - the text budget limits WORDS, not presence. Compose so the content occupies most of the well (roughly 75 to 90 percent of its height), with no large dead zones: size the headline, body and cards up to the space (bigger type, taller cards, more generous padding) instead of leaving small blocks floating in an empty slide. Every card is filled by its content: no card that is mostly empty space; when a card's text is short, make the card smaller or give it a supporting element (a large number, an icon, a short accent line). Small labels, eyebrows and card numbers must contrast strongly with the surface they sit on, never the same or a near colour as their background.
- ‼️ PEER ALIGNMENT - cards, columns or steps that sit side by side are peers: their matching parts must line up across the row. Align each peer's content to the TOP (justify-content:flex-start), never vertically centre the content of peers whose text lengths differ; every peer's icon, title, divider and first line of body starts at the same height. Give the peers the same structure (same element order, same title size), and when one is shorter, let the extra space fall at its BOTTOM (or push a closing element down with margin-top:auto), never split above and below.
- Write every repeated item (list rows, cards, steps, table cells) out IN FULL as elements. There is NO template engine: never use a JS loop, \`.map()\`, \`+\` concatenation, or \`\${…}\`.
- Decide the slide count from the brief (match \`brief.slideCount\` when given; else adapt).
- VARY the composition slide to slide: different FLOW structures, one coherent look.
- COPY: never use the em dash or the en dash in any text; use a comma, colon, or plain hyphen instead.
- SELF-CORRECTION - if AFTER emitting a slide you realize it has a real flaw (content overflowing the well, broken hierarchy, a block anchored to the wrong side, imbalanced composition), re-emit the ENTIRE corrected <section> with the same attributes PLUS data-revises="N" (N = the 1-based position of the slide it replaces, counting from the cover). The system swaps the corrected slide in place of the old one. Re-emit ONLY when the fix is meaningfully better; never re-emit an unchanged slide, and never use data-revises on a first-time slide.

BRAND & COLOUR - the brand variables are INJECTED for you; reference them, don't redefine them.

GRAPHICS - icons: inline an <svg viewBox="0 0 24 24"> with a REAL icon's path data from a standard open set (e.g. Lucide), stroked or filled in a brand colour. Charts / graphs: inline <svg>. Country flags: <img src="https://flagcdn.com/<cc>.svg"> (lowercase ISO code). NEVER hotlink any other external image${imagesMode ? " - photographic imagery ONLY via data-bg-prompt or an in-well data-genimage slot" : ""}.

AVOID (these don't render in export): conic-gradient, colour-to-alpha gradients, mix-blend-mode, backdrop-filter, filter: blur() / drop-shadow(), -webkit-text-stroke (use <svg><text stroke fill="none">), rgba() for translucency on a fill (use opacity on the element). Static only - no animation / transition / :hover / :focus / JS.
ALSO AVOID: !important, viewport units (vw/vh/vmin/vmax), @media, position: fixed.${opts.layoutRules ? `\n\n${LAYOUT_RULES}` : ""}`;
}

// Extra layout rules for Haiku (2026-10-13) and Sonnet (2026-10-15) runs. They follow the prose
// rules above loosely: on a 31-slide enhance deck the type was tiny, cards were
// half empty and a label sat far from the text it names. These are concrete,
// checkable numbers instead of judgement calls.
const LAYOUT_RULES = `LAYOUT CHECKLIST - check every slide against this before closing it:
- ‼️ TYPE SIZE: body text, bullets and card text are at least 26px; chips, labels and captions at least 20px; headlines at least 56px; the cover and section titles at least 80px. Never smaller, even when the source text is short. Short text means a bigger size, not a smaller one.
- ‼️ NO EMPTY CARDS: a card or panel is as tall as its content plus padding. Never stretch a card (flex:1, align-items:stretch, a fixed height) to fill the well when its text is short; let it hug its content and size the type up instead. At most 20 percent of a card's height may be empty.
- ‼️ LABELS STAY WITH THEIR TEXT: a tag, chip or caption that names a block sits directly above or below that block, inside the same flex column, never in a separate row at the far edge of the slide. Parallel blocks (two columns, a before and after) each carry their own label in the same position.
- ‼️ NO DEAD ZONE: never use margin-top:auto, justify-content:space-between or a fixed height to push a row or card group to the bottom when that leaves more than about 120px of empty space above it. Keep the title, text and cards together as one group with a normal gap (32 to 48px), and use up the rest of the slide with bigger type: big numbers at 72px or more, card text at 28px or more. One large element beats three small ones floating apart.
- ‼️ NO ORPHAN DIAGRAMS: a hub, node or pill that is meant to connect to other blocks needs real connectors. Draw every line, arrow or connector as an inline <svg> with explicit width and height, NEVER as an empty <div> (an empty div collapses to zero height and the line vanishes, leaving the node floating alone). If you cannot draw the connectors, do not use a hub: use a plain row or grid of cards instead.
- Fill the well: content together spans at least 70 percent of its height. If a slide has little text, use one larger element (a big quote, a large number, a bigger card) rather than small elements floating in space.
- Keep the source wording. Do not shorten, merge or reword the user's text; only fix an obvious typo.`;

// ── system CSS (logical properties: chrome + panels auto-mirror under dir) ──
export function frameSystemCss(canvas: FrameCanvas): string {
  const g = frameGeometry(canvas);
  const { wellW, wellH } = g;
  return (
    `.tq-canvas{position:relative;background:var(--brand-bg)}` +
    `.tq-canvas .tq-bg{position:absolute;inset:0;z-index:0}` +
    `.tq-canvas .tq-bg>img{width:100%;height:100%;object-fit:cover;display:block}` +
    `.tq-canvas .tq-panel{position:absolute;z-index:0;overflow:hidden}` +
    `.tq-canvas .tq-panel>img{width:100%;height:100%;object-fit:cover;display:block}` +
    `.tq-canvas .tq-panel.ps{inset-inline-start:0;top:0;width:${g.splitW}px;height:100%}` +
    `.tq-canvas .tq-panel.pe{inset-inline-end:0;top:0;width:${g.splitW}px;height:100%}` +
    `.tq-canvas .tq-panel.bt{top:0;inset-inline-start:0;width:100%;height:${g.bandH}px}` +
    `.tq-canvas .tq-panel.bb{bottom:0;inset-inline-start:0;width:100%;height:${g.bandH}px}` +
    `.tq-canvas .tq-scrim{position:absolute;inset:0}` +
    `.tq-canvas .tq-scrim.soft{background:linear-gradient(to top,rgba(10,12,16,.78) 0%,rgba(10,12,16,.38) 45%,rgba(10,12,16,.14) 100%)}` +
    `.tq-canvas .tq-scrim.strong{background:linear-gradient(to top,rgba(10,12,16,.9) 0%,rgba(10,12,16,.62) 45%,rgba(10,12,16,.3) 100%)}` +
    `.tq-canvas .tq-well{position:absolute;top:${g.margin}px;inset-inline-start:${g.margin}px;width:${wellW}px;height:${wellH}px;z-index:1;overflow:hidden}` +
    `.tq-canvas .tq-well>.well{width:100%;height:100%}` +
    // The chrome layer is an EMPTY STRUCTURE SENTINEL (owner direction
    // 2026-07-10: the system draws NOTHING the user didn't choose - the
    // flow's pagination/persistent variables hand off to Claude, and the
    // system stopped rendering identity chrome). The empty div stays as the
    // slide's LAST layer so the bake's structure check can detect
    // markup-eating corruption (an unterminated model attribute swallowing
    // the layer boundary) - and old stored decks carry their own copy of the
    // former slot CSS inside their baked <style>, so deleting the rules here
    // does not affect them.
    `.tq-canvas .tq-chrome{position:absolute!important;inset:0!important;z-index:2!important;pointer-events:none!important}`
  );
}

// ── declared-attribute parsing ──────────────────────────────────────────────
export type FrameSlideDecl = {
  label: string;
  role: string;
  bg: string;
  bgCss: string | null;
  bgPrompt: string | null;
  /** data-bg-source - "product" marks a photo background that must be
   *  generated FROM the user's uploaded product photo (social flow).
   *  Claude authors the bare marker; deck-generate resolves it to bgRef. */
  bgSource: string | null;
  /** data-bg-ref - the product photo URL, stamped server-side (never by
   *  Claude) and persisted on the stored section so post-hoc re-assemblies
   *  (vision revision, partial regen, unlock) re-emit it without the brief. */
  bgRef: string | null;
  bgScrim: "none" | "soft" | "strong";
  deckTitle: string | null;
  /** Cover's data-deck-slides = the model's declared intended slide total
   *  (drives the auto generating-nav count). Raw attr string; caller parses. */
  deckSlides: string | null;
  /** Claude's ENTIRE well div (modifier classes carry its CSS), or the section
   *  inner HTML as a fallback when the well tag is missing. */
  wellHtml: string;
};

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag);
  return m ? m[1] : null;
};

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// SELF-CORRECTION marker (thinking mode re-emits improved slides; the prompt's
// revision contract makes that explicit): `data-revises="N"` on a re-emitted
// section = replace the deck's N-th slide (1-based). Returns the 0-based index,
// or null when absent/invalid. Ingest MUST check this BEFORE the slide-cap
// guard - a correction arriving after the deck hit its slide count would
// otherwise abort the stream and be dropped (the pre-2026-07-10 behavior that
// locked in first drafts).
export function parseFrameRevises(sectionHtml: string): number | null {
  const openTag = /<section\b[^>]*>/i.exec(sectionHtml)?.[0] ?? "";
  const raw = attr(openTag, "data-revises");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n - 1 : null;
}

export function parseFrameSlide(sectionHtml: string): FrameSlideDecl {
  const openTag = /<section\b[^>]*>/i.exec(sectionHtml)?.[0] ?? "<section>";
  // Keep Claude's ENTIRE well div - its modifier classes ("well cov") carry
  // its stylesheet rules. Fallback: the raw section content (degraded but
  // lossless; the frame still wraps it).
  const wellMatch =
    /(<div class="well[^"]*"[^>]*>[\s\S]*<\/div>)\s*<\/section>\s*$/i.exec(
      sectionHtml,
    );
  const scrim = attr(openTag, "data-bg-scrim");
  return {
    label: attr(openTag, "data-label") ?? "",
    role: attr(openTag, "data-role") ?? "content",
    bg: attr(openTag, "data-bg") ?? "color",
    bgCss: attr(openTag, "data-bg-css"),
    bgPrompt: attr(openTag, "data-bg-prompt"),
    bgSource: attr(openTag, "data-bg-source"),
    bgRef: attr(openTag, "data-bg-ref"),
    bgScrim: scrim === "soft" || scrim === "strong" ? scrim : "none",
    deckTitle: attr(openTag, "data-deck-title"),
    deckSlides: attr(openTag, "data-deck-slides"),
    wellHtml: wellMatch
      ? wellMatch[1]
      : sectionHtml
          .replace(/^<section\b[^>]*>/i, "")
          .replace(/<\/section>\s*$/i, ""),
  };
}

// ── assembly ────────────────────────────────────────────────────────────────
// Deck-level context accumulated while slides stream (the cover carries the
// deck identity accumulated as slides stream (the cover declares it).
export type FrameDeckCtx = {
  direction: "rtl" | "ltr";
  // Cover-declared title, re-stamped on the stored cover section (it feeds
  // the manifest/project title extraction). NOT rendered anywhere.
  deckTitle: string | null;
  // NOTE (owner direction 2026-07-10, twice): the chrome layer renders
  // NOTHING the user didn't choose. The flow's variables (pagination,
  // persistent text) hand off to Claude via ruleLines with no position
  // words, and Claude places them in its design (frozen + audited like any
  // well content). The system's identity chrome (brand mark, kicker,
  // running title) was removed the same day it shipped - it stamped every
  // slide with repeated titles nobody asked for.
};

// Genids the SYSTEM invents for bg/panel boxes must satisfy the pipeline's
// SAFE_GENID charset ([A-Za-z0-9._-]) - slide indexes do.
const bgGenId = (slideIndex: number) => `tqframe-bg-${slideIndex + 1}`;

// Latin numerals ONLY (house rule): the prompt's LANG block already demands
// 0-9, but the model occasionally emits Arabic-Indic anyway (slide-4 stats +
// cover year, caught live 2026-07-10) - so the rule is ENFORCED here, at the
// assembly chokepoint every path shares (generation, vision revisions,
// partial regen). A 1:1 code-point map; these code points only ever occur in
// human text, so a whole-string pass is safe. Includes Extended Arabic-Indic
// (Persian forms some models mix in) and the Arabic percent/decimal marks so
// "٦٥٪" becomes "65%", not "65٪".
const LATIN_DIGIT_MAP: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
  "٪": "%", "٫": ".", "٬": ",",
};
export function latinizeDigits(html: string): string {
  return html.replace(/[٠-٩۰-۹٪٫٬]/g, (ch) => LATIN_DIGIT_MAP[ch] ?? ch);
}

export function assembleFramedSlide(
  decl: FrameSlideDecl,
  ctx: FrameDeckCtx,
  slideIndex: number,
  canvas: FrameCanvas,
): string {
  const g = frameGeometry(canvas);
  const { splitWellW, bandWellH } = g;
  const placeholder =
    "background:linear-gradient(to top,var(--brand-1),var(--brand-2))";
  const scrimDiv =
    decl.bgScrim !== "none"
      ? `<div class="tq-scrim ${decl.bgScrim}"></div>`
      : "";
  // Photo layers are data-genimage BOXES: the existing warm/reconcile pipeline
  // generates + injects the src (aspect via explicit data-genaspect - these
  // boxes are %-sized so px derivation has nothing to read).
  const isProductBg = decl.bgSource === "product";
  const bgImg = (aspect: "landscape" | "portrait") =>
    `<img data-genimage="${esc(decl.bgPrompt ?? "")}" data-genid="${bgGenId(slideIndex)}" data-genaspect="${aspect}"` +
    (isProductBg ? ` data-gensource="product"` : "") +
    (isProductBg && decl.bgRef ? ` data-genref="${esc(decl.bgRef)}"` : "") +
    ` alt="" style="width:100%;height:100%;object-fit:cover;display:block;${placeholder}"/>`;

  // ── Layer 0: ground + tier-1 full-bleed / tier-2 panel ──
  const ground = decl.bgCss
    ? `<div class="tq-bg" data-tq-lock="1" style="background:${esc(decl.bgCss)}"></div>`
    : `<div class="tq-bg" data-tq-lock="1"></div>`;
  let panelHtml = "";
  let wellStyle = "";
  if (decl.bg === "image" && decl.bgPrompt) {
    panelHtml = `<div class="tq-bg" data-tq-lock="1">${bgImg("landscape")}${scrimDiv}</div>`;
  } else if (
    (decl.bg === "split-start" || decl.bg === "split-end") &&
    decl.bgPrompt
  ) {
    const cls = decl.bg === "split-start" ? "ps" : "pe";
    panelHtml = `<div class="tq-panel ${cls}" data-tq-lock="1">${bgImg("portrait")}${scrimDiv}</div>`;
    wellStyle =
      decl.bg === "split-start"
        ? ` style="inset-inline-start:${g.splitW + g.gap}px;width:${splitWellW}px"`
        : ` style="width:${splitWellW}px"`;
  } else if (
    (decl.bg === "band-top" || decl.bg === "band-bottom") &&
    decl.bgPrompt
  ) {
    const cls = decl.bg === "band-top" ? "bt" : "bb";
    panelHtml = `<div class="tq-panel ${cls}" data-tq-lock="1">${bgImg("landscape")}${scrimDiv}</div>`;
    wellStyle =
      decl.bg === "band-top"
        ? ` style="top:${g.bandH + g.gap}px;height:${bandWellH}px"`
        : ` style="height:${bandWellH}px"`;
  }

  // ── Layer 1: the well (Claude's flow design, verbatim) ──
  // RTL decks: Latin / number runs get their LTR isolation here whatever the model
  // did (lib/deck/bidi-isolate.ts) - the one chokepoint generation, vision
  // revisions and partial regen all share.
  const wellBody =
    ctx.direction === "rtl" ? isolateLatinRuns(decl.wellHtml) : decl.wellHtml;
  const wellHtml = `<div class="tq-well"${wellStyle}>${wellBody}</div>`;

  // ── Layer 2: chrome = an EMPTY structure sentinel ──
  // The system renders NOTHING here (owner direction 2026-07-10: chrome only
  // carries what the user chose, and those variables hand off to Claude).
  // The empty div stays as the slide's LAST layer purely so the bake's
  // structure check can detect markup-eating corruption (an unterminated
  // model attribute swallowing the layer boundary swallows this div).
  const chromeHtml = `<div class="tq-chrome" data-tq-lock="1"></div>`;
  const isCover = decl.role === "cover";

  // data-tq-frame marks the deck as frame-architecture for every consumer
  // (the editor NEVER runs its flatten on frame decks - frozen or awaiting
  // the bake); data-tq-frozen is stamped later by deck-freeze-bake. The
  // DECLARED attrs are preserved on the stored section so post-hoc passes
  // (the render-audit self-fix, future partial regen) can reconstruct the
  // model's authoring view without the original stream.
  return latinizeDigits(
    `<section dir="${ctx.direction}" data-tq-frame="1" data-label="${esc(decl.label)}" data-role="${esc(decl.role)}"` +
      ` data-bg="${esc(decl.bg)}"` +
      (decl.bgCss ? ` data-bg-css="${esc(decl.bgCss)}"` : "") +
      (decl.bgPrompt ? ` data-bg-prompt="${esc(decl.bgPrompt)}"` : "") +
      (decl.bgSource ? ` data-bg-source="${esc(decl.bgSource)}"` : "") +
      (decl.bgRef ? ` data-bg-ref="${esc(decl.bgRef)}"` : "") +
      (decl.bgScrim !== "none" ? ` data-bg-scrim="${decl.bgScrim}"` : "") +
      (isCover && ctx.deckTitle ? ` data-deck-title="${esc(ctx.deckTitle)}"` : "") +
      `>${ground}${panelHtml}${wellHtml}${chromeHtml}</section>`,
  );
}

// ── stored-slide helpers for post-hoc passes (audit self-fix) ───────────────
// The assembled section is deterministic (ground → panel → well → chrome), so
// Claude's well div can be re-extracted from the STORED html.
export function extractStoredWell(storedHtml: string): string | null {
  const m = /<div class="tq-well"[^>]*>([\s\S]*?)<\/div><div class="tq-chrome/.exec(
    storedHtml,
  );
  return m ? m[1] : null;
}

// The section's open-tag declared attributes (for the fix call's context).
export function extractStoredSectionTag(storedHtml: string): string {
  return /<section\b[^>]*>/i.exec(storedHtml)?.[0] ?? "<section>";
}

// Rebuild the deck ctx from the stored COVER section (attrs stamped above).
export function frameCtxFromStoredCover(
  coverHtml: string,
  direction: "rtl" | "ltr",
): FrameDeckCtx {
  const tag = extractStoredSectionTag(coverHtml);
  return {
    direction,
    deckTitle: attr(tag, "data-deck-title"),
  };
}

// ── PARTIAL REGEN (single slide, frame decks) ───────────────────────────────
// The studio's redesign / apply-comments call for ONE slide of an existing
// frame deck. system = frameSystemPrompt verbatim (prompt cache shared with
// generation + the vision pass); this user message overrides the output
// shape: exactly ONE corrected section, no deck <style>. The stored well is
// FROZEN machine output (the bake pinned every element to absolute
// coordinates), so the message frames it as content + look reference and
// demands a pure-flow rebuild. Feeding pinned code back through the legacy
// pre-frame prompt was the regen DRIFT class (caught live 2026-07-10: the
// .well class dropped, so the deck font and the 96/110px well padding
// matched nothing; every repeat regen degraded further).
export type FrameRegenComment = { content: string; box: string | null };
export type FrameRegenInput = {
  position: number; // 1-based deck position
  total: number; // deck size
  sectionTag: string; // stored open tag (carries the declared attrs)
  wellHtml: string; // current well - frozen machine output
  comments: FrameRegenComment[]; // empty = redesign mode
};

export function frameRegenUserMessage(
  input: FrameRegenInput,
  deckCss: string,
): string {
  const intent = input.comments.length
    ? `USER COMMENTS - apply faithfully, minimally
Rebuild the SAME visual design in pure flow, changing ONLY what the comments ask. Every element a comment does not reference keeps its content, styling, and place in the composition. If a comment is ambiguous, prefer the conservative interpretation; if comments conflict, the later one wins.
${input.comments
  .map(
    (c, i) =>
      `  ${i + 1}. ${c.box ? `Region (slide-space): ${c.box}\n     ` : ""}"${c.content.replace(/"/g, '\\"')}"`,
  )
  .join("\n")}`
    : `REDESIGN BRIEF - variation REQUIRED
The user hit "redesign this slide" wanting a fresh visual approach. Keep every piece of content VERBATIM (headlines, body text, lists, labels, statistics, captions) - change the composition. Pick a distinctly different flow structure than the current slide; a result that reads the same at a glance is a failure.`;

  return `PARTIAL REGEN - redesign ONE slide of an EXISTING deck (slide ${input.position} of ${input.total}). The rest of the deck is fixed.

CURRENT SLIDE - section attributes:
${input.sectionTag}

CURRENT WELL CODE - FROZEN machine output: the export pipeline pinned every element to absolute coordinates. It is a CONTENT and look reference ONLY, never a layout to copy - your reply must be authored in pure flow per the system rules.
${input.wellHtml}

Shared deck stylesheet (FIXED - you cannot change it; reuse its classes or use inline styles, and do NOT emit a <style> block):
${deckCss}

${intent}

RULES:
- Reply with EXACTLY ONE corrected <section> in the generation contract: keep the declared data attributes from the section tag above (change data-bg-css only if your design needs it; keep data-label and data-role), containing exactly one <div class="well"> in PURE FLOW. No <style> block, no data-revises, no prose, no fences - the FIRST character of your reply is the < of the section.
- Never copy position:absolute, left/top offsets, or fixed pixel insets from the current code - they are machine output, not design.
- Keep the message and text content as written${input.comments.length ? " except where a comment asks otherwise" : ""}.
- Preserve every <img> src EXACTLY. Keep data-genimage boxes exactly as they are (same data-genimage, data-genaspect, data-gensource, and data-genref values, no new image slots). Keep every <img data-asset> (the user's own picture) and every <div data-table> box (the user's own table) on the slide with its attributes and contents unchanged: you may move and resize them, never remove, replace or rewrite them.
- Numerals in RTL decks: a digit block with dir="ltr" renders text-align:start as LEFT - keep dir=ltr, set text-align explicitly to place the numerals where the composition needs them.`;
}

// ── TEASER UNLOCK (continuation, frame decks) ───────────────────────────────
// A free deck was authored as a `total`-slide arc but only the first
// `visibleCount` slides were streamed (the rest were withheld as a paywall
// teaser). When the owner subscribes, this authors the WITHHELD tail
// (positions visibleCount+1 .. total) as net-new slides that COMPLETE the arc,
// on Opus, comped. system = frameSystemPrompt verbatim (shared prompt cache);
// this user message overrides the output to N continuation sections, no deck
// <style> (the shared deck css is FIXED and passed in), seeded with the
// existing slides + brief so the tail is on-topic and matches the look. Unlike
// a regen (redesign ONE existing slide), this emits multiple net-new sections.
export type FrameContinuationInput = {
  visibleCount: number; // slides already authored (positions 1..visibleCount)
  total: number; // planned deck size (the closing lives on slide `total`)
  lockedCount: number; // slides to author now (visibleCount+1 .. total)
  deckTitle: string | null;
  brief: string; // compact topic/brief context for on-theme continuity
  existingSlides: { position: number; sectionTag: string; wellHtml: string }[];
  // Enhance (a REDESIGN of the user's own deck, 2026-10-16): each locked
  // position N redesigns SOURCE slide N with its exact words, instead of
  // inventing a continuation. Absent = the create / social continuation.
  redesignSources?: { position: number; text: string }[];
};

export function frameContinuationUserMessage(
  input: FrameContinuationInput,
  deckCss: string,
): string {
  if (input.redesignSources && input.redesignSources.length > 0) {
    return frameRedesignContinuationMessage(input, input.redesignSources, deckCss);
  }
  const firstNew = input.visibleCount + 1;
  const existing = input.existingSlides
    .map(
      (s) =>
        `--- Slide ${s.position} ---\nSection attributes: ${s.sectionTag}\nWell (content + look reference; FROZEN machine output, never a layout to copy):\n${s.wellHtml}`,
    )
    .join("\n\n");

  return `CONTINUE an EXISTING deck. It currently has ${input.visibleCount} slides but was designed as a complete ${input.total}-slide presentation. Author the remaining ${input.lockedCount} slides (positions ${firstNew} through ${input.total}) that COMPLETE the deck's arc. The existing ${input.visibleCount} slides are the opening act and are FIXED - do not restate them; pick up where they leave off and carry the narrative to its conclusion. The CLOSING (summary / recap / call-to-action / thank-you / contact) belongs on the FINAL slide (${input.total}) only.

${input.deckTitle ? `Deck title: ${input.deckTitle}\n\n` : ""}Original brief (topic + content the deck is about):
${input.brief}

The existing slides, in order (for CONTINUITY and to match the look - do NOT repeat their content):
${existing}

Shared deck stylesheet (FIXED - you cannot change it; reuse its classes or use inline styles, and do NOT emit a <style> block):
${deckCss}

RULES:
- Reply with EXACTLY ${input.lockedCount} <section> elements in the generation contract, in ORDER (position ${firstNew} first, ${input.total} last). Each section declares its data attributes (data-label, data-role, data-bg, and any bg-css / bg-prompt / bg-scrim per the system rules) and contains exactly one <div class="well"> authored in PURE FLOW. No <style> block, no data-revises, no prose, no fences - the FIRST character of your reply is the < of the first section.
- The FINAL section (position ${input.total}) is the deck's closing - give it a closing role (data-role="closing").
- Build genuinely NEW slides that advance and finish the story; a tail that restates the opening act is a failure.
- Match the established design system: reuse the deck stylesheet's classes, the same headline/type treatment, and the same chrome the existing slides use, so the tail reads as one designer on one grid.
- Preserve numerals as Latin digits (0-9). In RTL decks a digit-only block with dir="ltr" renders text-align:start as LEFT - set text-align explicitly to place numerals where the composition needs them.`;
}

// Enhance unlock: the deck is a slide-by-slide REDESIGN of the user's own
// file, so the locked slides are NOT a story to continue. Position N redesigns
// source slide N with that slide's exact words (the same fidelity contract the
// Enhance generation follows); nothing is added to "complete an arc".
function frameRedesignContinuationMessage(
  input: FrameContinuationInput,
  sources: { position: number; text: string }[],
  deckCss: string,
): string {
  const firstNew = input.visibleCount + 1;
  const existing = input.existingSlides
    .map(
      (s) =>
        `--- Slide ${s.position} ---\nSection attributes: ${s.sectionTag}\nWell (look reference ONLY; FROZEN machine output, never a layout to copy):\n${s.wellHtml}`,
    )
    .join("\n\n");
  const sourceBlocks = sources
    .map((s) => `── SOURCE SLIDE ${s.position}: exact text (verbatim, authoritative) ──\n${s.text.trim() || "(no text on this slide)"}`)
    .join("\n\n");

  return `FINISH AN EXISTING REDESIGN. This deck is a slide-by-slide redesign of the user's own presentation: deck slide N is the redesign of source slide N. Slides 1 to ${input.visibleCount} are done and FIXED. Redesign source slides ${firstNew} to ${input.total} now, one slide each, in order.

${input.deckTitle ? `Deck title: ${input.deckTitle}\n\n` : ""}The source slides to redesign, with their EXACT words:
${sourceBlocks}

The finished slides, in order (to MATCH THE LOOK only, their content is not yours to repeat):
${existing}

Shared deck stylesheet (FIXED - you cannot change it; reuse its classes or use inline styles, and do NOT emit a <style> block):
${deckCss}

RULES:
- Reply with EXACTLY ${input.lockedCount} <section> elements in the generation contract, in ORDER (position ${firstNew} first, ${input.total} last): position N is the redesign of SOURCE SLIDE N above. Each section declares its data attributes (data-label, data-role, data-bg, and any bg-css / bg-prompt / bg-scrim per the system rules) and contains exactly one <div class="well"> authored in PURE FLOW. No <style> block, no data-revises, no prose, no fences - the FIRST character of your reply is the < of the first section.
- CONTENT FIDELITY (hard limits): each slide's words come from its source slide's exact text: keep the wording, the facts and their order (fix only an obvious typo). Never invent: no new headline, subtitle, statistic, example, summary, thank-you, call-to-action or closing that is not on that source slide, and never add an eyebrow, kicker, tag or section label whose words are not on it (a plain step or page number is fine). Never drop real information. Keep the slide's own language and script.
- The deck ends where the source ends: a slide is a closing only if its source slide is one. Do not turn the last slide into a recap or a thank-you.
- Match the established design system: reuse the deck stylesheet's classes, the same headline/type treatment, and the same chrome the finished slides use, so the whole deck reads as one designer on one grid.
- Preserve numerals as Latin digits (0-9). In RTL decks a digit-only block with dir="ltr" renders text-align:start as LEFT - set text-align explicitly to place numerals where the composition needs them.`;
}

// ── VISION QUALITY PASS (the bake's revision call) ──────────────────────────
// The deck is rendered in the real export browser and every pending slide is
// handed back as [rendered image + current code + measured findings] so the
// model reviews what the USER actually sees, not what it imagines its code
// renders as. system = frameSystemPrompt (same string as generation, so the
// prompt cache is shared cross-call and the corrected sections follow the
// exact same contract). The response reuses the data-revises semantics.
//
// Content-block layout: intro, then per slide IMAGE immediately followed by
// its text block (interleaved image+caption is the layout the vision docs
// recommend for multi-image prompts), the shared deck stylesheet once, and
// the rules last.
export type FrameVisionSlideInput = {
  position: number; // 1-based deck position
  total: number; // deck size (positions are deck-wide, pending may be a subset)
  sectionTag: string; // stored open tag (carries the declared attrs)
  wellHtml: string; // Claude's well div, current state
  findings: string[]; // measured audit findings, may be empty
  imageBase64: string; // downscaled JPEG of the rendered slide
};

type VisionBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: "image/jpeg"; data: string };
    };

export function frameVisionUserBlocks(
  slides: FrameVisionSlideInput[],
  deckCss: string,
): VisionBlock[] {
  const blocks: VisionBlock[] = [
    {
      type: "text",
      text: `VISION QUALITY PASS - the deck you designed was rendered in the real export browser. Each slide below appears as its actual rendered image, followed by its current code and any MEASURED findings from the render audit.

Review each slide the way a design director reviews a printed proof:
- clipping and overflow: content cut by the well edge or cramped against it
- anchoring: a block sitting on the wrong side for the reading direction
- hierarchy and balance: type scale, spacing rhythm, dead zones, lopsided or underfilled compositions
- scale and presence: these slides are PROJECTED in a room - type must read from distance, and the composition should USE the canvas; content floating small in a sea of empty ground is a defect, not minimalism
- legibility: text over photography or low-contrast fills
- deck consistency: type scale and spacing language coherent from slide to slide`,
    },
  ];
  for (const s of slides) {
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: s.imageBase64,
      },
    });
    blocks.push({
      type: "text",
      text: `SLIDE ${s.position} of ${s.total} - rendered above.
Section attributes: ${s.sectionTag}
Well code:
${s.wellHtml}
Measured findings:${
        s.findings.length
          ? "\n" + s.findings.map((x) => `  - ${x}`).join("\n")
          : " none"
      }`,
    });
  }
  blocks.push({
    type: "text",
    text: `Shared deck stylesheet (FIXED - you cannot change it; reuse its classes or use inline styles, and do NOT emit a <style> block):
${deckCss}

RULES:
- FIRST, one verdict line per slide, in order, no exceptions - grade each slide individually before deciding anything:
  SLIDE <n>: OK
  SLIDE <n>: REVISING - <under ten words naming the defect>
  SLIDE <n>: DISPUTING - <under ten words: why the measured finding is factually wrong in the render>
- ‼️ MEASURED findings are DEFECTS, not suggestions. A slide with a measured finding MUST be REVISING - the only alternative is DISPUTING when the measurement is factually wrong in the rendered image. "It reads as a stylistic choice" is NOT a dispute; the measurements encode this product's design law.
- THEN emit the corrected <section> for every REVISING slide, in the exact generation contract (same declared attributes unless the fix requires changing one, exactly one <div class="well">) PLUS data-revises="<the slide's position number>".
- Beyond the findings, revise when a correction genuinely improves the slide: a real defect or a clear visual upgrade. Never re-emit for a minor taste difference.
- Keep the message and text content as written (trim or rewrap text only when the defect demands it).
- Preserve every <img> src EXACTLY. Keep data-genimage boxes exactly as they are (same data-genimage, data-genaspect, data-gensource, and data-genref values, no new image slots). Keep every <img data-asset> (the user's own picture) and every <div data-table> box (the user's own table) on the slide with its attributes and contents unchanged: you may move and resize them, never remove, replace or rewrite them.
- Numerals in RTL decks: a digit block with dir="ltr" renders text-align:start as LEFT - keep dir=ltr, set text-align explicitly to place the numerals where the composition needs them.`,
  });
  return blocks;
}

