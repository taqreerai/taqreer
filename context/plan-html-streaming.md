# Plan — HTML-streaming generation (kill the JSON keyhole)

Status: PROPOSED (2026-06-04). Awaiting go-ahead before any code.

## 1. Why — the root cause, stated once

Every generation failure this session is the **same** bug wearing different
clothes: the model keeps writing the `html` value as *live code*, not inert
text, because we force a large HTML/CSS/SVG payload through a **JSON string**.

| Failure | The code idiom it used |
|---|---|
| early decks | unescaped `"` inside the string (HTML attribute quoting) |
| cmpylfuvg | `"a"+"b"` string concatenation |
| cmpymd9jf | `[...].map((t,i)=>{…}).join('')` — a full loop |

A JSON string can only hold dead text. The model treats that slot as a place to
*author a program*, so it reaches for quotes, `+`, and `.map()`. The specific
idiom changes per run; the boundary it crosses is always **data vs. code**.
`/enhance` never breaks because it *transcribes* given text (data mode);
`/create` authors from nothing → code mode.

Every fix so far (escape quotes → single-line → `collapseJsConcat` → forbid
`.map()`) just narrows the keyhole. **The durable fix is to remove the keyhole:
stream raw HTML, not JSON.**

## 2. The principle

Stop asking the model to embed HTML inside a JSON string. Let it emit **HTML as
HTML**, in its natural mode. Keep the tiny bit of real structure (theme, title,
counts) as a small, line-based header that is too small to ever trigger the
failure. Reconstruct the **exact same `SlideManifest` object** server-side from
the stream — so everything downstream is untouched.

Two structural wins beyond "no more parse crashes":
- **Failures go soft.** A malformed byte today loses the *entire* deck + a
  15-min retry loop. In raw HTML, a bad bit is *one ugly slide*; the rest still
  renders.
- **The system gets simpler.** We delete the whole JSON-salvage maze (below).

## 3. New wire format

The model emits, in order: one META block, then one block per slide, each
introduced by a sentinel comment. `TAQREER:` namespacing makes collision with
real content effectively impossible.

```
<!--TAQREER:META-->
title: تقرير — من الفكرة إلى عرض جاهز
palette: #8B5CF6, #44278F, #FFFFFF
font-heading: Noto Sans Arabic | https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;800&display=swap
font-body: Noto Sans Arabic | https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@300;400&display=swap
background: #FFFFFF
text: #44278F
slides: 11
<!--TAQREER:SLIDE id="cover" role="cover"-->
<div dir='rtl' style='width:1080px;height:1920px;…'> … literal HTML, written naturally … </div>
<!--TAQREER:SLIDE id="toc" role="content"-->
<div …> … repeated markup, written out in full, no code … </div>
…
<!--TAQREER:END-->
```

- **META is line-based `key: value` — NOT JSON.** Zero JSON anywhere in the
  format → fully commits to "no keyhole." Values are short and flat, so there's
  nothing for the model to mis-escape.
  - `font-heading` / `font-body` = `name | url` (url optional; system fonts omit
    it). `fontFaces` (uploaded weights) is **injected server-side**, never by the
    model — unchanged from today.
- **SLIDE marker** carries `id` + `role`. `id` defaults to `slide-N` if omitted;
  `role` defaults to `content`. Between markers is **raw HTML** — any quotes,
  any whitespace, multi-line, no escaping.
- **Server sets** `version:"2.0"`, `presentationId` (= `data.presentationId`),
  `format` (from brief), `language` + `direction` (from brief —
  `streamLanguage`/`streamDirection`, already authoritative today). The model
  does NOT emit these → fewer things it can get wrong.

## 4. Prompt contract changes (`deck-generate.ts`)

Replace the `OUTPUT_CONTRACT` (the JSON/escaping rules) with the HTML-stream
contract. Net effect: the prompt gets *shorter* and the model's job *easier*.

- Remove: "valid JSON", single-quote-attributes rule, single-line/no-raw-
  newline rule, the whole `{ "slides": [ … ] }` shape, `collapseJsConcat`-bait.
- Add: "Output a `<!--TAQREER:META-->` block (the `key: value` lines above), then
  one `<!--TAQREER:SLIDE id=… role=…-->` marker + the slide's **literal HTML**
  for each slide, then `<!--TAQREER:END-->`. Write final HTML only — never
  template syntax, never `+`, never `.map()`; if a list repeats, write each item
  out. Markers go on their own line."
- Applies to **all** generation branches that stream slides: create, enhance,
  mimic, datasheet. The verbatim/enhance content rules stay; only the OUTPUT
  FORMAT section is shared-and-swapped. (`SYSTEM_PROMPT`, `SYSTEM_PROMPT_IMAGES`
  + `IMG_ADDENDUM`, and the mimic/enhance system prompts all reference the same
  output contract — verify each.)
- `IMG_ADDENDUM` (`data-genimage` boxes) is unchanged — it already describes
  literal `<img>` markup.

## 5. New parser — `StreamingHtmlSplitter` (replaces `StreamingSlideParser`)

A marker splitter, far simpler than the brace/string state machine.

Algorithm (incremental, over the growing buffer):
- Accumulate streamed text into `buffer`.
- The region between `<!--TAQREER:META-->` and the first `<!--TAQREER:SLIDE…-->`
  is the META block → parse the `key: value` lines into `{ title, palette[],
  fontHeading, fontBody, background, text, slides }` **once** the first SLIDE
  marker appears (META is then known-complete).
- Each `<!--TAQREER:SLIDE id=… role=…-->` opens a slide. Its `html` = the text
  from just after that marker up to **the next marker** (`SLIDE` or `END`).
- **Per-slide close = "the next marker appeared."** When a new marker is seen,
  the previous slide's html is final → emit it: `SlideSchema.safeParse` →
  push to `callSlides` + `streamingPreview` → (images mode) `scanGenImages(html)`
  → dispatch `deck.image.warm` per box. This maps 1:1 to today's
  `parser.advance()`-yields-a-closed-slide hook (deck-generate.ts ~1918–2000).
- `<!--TAQREER:END-->` or stream-end closes the last slide.
- **Re-emit / draft→re-emit:** if a *second* `<!--TAQREER:META-->` appears after
  slides were already emitted, treat as reset (clear `callSlides` +
  `streamingPreview`, bump `manifestVersion`, free the warm budget) — same
  semantics as today's `didReset()`, but trivially detected (a marker, not a
  depth-0 `}`). `manifestHeadOffset` is gone.

The splitter yields `SlideType` objects (`{slideId, role, html}`) and exposes
the parsed theme — i.e. it feeds the **exact same** `streamingPreview` /
`streamingTheme` contract the status route + DeckView already consume (no
changes there).

## 6. What stays identical (the streaming contract)

Confirmed by the code map — unchanged:
- `writeProgress(stage, currentSlide, total, extra?)` → `PresentationVersion.
  slideJson` with `{status, progress, streamingPreview:SlideType[],
  streamingManifestVersion, streamingTheme, streamingDirection,
  streamingLanguage}`.
- `app/api/projects/[id]/status/route.ts` response shape — unchanged.
- `DeckView.tsx` polling (1.5s), `SlideSchema`/`ThemeSchema` validation,
  `SlideRenderer` (client `sanitizeSlideHtml` + theme CSS vars + image-fill
  inject) — unchanged.
- The per-slide `deck.image.warm` dispatch + cap logic — unchanged (just called
  from the new splitter's close hook).

## 7. End-of-stream assembly + validation

Build the manifest from `{META theme + title + slides[]}` + server-set fields:

```
const manifest = {
  version: "2.0",
  presentationId: data.presentationId,
  title: meta.title,
  language: streamLanguage,         // from brief, authoritative
  direction: streamDirection,       // from brief
  format: briefFormat,              // from brief
  theme: { palette, fontHeading, fontBody, background, text },
  slides,                            // [{slideId, role, html}]
};
SlideManifestSchema.safeParse(manifest)  // same Zod gate as today
```

No `extractJson` / `repairJson` / `collapseJsConcat` / `extractLastJsonObject` /
whole-buffer parse / degenerate-salvage. The "salvage" becomes: if the stream
ended mid-slide or a marker is missing, we still have every fully-closed slide →
ship them (graceful), and only fail if **zero** slides closed or theme is
missing.

## 8. UX — NO UI changes (user direction, 2026-06-04)

The existing `/preview` streaming UX already does what we want: `streamingPreview`
grows one slide at a time and each renders via the existing (sanitized)
`SlideRenderer`. Because the new parser feeds the **same** `streamingPreview` /
`streamingTheme` contract, that UX keeps working **with zero UI changes** — no
status-route change, no DeckView change, no new component, no iframe.

- **DROPPED:** the sandboxed-iframe "in-flight draw" idea. Not needed — the
  per-slide-on-close preview is the UX. (Avoids the only new security surface.)
- **Optional later (zero-friction polish, NOT now):** a CSS/text-shimmer
  animation on the just-appeared slide to make it feel "written." Pure cosmetic,
  no pipeline impact. Deferred.

## 9. Failure modes & graceful degradation

- **A malformed slide** (bad HTML) → renders as one ugly slide; deck survives.
  (vs. today: total loss.)
- **Model forgets a SLIDE marker** → two slides merge into one over-full slide —
  visibly wrong, not fatal. Mitigation option: also accept a top-level
  `<section data-slide-id…>` as a boundary (belt-and-suspenders).
- **Missing END marker** → stream-end closes the last slide anyway.
- **Malformed META line** → that one field falls back (title→brief/generic,
  palette→brief colors, fonts→brief). META is tiny, so this is rare and cheap.
- **No slides at all** → hard fail (as today), but now genuinely rare.

## 10. What gets deleted (simplification)

Once Phase A is proven, remove from `deck-generate.ts` + `lib/extract/`:
- `StreamingSlideParser` (the brace/string state machine)
- `extractJson`, `extractLastJsonObject`, `repairJson`, `collapseJsConcat`
- the whole-buffer parse + sources loop, `parseHead`, `assemble`, the
  degenerate-salvage guard, `manifestHeadOffset`
- `lib/extract/json-repair.ts` (if unused elsewhere — verify regen/datasheet)
- the temporary `dumpRun` debugger
- `lib/types/quality.ts` `estimateSlideCountFromText` stays (slide-count is
  still a brief input).

Net: the generation front-end shrinks substantially and stops being a source of
incidents.

## 11. Blast radius — confirmed downstream-safe

Everything after the manifest is built reads the **parsed object**, never the
raw text (verified): font expand (`expandWeightAxis` on `theme.font*.url`), font
inject (`injectUploadedFontSources` → `theme.font*.fontFaces`), DB save
(`PresentationVersion.slideJson` = manifest; `seedSlideVersionsForInitial
Generation` per-slide `slideId`+`html`), `deriveColorTags(theme.palette)`,
images dispatch (`deck.images.requested`), thumbnail/export
(`sanitizeSlideHtmlServer` per `slide.html`), broadcasts. **All untouched** as
long as we emit the same `SlideManifest`.

## 12. Branches to update

All four generation flows share the streaming step, so all get the new output
contract + splitter automatically. Verify the per-branch SYSTEM prompts
(create / enhance-verbatim / mimic / datasheet) each reference the swapped OUTPUT
FORMAT section and nothing else regresses (esp. enhance's strict-verbatim rule).

## 13. Implementation phases (each independently testable)

1. **Parser, standalone + unit-tested.** Write `StreamingHtmlSplitter` + the
   META line-parser as a pure module; unit-test on hand-written + on the two
   captured failing buffers (rewritten into the new format) → asserts it yields
   the right slides + theme. No wiring yet.
2. **Prompt swap.** Replace `OUTPUT_CONTRACT` with the HTML-stream contract
   across the shared system prompt(s). tsc/lint.
3. **Wire the splitter** into the streaming loop in place of
   `StreamingSlideParser`; assemble manifest at end-of-stream; keep `dumpRun`
   for one live run. NO changes to status route / DeckView / SlideRenderer —
   they consume the same `streamingPreview`/`streamingTheme` contract. → live
   test: a `/create` images deck must produce all slides.
4. **Delete** the JSON machinery + `dumpRun` (§10). tsc/lint + `/security-review`
   (touches the prompt pipeline only — no new render surface).
5. Commit / push / PR `dev → main`.

(No Phase B / iframe — see §8. Optional text-shimmer polish deferred.)

## 14. Risks & open questions

- **Marker reliability.** The model must emit `<!--TAQREER:SLIDE…-->` on its own
  line every time. Comments are well-followed, and a miss degrades softly (§9).
  Open: add the `<section data-slide-id>` fallback boundary now, or only if a
  miss is observed? (Lean: ship without, add if needed.)
- **Enhance verbatim.** Confirm the verbatim flow still reproduces source text
  faithfully under the new format (it should — it already emits HTML; only the
  envelope changes).
- **Regen path.** Single-slide regen (if it re-runs generation) must emit one
  SLIDE block; confirm its prompt/parse path.
- **Token cost of comments.** Markers add a few tokens per slide — negligible vs.
  the escaping/retry cost they remove.
