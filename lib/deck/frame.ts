// FRAME architecture (context/frame-architecture-2026-07-10.md) — the system-
// owned slide frame. Generation under the `frameGen` flag splits ownership:
// the SYSTEM renders everything edge-touching / identity / direction-dependent
// (margins, 6-slot chrome, backgrounds, photo panels, scrims, brand mark, dir),
// and CLAUDE designs composition inside a clipped content WELL, in FLOW ONLY
// (flex/grid — overlap impossible by construction). The freeze bake
// (deck-freeze-bake) later pins the flow layout to absolute boxes for the
// freeform editor.
//
// This module is pure string assembly (no DOM): it parses the declared section
// attributes Claude emits and wraps the well with the system layers. Photo
// backgrounds/panels are emitted as data-genimage boxes so the EXISTING image
// pipeline (warm dispatch + reconcile) generates and fills them — the frame
// adds no new image machinery.

// ── geometry ────────────────────────────────────────────────────────────────
// Derived from the canvas so every format gets proportional framing. The
// ratios reproduce the spike-proven 16:9 values EXACTLY (margin 96, split 768,
// band 378, gap 64, chrome mid 40, brand top 52 at 1920x1080) and scale for
// portrait 3:4 (1080x1440: margin 54, split 432, band 504, gap 36).
export type FrameCanvas = { width: number; height: number };

export function frameGeometry(canvas: FrameCanvas) {
  const margin = Math.round(canvas.width * 0.05); // safe-area inset
  const splitW = Math.round(canvas.width * 0.4); // tier-2 split panel width
  const bandH = Math.round(canvas.height * 0.35); // tier-2 band height
  const gap = Math.round(canvas.width / 30); // panel-to-well gap
  const chromeMid = Math.round(margin * (40 / 96)); // chrome text band center
  const brandTop = Math.round(margin * (52 / 96)); // cover brand-mark top
  return {
    margin,
    splitW,
    bandH,
    gap,
    chromeMid,
    brandTop,
    wellW: canvas.width - margin * 2,
    wellH: canvas.height - margin * 2,
    splitWellW: canvas.width - splitW - gap - margin,
    bandWellH: canvas.height - bandH - gap - margin,
  };
}

// Back-compat alias (earlier callers read only the well box).
export function frameWellSize(canvas: FrameCanvas) {
  return frameGeometry(canvas);
}

// Replaced at finalize (assembleManifest knows the total; streaming doesn't).
export const FRAME_TOTAL_TOKEN = "%%TQTOTAL%%";

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
  // authored-LTR mirroring — bg photos don't flip, so mirrored compositions
  // break against them. RTL drift is caught downstream, never guess-rewritten.
  const langBlock = ar
    ? `‼️ LANGUAGE & DIRECTION — this deck is ARABIC: design natively RTL. The system sets dir="rtl" on every slide root (do NOT set dir yourself). The eye enters from the RIGHT: lead text blocks and columns anchor to the visual RIGHT, secondary/decorative elements to the LEFT; body text right-aligned. Flex keywords are LOGICAL under RTL: align-items/justify-content flex-START anchors to the reading side (the RIGHT) and flex-END anchors LEFT — to anchor content to the reading edge use flex-start, never flex-end. Do NOT set dir on child blocks that contain Latin letters; for an inline Latin run inside an Arabic sentence (URL, email, English word) wrap just that run in <span dir="ltr">. Numbers are ALWAYS Latin digits (0-9), never Arabic-Indic (٠-٩). letter-spacing on Arabic-bearing elements is stripped at export.`
    : `LANGUAGE & DIRECTION — this deck is ENGLISH (LTR). The system sets dir="ltr" on every slide root (do NOT set dir yourself).`;

  const bgKinds = imagesMode
    ? `data-bg="color|image|split-start|split-end|band-top|band-bottom"`
    : `data-bg="color"`;

  const imageBlocks = imagesMode
    ? `
BACKGROUND KINDS —
- "color": flat/gradient ground (data-bg-css).
- "image": FULL-BLEED photo behind everything (data-bg-prompt + data-bg-scrim). ‼️ The ONLY layout where your text may sit over a photo — the system's scrim guarantees legibility.
- "split-start"/"split-end": a full-height photo panel (${g.splitW}px wide) bleeding to that edge. LOGICAL sides: start = the reading side (${ar ? "visual RIGHT in this RTL deck" : "visual LEFT"}). Your well sits on the opposite side. Add data-bg-css to tint the remaining ground.
- "band-top"/"band-bottom": a full-width photo band (${g.bandH}px tall) on that edge; your well takes the rest. Add data-bg-css for the remaining ground.${social ? " Portrait cards favor bands and full-bleed; splits are narrow at this width." : ""}

IN-WELL CONTENT IMAGES — inside the well you may reserve FRAMED photo slots as content blocks (photo cards, gallery tiles, a portrait beside a quote):
  <img data-genimage="<textless photo prompt — SUBJECT/SCENE/MOOD>" data-genid="<unique-id>" alt="" style="width:…px;height:…px;object-fit:cover;display:block;background:<a brand-tinted placeholder gradient>;"/>
  • NO src — the system generates and fills it. Set width/height in px (the system reads the shape). Round corners/borders welcome.
  • data-genimage describes SUBJECT / SCENE / MOOD only — never text, letters, numbers, logos, signage, charts, or UI inside the image (stripped server-side); keep it trademark-safe (no real brand / person / team / character names). One consistent medium + mood across the whole deck.
  • ‼️ NEVER place text on top of a well image, and never draw a scrim/overlay on one — text-over-photo happens ONLY via data-bg="image" or a split/band panel. Well images are clean framed blocks BESIDE/AROUND text.
`
    : `
BACKGROUND KINDS — "color" only for this deck: a flat or gradient ground via data-bg-css. Do not reference photos anywhere.
`;

  const wellSizes = imagesMode
    ? `   - data-bg="color" or "image": well = ${wellW}x${wellH}px
   - data-bg="split-start" or "split-end": well = ${splitWellW}x${wellH}px (the panel takes the other side)
   - data-bg="band-top" or "band-bottom": well = ${wellW}x${bandWellH}px (the band takes the other edge)`
    : `   - well = ${wellW}x${wellH}px`;

  return `${social ? `You are an elite social media designer. Design an original carousel of ${canvas.width}x${canvas.height} portrait cards for a phone feed, fresh for this brief, as one HTML fragment. Open with a hook that stops the scroll.` : `You are a world-class presentation designer. Design a complete, ORIGINAL slide deck — your own visual system, fresh for this brief — as one HTML fragment. Bespoke and editorial, never a generic template.`}

THE FRAME IS SYSTEM-OWNED. Each slide has three layers; you author only what is declared here:
1. BACKGROUND — you DECLARE it per slide via section attributes (below); the system renders it. You never draw backgrounds or edge-to-edge imagery yourself.
2. CONTENT WELL — your canvas. Inside each <section>, emit EXACTLY ONE <div class="well">…</div> and design everything in it. The well is already inset from the slide edges; treat its edges as the canvas edges. Content outside it is clipped. Its size depends on the background you declare:
${wellSizes}
3. CHROME (page number, deck title, kicker, brand line) — the system renders these in fixed positions. You never draw chrome: no page numbers, no running titles, no logos anywhere in the well. You declare the per-slide kicker text via an attribute.

${langBlock}

OUTPUT — emit exactly this, with NOTHING else (no prose, no fences, no JSON, no <!DOCTYPE>/<html>/<head>/<body>):
1. ONE <style> block FIRST — your design system: CSS custom properties + component classes built ON the injected brand variables. Define styling ONCE and reuse via classes.
2. THEN the slides, each:
<section data-label="<short ${ar ? "Arabic" : ""} name>" data-role="cover|content|section|stats|quote|image|closing"
         data-kicker="<2-4 word kicker for this slide, or omit>"
         data-chrome="light|dark"   (light = white chrome text for dark/photo backgrounds, dark = ink chrome for light backgrounds)
         ${bgKinds}
         data-bg-css="<any CSS background value for the non-photo area, e.g. var(--brand-1) or a linear-gradient>"${imagesMode ? `
         data-bg-prompt="<for image/split/band: a concrete textless photo prompt — SUBJECT / SCENE / MOOD, no text/logos/people-brands>"
         data-bg-scrim="none|soft|strong"` : ""}>
  <div class="well"> …your design… </div>
</section>
${imageBlocks}
- The FIRST character of your response is \`<\` (your <style>).
- The COVER <section> also carries data-deck-title="…" (3-8 words, in the deck's language, a real title — becomes the project name), plus the deck's BRAND MARK as data: data-brand="<the brand/venture name>" and optionally data-brand-sub="<one short sub-line>". The system renders the brand mark; NEVER draw a brand mark, wordmark, or logo lockup inside the well.
- Slides are TOP-LEVEL siblings — never nest a <section>. Exactly one .well per section, nothing else inside the section.
- There is NO wrapper element around your output: never write CSS through an imagined container (e.g. \`.deck x\`, \`.wrapper x\` — those selectors match NOTHING). Base styles go on .well or your own classes.
- ‼️ Design the well in FLOW ONLY: flex and grid (display:flex/grid, flex-direction, gap, padding, margin, flex:1, aspect-ratio, align-items/justify-content). NEVER position:absolute/relative offsets, NEVER left/top, NEVER transforms, NEVER negative margins inside the well — the layout must be pure document flow, so nothing can ever overlap. Give .well itself display:flex;flex-direction:column (or grid) filling its box; distribute space with gap, flex:1, and auto margins. Px font sizes and fixed px sizes for images/cards are fine. Plan each slide so content FITS its well without overflowing.
- Use left/top/right/bottom longhands, NOT the \`inset\` shorthand.
- Write every repeated item (list rows, cards, steps, table cells) out IN FULL as elements. There is NO template engine: never use a JS loop, \`.map()\`, \`+\` concatenation, or \`\${…}\`.
- Decide the slide count from the brief (match \`brief.slideCount\` when given; else adapt).
- VARY the composition slide to slide: different FLOW structures, one coherent look.
- SELF-CORRECTION — if AFTER emitting a slide you realize it has a real flaw (content overflowing the well, broken hierarchy, a block anchored to the wrong side, imbalanced composition), re-emit the ENTIRE corrected <section> with the same attributes PLUS data-revises="N" (N = the 1-based position of the slide it replaces, counting from the cover). The system swaps the corrected slide in place of the old one. Re-emit ONLY when the fix is meaningfully better; never re-emit an unchanged slide, and never use data-revises on a first-time slide.

BRAND & COLOUR — the brand variables are INJECTED for you; reference them, don't redefine them.

GRAPHICS — icons: inline an <svg viewBox="0 0 24 24"> with a REAL icon's path data from a standard open set (e.g. Lucide), stroked or filled in a brand colour. Charts / graphs: inline <svg>. Country flags: <img src="https://flagcdn.com/<cc>.svg"> (lowercase ISO code). NEVER hotlink any other external image${imagesMode ? " — photographic imagery ONLY via data-bg-prompt or an in-well data-genimage slot" : ""}.

AVOID (these don't render in export): conic-gradient, colour-to-alpha gradients, mix-blend-mode, backdrop-filter, filter: blur() / drop-shadow(), -webkit-text-stroke (use <svg><text stroke fill="none">), rgba() for translucency on a fill (use opacity on the element). Static only — no animation / transition / :hover / :focus / JS.
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
    `.tq-canvas .tq-chrome{position:absolute;inset:0;z-index:2;pointer-events:none;font-family:var(--font-body,var(--font));font-size:19px;font-weight:500}` +
    `.tq-canvas .tq-chrome .slot{position:absolute;display:flex;align-items:center;gap:12px;line-height:1}` +
    `.tq-canvas .tq-chrome.light .slot{color:rgba(255,255,255,.92)}` +
    `.tq-canvas .tq-chrome.dark .slot{color:var(--brand-text);opacity:.75}` +
    `.tq-canvas .tq-chrome .slot.ts{top:${g.chromeMid}px;inset-inline-start:${g.margin}px}` +
    `.tq-canvas .tq-chrome .slot.te{top:${g.chromeMid}px;inset-inline-end:${g.margin}px}` +
    `.tq-canvas .tq-chrome .slot.bs{bottom:${g.chromeMid}px;inset-inline-start:${g.margin}px}` +
    `.tq-canvas .tq-chrome .slot.be{bottom:${g.chromeMid}px;inset-inline-end:${g.margin}px}` +
    `.tq-canvas .tq-chrome .slot.tc{top:${g.chromeMid}px;inset-inline-start:50%;transform:translateX(-50%)}` +
    `.tq-canvas .tq-chrome .kicker-dash{display:inline-block;width:34px;height:2px;background:var(--accent,currentColor)}` +
    `.tq-canvas .tq-chrome .slot.brand{top:${g.brandTop}px}` +
    `.tq-canvas .tq-chrome .slot.brand .brand-name{font-size:34px;font-weight:700;color:var(--accent,currentColor);line-height:1.2}` +
    `.tq-canvas .tq-chrome .slot.brand .brand-sub{font-size:13px;letter-spacing:4px;opacity:.8;margin-top:6px}` +
    // Slots that sit OVER a photo (full-bleed or panel) force light ink + a
    // soft shadow — per-slot, computed from the declared geometry (a per-slide
    // light/dark flag can't cover a slide whose panel darkens one side only).
    `.tq-canvas .tq-chrome .slot.onpanel{color:rgba(255,255,255,.94);opacity:1;text-shadow:0 1px 14px rgba(10,12,16,.5)}`
  );
}

// ── declared-attribute parsing ──────────────────────────────────────────────
export type FrameSlideDecl = {
  label: string;
  role: string;
  kicker: string | null;
  chrome: "light" | "dark";
  bg: string;
  bgCss: string | null;
  bgPrompt: string | null;
  bgScrim: "none" | "soft" | "strong";
  deckTitle: string | null;
  brand: string | null;
  brandSub: string | null;
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
// guard — a correction arriving after the deck hit its slide count would
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
  // Keep Claude's ENTIRE well div — its modifier classes ("well cov") carry
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
    kicker: attr(openTag, "data-kicker"),
    chrome: attr(openTag, "data-chrome") === "light" ? "light" : "dark",
    bg: attr(openTag, "data-bg") ?? "color",
    bgCss: attr(openTag, "data-bg-css"),
    bgPrompt: attr(openTag, "data-bg-prompt"),
    bgScrim: scrim === "soft" || scrim === "strong" ? scrim : "none",
    deckTitle: attr(openTag, "data-deck-title"),
    brand: attr(openTag, "data-brand"),
    brandSub: attr(openTag, "data-brand-sub"),
    wellHtml: wellMatch
      ? wellMatch[1]
      : sectionHtml
          .replace(/^<section\b[^>]*>/i, "")
          .replace(/<\/section>\s*$/i, ""),
  };
}

// ── assembly ────────────────────────────────────────────────────────────────
// Deck-level context accumulated while slides stream (the cover carries the
// deck identity; pagination totals aren't known until the stream ends, so the
// page number renders FRAME_TOTAL_TOKEN and finalize replaces it).
export type FrameDeckCtx = {
  direction: "rtl" | "ltr";
  deckTitle: string | null;
  brand: string | null;
  brandSub: string | null;
};

// Genids the SYSTEM invents for bg/panel boxes must satisfy the pipeline's
// SAFE_GENID charset ([A-Za-z0-9._-]) — slide indexes do.
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
  // generates + injects the src (aspect via explicit data-genaspect — these
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

  // ── Layer 2: chrome ──
  // Slots over a photo force light ink (.onpanel) — computed from geometry.
  const overPhoto = new Set(
    decl.bg === "image"
      ? ["ts", "tc", "te", "bs", "be"]
      : decl.bg === "split-start"
        ? ["ts", "bs"]
        : decl.bg === "split-end"
          ? ["te", "be"]
          : decl.bg === "band-top"
            ? ["ts", "tc", "te"]
            : decl.bg === "band-bottom"
              ? ["bs", "be"]
              : [],
  );
  const op = (pos: string) => (overPhoto.has(pos) ? " onpanel" : "");
  const isCover = decl.role === "cover";
  const slots: string[] = [];
  if (isCover && ctx.brand) {
    slots.push(
      `<div class="slot ts brand${op("ts")}"><div><div class="brand-name">${esc(ctx.brand)}</div>${ctx.brandSub ? `<div class="brand-sub">${esc(ctx.brandSub)}</div>` : ""}</div></div>`,
    );
    if (decl.kicker)
      slots.push(
        `<div class="slot tc${op("tc")}"><span class="kicker-dash"></span><span>${esc(decl.kicker)}</span></div>`,
      );
  } else if (decl.kicker) {
    slots.push(
      `<div class="slot ts${op("ts")}"><span class="kicker-dash"></span><span>${esc(decl.kicker)}</span></div>`,
    );
  }
  if (ctx.deckTitle && !isCover)
    slots.push(`<div class="slot te${op("te")}">${esc(ctx.deckTitle)}</div>`);
  // dir=ltr sits on an INNER span: on the slot itself it would flip the slot's
  // own inset-inline-start and collide with the be slot (found 2026-07-10).
  if (!isCover)
    slots.push(
      `<div class="slot bs${op("bs")}"><span dir="ltr">${String(slideIndex + 1).padStart(2, "0")} / ${FRAME_TOTAL_TOKEN}</span></div>`,
    );
  slots.push(`<div class="slot be${op("be")}">taqreer.ai</div>`);
  const chromeHtml = `<div class="tq-chrome ${decl.chrome}" data-tq-lock="1">${slots.join("")}</div>`;

  // data-tq-frame marks the deck as frame-architecture for every consumer
  // (the editor NEVER runs its flatten on frame decks — frozen or awaiting
  // the bake); data-tq-frozen is stamped later by deck-freeze-bake. The
  // DECLARED attrs are preserved on the stored section so post-hoc passes
  // (the render-audit self-fix, future partial regen) can reconstruct the
  // model's authoring view without the original stream.
  return (
    `<section dir="${ctx.direction}" data-tq-frame="1" data-label="${esc(decl.label)}" data-role="${esc(decl.role)}"` +
    ` data-chrome="${decl.chrome}" data-bg="${esc(decl.bg)}"` +
    (decl.kicker ? ` data-kicker="${esc(decl.kicker)}"` : "") +
    (decl.bgCss ? ` data-bg-css="${esc(decl.bgCss)}"` : "") +
    (decl.bgPrompt ? ` data-bg-prompt="${esc(decl.bgPrompt)}"` : "") +
    (decl.bgScrim !== "none" ? ` data-bg-scrim="${decl.bgScrim}"` : "") +
    (isCover && ctx.deckTitle ? ` data-deck-title="${esc(ctx.deckTitle)}"` : "") +
    (isCover && ctx.brand ? ` data-tq-brand="${esc(ctx.brand)}"` : "") +
    (isCover && ctx.brandSub ? ` data-tq-brand-sub="${esc(ctx.brandSub)}"` : "") +
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
    brand: attr(tag, "data-tq-brand"),
    brandSub: attr(tag, "data-tq-brand-sub"),
  };
}

// The user message for the ONE-round self-fix call (system = frameSystemPrompt,
// so the corrected sections follow the same contract). Each flawed slide is
// handed back in the model's own authoring format with its measured findings;
// the response re-uses the data-revises revision semantics for mapping.
export function frameFixUserText(
  flawed: {
    position: number; // 1-based deck position
    sectionTag: string; // stored open tag (carries the declared attrs)
    wellHtml: string; // Claude's well div, current state
    findings: string[];
  }[],
): string {
  const blocks = flawed
    .map(
      (f) => `SLIDE ${f.position} — measured flaws:
${f.findings.map((x) => `  • ${x}`).join("\n")}
Current section attributes: ${f.sectionTag}
Current well:
${f.wellHtml}`,
    )
    .join("\n\n");
  return `QUALITY PASS — the deck you designed was rendered and MEASURED; the slides below have concrete flaws. Fix ONLY these slides.

${blocks}

Re-emit each slide as a complete corrected <section> in the exact same output contract (same declared attributes unless a flaw requires changing one; exactly one <div class="well">), PLUS data-revises="<the slide's position number>" on each <section> so the system swaps it in place. Keep the same content and visual system — fix the measured flaws, don't redesign. If an <img> carries a src attribute, preserve that src EXACTLY. Emit ONLY the corrected <section> elements, nothing else.`;
}

// Finalize: pagination totals aren't known while streaming — every slide's
// page-number slot rendered FRAME_TOTAL_TOKEN; replace once the count is
// final. Safe on non-frame decks (the token never appears).
export function fillFrameTotals(html: string, total: number): string {
  return html.split(FRAME_TOTAL_TOKEN).join(String(total).padStart(2, "0"));
}
