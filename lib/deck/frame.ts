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

// ── geometry ────────────────────────────────────────────────────────────────
// Derived from the canvas so every format gets proportional framing. 16:9
// values: margin 64, split 768, band 378, gap 64 at 1920x1080; portrait 3:4
// (1080x1440): margin 36, split 432, band 504, gap 36.
//
// Margin history: the spike used 5% (96px at 16:9) SIZED FOR THE CHROME TEXT
// BANDS that used to render between the well and the canvas edge. The system
// chrome was removed 2026-07-10 (owner direction), so the wide band became
// pure waste - user report: "the well is tight and margins are huge, which
// makes the content small". Now margin == the panel gap (width/30): the well
// grew 1728x888 -> 1792x952 at 16:9. Old stored decks are untouched (their
// geometry is baked into their own <style>).
export type FrameCanvas = { width: number; height: number };

export function frameGeometry(canvas: FrameCanvas) {
  const margin = Math.round(canvas.width / 30); // safe-area inset
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
}): string {
  const { canvas, language, imagesMode } = opts;
  const social = opts.kind === "social";
  const g = frameGeometry(canvas);
  const { wellW, wellH, splitWellW, bandWellH } = g;
  const ar = language === "ar";

  // Direction is NATIVE to the deck language (owner contract 2026-07-10): no
  // authored-LTR mirroring - bg photos don't flip, so mirrored compositions
  // break against them. RTL drift is caught downstream, never guess-rewritten.
  const langBlock = ar
    ? `‼️ LANGUAGE & DIRECTION - this deck is ARABIC: design natively RTL. The system sets dir="rtl" on every slide root (do NOT set dir yourself). The eye enters from the RIGHT: lead text blocks and columns anchor to the visual RIGHT, secondary/decorative elements to the LEFT; body text right-aligned. Flex keywords are LOGICAL under RTL: align-items/justify-content flex-START anchors to the reading side (the RIGHT) and flex-END anchors LEFT - to anchor content to the reading edge use flex-start, never flex-end. Do NOT set dir on child blocks that contain Latin letters; for an inline Latin run inside an Arabic sentence (URL, email, English word) wrap just that run in <span dir="ltr">. Digit-only blocks (pagination "01 / 07", dates, phone numbers) - dir="ltr" on that block IS fine (the digits would otherwise reorder under the RTL paragraph direction). Numbers are ALWAYS Latin digits (0-9), never Arabic-Indic (٠-٩). letter-spacing on Arabic-bearing elements is stripped at export.`
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
`
    : `
BACKGROUND KINDS - "color" only for this deck: a flat or gradient ground via data-bg-css. Do not reference photos anywhere.
`;

  const wellSizes = imagesMode
    ? `   - data-bg="color" or "image": well = ${wellW}x${wellH}px
   - data-bg="split-start" or "split-end": well = ${splitWellW}x${wellH}px (the panel takes the other side)
   - data-bg="band-top" or "band-bottom": well = ${wellW}x${bandWellH}px (the band takes the other edge)`
    : `   - well = ${wellW}x${wellH}px`;

  return `${social ? `You are an elite social media designer. Design an original carousel of ${canvas.width}x${canvas.height} portrait cards for a phone feed, fresh for this brief, as one HTML fragment. Open with a hook that stops the scroll.` : `You are a world-class presentation designer. Design a complete, ORIGINAL slide deck - your own visual system, fresh for this brief - as one HTML fragment. Bespoke and editorial, never a generic template.`}

THE FRAME IS SYSTEM-OWNED. Each slide has two layers; you author only what is declared here:
1. BACKGROUND - you DECLARE it per slide via section attributes (below); the system renders it. You never draw backgrounds or edge-to-edge imagery yourself.
2. CONTENT WELL - your canvas. Inside each <section>, emit EXACTLY ONE <div class="well">…</div> and design everything in it. The well is already inset from the slide edges; treat its edges as the canvas edges. Content outside it is clipped. Its size depends on the background you declare:
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
- The COVER <section> also carries data-deck-title="…" (3-8 words, in the deck's language, a real title - becomes the project name).
- Slides are TOP-LEVEL siblings - never nest a <section>. Exactly one .well per section, nothing else inside the section.
- There is NO wrapper element around your output: never write CSS through an imagined container (e.g. \`.deck x\`, \`.wrapper x\` - those selectors match NOTHING). Base styles go on .well or your own classes.
- ‼️ Design the well in FLOW ONLY: flex and grid (display:flex/grid, flex-direction, gap, padding, margin, flex:1, aspect-ratio, align-items/justify-content). NEVER position:absolute/relative offsets, NEVER left/top, NEVER transforms, NEVER negative margins inside the well - the layout must be pure document flow, so nothing can ever overlap. Give .well itself display:flex;flex-direction:column (or grid) filling its box; distribute space with gap, flex:1, and auto margins. Px font sizes and fixed px sizes for images/cards are fine. Plan each slide so content FITS its well without overflowing.
- Write every repeated item (list rows, cards, steps, table cells) out IN FULL as elements. There is NO template engine: never use a JS loop, \`.map()\`, \`+\` concatenation, or \`\${…}\`.
- Decide the slide count from the brief (match \`brief.slideCount\` when given; else adapt).
- VARY the composition slide to slide: different FLOW structures, one coherent look.
- SELF-CORRECTION - if AFTER emitting a slide you realize it has a real flaw (content overflowing the well, broken hierarchy, a block anchored to the wrong side, imbalanced composition), re-emit the ENTIRE corrected <section> with the same attributes PLUS data-revises="N" (N = the 1-based position of the slide it replaces, counting from the cover). The system swaps the corrected slide in place of the old one. Re-emit ONLY when the fix is meaningfully better; never re-emit an unchanged slide, and never use data-revises on a first-time slide.

BRAND & COLOUR - the brand variables are INJECTED for you; reference them, don't redefine them.

GRAPHICS - icons: inline an <svg viewBox="0 0 24 24"> with a REAL icon's path data from a standard open set (e.g. Lucide), stroked or filled in a brand colour. Charts / graphs: inline <svg>. Country flags: <img src="https://flagcdn.com/<cc>.svg"> (lowercase ISO code). NEVER hotlink any other external image${imagesMode ? " - photographic imagery ONLY via data-bg-prompt or an in-well data-genimage slot" : ""}.

AVOID (these don't render in export): conic-gradient, colour-to-alpha gradients, mix-blend-mode, backdrop-filter, filter: blur() / drop-shadow(), -webkit-text-stroke (use <svg><text stroke fill="none">), rgba() for translucency on a fill (use opacity on the element). Static only - no animation / transition / :hover / :focus / JS.
ALSO AVOID: !important, viewport units (vw/vh/vmin/vmax), @media, position: fixed.`;
}

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
  bgScrim: "none" | "soft" | "strong";
  deckTitle: string | null;
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
    bgScrim: scrim === "soft" || scrim === "strong" ? scrim : "none",
    deckTitle: attr(openTag, "data-deck-title"),
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
  const bgImg = (aspect: "landscape" | "portrait") =>
    `<img data-genimage="${esc(decl.bgPrompt ?? "")}" data-genid="${bgGenId(slideIndex)}" data-genaspect="${aspect}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;${placeholder}"/>`;

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
  const wellHtml = `<div class="tq-well"${wellStyle}>${decl.wellHtml}</div>`;

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
  return (
    `<section dir="${ctx.direction}" data-tq-frame="1" data-label="${esc(decl.label)}" data-role="${esc(decl.role)}"` +
    ` data-bg="${esc(decl.bg)}"` +
    (decl.bgCss ? ` data-bg-css="${esc(decl.bgCss)}"` : "") +
    (decl.bgPrompt ? ` data-bg-prompt="${esc(decl.bgPrompt)}"` : "") +
    (decl.bgScrim !== "none" ? ` data-bg-scrim="${decl.bgScrim}"` : "") +
    (isCover && ctx.deckTitle ? ` data-deck-title="${esc(ctx.deckTitle)}"` : "") +
    `>${ground}${panelHtml}${wellHtml}${chromeHtml}</section>`
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
- Re-emit ONLY the slides a correction genuinely improves: a real defect or a clear visual upgrade. Never re-emit a slide for a minor taste difference; every re-emission costs the user time.
- Keep the message and text content as written (trim or rewrap text only when the defect demands it).
- Preserve every <img> src EXACTLY. Keep data-genimage boxes exactly as they are (same data-genimage and data-genaspect values, no new image slots).
- Each corrected slide: the complete <section> in the exact generation contract (same declared attributes unless the fix requires changing one, exactly one <div class="well">) PLUS data-revises="<the slide's position number>".
- Emit ONLY corrected <section> elements. If every slide holds up, reply with the single word OK.`,
  });
  return blocks;
}

