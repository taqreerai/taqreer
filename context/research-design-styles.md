# Design Styles for Generated Decks — Research Report

> First-principles design study of presentation/deck visual styles, the
> "knobs" that make styles genuinely distinct, how to force a generator to
> commit to one, how many to offer, and the imagery that reinforces each.
> Deliberately **platform/language-agnostic** (no RTL, brand-token, or
> existing-catalog assumptions — those mappings come as a later step).
>
> Evidence base: a 110-agent deep-research pass (27 vetted sources, 23
> adversarially-verified claims) + targeted top-ups on Apple keynote practice,
> choice-count psychology, and 2025–26 trends. Claims marked **[verified]** were
> confirmed 3-0 in adversarial verification; **[practice]** = design-community
> consensus from cited sources; **[synthesis]** = my design reasoning applied to
> the above. Sources at the end.

---

## 0. Executive summary

- **Genuinely distinct style families: ~14–16 exist; ~8 are worth exposing.**
  Beyond that you get recolors, not new styles, and choice-overload sets in.
- **Styles differ by ORTHOGONAL KNOBS, not by color.** Two decks look
  *completely* different only when they diverge on **composition system +
  signature device + imagery treatment** (≥3 of the 6 knobs in §1). Same layout
  in two palettes = the same style. This is the single most important finding.
- **Recommended count: 8** (defensible range 6–9), grounded in Hick's Law +
  Miller's 7±2 + Iyengar's jam study (6 options → 30% conversion vs 24 options →
  3%). Present them as a **visual side-by-side picker**, not a text list.
- **The engine = LOCK then FORCE.** Locking a style means locking a *point* in
  knob-space; forcing commitment means: a **fixed frame + 4–6 reusable layout
  archetypes + 1–3 motifs**, "**accent = FILL, not ink**," and "**match the
  density, don't reduce it.**" Without forcing, every generator regresses to the
  same "safe AI look" (centered title, three bullet cards, oceans of whitespace).
- **Recommended 8:** Swiss/Grid · Editorial · Bold/Display · Minimal/Keynote ·
  Corporate/Data · Brutalist · Duotone/Full-bleed · Playful/Dopamine. They span
  the whole space: objective↔expressive, quiet↔loud, airy↔dense, type-only↔
  image-led. (Catalog with per-style directives in §6.)

---

## 1. The differentiation model — the "knobs" (most important section)

A *style* is a **locked configuration of orthogonal variables**. Verified
foundations: there are **8 canonical composition systems** — grid, axial,
modular, bilateral (centered), radial, dilatational, transitional, random
**[verified]** — and visual hierarchy is driven by **8 primary variables** (size,
weight, color, contrast, alignment, spacing, position, type style) **[verified]**.
Collapsing these into the levers that actually *change a style*:

| # | Knob | Range (examples) | Why it separates styles |
|---|------|------------------|-------------------------|
| 1 | **Composition system** | strict grid · centered/bilateral · modular cards · diagonal/asymmetric · radial · full-bleed field | The structural skeleton. The biggest single differentiator — a grid deck and a diagonal deck are unmistakably different before a single word is read. |
| 2 | **Type treatment** | scale *ratio* (1.2 calm → 1.6+ dramatic) · weight contrast (uniform → black-vs-light) · serif/sans/display/mono · alignment (flush vs centered vs justified) · case (ALL-CAPS labels vs sentence) | Controls "voice." Big scale-ratio + extreme weight contrast reads loud; tight ratio + uniform weight reads calm/objective. |
| 3 | **Color application** | color as **INK** (text/lines) vs color as **FILL** (blocks/badges/fields) · mono · duotone · full palette · accent placement | "Accent = fill not ink" is the difference between a confident system and a recolored Word doc **[practice]**. *Where* color lands is more style-defining than *which* color. |
| 4 | **Density** | airy (1–3 blocks, huge margins) · medium · dense (6–8 blocks, tight gutters) | Consulting decks are dense; keynote decks are airy. Same content, opposite feel. A generator's #1 regression is silently reducing density. |
| 5 | **Signature device** | hairline baseline grid · thick black rules boxing cells · giant numerals bleeding off-edge · keyline frame · diagonal accent bar · rounded filled cards · drop-cap + column rules · duotone field | The *one memorable move* a viewer remembers. This is what makes a style "ownable" rather than generic. Each style should have exactly one. |
| 6 | **Imagery treatment** | none (pure type+graphic) · small accent · hero · full-bleed · duotone-processed | Spans the gap from "no photos at all" (Swiss, data, brutalist) to "image *is* the slide" (duotone, keynote). |

**The rule of distinctness [synthesis]:** two styles read as *completely
different* when they differ on **≥3 knobs, and necessarily on #1 (composition)
and #5 (signature device)**. Differing only on #3 (color) = the same style in two
brands. This is exactly why naive generators feel samey: they vary color and
maybe font, hold composition + density + signature constant, and every deck
collapses to one look.

**Design implication for the engine:** a "style" should be stored as an explicit
*tuple* over these knobs, not a vibe word. "Bold" = {composition: centered/full-
bleed, type: ratio 1.6 + black weight + ALL-CAPS, color: high-contrast fill,
density: airy, signature: edge-to-edge oversized headline, imagery: optional
hero}. Pinning the tuple is what lets two different style picks produce two
unmistakably different decks.

---

## 2. Why generators converge — and how to force commitment

**The "AI look" is real and documented [practice]:** centered titles, 3 evenly-
spaced bullet cards, heavy whitespace, a safe sans, and one timid accent (the
web-design version is literally "Tailwind's indigo-500"). Causes: models optimize
for *acceptability* (the statistical center), treat instructions as *soft
suggestions*, and reduce density/contrast toward a safe mean.

**Forcing techniques that work [practice + synthesis]:**

1. **Lock a fixed FRAME for the whole deck** — outer margins, header/footer
   band, corner treatment, panel fills — applied identically on every slide.
   Consistency *is* the system.
2. **Define a closed set of 4–6 LAYOUT ARCHETYPES** and require every content
   slide to be an instance of one. Variety comes from *which* archetype + the
   content, never from inventing new geometry per slide. (Mirrors atomic/design-
   system practice — components, not bespoke pages **[practice]**.)
3. **1–3 MOTIFS, and nothing else decorative** — a badge shape, a numeral
   treatment, a rule weight. Repetition of a motif is what reads as "designed."
4. **"Accent = FILL, not ink."** Put the accent color as a fill on blocks/
   badges/number-cards with text *on* it — not as colored body text. This single
   instruction is the largest premium-vs-amateur lever.
5. **"Match the density, don't reduce it."** Explicitly forbid the whitespace
   drift. State the target block count per slide for the style.
6. **Commit literally; do not soften toward neutral.** Tell the model the style
   was chosen on purpose and must be honored even where a "safer" choice exists
   (legibility is the only override).
7. **Show, don't adjective.** "Brutalist" alone fails; "2–3px solid black rules
   boxing every region, monospaced ALL-CAPS labels, zero rounded corners,
   zero shadows" succeeds. Directives must be *mechanical*, not vibes.

These are the backbone of every per-style directive in §6.

---

## 3. Master taxonomy (the landscape)

The full field, then the cut to the recommended 8. Distinct families:

| Family | Defining traits | Origin / lineage | Famous example |
|--------|-----------------|------------------|----------------|
| **Swiss / International Typographic** | Strict grid, flush-left/ragged-right, sans (Helvetica/Akzidenz), objective, hairline rules, little/no imagery | Switzerland 1930s–50s; De Stijl → Bauhaus → International Style **[verified]** | Müller-Brockmann posters; Helvetica-era signage |
| **Editorial / Magazine** | Multi-column, serif display headlines, drop caps, kickers/bylines, rules between blocks, heavy imagery | Print magazine layout | *The New York Times*, *Kinfolk*, *Bloomberg Businessweek* |
| **Bold / Display (Maximal type)** | Oversized type dominates the canvas, high contrast, edge-to-edge headlines, aggressive negative space | Poster/advertising | Spotify Wrapped; festival posters |
| **Minimal / Keynote** | Vast negative space, one idea per slide, single image or number, dark-stage option, ≤5 words/line | Apple/Jobs keynote lineage **[practice]** | Apple keynotes |
| **Corporate / Consulting-Data** | Dense grid, "action titles," pyramid logic, 3–4 semantic colors, charts/tables, no decoration | MBB consulting **[verified]** | McKinsey/BCG/Bain decks |
| **Brutalist / Neo-brutalist** | Raw structural cells, thick black rules, blocky/mono type, harsh contrast, zero polish; deliberately anti-AI | Architecture → web brutalism; surging as the human/anti-AI reaction 2024–26 **[practice]** | Bloomberg redesign; Gumroad |
| **Bauhaus / Geometric** | Primary shapes, geometric sans, asymmetric balance, color blocking | Bauhaus 1920s | Bauhaus posters |
| **Duotone / Full-bleed image** | Edge-to-edge photographic fields, brand-duotone processing, bold type over scrim | Spotify-era brand systems **[practice]** | Spotify brand; festival keyarts |
| **Poster / Framed-keyline** | Outer keyline border per slide, centered lockups, tracked labels | Swiss poster / luxury print | Gallery/film posters |
| **Playful / Rounded (Dopamine)** | Rounded geometry, soft filled cards, bright saturated palette, friendly rhythm | Memphis-adjacent; "dopamine design" trend 2025 **[practice]** | Headspace; Duolingo |
| **Mega-numeral** | One giant figure per slide bleeding off-edge, small supporting text | Data-editorial | Annual-report hero stats |
| **Retro / Vintage** | Period palettes, grain, era-specific type, muted or washed color | 70s/80s revival | Vinyl-era reissues |
| **Memphis / Y2K / Anti-design** | Chaotic, clashing, intentionally "wrong," sticker/gradient soup | 80s Memphis; Y2K revival | MTV-era; Y2K fashion decks |
| **Dark-mode / Tech** | Dark ground, neon/gradient accents, mono labels, glow | Developer-tool branding | Linear, Vercel launch decks |
| **Luxury / Editorial-serif** | High-contrast serif, generous leading, restrained palette, elegant | Fashion/luxury print | Vogue; luxury brand decks |

**Why ~8 and not 16:** several families are *signature devices or palettes*, not
whole systems — Mega-numeral is a device usable inside Bold/Data; Poster is a
frame on Swiss/Bold; Dark-tech is Minimal/Bold with an inverted ground; Retro/
Memphis/Y2K/Luxury are palette+era skins that collapse toward Playful or Editorial
in execution. Keeping them as *separate user choices* buys overlap and choice-
overload, not distinctness **[synthesis]**.

---

## 4. What professionals & big companies do

**Professional practice [practice]:**
- **Design-system / atomic thinking** — reusable components (tokens → elements →
  patterns → templates), not bespoke slides. The pro deck = a kit, applied.
- **Action titles** — the slide's headline states the *takeaway*, not the topic
  ("Revenue grew 40% on enterprise" not "Revenue") **[verified, MBB]**.
- **Pyramid / one-message-per-slide** structure **[verified]**.
- **Color-as-meaning** — restrict to 3–4 colors and use them *semantically*
  (Duarte) **[verified]**; decoration earns its place or is cut.
- **Grid alignment** — every element to an invisible grid **[verified]**.

**Big-company keynote systems:**
- **Apple** — minimalist; **1–2 clean sans fonts**; **full-bleed image as the
  content** (not decoration); ≤4–5 words/line; dark stage; one image or number
  commands the room **[practice]**.
- **McKinsey / BCG / Bain** — the *opposite* pole: **dense data-grid**, action
  titles, pyramid, two fonts, 3–4 semantic colors, **zero decoration** **[verified]**.
- **Airbnb (the famous pitch deck)** — extreme brevity, one idea/slide, big
  numbers, consistent template **[practice]**.
- **Microsoft (Fluent) / Google (Material)** — system-driven: defined type ramp
  (Segoe / Roboto), spacing scale, elevation/levels, restrained accent. *Named
  internal keynote rules were NOT independently verifiable — treat as design-
  community consensus, not fact* (the deep-research pass could only evidence MBB).
- **Modern tech (Stripe, Linear, Vercel, Figma)** — gradient-on-dark or crisp-
  light, mono labels, generous grid, one vivid accent; "engineered" minimalism
  **[practice]**.

**Takeaway:** the professional spectrum runs from **Apple/airy/image-led** to
**McKinsey/dense/type-and-data** — and a good style menu should *span* that axis,
not cluster in the safe middle.

---

## 5. How many styles to offer

Grounded in choice psychology **[practice]**:
- **Hick's Law** — decision time grows logarithmically with the number of
  options; every added style taxes the user.
- **Miller's 7±2** — working memory holds ~7 items; a picker beyond ~9 can't be
  held in the head and forces re-scanning.
- **Iyengar & Lepper jam study** — 24 options drew more *lookers* but **6 options
  converted 30% vs 3%** for 24. More choices → more abandonment.

**Recommendation: 8 styles** (range 6–9). Enough to span objective↔expressive,
quiet↔loud, airy↔dense, type-only↔image-led; few enough to avoid paralysis and to
*actually build/tune each one to be distinct*. Mitigations: present as a **visual
side-by-side grid** (thumbnail per style — comparison beats reading), order from
safe→expressive, and consider a "surprise me / auto" option so undecided users
don't stall. Cut everything in §3 below the line (Mega-numeral, Poster, Bauhaus,
Retro, Memphis/Y2K, Dark-tech, Luxury) — fold them in as *devices/skins* within
the 8, not as separate picks.

---

## 6. Recommended style catalog (the deliverable)

Each style is a locked knob-tuple + a **ready-to-use, mechanical style-forcing
directive** (platform-agnostic; adapt wording when wiring). Directives assume the
generic forcing scaffold from §2 (fixed frame + archetypes + motifs + accent-as-
fill + hold-the-density).

### 1. Swiss / Grid — *objective, structured, type-led*
- **Composition:** strict multi-column grid, flush-aligned, high alignment discipline.
- **Type:** clean neutral sans; tight scale ratio (~1.2–1.33); uniform-to-moderate weight; flush-left, ragged edge; ALL-CAPS tracked labels (Latin only).
- **Color:** mostly ink on near-white; ONE accent as a small fill; restraint.
- **Density:** medium. **Signature:** hairline baseline-grid rules + tiny corner index labels.
- **Cover:** large flush title locked to the grid, generous top margin, one hairline.
- **Imagery:** none or small accent — it's a type+grid system.
- **Directive:** *"Build a strict Swiss/International grid system: a visible multi-column grid, everything flush-aligned to it, neutral sans type at a tight 1.25 scale ratio, near-white ground with text as ink and exactly ONE accent used only as a small fill. Hairline rules and tiny corner index labels are the only ornament. Objective and structured — no photos, no shadows, no rounded corners, no gradients."*

### 2. Editorial / Magazine — *literary, layered, image-rich*
- **Composition:** wide single-measure or 2-col with a sidebar; magazine rhythm.
- **Type:** serif display headlines + small sans body; drop-initials; kickers/bylines; mixed sizes within a slide.
- **Color:** ink-led with one editorial accent; imagery carries the color.
- **Density:** medium–dense. **Signature:** drop-cap + hairline rules between blocks; kicker labels.
- **Cover:** full-bleed hero image + serif title overprinted on a scrim.
- **Imagery:** heavy — full-bleed heroes, photographic, editorial.
- **Directive:** *"Design like a print magazine spread: serif display headlines paired with a small sans body, drop-initial capitals, kicker labels and byline-style metadata, hairline rules separating blocks, and a multi-column rhythm with a sidebar for secondary content. Use full-bleed photographic imagery as heroes with the headline overprinted on a gradient scrim. Calm, literary, layered."*

### 3. Bold / Display — *loud, oversized type, high impact*
- **Composition:** centered or full-bleed lockups; type dominates.
- **Type:** extreme scale ratio (1.5–1.618+); black-vs-light weight contrast; edge-to-edge headlines; ALL-CAPS option.
- **Color:** high-contrast; accent as large fills/blocks.
- **Density:** airy (one statement per slide). **Signature:** a single oversized word/phrase bleeding to the edges.
- **Cover:** one giant word/number, edge-to-edge, on a flat brand field.
- **Imagery:** optional single hero, cropped tight; type still wins.
- **Directive:** *"Make typography the hero: one oversized headline per slide that bleeds to the edges, extreme weight contrast (black display against light captions), a 1.6 type-scale ratio, high-contrast color used as full blocks behind text. One statement per slide, aggressive negative space, cinematic. Never more than a few words large on screen."*

### 4. Minimal / Keynote — *quiet, one idea, image-or-number*
- **Composition:** centered or off-center single focal lockup; vast negative space.
- **Type:** clean sans; one or two sizes; generous leading; ≤5 words/line.
- **Color:** monochrome ground (light OR dark "stage"); one restrained accent.
- **Density:** airy (1–2 blocks). **Signature:** a single focal element — one full-bleed image OR one giant number — and nothing else.
- **Cover:** full-bleed image with a few overlaid words, or one word centered on a dark stage.
- **Imagery:** full-bleed hero OR none (a single number). The image *is* the content.
- **Directive:** *"Apple-keynote minimalism: one idea per slide, vast negative space, at most a few words per line, a single focal element — either one full-bleed photograph with a short overlaid line, or one very large number/word centered on a plain stage (offer a dark-stage variant). One restrained accent. Remove everything that isn't the single point."*

### 5. Corporate / Data — *dense, analytical, no decoration*
- **Composition:** strict dense grid; action-title band on top; stat cells/tables.
- **Type:** two fonts max; clear title→subhead→body hierarchy; tabular figures.
- **Color:** 3–4 colors used *semantically* (good/bad/neutral); no decorative color.
- **Density:** dense (6–8 blocks). **Signature:** gridlines + stat cells + tick/unit labels; the headline is an *action title* (the takeaway).
- **Cover:** plain title + subtitle on grid, one accent rule; sober.
- **Imagery:** essentially none — charts and tables, not photos.
- **Directive:** *"Consulting data-deck: every slide opens with an ACTION TITLE stating the takeaway (not the topic). Dense, gridded layout of stat cells, ruled tables, and inline charts; two fonts maximum; 3–4 colors used only semantically (e.g. positive/negative/neutral); tabular figures with unit labels. Zero decoration, zero photography — information density is the aesthetic."*

### 6. Brutalist — *raw, structural, anti-polish*
- **Composition:** visible structural cells; thick dividers; exposed grid.
- **Type:** blocky sans or monospace; ALL-CAPS; minimal hierarchy; raw.
- **Color:** high-contrast, often black/white + one harsh accent; color as flat fill.
- **Density:** medium–dense. **Signature:** 2–3px solid black rules boxing every region; zero rounding, zero shadow.
- **Cover:** oversized raw title in a thick black box; exposed labels.
- **Imagery:** none, or harsh high-contrast/halftone if any.
- **Directive:** *"Brutalist: expose the structure. Box every region with 2–3px solid black rules, use a blocky sans or monospaced type in ALL-CAPS, flat high-contrast color as fills, and a stark black-on-white base with one harsh accent. Absolutely no rounded corners, no shadows, no gradients, no soft anything. Raw, mechanical, deliberately unpolished."*

### 7. Duotone / Full-bleed — *image-as-everything, branded*
- **Composition:** edge-to-edge image fields; no margins; type overprinted.
- **Type:** bold sans/display over imagery; tight lockups.
- **Color:** brand-duotone processing on every photo; type in brand colors.
- **Density:** airy–medium. **Signature:** every image duotone-mapped to two brand colors + small corner caption.
- **Cover:** full-bleed duotone image, big title across it on a scrim.
- **Imagery:** heavy and *processed* — duotone is the whole point.
- **Directive:** *"Duotone full-bleed: every slide is an edge-to-edge photographic field processed into a two-color brand duotone, with bold type overprinted on a legibility scrim and a small corner caption. No white margins — the image fills the frame. Cohesive, branded, high-impact; the processed image IS the slide."*

### 8. Playful / Dopamine — *rounded, bright, friendly*
- **Composition:** modular rounded blocks on tinted grounds; soft cards.
- **Type:** rounded geometric sans; friendly; moderate scale; sentence case.
- **Color:** bright saturated palette used liberally as fills; one card accent-filled.
- **Density:** medium. **Signature:** filled rounded cards with soft shadow; playful icon/shape motifs.
- **Cover:** big friendly title on a saturated rounded panel, a playful shape motif.
- **Imagery:** bright, optimistic, high-saturation lifestyle or 3D-rounded illustration.
- **Directive:** *"Playful 'dopamine' design: modular rounded cards on softly tinted backgrounds, a rounded geometric sans, bright saturated colors used liberally as card fills, and a soft friendly shadow on cards. Use cheerful shape/icon motifs. Warm and energetic but not childish — one accent-filled hero card per slide carries the emphasis."*

---

## 7. Images-mode mood per style (consolidated)

When photographic image generation is on, the *style* should steer the image
**medium, lighting, color, subject, and framing** so photos reinforce rather than
fight the layout **[practice + synthesis]**. Also: some styles want **no
photography at all** — forcing images into them weakens them.

| Style | Imagery weight | Mood directive for generated images |
|-------|----------------|--------------------------------------|
| **Swiss / Grid** | None / tiny accent | If any: black-and-white or single-accent, geometric, objective, no people-clutter. Prefer pure type+grid. |
| **Editorial** | Heavy | Photojournalistic, natural light, real moments, rich but true color, environmental portraits, full-bleed crops. |
| **Bold / Display** | Light (1 hero) | High-contrast, single strong subject, dramatic light, tight crop; type still dominates. |
| **Minimal / Keynote** | Heavy *or* none | Cinematic, clean, lots of negative space *inside* the photo, soft directional light, single subject; OR no photo (one number). |
| **Corporate / Data** | None | No photography — charts/tables only. If a cover image is forced: muted architectural/abstract, desaturated. |
| **Brutalist** | None / harsh | Prefer none. If any: harsh high-contrast black-and-white, halftone/grain, flat, unretouched. |
| **Duotone / Full-bleed** | Heavy (processed) | Strong-silhouette subjects that read after two-color duotone mapping; high contrast; full-bleed; texture welcome. |
| **Playful / Dopamine** | Medium–heavy | Bright, high-saturation, optimistic, soft even light, candid/lifestyle or rounded 3D illustration; cheerful color. |

User's own examples map cleanly: **corporate → muted/architectural or gradient
fields** (Corporate/Data row), **sports → vivid, high-saturation, motion, bold**
(a Bold or Playful execution with a high-energy image directive). "Sports" isn't a
*style* — it's a **content domain** that should *bias* the rolled style toward
Bold/Playful and push the image directive toward saturation + motion **[synthesis]**.

---

## 8. Open questions for the build phase (out of scope here, flagged)

1. Named big-company internal keynote rules (Apple/MS/Google) couldn't be
   independently verified — treat §4 specifics as consensus, not fact.
2. Whether to expose a "surprise me / auto" pick alongside the 8.
3. How a content *domain* (sports, finance, religion) should bias the style +
   image mood — the diversity/appropriateness layer, a separate engine concern.

---

## Sources

**[verified] backbone (deep-research, 3-0 confirmed):**
- Organizational/composition systems — https://courses.lumenlearning.com/suny-graphicdesign/chapter/3-4-organizational-principles/
- International Typographic Style — https://en.wikipedia.org/wiki/International_Typographic_Style
- De Stijl (lineage) — https://en.wikipedia.org/wiki/De_Stijl · https://www.theartstory.org/movement/de-stijl/
- Visual hierarchy (8 variables) — https://ixdf.org/literature/topics/visual-hierarchy
- Consulting slide standards — https://deckary.com/blog/consulting-slide-standards · https://tosea.ai/blog/cognitive-architecture-mckinsey-deck-logic
- Duarte design principles — https://www.duarte.com/blog/4-presentation-design-principles-to-live-by/ · https://www.duarte.com/training/slide-document-design/slide-design/
- Atomic/design-system practice — https://thegooddeck.com/blogs/presentation-designers-toolkit/atomic-design-methodology
- Airbnb pitch deck analysis — https://www.spectup.com/resource-hub/airbnb-pitch-deck-analysis
- Space in design systems — https://medium.com/eightshapes-llc/space-in-design-systems-188bcbae0d62
- Swiss vs brutalism — https://medium.com/@manojadhikari57/clear-vs-bold-swiss-and-brutalism-for-the-web-2fbefedb5161

**Anti-generic / style-forcing:**
- https://dev.to/alanwest/why-every-ai-built-website-looks-the-same-blame-tailwinds-indigo-500-3h2p
- https://www.visily.ai/blog/how-to-make-ai-designs-less-generic/
- https://www.vandelaydesign.com/why-ai-generated-designs-look-the-same/
- https://www.illustration.app/blog/designing-for-generative-consistency-creating-style-guides-for-ai-art

**Imagery art-direction / duotone:**
- https://www.creativebloq.com/inspiration/5-ways-to-use-images-more-effectively-in-editorial-design
- https://www.shopify.com/blog/photography-style-guide
- https://99designs.com/blog/trends/duotone-design/ · https://www.latyndesign.com/post/3-options-for-duotone-images-in-your-presentation
- https://brandguide.asu.edu/execution-guidelines/photo-video/art-direction

**Top-ups (Apple keynote / choice-count / 2025–26 trends):**
- Apple keynote practice — https://business.tutsplus.com/tutorials/5-tips-for-better-keynote-presentations--mac-53474 · https://autoppt.com/blog/presentation-design-styles/
- Choice overload / Hick / Miller / jam study — https://lawsofux.com/choice-overload/ · https://lawsofux.com/hicks-law/ · https://en.wikipedia.org/wiki/The_Paradox_of_Choice
- 2025–26 trends (brutalism, dopamine, editorial, Swiss) — https://letterhanna.com/graphic-design-trends-2025-15-styles-that-will-explode-this-year/ · https://www.bighuman.com/blog/graphic-design-styles-guide · https://www.zekagraphic.com/brutalism-in-graphic-design/
