# AI Image Generation — /create flow

> **Planning doc — NOT built yet.** Captures the locked decisions + the phased
> build plan for generating photographic images inside generated decks, via
> OpenAI's **gpt-image-2**. Scope for now: **the /create flow only** (enhance /
> mimic / datasheet come later, if ever). Pricing/credits is deliberately the
> LAST phase. Authored 2026-05-31.

---

## 1. Objective

Let a /create deck contain real **photographic / illustrative raster images**
(heroes, backgrounds, subject shots) in addition to today's inline-SVG graphics.
Claude is the **art director** — he decides where images go, reserves a sized box,
and writes the image prompt. **gpt-image-2** is the illustrator — it fills the box.
The user can later regenerate any image with a tweak.

This is **opt-in** via a toggle on the /create content card. Toggle OFF = today's
SVG-only deck, byte-for-byte unchanged. Toggle ON = "images deck".

---

## 2. Locked decisions (2026-05-31)

| Decision | Choice |
|----------|--------|
| **Model / quality** | **gpt-image-2, `medium`** (best photorealism; quality > our COGS since billing is per-image). |
| **Who authors prompts** | **Claude.** He reserves boxes + writes textless prompts; he never sees the result. |
| **Placeholders** | Reserved box shows a branded shimmer + "generating" affordance (spinner/text) during the stream. |
| **Two prompt modes** | Toggle ON → "images deck" directive (photography-led). OFF → current prompt unchanged. |
| **SVG in images mode** | **Relaxed, NOT removed.** Keep inline SVG for logo + icons + data-viz/charts; stop hand-drawing illustrative *scenes* as SVG — reserve an image box instead. |
| **Distribution** | Cover ALWAYS gets an image (full-bleed bg or split). Other slides: image where it elevates / fills meaningful whitespace. Soft cadence ~1 per 2–3 slides, hard cap (TBD, ~10–12). |
| **Textless** | GPT prompts forbid text/words/letters/captions/watermarks/logos/UI. All wording stays as real HTML over the box. (Critical for Arabic — image models butcher text.) |
| **Streaming** | Don't block the stream. Render the slide with placeholder immediately; fill images async. |
| **Fill UX** | **Realtime progressive swap** — placeholder → spinner → image, via the existing Phase-16 channel. |
| **Image control** | **User toggle** on the /create content card (off = SVG-only). |
| **Regenerate** | On **/project** (final view), generated images are click-selectable → glass-popover with a comment input → regenerate with the amended prompt → swap in place. |
| **Billing** | **Per-image credit debit** (generation + regenerate). Detailed LAST (Phase 5). |
| **Storage** | base64 → Supabase → reference by **URL** in the manifest (never inline base64). See §6 for public-vs-signed. |

---

## 3. Architecture — "reserved box + async fill"

```
/create (toggle ON)
   │  brief.imagesMode = true
   ▼
deck-generate (Inngest)
   │  system prompt: "images deck" directive (§4)
   │  Claude streams slides; some contain:
   │     <img data-genimage="<textless prompt>" data-genrole="hero|bg|accent"
   │          data-genid="<uuid>" style="…sized/positioned…" />   (NO src)
   ▼
StreamingSlideParser closes a slide
   │  → render immediately (placeholder shimmer + spinner in each box)
   │  → scan slide for data-genimage markers
   │  → enqueue parallel image steps (capped concurrency)
   ▼
per image:  gpt-image-2(prompt+textless guard, mapped size)
   │  → base64 → Supabase store → URL
   │  → patch that slide's <img src> + persist per-image record (§5)
   │  → broadcast `slide.image.ready` {slideId, genid, url}
   ▼
client (preview + /project): swap placeholder → image in place (realtime)
```

Claude does **not** receive the generated images back (unlike enhance). The box is
sized; `object-fit:cover` handles fit. No feedback loop — Claude art-directs, we fill.

---

## 4. The box contract + art-direction rules (images-mode prompt)

Claude emits, where an image belongs:

```html
<img data-genimage="cinematic wide shot of a modern Riyadh skyline at dusk, warm light"
     data-genrole="hero"            <!-- hero | bg | accent -->
     data-genid="img-1"             <!-- unique per deck; we fill src by this -->
     style="width:100%;height:100%;object-fit:cover; …positioned…" />
```

Rules baked into the directive:
- **Textless prompts** — append a hard guard to every prompt: *"no text, no words, no
  letters, no captions, no watermarks, no logos, no UI, no signage."*
- **Cover** — MUST have an image: full-bleed background OR a split (image one half).
- **Scrim (hard rule)** — any text over an image box gets a scrim between them
  (brand-color gradient / semi-opaque overlay) so text stays legible regardless of
  the photo. *This is the #1 premium-vs-stock-soup lever.*
- **Distribution** — image where it elevates the content / fills meaningful
  whitespace; intentional whitespace is also valid design. ~1 per 2–3 slides;
  never more than the cap.
- **Aspect** — reserve boxes in roughly **landscape / portrait / square** so they map
  cleanly to gpt-image-2's sizes (§7); `cover`-crop the remainder.
- **Keep SVG** for logo, icons, charts/data-viz. Don't render scenes as SVG anymore.
- **Functional slides** (pure data/stats) generally stay SVG/CSS — a photo can't show numbers.

Toggle OFF → none of this; the current SVG-only prompt is used verbatim.

---

## 5. Data model — per-image record (needed for regenerate)

Each generated image needs a durable record so the regenerate popup has a prompt to
amend and we can track status. Proposed shape (stored as a JSON array on the
presentation version, or a small `GeneratedImage` table — decide in Phase 2):

```ts
type GeneratedImage = {
  genid: string;        // matches data-genid in the slide HTML
  slideId: string;
  prompt: string;       // the textless prompt Claude wrote (amendable on regen)
  role: "hero" | "bg" | "accent";
  size: "1024x1024" | "1536x1024" | "1024x1536";
  status: "pending" | "ready" | "failed" | "moderation_blocked";
  storageUrl: string | null;  // public URL once ready
  updatedAt: string;
};
```

`failed` / `moderation_blocked` → box renders a tasteful branded gradient (not a
broken state) and stays regenerable.

---

## 6. Storage

- New path/bucket for generated deck images — reuse `lib/storage/project-assets.ts`
  pattern; path `…/{projectId}/gen/{genid}.png`.
- **Public vs signed (decision):** brand logos use 1-yr **signed** URLs, but those
  expire — a deck older than a year would have dead image `src`s embedded in its
  saved HTML. Recommendation: a **public** generated-images bucket so URLs are
  permanent (these images are decorative, not sensitive) and exports + old decks
  never break. Confirm in Phase 0.
- We store the PNG and reference it by URL in the slide HTML — **never inline
  base64** (keeps the manifest + .pptx lean).

---

## 7. gpt-image-2 facts (verified 2026-05-31)

- Endpoints: `POST /v1/images/generations` (+ `/edits` for later). Model id `gpt-image-2`.
- Params we use: `model`, `prompt`, `size`, `quality:"medium"`, `n:1`, `output_format:"png"`.
- **Sizes:** `1024x1024`, `1536x1024` (landscape), `1024x1536` (portrait). Map the
  box aspect → nearest. 16:9 deck → landscape heroes; 9:16 → portrait.
- **Response is base64 PNG only — no URL.** We must store it ourselves.
- **No transparent background** on gpt-image-2 (opaque rectangles in boxes — fine).
- **Latency** ~10–30s typical, up to ~2 min for complex prompts → async fill is mandatory.
- `gpt-image-1` **deprecates 2026-10-23** — do not use it. (`partial_images` streaming
  exists but we skip it in v1.)
- Cost (for Phase 5): medium ≈ $0.041/landscape image. Sources in pricing discussion.
- New: `OPENAI_API_KEY` env. Add the `openai` SDK (consistent with `@anthropic-ai/sdk`)
  or plain `fetch` — decide in Phase 0 (lean `openai` SDK).

---

## 8. Phase plan (each phase independently testable)

### Phase 0 — Image client + storage (no flow integration)
**Build:** `lib/images/gpt-image.ts` (gpt-image-2 wrapper: textless-prompt augment,
size mapping, returns base64) + `lib/images/store.ts` (base64 → Supabase → URL) +
`OPENAI_API_KEY` + bucket. **Prereq: user provides `OPENAI_API_KEY`.**
**Test (DoD):** a one-off script generates an image from a prompt and stores it;
opening the returned URL shows the image. No app changes yet.

### Phase 1 — Images-mode prompt + box contract (placeholders only, NO gen)
**Build:** `brief.imagesMode` flag (flip manually for now); in deck-generate, swap
the SVG-only directive for the images-deck directive + box contract (§4). Slides emit
well-formed `data-genimage` boxes with shimmer placeholders. No image generation runs.
**Test (DoD):** generate a deck with `imagesMode` on — inspect the manifest: boxes
present, sized, prompts in `data-genimage`, cover has one, scrim on text-over-image,
cap respected, SVG still used for logo/charts. Preview shows shimmer placeholders.
Toggle-off deck is identical to today (diff the prompt).

### Phase 2 — Async fill + realtime swap (server)
**Build:** Inngest scans closed slides for markers → parallel image steps (capped
concurrency) → store → patch `src` → persist per-image record (§5) → broadcast
`slide.image.ready` → client in-place swap. Spinner during; branded-gradient fallback
on fail/moderation.
**Test (DoD):** images-mode deck fills live (placeholder→spinner→image); kill a
prompt to force a moderation fail → graceful gradient; refresh → images persist;
export PDF + PPTX → images present.

### Phase 3 — Toggle on /create content card
**Build:** "AI images" toggle (reuse `Toggle` primitive) on the create content card →
sessionStorage → POST /api/projects → `brief.imagesMode`. Off = current prompt.
**Test (DoD):** flip the toggle in the real UI; on → images deck, off → today's deck.
Verify both prompt modes fire from the UI, not a manual flag.

### Phase 4 — /project regenerate UI
**Build:** click-to-select a generated image on the canvas (event delegation on
`data-genimage`, like comment markers) → glass-popover showing the image + a comment
input → "إعادة الإنشاء" → new route re-runs gpt-image with the amended prompt → store →
swap in place → update per-image record + saved manifest.
**Test (DoD):** open a finished images-deck on /project, select an image, type a tweak,
regenerate, watch it swap, refresh → persisted.

### Phase 5 — Pricing / credits (LAST)
**Build:** per-image credit debit (generation + regenerate), tie into
`subscriptionmodel.md`; finalize the per-deck cap + a cost/estimate affordance; gate on
the toggle.
**Test (DoD):** credits debit per image; insufficient-credits path handled; cap enforced.

---

## 9. Open questions (resolve at the relevant phase)
- [ ] Public vs signed bucket for generated images (rec: public). — Phase 0
- [ ] `openai` SDK vs `fetch`. (rec: SDK) — Phase 0
- [ ] Per-image record: JSON-on-version vs `GeneratedImage` table. — Phase 2
- [ ] Concurrency cap for parallel image steps (rec: 3–5). — Phase 2
- [ ] Hard cap on images/deck (rec: ~10–12; aesthetic + cost). — Phase 1, finalize Phase 5
- [ ] Regenerate: amend-prompt-only vs free-text replace. — Phase 4
- [ ] Credit cost per image + whether the toggle shows an estimate. — Phase 5

---

## 10. Cross-references (current code seams)
- Create entry → `app/(app)/create/page.tsx` (`handleGenerate`, payload ~L456–594)
- Brief assembly + Inngest fire → `app/api/projects/route.ts` (~L461–615); logo-box
  precedent = `buildClaudeBrand` / `buildLogoBlock`
- Generation core → `inngest/functions/deck-generate.ts` (system prompt ~L81–184;
  `StreamingSlideParser` ~L246–404; `buildLogoBlock` ~L821–880)
- Slide schema (permissive HTML; allows `<img>`) → `lib/schema/slide.ts`
- Render (dangerouslySetInnerHTML + DOMPurify; allows `<img>`) → `components/slides/SlideRenderer.tsx`
- Export (Puppeteer rasterizes remote img; dom-to-pptx rasterizes non-SVG img) →
  `lib/export/render-deck-pdf.ts`, `lib/export/html-export.ts`
- Storage helpers → `lib/storage/project-assets.ts`, `lib/storage/sign.ts`
- Realtime swap → `lib/realtime/*` (Phase 16), in-place update pattern
- Credits (Phase 5) → `context/subscriptionmodel.md`
