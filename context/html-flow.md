# The HTML generation flow (canonical, 2026-06-05)

Status: **SHIPPED.** All four flows — `create` (scratch text / images / file-upload),
`datasheet`, `mimic`, `enhance` — generate decks the same way: Claude **streams
`<section>` HTML**, not a JSON manifest. The JSON manifest path was deleted on
2026-06-05 (see `log.md`). This doc is the canonical map of what happens from the
user clicking *generate* to the exported file.

Supersedes the JSON-era sections of `plan-create-agent-pivot.md` (which proposed
the pivot for `/create` only); this is the generalized, shipped form.

---

## 1. The one gate

`isHtmlAuthoringFlow(event)` in `inngest/functions/deck-generate.ts` returns true
for every flow (`type` is only ever `"create" | "enhance"`). It is now effectively
always-true; it is kept as an explicit guard so a hypothetical future flow fails
loudly (the `throw` after the HTML branch) instead of silently. There is **no JSON
branch** — the streaming step authors HTML or throws.

## 2. What's shared vs per-flow

Everything in the streaming core is shared across all four flows. Only the **input**
and a small **system addendum** differ:

| Flow | `type` / `source.kind` | Source content blocks | Directive (in user msg) | System addendum |
|---|---|---|---|---|
| create (text) | create / *(none/scratch)* | none (plain string) | none | — |
| create (images) | create / scratch | none (or 1 PDF if file-upload) | scratch (if upload) | `IMG_ADDENDUM` (reserve gen-image boxes) |
| datasheet | create / `data` | **none** — markdown is inlined in the directive | chart-deck directive (inline `<svg>`, fidelity, sentinels) | — |
| mimic | create / `mimic` | design-ref PDF (+ optional ugly PDF) document blocks | "match the reference" + brand vars | `MIMIC_HTML_ADDENDUM` (reproduce reference, don't invent) |
| enhance | **enhance** / `enhance` | per-slide `{image + verbatim text}` blocks (file-based) | per-slide redesign brief (preserve content + identity, lock chrome) | `ENHANCE_HTML_ADDENDUM` (redesign existing, override "ORIGINAL/VARY") |

- **System prompt** = `SYSTEM_PROMPT_CREATE_HTML` + the per-flow addendum(s) above, joined.
- **User message** = `baseUserMessage` = `buildSourceTextDirective(...)` (per-flow) + `buildUserMessage(...)` + the "Author the deck now: emit the `<section>` slides… first character must be `<`" closer.
- **Content** = `hasDocBlocks ? [...docBlocks, {text:userText}] : userText`. File-based blocks (mimic/enhance/create-upload) carry the `anthropic-beta: files-api-2025-04-14` header.

## 3. Generate pipeline (click → saved deck)

1. **Flow UI** (`app/(app)/{create,datasheet,mimic,enhance}/page.tsx`) — pre-steps: datasheet → `POST /api/datasheet/parse`; enhance/mimic → `POST /api/extract` + poll `GET /api/extract/[jobId]`. All then `POST /api/projects`.
2. **`POST /api/projects`** — creates Project / Presentation / PresentationVersion(v1) / Job rows, sends Inngest **`deck.generate.requested`**.
3. **`deckGenerate`** (`inngest/functions/deck-generate.ts`), `retries:3`, `cancelOn deck.generate.cancel.requested`:
   - `broadcast-deck-regen-started`.
   - resolve quality → `paramsForQuality` (model + thinking + effort; default `opus-balanced` = Opus 4.8 + adaptive + effort:low).
   - `rasterize-and-upload-source` *(enhance only)* → per-slide PNG `file_id`s.
   - `call-claude-and-validate`: build `theme = buildCreateHtmlTheme`, `htmlSystem`, `baseUserMessage`, `docBlocks` → `client.messages.stream(...)`. Stream handlers: `thinking`→`writeProgress`; `text`→`StreamingHtmlSplitter.push`→`ingestSlide` (`scopeDeckCss(extractLeadingStyleCss())` once + `buildSlideHtml` per slide → `streamingPreview` + image-warm dispatch in images mode). Assemble manifest → `SlideManifestSchema.safeParse` → return.
   - post-step: `expandWeightAxis` + `injectUploadedFontSources`, `save-to-database` (manifest → `PresentationVersion.slideJson`, Project/Job → completed), images mode → `deck.images.requested`, `flush-enhance-images`, `broadcastToProject("deck.regen.finished")` + bell.
4. **Live preview** (`components/preview/DeckView.tsx`) — 1.5s poll `GET /api/projects/{id}/status?includeManifest=true` (authoritative in local dev) applies `streamingPreview` mid-stream and swaps to the final manifest via `setManifestStable` (no `router.refresh`); plus Supabase Realtime + broadcast handlers (`deck.regen.finished` → `fetchAndSwapState`).
5. **Images-mode async fill** — `dispatchImageWarm` → `deck.image.warm` (gpt-image → store → `slide.image.ready`); end-of-deck `deck.images.requested` reconciles via `injectImgSrc` back into `PresentationVersion.slideJson`.

## 4. The slide shape & export spine

Every slide's `slide.html` is a self-contained `<section><style>…scoped CSS…</style>…</section>` fragment (`buildSlideHtml`), the `<style>` scoped under `.tq-canvas` (`scopeDeckCss`). The brand vars (`--brand-1..N`, `--font-heading/body`, `--primary/secondary/accent`) are injected at the **slide root** by `themeToCssVars` (`lib/export/theme-css-vars.ts`) for **every** consumer — live preview, PPTX, PDF, PNG, HTML — and the scoped `<style>` only *reads* them. No exporter parses the `<style>`; the browser (PPTX offscreen / Puppeteer) or the browser-on-open (HTML bundle) applies it, so preview and all exports resolve identically.

Export entry points (`useExportActions`, baked `exportManifest` with filled images):
- **PPTX** (client) — `exportManifestAsPptx` → offscreen `SlideRenderer` → RTL/BiDi pre-passes → patched `dom-to-pptx` (reads computed styles) → font embed (`/api/export/embed-fonts`: Google css2 / uploaded faces → fontforge OTF→TTF → EOT) → `fixBiDiInPptxBlob` (3 OOXML BiDi layers + run-merge).
- **PDF / PNG** (server) — `POST /api/projects/{id}/export/{pdf,png}` → `buildHtmlDocumentServer` → Puppeteer `page.pdf()` / per-slide `page.screenshot()`.
- **HTML** (client) — `downloadHtmlDocument` → `buildHtmlDocument`.

## 5. Why this is safer than JSON (the "tramp bombs")

The JSON manifest was always an **envelope** around HTML — each slide's `html` field was already an HTML string. Forcing HTML into a JSON string is where the corruption lived: one unescaped `"` or newline inside any `html` value broke the whole `JSON.parse`, and the model had to single-quote every attribute and keep each slide on one line. Authoring HTML directly removes the envelope (and the `repairJson` / `StreamingSlideParser` / per-slide re-parse machinery), so a malformed run degrades to a missing slide, not a lost deck.

## 6. Out of scope / unaffected

- **Partial regen** (`deck-regenerate-partial.ts`) was already HTML-native — it reads each slide's `.html` and regenerates HTML; no migration needed.
- `lib/extract/json-repair.ts` is now orphaned (0 importers) — a deletion candidate, left in place pending a separate pass.
