# Enhance: carry over the original visuals (plan, 2026-10-15)

Status: draft for owner review. Nothing built yet. Based on two local spikes
(scratchpad, 2026-10-15) run on real uploads: an Arabic finance PDF with a vector
line chart, and the RNA / Polymers PDFs (picture charts, a scatter plot, a tree
diagram, a table, a concept sketch).

## 1. Owner rules (non-negotiable)

1. **Original images are never swapped.** A photo, screenshot, map or logo from the
   source is always carried over. It may only be ENHANCED to fit the new design
   (crop, frame, colour grade, relight, upscale), keeping the subject.
2. **AI images only where the source has none.** With AI images on, generated
   images are added only when the original FILE contains no content images
   (decorative backgrounds do not count). Decided per file (owner, 2026-10-15): if
   any slide has a content photo, the deck gets no AI images at all.
3. **Charts, graphs, diagrams, tables: content is sacred, look is free.** They are
   redesigned in the deck's style, but every value, label and connection must
   survive. When we cannot prove that, the original is kept (framed).
4. **Obvious typos in labels are fixed** ("E is the slop" becomes "E is the slope").
   Numbers and data are never "corrected".

## 2. What happens today (and what changes)

| Today (deck-generate.ts) | After |
|---|---|
| Each source slide goes to the model as a 72 dpi page image + its text (`sourceToSlideImages`, `rasterize-and-upload-source` step) | Same, plus a new analysis step that finds and processes every visual |
| Photos: regenerated as AI images when images mode is on (`ENHANCE_IMG_ADDENDUM`), else a `data-photoslot` placeholder the user fills by hand (`PhotoSlotOverlay`) | The original photo is placed automatically, restyled to fit |
| Complex charts / diagrams: "styled placeholder block... do not reconstruct the data" (user-message VISUAL HANDLING rules) | Redrawn from extracted data by our own renderers, verified, original as fallback |
| Model draws simple visuals freehand in SVG | Model only places boxes; the server fills them |

## 3. Pipeline

A new Inngest step `analyse-source-visuals` runs after `rasterize-and-upload-source`
and before `call-claude-and-validate`. Only the region list (kind, size, aspect) is
needed before the model starts; extracting data and rendering can run in parallel
with the stream and be injected afterwards (same pattern as `data-genid` image fills).

### 3.1 Render
Render every source page once more at 200 dpi (pdftoppm, already installed) for
crops and for reading picture charts. The 72 dpi images stay as the model's slide
view. Only visible (teaser) slides are processed on the free plan.

### 3.2 Find the visuals on each slide
- **PPTX (exact, free):** walk each slide's XML: `p:pic` (pictures), `p:graphicFrame`
  holding `c:chart` (charts), `a:tbl` (tables) or `dgm` (SmartArt), and `p:grpSp`
  groups. Positions come in EMU, mapped to page pixels. Layout / master pictures
  are not on the slide itself, so most decoration is excluded for free.
- **PDF images (exact, free):** image placements from the content stream (image
  XObject + transform matrix) give each picture's box.
- **PDF vector visuals (charts, diagrams, tables drawn as lines + text):** one vision
  call per slide that has candidate content returns boxes + kind. Spike still needed
  for box accuracy (see 7).
- **Decorative filter:** drop full-bleed backgrounds, images repeated in the same
  place on most pages (the Arabic PDF had 7 to 89 embedded images per page, all
  background art), and tiny items (under ~3% of the slide).
- **Several visuals per slide are normal** (spike: poly-52 had a sketch AND a table,
  and the models disagreed on which was "the" visual). Each region is handled
  separately.

### 3.3 Classify
`photo` (incl. the user's own real things), `screenshot`, `map`, `logo`, `chart`,
`diagram`, `table`, `sketch` (concept drawing, no data), `decorative`.

### 3.4 Get the content (best source first)

| Kind | Exact source | Fallback |
|---|---|---|
| Table | PPTX `a:tbl` cells; PDF text layer inside the box (`pdftotext -bbox`) | vision read |
| Diagram | labels from the text layer inside the box | structure (edges, groups) from a vision read |
| Chart | PPTX chart XML (`c:ser`, `c:cat`, `c:val`): real numbers; PDF vector paths mapped to the gridlines (spike 1: exact) | **picture charts:** two DIFFERENT models read the 200 dpi crop (Sonnet + Opus). Points where they differ by more than 3% of the axis are re-read from a zoomed crop; still different = keep the original |
| Sketch | none | model draws a themed SVG, then must pass the check (3.6) |
| Photo / screenshot / map / logo | the crop itself | n/a |

Spike evidence: tables 16/16 cells exact, diagram 9/9 labels, scatter accurate to
~0.01, picture line chart 26/27 points within ~1-2% and ONE point off by 7.5%. That
point was wrong in both Sonnet runs and right in Opus, which is why the two reads
must come from different models.

### 3.5 Redraw (our code, never the model)
New `lib/deck/visuals/`: renderers for line, scatter, bar/column, area and pie charts,
tables, and tree / flow diagrams. They read the deck theme (`--brand-*`, font,
direction), so a redesign matches the deck. Rules learned in the spikes:
- axes fit the data, not just the last tick label (poly-124 was clipped);
- smooth curves where the original was smooth;
- never print values the source did not show (spike 1 added "125k" labels: wrong);
- implied groups (boxes grouped only by position) may become explicit groups;
- fix obvious label typos (rule 4), never touch numbers.

### 3.6 Verify
Every redrawn visual is compared with its original crop by a vision model ("list
every content difference", JSON pass/issues). Spike: it caught both planted errors
(a transposed table cell, a moved curve end) and passed the four good redesigns;
about $0.016 per visual. It is not perfectly steady (it caught the real 7.5% error
once out of two), so it is the final gate on top of 3.4, not the only safeguard.
On fail: one retry with the issues fed back, then fall back to the original crop.

### 3.7 Store (decided 2026-10-15: private bucket, signed links)
Crops of the user's document go to a NEW PRIVATE bucket (e.g. `source-assets`) under
`${userId}/${projectId}/`. Signed links expire, so the deck HTML never holds one:
- slides store a stable reference (`data-asset` id + storage path), and `src` points
  at an app route, e.g. `/api/assets/{projectId}/{assetId}`;
- that route checks access the same way the deck itself is checked (owner,
  collaborator, or a valid public / share link) and answers with a redirect to a
  short-lived signed URL (cacheable for its lifetime);
- server-side consumers (freeze bake, thumbnails, PDF / PNG / PPTX export, gallery)
  read the bytes with the service role, never through a public URL;
- deleting a project deletes its `source-assets` folder.
Rendered charts / tables / diagrams are inline SVG / HTML (no file) and are also
kept as their data spec, so the studio can re-render them when the deck's colours or
font change.

## 4. Prompt contract

Per source slide, after its image and exact text, an ASSETS block:

```
ASSETS for slide 7:
  a1  chart   (redrawn, will be filled)  46% x 38% of the slide, aspect 1.6
  a2  photo   (original, keep)           30% x 40%, aspect 0.75, subject: "factory floor"
```

The model places `<div data-visual="a1">` / `<img data-asset="a2">` boxes with an
explicit size and designs the slide around them. It never writes URLs and never
draws data. The server fills the boxes after the stream (like `data-genid`).
`ENHANCE_IMG_ADDENDUM` and the "complex charts -> placeholder" rule are replaced;
`data-photoslot` remains only for originals we could not extract (should be rare).

## 5. Photos: enhance, never replace

- **Default "Restyled" (free):** crop to the box (object-fit / focal point), the deck's
  corner radius and frame, a light palette-tinted grade. Pure CSS, exportable.
- **Optional "AI enhanced" (~$0.05 each, only on user click or an opt-in setting):**
  gpt-image `images.edit` with the original as the reference (already used for Social
  product photos) to relight, recolour, clean the background or upscale, keeping the
  subject. Never generates a different picture.
- Screenshots, maps, scans and logos: Restyled framing only.

## 6. Studio

`PhotoSlotOverlay` grows into an asset menu on every carried visual:
**Original / Restyled / Redrawn / AI enhanced / Remove**, with a small preview.
Defaults: charts and diagrams that passed the check = Redrawn; photos = Restyled;
anything uncertain = Original. Picture-chart redraws carry a "Redrawn from a
picture, check the values" note until the user confirms.

## 7. Phases (each one tested locally on the uploaded-docs set before deploy)

1. **PPTX exact path**, in this order (re-ordered after the 2026-10-15 checks):
   a. private `source-assets` bucket + access-checked asset route;
   b. XML region finding + decorative filter, picture crops, prompt contract + server
      fill, per-file images rule (pictures are in 9 of 11 real PPTX uploads);
   c. tables from `a:tbl` + the table renderer (exports as a native table);
   d. studio menu (Original / Remove first), typo rule;
   e. native chart XML + chart renderers (rare in real uploads).
   No model reading involved.
2. **PDF path:** image placements + decorative filter, text-layer tables and
   diagrams, vector-path charts, vision box detection for vector visuals (spike the
   box accuracy first).
3. **Picture charts and sketches:** two-model read, zoom re-read, check, fallback.
4. **Photo enhancement:** Restyled CSS, AI enhanced option, full studio menu.

The 29 uploaded files (local copy) become the regression set: per file, visuals
found, values exact, check pass rate, and how many fell back to the original.
They stay local (users' private documents).

## 8. Cost and time (estimates, to be measured in phase 1)

For a 20-slide deck with ~6 visuals: box detection (PDF only) ~$0.02-0.06, picture
chart reads ~$0.03 each, checks ~$0.016 each, so roughly $0.10-0.30 per deck.
Added wall time ~20-40 s, mostly hidden behind the stream (only region finding
must finish before the model starts).

## 9. Open questions

- **Q1 (decided 2026-10-15): per FILE.** A file with any content photo gets no AI
  images at all; the AI images toggle only applies to files without content images.
  This makes the decorative filter (3.2) critical: a background image counted as
  content would wrongly switch AI images off for the whole deck.
- **Q2 (decided 2026-10-15): private bucket + signed links** (see 3.7). To check in
  phase 1: every place that renders a deck outside the studio (share links, gallery,
  embeds, exports, thumbnails) must resolve assets through the access-checked route
  or the service role.
- **Q3 (checked 2026-10-15, patched dom-to-pptx, same options as html-export.ts):**
  - HTML tables export as NATIVE PowerPoint tables (`a:tbl`), every cell editable,
    Latin digits, `lang="en-US"` runs.
  - Inline SVG charts export as an SVG picture with a PNG fallback: sharp vectors,
    but one picture (not editable as a chart). Upgrade path: we hold each chart's data
    spec, so pptxgenjs `addChart` could emit a native, editable PowerPoint chart.
  - Flex diagrams export as editable shapes + text. Rounded boxes with a coloured
    left border became 7 tiny images; renderers should draw accents as their own
    plain box. Node text boxes were sized with no slack and wrapped
    ("Polymerizatio / n") under font fallback (Inter not installed, harness skipped the
    font-embed pass); renderers must leave room for a wider fallback font.
- **Q4 (checked 2026-10-15 on the PRODUCTION LibreOffice 24.2):** native PPTX line,
  column, pie, scatter and Arabic-label bar charts render with correct values, axes,
  legends and data labels; Arabic labels shape correctly; digits stay Latin (my local
  Windows LibreOffice drew Arabic-Indic digits, a local quirk only). Crops of LibreOffice
  renders are a content-faithful fallback.
- **Real uploads:** of the 11 PPTX files uploaded on 2026-10-14/15, NONE had a native
  chart, 2 had tables, 9 had pictures (9 to 49 media files each). Pictures and tables
  carry most of the value; the chart-XML path is small and comes last in phase 1.
- Security review required for phase 1 and 2 (new PPTX XML and PDF parsing,
  new storage paths).

Correction to the spike notes: Arabic text DOES extract from the finance PDF; the
spike ran `pdftotext` without `-enc UTF-8`, which production always passes.
