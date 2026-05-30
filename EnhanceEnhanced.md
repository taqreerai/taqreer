# EnhanceEnhanced — the /enhance overhaul

> **Status:** spec / not built yet. Build tomorrow. **Commit the whole overhaul as ONE change once it works — do NOT commit piecemeal.**
> **Authored:** 2026-05-30, after a live test of Anthropic's own Claude Design on the same 31-slide deck.

---

## 0. TL;DR

The current /enhance makes a single Claude call do **everything at once** — read the PDF, OCR the content, infer the brand, and emit a 31-slide HTML/JSON manifest — and it buckles (slow, malformed JSON, "succeeded with 7 of 31 slides", looping). 

We watched **claude.ai/design** do the same job. It does NOT do it in one shot — it's an **agent** that spends ~25 min on deterministic *prep* (render pages → images, extract text, extract assets, extract fonts) **before** it designs a single slide. The lesson: **that prep is deterministic and belongs on our server, not on Claude.** Do the ingest server-side, hand Claude a finished package, and Claude's job shrinks to pure design → fast, reliable, faithful.

Two product decisions narrow it further:
- **Keep placeholders** for images/logos (no asset extraction). Claude draws placeholder shapes; user swaps later.
- **Brand kit comes from the user**, not extraction — the enhance card collects **logo + colors + fonts**. Claude never decides the theme → the theme-validation failures vanish.

---

## 0.5 — Day-2 decisions (supersede §5–6 where noted)

**Feed Claude pre-rendered per-slide IMAGES, not the PDF document block.** A PDF document block *does* auto-render each page to an image for Claude (verified via the pdf-support docs — so a rasterizer isn't strictly required), but we choose direct images anyway: full control of resolution, clean one-image-per-slide input, and each image paired with its exact text. → **The PDF-document-block upload is dropped.**

**Rasterizer = poppler `pdftoppm` → PNG @ ~72 DPI.** Benchmarked on the real 31-page deck (2026-05-31): **31 pages in ~12s**, **1584×891px / ~650 KB per slide** at 72 DPI — which is Anthropic's ~1568px vision ceiling, so anything larger is downsampled = wasted upload. PNG, not JPEG (slides are text/vector; JPEG rings on small text). Path: pptx→pdf (existing LibreOffice) → `pdftoppm -png -r 72`; PDF uploads rasterize directly. Prod: add `poppler-utils` next to LibreOffice. Rejected: pdfjs+canvas (the 17.B-8 Turbopack pain), ghostscript/imagemagick (heavier, GS quirks).

**All image files are TRANSIENT — flushed once Claude has been fed.**
- Local rasterization temps (pdf + PNGs) live in a `mkdtemp` dir, deleted after handoff (like `pptx-to-pdf.ts`).
- Images reach Claude via the Anthropic Files API (short-lived) — or base64-inline per call in the per-slide path.
- **`deck-generate` flushes them**: a cleanup step deletes the uploaded `file_id`s after the deck is saved AND in `onFailure` (survives retries; gone once consumed).
- No Supabase "render" bucket; no permanent storage of rendered images. Also drops the persisted PDF-on-Anthropic.
- Edge: an extracted-but-never-generated card would orphan its images → cheap periodic sweep (follow-up; the old PDF upload had the same risk).

**Updated build order:** (1) `lib/extract/pdf-to-png.ts` (`pdftoppm` wrapper) → per-slide PNG buffers; (2) per-slide exact text (`text-pptx.ts`); (3) upload images to Files API + store transient `file_id`s + **flush-after-generation** cleanup; (4) brand-kit card (colors + fonts); (5) design-prompt rewrite → {image block + exact text + brand kit} per slide; (6) drop PDF-doc-block + the salvage/continue scaffolding; (7) `/security-review` + one commit.

---

## 1. The problem (current enhance)

Evidence gathered while debugging (2026-05-29/30):

- A 31-slide enhance **truncated on the last slide** (hit the old `max_tokens: 64000` ceiling ≈ ~31 slides at ~2k output tokens/slide), failed `JSON.parse`, and the self-heal loop **restarted from slide 1** repeatedly → looped until force-stopped. ~$9.55 on Opus 4.8 for one run (output-dominated, zero cache reads).
- After raising the cap to **128k**, a re-run **"succeeded" with only 7 of 31 slides**: the response generated a full deck's worth of output (~44k tokens) but the JSON was malformed/draft-then-final, the whole-buffer parse failed, and salvage scraped 7 clean slides. Root cause: preset was **`opus-fast` = thinking DISABLED**, which is documented-fragile for long structured JSON.
- The prompt itself is **~4k tokens of dense, simultaneous constraints** applied to 31 slides in one JSON response — a big chunk of which is *PowerPoint-export survival* rules (BiDi OOXML, forbidden CSS, chrome zones) irrelevant to the actual design.

**Diagnosis:** the single call is overloaded — it extracts *and* designs *and* decides the theme, all at once, under heavy constraints. That's the failure.

---

## 2. Verified API facts (reference)

- **Opus 4.8** (`claude-opus-4-8`): context window **1M tokens (input)**; **max output 128k tokens** on the synchronous Messages API; pricing **$5 / $25** per MTok. The async **Message Batches API** can reach **300k output** via the `output-300k-2026-03-24` beta header (no live streaming).
- **Document blocks** accept **PDF and plain text only** (plus images as image blocks). **You cannot send a `.pptx` or `.docx`** — convert to PDF or extract to text. A PDF document block gives Claude **both** the text layer **and** per-page vision.
- ~**2k output tokens per slide** for our editorial inline-SVG HTML (so 64k ≈ 31 slides, 128k ≈ ~60 slides — but a single 120k-token stream is slow + fragile).
- **Thinking-off presets** (sonnet-fast, opus-fast) produce malformed/partial JSON on long decks. Thinking-on (opus-balanced, effort:low) drafts internally and commits clean JSON.

---

## 3. What Anthropic's Claude Design actually does (observed live)

Ran the same 31-page deck (the LibreOffice-converted PDF) + our exact enhance prompt through claude.ai/design and monitored it end to end via Playwright. It is an **agent with code execution + a project filesystem**, running a **self-authored to-do list**:

1. **Exhaustive multi-modal ingest (~25 min for 31 pages):**
   - Extract **text** (`pdf-parse`).
   - Render **every page to a PNG** (`pdfjs`) and **view every image** — *"Before I design anything, I need to see the actual visual identity — colors, fonts, logo, layouts."*
   - **Extract every real embedded asset** (logo white+color, cover motif, photos, JV photo, team headshots, partner marks) page-by-page into an `assets/` folder — *"reusing the user's own brand assets beats placeholders."*
   - It debugged its own tooling along the way (font-fetch bottleneck, `requestAnimationFrame` paused in the sandbox iframe → monkeypatched to `setTimeout`, batch + timeout races).
2. **Plan scratchpad** — design system + title sequence (an outline).
3. **Set up `deck_stage.js`** — one **shared scaffold**: type scale + chrome that *every slide reuses*.
4. **Build all 31 slides verbatim** on the scaffold.
5. **Add a Tweaks panel.**
6. **Verify + done.**

**Key takeaways:**
- **The prep is deterministic** — it's only agentic because claude.ai has no backend. We have one.
- **Consistency = a shared scaffold (`deck_stage.js`), not a theme spec.** Our old batching drifted because each batch re-interpreted a theme *description*; Anthropic shares actual chrome/type-scale *code*. This is the missing piece for any multi-call design.
- It treats the **visual as non-negotiable** (renders + views every page) **and** extracts **exact text** (verbatim). The hybrid.
- (We are deliberately *not* copying its real-asset reuse — see decisions.)

---

## 4. Decisions (locked for this overhaul)

1. **Move all ingest server-side, deterministic** (no Claude agent loop). Claude only designs.
2. **Keep placeholders** for images + logos. Claude draws placeholder shapes; user swaps post-gen. → **No asset extraction.**
3. **Brand kit from the user.** The enhance card collects **logo + colors + fonts**. Claude does **not** decide the theme → kills the bad-font-URL / theme-reject failures. Theme = user's kit (authoritative).
4. **The visual stays** — Claude must *see* the source to enhance it (enhance = see-and-improve, never text-only).
5. **Verbatim content** comes from **server-extracted exact text**, not Claude OCR.
6. **Lighter prompt** — strip the "figure out the deck / extract / infer brand" burden; Claude just redesigns. (Keep the design-quality + RTL/BiDi + export-survival rules.)

---

## 5. Target architecture

### Enhance card (collect up front)
- **Logo** upload (existing `LogoUploadSlot`).
- **Colors** picker (re-add — removed in task 171).
- **Fonts** picker / upload (existing brand primitives — Google font slot + font upload).
→ Produces an authoritative **brand kit** (logo + palette + fonts) attached to the brief.

### Stage 1 — Prep (server, deterministic, parallelizable, no LLM)
For the uploaded deck (PPTX→PDF via LibreOffice as today; PDF passes through):
- **Per-slide exact text** — from the **PPTX XML** (exact text runs, no OCR) for pptx; from the **PDF text layer** for pdf uploads. ← the main new piece.
- The source **visual** for Claude:
  - **Option A:** keep the existing **PDF document block** (Claude already gets per-page vision + text).
  - **Option B:** **rasterize each page to a PNG** (server rasterizer — we removed pdfjs/canvas in 17.B-8; re-add via poppler `pdftoppm` / pdfium / headless render). One image per slide.
- **No** asset extraction. **No** brand extraction.

Output: a structured **per-slide package** `{ index, text }[]` + the user's brand kit + the source visual (PDF block or per-page PNGs).

### Stage 2 — Design (LLM)
Claude receives, per slide: **source visual + exact text + user brand kit + "placeholder shapes for images/logos"** → redesigns. Output stays our **HTML manifest**. Theme is fixed (user kit). Claude's job = *look at this slide, make it prettier with the user's brand, keep the exact words, placeholder the images.*

### Stage 3 — Assemble + render + export
Unchanged (existing manifest → renderer → dom-to-pptx).

---

## 6. The one open design choice — Stage 2 shape

| | A — single coherent call | B — per-slide |
|---|---|---|
| **How Claude sees** | PDF document block (all pages) | per-page PNG (one per call) |
| **Calls** | 1 | N (one per slide / small batches) |
| **Drift risk** | none (single context) | controlled IF each output is anchored to *its own* source page image **+** a shared locked scaffold (the `deck_stage.js` trick) |
| **Live feedback (#1 priority)** | one shot | true per-slide ("slide done → show it") + single-slide retry |
| **New infra** | per-slide text only (no rasterizer) | rasterizer + per-slide orchestration + shared scaffold |
| **Effort** | small | larger |

**Recommendation:** **Do A first.** Now that Claude's load is light (exact text given, brand given, placeholders, lighter prompt), the single coherent call likely becomes reliable *today* with no rasterizer. Then **graduate to B** for the live-feedback polish — B is now *safe* (unlike our old batching) because each output slide is anchored to its own source image **and** shares a locked scaffold.

---

## 7. Infra inventory — have vs. build

**Have:**
- LibreOffice **pptx→pdf** (`lib/extract/pptx-to-pdf.ts`).
- **Fonts** extraction (`lib/extract/fonts-pptx.ts`) — keep for *suggesting* defaults on the card, but the user confirms.
- **Colors** extraction (`lib/extract/colors-pptx.ts`) — same (suggest, user confirms).
- PPTX **asset extraction** (group-tagged blips) — *shelved* (17.B-8 / 175). NOT needed (placeholders).
- Page count + aspect (`pdf-lib` in `extract-source.ts`, task 17.B-15).
- Brand UI primitives: `LogoUploadSlot`, color picker, Google-font slot, font upload (from `/create/brand`).
- The manifest schema, renderer, dom-to-pptx export.

**Build:**
1. **Per-page exact text extraction** — PPTX XML per-slide text; PDF text-layer per-page. (New.)
2. **(Option B only) pdf→PNG rasterizer** — re-add a server rasterizer (poppler/pdfium/puppeteer). One PNG per page.
3. **Enhance card:** re-add **colors + fonts** pickers next to the logo (collect the full brand kit).
4. **Design prompt rewrite** — consume the package; drop the extraction/brand-inference instructions; keep design-quality + RTL/BiDi + export rules. Theme is injected from the user kit (Claude doesn't emit/decide it).
5. **(Option B only) shared scaffold** — a locked CSS chrome/type-scale every slide plugs into.

---

## 8. Current code state (uncommitted on `dev`, from debugging — revisit, don't assume keep)

`inngest/functions/deck-generate.ts` currently has uncommitted changes from the investigation:
- `max_tokens` raised **64k → 128k**. (Probably keep.)
- **Thinking-on auto-upgrade**: `resolveEffectiveQuality` now upgrades thinking-off presets (sonnet-fast/opus-fast) → **opus-balanced** for enhance/mimic/data. (Probably keep — clean JSON.)
- **Salvage + continue (A+B)** logic in the `call-claude-and-validate` step (stop_reason read, salvage partial slides, continuation calls), `OUTER_ATTEMPTS = 1`, schema-failure logging. ← **Much of this is likely SUPERSEDED** by the new server-prep architecture (the overload it works around goes away). Re-evaluate / likely simplify or remove when we rebuild.

> Decision for tomorrow: rebuild the enhance path around server prep, fold in the keepers (128k, thinking-on), drop the salvage/continue scaffolding if the lighter design call is reliable, and **commit the whole thing once.**

---

## 9. Open questions / risks
- **PDF text-layer fidelity** for pdf-only uploads (Arabic/numbers) — pptx XML is exact; pdf text layer can be lossy. May need per-page image fallback (Option B) for image-only/scanned PDFs.
- **Rasterizer choice** (Option B) — poppler `pdftoppm` is simplest server-side; resolution vs token cost trade-off.
- **Shared scaffold** (Option B) — how to express "one chrome/type-scale every slide reuses" inside our manifest model (CSS vars already shared; need layout-grammar consistency too).
- **Per-slide vs whole-deck text** — make sure the text package maps cleanly 1:1 to source pages.
- Re-run `/security-review` after the rebuild (Inngest prompt-pipeline + new extraction + upload handling).

---

## 10. Tomorrow's checklist (suggested order)
1. [ ] Enhance card: re-add **colors + fonts** pickers → full brand kit on the brief.
2. [ ] Stage 1: **per-page exact text** extraction (pptx XML + pdf text layer) → package.
3. [ ] Design prompt rewrite: consume {source visual + per-slide text + user brand kit + placeholders}; inject theme from kit; drop extraction/brand-inference; keep design + RTL + export rules.
4. [ ] Wire **Option A** (keep PDF block) end-to-end; test the 31-slide deck.
5. [ ] If A is reliable → ship. If we want live feedback → build **Option B** (rasterizer + per-slide + shared scaffold).
6. [ ] Drop the now-unneeded salvage/continue scaffolding; keep 128k + thinking-on.
7. [ ] `/security-review`, then **commit the overhaul as one change**.
