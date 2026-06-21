# Flattener Robustness Audit Report

`lib/editor/flatten.ts` · `lib/editor/leaves.ts` · `components/preview/editor/SlideEditor.tsx`

---

## 1. Executive summary

**No. The flattener is not safe to keep silently overwriting and exporting slides.** It must not persist a flatten result until a content-parity guard is in place.

The flattener is a one-way, lossy transform that runs the instant a user *enters* edit mode (not when they edit), overwrites both `PresentationVersion.slideJson` and `SlideVersion.slideJson`, and feeds the PPTX export. There is no recoverable copy of the original AI HTML once it is overwritten.

The core risk is **DEFECT 6: there is no safety net.** The pipeline has exactly two guards before persist:

- `SlideEditor.tsx:438` `try/catch` — catches *throws* only.
- `SlideEditor.tsx:434` `flatSec.innerHTML !== sec.innerHTML` — an *inequality* check whose only purpose is idempotence.

A flatten that **succeeds while silently dropping content** (a page number, a hairline rule, a list bullet, a caption) sails through both. Worse, the inequality gate is backwards for the lossy case: a flatten that dropped text produces *different* innerHTML, so the gate **passes** and the lossy version is written. Every confirmed defect below converges on this: the drop is invisible, persisted, and exported, with the source gone.

The drops are not theoretical. Confirmed on real decks: bare text nodes (`<div class="pno"><hr>Page · 01</div>` loses "Page · 01"), sub-pixel hairlines (a 1px `<hr>` at 0.5x editor zoom), cascade-on-hoist (`.foot b{display:block}` collapsing a two-line cell), and a content-box padding/border double-count (the real source of the user-flagged "wrong 40px frame" on slide-10). The output is also **non-deterministic**: the same slide flattens differently depending on the window size at edit time, because the cull threshold is in on-screen px.

**Recommendation:** ship the parity safety net (Plan 4a) before anything else. It converts every silent drop in the entire pipeline into a safe no-op (slide stays unflattened, lossless, still editable in degraded mode). Then land the high-severity per-defect fixes so flatten actually succeeds on these patterns instead of falling back.

---

## 2. How flatten works

On entering edit mode, after `doc.fonts.ready` + 2 rAFs, `SlideEditor.tsx` calls `flattenSlideSection(section, {scale})`. `collect()` walks the section's element tree depth-first in paint order (z-index then DOM order); each surviving element is either emitted as a standalone `position:absolute` box (a full clone for text/img/svg leaves, a shallow "shell" for painted containers), or dissolved (transparent wrappers, whose children are hoisted to the section root). Geometry is measured in canvas (1920x1080) space, inherited text styles are frozen inline, and a global `z` counter linearizes the original nested stacking into one flat context. The returned HTML overwrites `sec.innerHTML` and is persisted to both slide stores and later exported to PPTX.

The architecture is sound in principle. The failures are: (a) the walk only sees *element* children and on-screen geometry, so it drops content the DOM still holds; (b) hoisting breaks the scoped CSS cascade and frozen styles only cover *inherited* props; (c) there is zero verification that the output still contains what the input had.

---

## 3. Failure situations by dimension (high severity first, deduplicated)

### 3.1 Content drops (the walk loses content the DOM still holds)

#### HIGH — Bare text nodes are never emitted (DEFECT 1)
- **Trigger:** any element mixing a raw text node with at least one element child that is not all-inline: `<div class="pno"><hr>Page · 01</div>`, `<div><svg/>Step 1</div>`, `<div class="stat">Revenue<div class="bar"></div></div>`, `<li><div class="icon"></div>Bullet</li>`.
- **Mechanism:** `collect()` enumerates `Array.from(parent.children)` (`flatten.ts:227`) — an HTMLCollection, element nodes only. The parent fails `isTextLeaf` (`leaves.ts:42-43`) because an element child (`<hr>`, block `<div>`, `<svg>`, `<img>`) is not in `INLINE_TAGS`, so it is not a leaf (`flatten.ts:205-206`) and is recursed (`:248-249`). Recursion again visits only `.children`, so the text node is never reached. `hasContent` (`:207`) sees it via `textContent` and keeps recursing, but recursion can never emit a text node.
- **Fix:** iterate `parent.childNodes`; for each `Node.TEXT_NODE` with non-whitespace content, measure it with a `Range` (`range.getBoundingClientRect()` gives correct on-canvas geometry even when wrapped) and emit it as its own box, freezing inherited text props from the parent's computed style.

#### HIGH — Bare text mixed with an inline `<img>`/`<svg>` is dropped (DEFECT 1 variant)
- **Trigger:** `<p>See <img src="warn.svg"> the appendix</p>`, `<span>Rated <svg/> 5 stars</span>`.
- **Mechanism:** `IMG`/`SVG` are not in `INLINE_TAGS` (`leaves.ts:12-16`), so even though they render inline the parent fails `isTextLeaf`, is recursed, the img/svg is emitted as its own box, and the loose text around it is `.children`-invisible. Visible result: a floating icon, surrounding words gone.
- **Fix:** same `childNodes` emission; per-text-node `Range` measurement gives correct fragment boxes even sharing a line with the inline image.

#### HIGH — Painted container whose only content is a bare text node loses the text
- **Trigger:** `<div class="badge" style="background:#0a0">NEW<i class="corner"></i></div>` (an empty green box exports, "NEW" gone).
- **Mechanism:** `hasOwnPaint` true → branch 2 emits a *shallow* shell (`flatten.ts:245-246`, children removed at `:168`) then recurses (`:247`); the direct text node is again `.children`-invisible.
- **Fix:** the shared `childNodes` fix materializes the bare text during recursion.

#### HIGH — CSS generated content (`::before`/`::after`) is never captured
- **Trigger:** bullet glyphs (`li::before{content:"•"}`), quote marks, numbered counters (`::before{content:counter(s)}`), `.tag::before{content:"NEW"}`, icon-font ligatures, drawn rules (`.card::after{content:"";height:3px;background:…}`), unit suffixes (`.pct::after{content:"%"}`).
- **Mechanism:** nothing reads `getComputedStyle(el, '::before')` anywhere; `cloneNode` does not copy pseudo rendering. Counters depend on `counter-reset` on a now-dissolved ancestor; `open-quote` depends on nesting flatten destroys.
- **Fix:** during the walk read `::before`/`::after` computed `content`; when not `none`/`normal`/empty, materialize textual content as a box (resolved counter values come back as a quoted string) and paint-only decorative pseudos (`content:""` + height/bg) as painted shells. At minimum route any element with non-trivial pseudo content to the safety-net fallback. Update `hasContent` to return true when a non-empty pseudo exists.

#### HIGH — List markers (`<ul>`/`<ol>` bullets and numbers) dropped wholesale
- **Trigger:** any real list.
- **Mechanism:** markers are `::marker` pseudos, never DOM nodes. The `<ul>`/`<ol>` is a transparent wrapper → dissolved (`:248`); each `<li>` is a text leaf → emitted with `margin:0;position:absolute` (`:194-195`), removing it from list-item flow; `::marker` is never read.
- **Fix:** read `getComputedStyle(li, '::marker').content` + `list-style-type`, prepend the resolved glyph/number into the emitted box (or emit a small separate box for it).

#### HIGH — Text orphaned by cascade-on-hoist (DEFECT 3)
- **Trigger:** scoped descendant rule turning an inline element block or setting non-inherited props, where the keyed ancestor is dissolved: `<div class="card"><div class="foot">$4.2M<b>net revenue</b></div></div>` with `.card .foot b{display:block;color:#cfcfd4}`, and `.foot` forced to dissolve by a block sibling.
- **Mechanism:** dissolving the wrapper (`:248-250`) removes it from the hoisted `<b>`'s DOM ancestry, so `.card .foot b` no longer matches. `freezeInherited` (`:114-124`, `TEXT_INHERIT` `:109-113`) bakes only *inherited* props on the *box itself*; non-inherited descendant props (`display:block`, the descendant-set `color`) are never frozen. The `<b>` reverts to inline + UA color: two lines collapse to one, color lost. **A zero-element-drop flatten still mangles styling.**
- **Fix:** before dissolving, snapshot computed styles of every descendant that will be hoisted and inline-bake the non-inherited visually-significant ones (display, color, background, border, text-decoration, font-weight, margin) onto those descendants inside the full clone, captured from the live node while still in scope. (See also §3.3, the generalized form.)

#### HIGH — Sub-1px-on-screen text wrapper culls a real text subtree (DEFECT 2 applied to text)
- **Trigger:** `<div style="height:2px;overflow:visible"><span style="font-size:18px">CONFIDENTIAL</span></div>` at editor zoom 0.5.
- **Mechanism:** the cull `r.width >= 1 && r.height >= 1` (`:233-234`) uses on-screen px (scaled by `--tqe-zoom` ~0.5); the wrapper measures ~1px and is filtered at the *parent* level before recursion, taking the text with it.
- **Fix:** cull in canvas px (`offsetWidth/Height`, or `rect/scale`); never cull a container that has real text/img descendants.

#### HIGH — `opacity:0` / `visibility:hidden` container drops its whole subtree
- **Trigger:** `<div class="reveal" style="opacity:0"><h2>Vision 2027</h2></div>` captured mid-fade; `<div style="visibility:hidden"><span style="visibility:visible">Shown</span></div>`.
- **Mechanism:** `isHidden` (`:134-135`) culls `display:none || visibility:hidden || opacity === "0"` at the parent level (`:232`). `visibility` is independently overridable by a child; `opacity:0` is a common transient reveal state, and flatten runs after only 2 rAFs (`SlideEditor.tsx`) so it can catch a 0% keyframe. Entire subtree gone.
- **Fix:** hard-drop only `display:none`. For `visibility:hidden`/`opacity:0`, recurse and let each leaf's effective visibility decide; consider deferring flatten until animations settle. Route any such subtree containing real content through the safety net.

#### MED — `display:contents` wrapper drops its laid-out children
- **Mechanism:** a `display:contents` element generates no box → `getBoundingClientRect` is 0x0 → fails the size cull (`:233-234`) at the parent level, dropping its (laid-out) children. `isHidden` does not check it.
- **Fix:** when computed `display === "contents"`, never cull on the wrapper's own rect — recurse unconditionally.

#### MED — `white-space:pre`/`pre-wrap` collapses (stripped, not frozen)
- **Trigger:** `<pre>`, tab-aligned numbers, address/poetry blocks.
- **Mechanism:** `white-space` is in `FLATTEN_OWNED` (`:40`) so it is stripped, but not in `TEXT_INHERIT` so never re-baked; the only re-application is the heuristic `nowrap`. Authored `pre` collapses runs of spaces and drops newlines.
- **Fix:** when computed `white-space !== "normal"`, bake the computed value into the frozen string and do not overwrite it with the nowrap heuristic.

#### MED — `<br>` multi-line geometry / false nowrap
- **Mechanism:** `BR` is in `INLINE_TAGS` so the node survives (full clone), but the nowrap heuristic (`:178-184`) can pin `white-space:nowrap` on a `<br>`-separated two-liner whose longest line fits, while the box height was measured for two lines → clip/overflow risk.
- **Fix:** skip the nowrap heuristic when the leaf contains a `<br>`, or when `scrollHeight` under nowrap differs from the measured height.

#### LOW — `<template>`/`<noscript>`/comments ignored
- Mostly correct (inert/non-visual). Only risk: a `<template>` misused as a visible container is dropped. Optionally route a `<template>` with non-whitespace text to the safety net. No action otherwise.

---

### 3.2 Sizing / cull defects (drops driven by the on-screen size gate)

#### HIGH — Sub-pixel cull of hairlines, generalized (DEFECT 2)
- **Trigger:** any element thinner than `1/zoom` canvas px in either axis: `<hr>`, 1-2px dividers, accent bars, hairline borders, sparkline ticks.
- **Mechanism:** `flatten.ts:233-234` reads `getBoundingClientRect()` (on-screen px = canvas px × `--tqe-zoom`) and tests `>= 1`. A 1px canvas `<hr>` at zoom 0.5 measures 0.5px → dropped. Inconsistent with `measure()` (`:143-145`) which divides by scale.
- **Fix:** cull in canvas px: `const w = el.offsetWidth || rect.width/scale; const h = el.offsetHeight || rect.height/scale; return w >= 0.5 && h >= 0.5;`. Prefer `offsetWidth/Height` (scale-invariant); a sub-1px floor keeps genuine hairlines.

#### HIGH — Zoom/viewport-dependent non-determinism
- **Trigger:** editing the same deck on different window sizes; any 1-4px canvas element.
- **Mechanism:** the canvas-px cull threshold is `1/zoom`: 2px at zoom 0.5, 4px at zoom 0.25, 1px at export (zoom 1.0). A 3px divider survives on a large screen, dropped on a small one. Output is persisted + exported, so two users produce two different decks from identical source. Contradicts the file's idempotence claim (`:20-22`).
- **Fix:** same as above — `offsetWidth/Height` is scale-invariant, making the cull zoom/viewport-independent.

#### HIGH — Asymmetric AND-cull drops thin-in-one-axis elements
- **Trigger:** full-bleed 1px top rule (`width:1920px;height:1px`), tall thin vertical spine, progress bar, timeline axis.
- **Mechanism:** `r.width >= 1 && r.height >= 1` (`:234`) requires both axes; a 1920×1px rule passes width, fails height → the whole prominent accent bar dropped.
- **Fix:** covered by the canvas-px + sub-1px-floor fix; additionally keep any element where `hasOwnPaint` is true even at sub-px thickness (painted hairline = intentional ink).

#### HIGH — Floor-then-emit ordering: a leaf under a culled wrapper has no chance
- **Trigger:** real content nested under a wrapper dropped for any reason (sub-px, zero-rect timing, `display:contents`).
- **Mechanism:** `collect()` filters children first (`:227-238`), then iterates only survivors (`:239`). The recurse/emit branches (`:243-249`) are reachable only for survivors, so a culled wrapper is a hard cut of its entire subtree — no per-leaf size check ever runs on the descendants.
- **Fix:** decouple the size decision from the recursion decision. The cull should gate *emission* of a leaf, not *descent*. Restructure so a container failing the size test is still descended into; only true visual leaves are dropped when sub-pixel-and-empty.

#### HIGH — Fonts-not-ready / lazy-layout zero-rect
- **Trigger:** a web/Google font that resolves after flatten ran; `doc.fonts.ready` resolving while a face still swaps; auto-sized text collapsing to ~0 before its font shapes.
- **Mechanism:** flatten waits `doc.fonts.ready` + 2 rAFs (`SlideEditor.tsx`), which is not a guaranteed layout-settled signal. A ~0 box fails the cull and the run is dropped; no retry, no re-measure, no verification.
- **Fix:** harden the gate (await a `setTimeout(0)` + forced reflow, optionally measure twice and bail if unstable) **and** rely on the parity safety net to catch timing-driven shortfalls and fall back.

#### MED — Overflow / line-clamped / scrolled content measured at clipped box
- **Mechanism:** both `measure()` and the cull read the border box, not painted extent; a `height:0;overflow:hidden` element with visible overflow is culled; a clamped leaf is emitted at clamped size but the full-clone subtree re-expands after hoist if the clamp class stops matching.
- **Fix:** for the cull, fall back to `scrollWidth/Height` when the border box is ~0 but content exists. For measure, when line-clamped/overflow-hidden, carry `-webkit-line-clamp`/`max-height` + `overflow:hidden` so re-expansion can't happen.

#### MED — False `white-space:nowrap` pins multi-line text to one line
- **Trigger:** wrapped text whose longest physical line is ≤ box width + 4 (narrow columns, wrapped Arabic, justified text).
- **Mechanism:** `:184` pins nowrap if `oneLineWidth <= m.width + 4`; the box height was measured for the multi-line layout → forced one line overflows/clips.
- **Fix:** compare `scrollHeight` under forced-nowrap vs natural `offsetHeight`; pin nowrap only when forcing one line does not reduce the natural line count, i.e. it was already single-line.

#### MED — Live DOM left in forced nowrap if the heuristic throws mid-measure
- **Mechanism:** `makeBox` mutates the live element (`:181` set, `:182` read `scrollWidth`, `:183` restore) with no `try/finally`. A throw between set and restore leaves the live node at `white-space:nowrap`; the outer catch swallows it; a later save serializes the forced single line.
- **Fix:** wrap in `try/finally`; better, measure on the clone (already built) or an offscreen measurer so the live DOM is never mutated.

#### MED — Square (non-radius) `overflow:hidden` crop not carried → overflow text leaks
- **Mechanism:** `clipRadiusOf` returns `""` when there is no radius (`:78-79`), so a rectangular crop is treated as non-existent; the full-clone text re-expands past its measured box. (See §3.4 for the full clip-handling fix.)

#### LOW — `buildLayerTree` has the identical sub-pixel cull bug
- **Mechanism:** `leaves.ts:223-224` does the same raw on-screen `< 1` test, with no scale arg. Once flatten is fixed, the Layers panel and canvas will disagree on what exists.
- **Fix:** apply the same canvas-px cull; factor the size test into one shared helper imported by both files so the "lockstep" claim is enforced by code.

#### LOW — `ceil()` width inflation + center-based left → ±1px drift
- **Mechanism:** `width = ceil(w)` (`:151`) but `left = round(cx - w/2)` uses the un-ceiled half-width (`:148`), so the box is up to ~1px wider and off-center; matters for aligned grids and RTL end-anchored content.
- **Fix:** `const W = Math.ceil(w); left = Math.round(cx - W/2)` so the box stays centered after inflation.

---

### 3.3 Geometry & cascade-hoist defects (wrong size / wrong style, content survives)

#### HIGH — `box-sizing` not emitted + padding/border never stripped → box inflates (the real slide-10 "40px frame")
- **Trigger:** any content-box leaf/shell carrying padding or a border from a class or inline shorthand. `.card{padding:40px}` is endemic in AI output.
- **Mechanism:** `measure()` uses `offsetWidth/Height` (`:143-144`) = the **border-box** size; `makeBox` emits `width:${m.width}px` (`:194-195`) but `FLATTEN_OWNED` (`:37-47`) lists neither `padding*` nor `border*`, so `stripFlattenProps` (`:52-55`) leaves them, and no `box-sizing:border-box` is emitted. With content-box the browser **adds** the retained padding+border to the emitted width. Proven: `width:400px;padding:40px` content-box has `offsetWidth=480`; flatten emits `width:480` + keeps `padding:40` → renders 560px. This double-count, with text inset by the retained padding, is the wrong "40px frame," not `inset`.
- **Fix:** emit `box-sizing:border-box` unconditionally in the pos string. The emitted width/height *are* border-box, so this makes the rendered box match the measurement regardless of retained padding/border, and text stays correctly inset. Do not strip padding/border (that would lose the visual inset).

#### HIGH — `inset` (and logical inset longhands) not owned (the user-flagged shorthand)
- **Trigger:** `<div style="inset:40px">` and class `.pin{inset:40px}` / `inset-inline-end` etc.
- **Mechanism (verified):** inline `inset:40px` *is* cleared in Chromium because `removeProperty('top'/'right'/'bottom'/'left')` expands and clears the shorthand — so the inline case is handled. The residual risk is **class** `inset`/logical longhands (which cannot be stripped) and any `!important` version, which over-constrain the absolute box; `right:auto`/`bottom:auto` (`:194`) only neutralize physical right/bottom, not `inset-inline-end`.
- **Fix:** add `inset`, `inset-block`, `inset-inline`, `inset-block-start/end`, `inset-inline-start/end` to `FLATTEN_OWNED` (clears any *inline* logical inset), and emit geometry with `!important` (below) to beat class versions.

#### HIGH — Class `!important` / min-max / aspect-ratio beats emitted geometry
- **Trigger:** `.full{width:100%!important}`, `.kpi{min-width:600px}`, `min/max-width`, `min/max-height`, `aspect-ratio` on the leaf or class.
- **Mechanism:** the pos string sets `width:${m.width}px` *non-important* (`:194-195`); the clone keeps its class and the carried `<style>` still matches, so a `!important` or min/max rule overrides the measured width. None of min/max-* or aspect-ratio are in `FLATTEN_OWNED`.
- **Fix:** emit geometry with `!important` (`left/top/right/bottom/width/height/margin`) via `setProperty(prop, val, 'important')`, and add `min-width`, `max-width`, `min-height`, `max-height`, `aspect-ratio` to `FLATTEN_OWNED`. Also emit `max-width:none!important; min-width:0!important` (and height equivalents) so no surviving class rule can resize the box.

#### HIGH — `transform:scale()` silently dropped → box renders at untransformed size
- **Trigger:** `transform:scale(1.5)` on a hero/stat; `scaleX(-1)` RTL icon mirror.
- **Mechanism:** `rotationDeg` (`:60-67`) extracts only rotation via `atan2(m[1],m[0])`; scale is intentionally not reconstructed (`:58-59`). `measure()` takes width from the untransformed `offsetWidth`. Proven: `scale(1.5)` on a 400px div → `offsetWidth=400`, emits `width:400`, no transform → renders 400px instead of 600px.
- **Fix:** decompose the matrix (`scaleX=hypot(m[0],m[1])`, `scaleY=hypot(m[2],m[3])`) and multiply `offsetWidth/Height` by them; or, when the transform contains a non-identity scale, use `rect.width/scale` for w/h (the rect already reflects the rendered size) and do not re-apply scale.

#### HIGH — `rotationDeg` misreads skew and mirror as rotation (RTL-critical)
- **Trigger:** `transform:skewY(20deg)`; especially `transform:scaleX(-1)` mirroring an Arabic chevron/arrow.
- **Mechanism:** `atan2(m[1],m[0])` (`:66`) conflates skew/negative-scale with rotation. `skewY(20deg)` → emits `rotate(20deg)` (false) and drops the skew. `scaleX(-1)` → `matrix(-1,0,0,1)` → `atan2(0,-1)=180` → emits `rotate(180deg)`: a horizontal mirror becomes a 180° flip, so a mirrored RTL chevron points wrong and upside down.
- **Fix:** detect non-rotation matrices: if `scaleX<0`, `scaleY<0`, or skew present (`m[0]*m[2]+m[1]*m[3] != 0`), carry the original `transform` matrix verbatim onto the box instead of synthesizing a single `rotate()`. Best: re-emit the source matrix and only recenter via `transform-origin`.

#### HIGH — `offsetWidth` ignores ancestor transforms → leaf sized pre-transform
- **Trigger:** a leaf inside a wrapper with its own `transform:scale()` that gets dissolved.
- **Mechanism:** `offsetWidth` (`:143`) is unaffected by ancestor transforms; the center from `getBoundingClientRect` (`:145-146`) divides only by the editor stage `scale`, not the ancestor's. Proven: `offsetWidth=100` inside `scale(2)` renders at 200px; flatten emits `width:100`.
- **Fix:** size from the on-screen rect normalized by the editor scale only (`w = rect.width/scale`), backing out the element's own rotation first for rotated leaves. `offsetWidth`-first is the root cause.

#### HIGH — Ancestor-scoped descendant rules stop matching after dissolve (DEFECT 3, generalized)
- **Trigger:** any scoped rule keyed on a wrapper styling a descendant: `.foot b{…}`, `.card p{…}`, `.hero .sub{opacity:.7}`, `ul.feat li{padding-left:1.4em}`.
- **Mechanism:** `:248-250` dissolves the wrapper; the carried `<style>` still has `.foot b{…}` but `.foot` is gone from ancestry, so the descendant combinator can never match. `freezeInherited` bakes only inherited props on the box; non-inherited descendant props are never frozen.
- **Fix:** resolve the scoped cascade per emitted element *before* dissolving. For every full-clone leaf, walk `el.querySelectorAll('*')` on the **live** node and inline-stamp each descendant's computed `display/color/background/border/text-decoration/font-*` onto the matching cloned descendant, so the clone is self-contained.

#### HIGH — `var()` custom properties resolve at the wrong scope after hoist
- **Trigger:** `.card{--accent:#0a7}` consumed by a descendant `background:var(--accent)` or `box-shadow`, or a `.theme-dark{--fg:#fff}` wrapper that dissolves.
- **Mechanism:** `freezeInherited` resolves `color` correctly, but custom props consumed by non-frozen props (background, border-color, gradient, box-shadow) are not frozen; the `--accent` declaration lived on the dissolved `.card`, so `var()` now resolves to fallback/`unset`. Custom props are *inherited*, so a value set on `.card` and consumed by a leaf hoisted to `<section>` inherits the section's value instead — wrong color silently substituted.
- **Fix:** snapshot resolved values, not `var()` references. For every emitted box and full-clone descendant, when a retained/emitted property references `var(`, replace it with the computed resolved value from the live node. Proactively freeze `background-color`, `border-color`, `box-shadow`, `background-image` when non-default.

#### HIGH — `@font-face`/`@keyframes`/`@media`/`:root` vars in a NESTED `<style>` are lost
- **Trigger:** `<div class="wrap"><style>@font-face{font-family:Brand;…} .t{font-family:Brand} :root{--c:#e11}</style>…</div>`.
- **Mechanism:** `flatten.ts:219` carries only `:scope > style` (direct children of `<section>`). A nested `<style>` is not cloned to `out`; the wrapper then dissolves. Frozen `font-family:'Brand'` now references an undefined face → fallback font (breaks Arabic shaping/metrics); `:root` vars and keyframes gone.
- **Fix:** carry **all** `<style>` blocks found anywhere under the section (`section.querySelectorAll('style')`, not just `:scope > style`) into `out` before dissolving wrappers. They are global once hoisted — exactly what `@font-face`/`@keyframes`/`:root` need. De-dup if necessary.

#### HIGH — Full-clone leaf keeps inner descendant classes whose ancestor-scoped rules stop matching
- **Trigger:** `<p class="lede">Revenue <span class="hl">up 40%</span></p>` inside `<div class="col">` with `.col .hl{color:#0af}`.
- **Mechanism:** the `<p>` is a text leaf, full-cloned with its inner `<span class="hl">`; after `.col` dissolves, `.col .hl` no longer matches. `freezeInherited` covers only the `<p>` box, not the inner span. Inner emphasis styling silently lost.
- **Fix:** same as the descendant-rule fix — when full-cloning a leaf, freeze each inner element's computed `color/font-weight/font-style/text-decoration/background/border` inline, captured from the live tree.

#### HIGH — SVG defs / `<use>` / class-based fill break on hoist (SVG paint loss)
- **Trigger:** one shared `<defs>`/sprite `<svg>` (often 0x0 / `display:none`) plus consuming `<svg>`s referencing `url(#g)` / `<use href="#sym">`; or SVG fill/stroke via a scoped (often nested) `<style>` / `currentColor` from an ancestor.
- **Mechanism:** each `<svg>` is a self-contained leaf (`:205-206`, full clone). A defs-only `<svg>` is 0x0/`display:none` → culled (`:232-234`); consumers keep `url(#g)`/`<use>` pointing at nothing → shapes render black/empty. Class-based `fill` from a nested `<style>` is dropped on dissolve; `freezeInherited` covers only `color` for an svg (no textContent), so a descendant `fill` rule reverts to black.
- **Fix:** before hoisting, scan each emitted `<svg>` for `url(#id)`, `clip-path/mask/filter` refs, and `href`/`xlink:href=#id`; inline a clone of each externally-defined target into a `<defs>` prepended to the svg; expand `<use>` against its `<symbol>`. Never cull an id-defining `<svg>`. Inline resolved `fill/stroke/stroke-width/opacity` onto painted svg descendants.

#### HIGH — Pseudo-element-only visuals never captured (overlaps §3.1)
- Same root cause and fix as the generated-content finding; called out separately for the special-elements dimension (accent bars, big quote marks, counters, icon-font glyphs).

#### HIGH — Icon-font / web-font glyphs lose font → tofu or literal text
- **Trigger:** `<span class="material-symbols">arrow_forward</span>` relying on `font-feature-settings:'liga'` and an `@font-face` (often nested).
- **Mechanism:** `TEXT_INHERIT` (`:109-113`) omits `font-feature-settings`/`font-variation-settings`; without `liga` the ligature renders as the literal word. Nested `@font-face` (dropped) means the face never loads → tofu.
- **Fix:** add `font-feature-settings`, `font-variation-settings`, `font-kerning`, `font-optical-sizing` to the freeze list; carry all `@font-face` styles regardless of nesting; consider rasterizing icon glyphs for export.

#### HIGH — `<img object-fit:cover>` crop changes / reverts to stretch
- **Trigger:** `<div style="width:200px;height:200px;overflow:hidden"><img style="width:100%;height:100%;object-fit:cover"></div>` (1600×900 source).
- **Mechanism:** `object-fit` is not owned/frozen; the square `overflow:hidden` crop wrapper is dissolved (rectangular clips not carried, §3.4); the img is hoisted at the box geometry, recomputing/losing the crop → shifted crop or stretch.
- **Fix:** read computed `object-fit`/`object-position` and write them inline on the img clone; carry `overflow:hidden` (and any radius) onto the img box when the parent cropped; size to the img's own rendered box.

#### HIGH — `<canvas>` content dropped
- **Mechanism:** `<canvas>` is not IMG/svg/text-leaf; with a bg it becomes an empty shell, without one it is dissolved; the drawn bitmap never survives `cloneNode`, and the drawing `<script>` is stripped (`:230`).
- **Fix:** treat `<canvas>` as a leaf; snapshot via `canvas.toDataURL()` at flatten time and emit as an `<img>` box (guard tainted/WebGL canvases → safety net on failure).

#### HIGH — `<video>`/`<iframe>` embeds dropped or unexportable
- **Mechanism:** neither is a recognized leaf; with paint they become empty shells (sources/poster stripped), without paint they are dissolved. Neither has a PPTX representation.
- **Fix:** treat `<video>` as a leaf and freeze its poster/first frame as an `<img>`; keep `<iframe>` as a leaf (don't dissolve) and flag to the safety net since it can't export. Add `VIDEO/IFRAME/CANVAS` to the explicit leaf set so they're never dissolved.

#### HIGH — `background-image` (gradients/url) lost on dissolved wrapper / nested style; multi-layer simplified
- **Mechanism:** `hasOwnPaint` returns true for any `backgroundImage !== "none"` (`:91`) so a pure-bg inline wrapper becomes a shell — but a class-based bg in a nested `<style>` is dropped on dissolve, and `background-size:cover`/`position`/`repeat`/`blend-mode` are not owned, so a class `background-size:cover` reverts to auto → tiles/mis-scales.
- **Fix:** carry/inline all background painting (`image/size/position/repeat/blend-mode/clip/origin`) computed from `getComputedStyle` onto the shell; carry nested `<style>` rules.

#### HIGH — Dissolved wrapper effects (filter, opacity 0-1, mask, clip-path, transform, mix-blend) never pushed to children
- **Trigger:** `<div style="opacity:.6">…</div>`, `<div style="filter:drop-shadow(…)"><svg/></div>`, `<div style="transform:rotate(8deg)"><p>…</p></div>`, `<div style="letter-spacing:.3em"><span>WIDE</span></div>`.
- **Mechanism:** a non-painting, non-leaf wrapper falls to `:248` and is dissolved with no box, so its non-inherited effects (opacity, filter, transform, mask, clip-path, mix-blend) vanish; inherited-but-unfrozen props (`letter-spacing`, `word-spacing`, `text-shadow` — none in `TEXT_INHERIT`) are also lost; a wrapper `transform:rotate` is dropped because `rotationDeg` only reads each emitted element's *own* transform.
- **Fix:** when dissolving, (1) accumulate the wrapper's transform into a matrix context threaded to descendants (like `clip` already is); (2) add `letter-spacing`, `word-spacing`, `text-shadow`, `white-space` to the freeze list; (3) extend `hasOwnPaint` to return true for `filter/backdrop-filter/mask/clip-path/mix-blend-mode != none` and `opacity < 1` so the wrapper survives as a shell, or bake opacity/filter onto each child.

#### MED — Frozen inherited values baked as plain can be overridden by a carried `!important` rule (RTL flip risk)
- **Mechanism:** `freezeInherited` bakes correct resolved values but as *non-important* inline; a carried `.box{direction:ltr!important}` matching after hoist beats it → Arabic direction flips.
- **Fix:** freeze inherited props (and `color`) with `!important` via `setProperty` — safe because the baked value is exactly what the element computed.

#### MED — Positional/structural selectors break after reorder/reparent/drop
- **Trigger:** `li:nth-child(2n)`, `.row:first-child`, `h2 + p`, `:not(:last-child)`, `p ~ p`.
- **Mechanism:** flatten reorders siblings to paint order (`:236-238`), reparents to `<section>` (`:248`), and drops culled elements; carried structural selectors now match against all section children. Zebra striping, divider borders, first/last spacing silently change.
- **Fix:** resolve and inline-freeze the matched non-inherited declarations (background, border, margin) per element from the live node before structure is destroyed. Structural selectors cannot survive a flat DOM.

#### MED — CSSOM re-serialization drops invalid/unknown declarations and normalizes `prev`
- **Mechanism:** `stripFlattenProps` reads back `getAttribute("style")` after `removeProperty` (`:53-54`), which forces a full re-serialization of the inline style; declarations the parser dropped as invalid/experimental are gone, shorthands re-expand inconsistently across engines.
- **Fix:** capture the original `getAttribute("style")` string before any mutation; remove owned props via a parenthesis/quote-aware tokenizer rather than mutating the clone's CSSOM, preserving exact non-owned declarations (data: URLs, unusual-but-valid values).

#### MED — Emitted box reuses source class → carried scoped rules double-apply / percentages re-resolve
- **Mechanism:** the clone keeps its class; a `.box{width:60%}` re-resolves against `<section>` (1920px) instead of the old 600px wrapper if it has higher weight; `max-width:80%` re-applies; `:hover` rules now fire on the flat box.
- **Fix:** the `!important` geometry emission (plus `max-width:none!important` etc.) neutralizes class layout rules; keep the class only for inner descendants that still need the carried `<style>`.

#### LOW — emoji / ZWJ measurement under nowrap; font-dependent width drift
- **Fix:** guard the nowrap heuristic with tolerance and skip it for text containing emoji/RTL marks; ensure the export renderer uses the same emoji font. Content survives; this is fidelity only.

#### LOW — `<input>`/`<textarea>`/`<select>` live values not serialized
- **Mechanism:** `cloneNode` copies the value *attribute* but not the live `.value`/selection; a bare `<input>` is also not a leaf and is dissolved.
- **Fix:** treat form controls as leaves; reflect live state to attributes (`setAttribute('value', el.value)`, `selected`/`checked`, textarea value → textContent) before cloning.

---

### 3.4 Stacking & clip defects (wrong z-order / wrong cropping, content survives)

#### HIGH — Rectangular `overflow:hidden`/`clip` with no radius silently dropped → children show full bleed
- **Trigger:** `<div style="width:200px;height:120px;overflow:hidden"><img style="width:400px;height:300px"></div>`.
- **Mechanism:** `clipRadiusOf` returns `""` when `border-radius` is 0 (`:78-79`), so the clip is treated as non-existent; the clipping ancestor is dissolved and the oversized child is hoisted at its full `offsetWidth/Height` — crop permanently gone.
- **Fix:** decouple clip detection from radius. `clipRadiusOf` should return whether the element clips (the `overflowX/Y` test at `:76-77`) *and* its radius. Carry a structured clip `{rect, radius}` down recursion; always emit `overflow:hidden` when an ancestor clipped, with radius only when present.

#### HIGH — `clip-path`, `mask`/`mask-image`, legacy `clip` never detected → masked content hoisted unmasked
- **Trigger:** `clip-path:circle(50%)` avatar, gradient `mask-image` fade.
- **Mechanism:** flatten reads only overflow-based clipping; `cs.clipPath`/`cs.mask*`/`cs.clip` are read nowhere, and `hasOwnPaint` doesn't count a mask, so a mask-only wrapper is dissolved and children hoist unmasked.
- **Fix:** in `clipRadiusOf` (or a new `clipOf`) also detect `clipPath !== 'none'`, `mask/maskImage !== 'none'`, `clip !== 'auto'`. When a wrapper carries one, do not dissolve it — emit it as a real shell with the clip preserved, or carry the clip onto each hoisted descendant in its local coordinate space.

#### HIGH — Nested/partial clips collapse to innermost radius (REPLACE not intersect) and ignore the clip rectangle
- **Trigger:** a rounded card with a child taller than the card; nested rounded clippers.
- **Mechanism:** `childClip = clipRadiusOf(cs) || clip` (`:242`) — an inner clipper's radius *replaces* the outer's; and only the radius travels, never the clip *rectangle*, so an oversized child keeps its full size after hoist and the cropped overflow reappears.
- **Fix:** propagate the ancestor clip as a geometric region (rect in canvas space + radius) and **intersect** successive clips; in `makeBox`, clip each box to the intersection of all ancestor clip rects (shrink the box + shift inner content), keeping the outer radius even when an inner element also clips.

#### HIGH — Child with its own `border-radius` loses overflow clipping
- **Mechanism:** `clip = clipRadius && !hasOwnRadius(cs) ? … : ""` (`:189`) — if the box already has a radius, the inherited-mask branch is skipped *entirely*, dropping the `overflow:hidden` along with the redundant radius.
- **Fix:** separate the two concerns. Always emit `overflow:hidden` when this box or an ancestor clipped; emit `border-radius` from own-or-inherited. The `!hasOwnRadius` short-circuit should only skip the redundant radius, never `overflow:hidden`.

#### HIGH — z-order ignores positioned-vs-static paint tiers
- **Trigger:** mixed positioned + static siblings without explicit z-index (extremely common).
- **Mechanism:** sibling order is `parseInt(zIndex)` (auto→0, `:210-213`) then DOM order (`:236-238`). Computed z-index is `auto`→0 for both a static `<h2>` and an un-z-indexed absolute scrim, so a static block can outrank a positioned sibling — CSS paints in-flow blocks *before* positioned-without-z. The wrong stack is persisted and exported.
- **Fix:** compute a CSS paint rank per child: (a) negative-z positioned, (b) in-flow non-positioned blocks, (c) floats, (d) in-flow inline, (e) positioned/stacking with z auto/0, (f) positive-z; tiebreak DOM order within a tier. Use that composite rank for the global z counter.

#### HIGH — Local z-index scopes linearized globally; negative-z children mis-painted
- **Mechanism:** a single global counter (`:222`, `z++` at `:244/:246`) cannot reproduce nested contexts. Specifically, a `z-index:-1` child meant to paint *behind* its parent's background is emitted *after* the parent's shell (shell at `:246`, content at `:247`), so it paints on top.
- **Fix:** split a painted shell's children into negative-z (emit before the shell) and non-negative (after), matching CSS where `z<0` paints behind the parent background; assign global z by a stable post-order that respects each context's negative/zero/positive tiers.

#### MED — opacity/transform/filter stacking contexts flattened → descendants reorder across the group boundary
- **Mechanism:** a `0<opacity<1` (or transform/filter/will-change) wrapper is not painted and is dissolved (`:248`), destroying the stacking context; an inner `z-index:5` leaks into the global space and can jump siblings that were above the whole group.
- **Fix:** detect stacking-context-creating wrappers (opacity<1, transform/filter/perspective, will-change, contain, isolation, mix-blend, positioned+z) and either keep them as real boxes or re-base descendant z into a contiguous block at the group's paint rank.

#### MED — `isolation:isolate` / `mix-blend-mode` groups dissolved → blend targets change
- **Mechanism:** neither property is read anywhere; an isolation wrapper is dissolved, removing the boundary, while `mix-blend-mode` (not in `FLATTEN_OWNED`) survives on the shell and now blends against the whole slide instead of its former group → wrong colors.
- **Fix:** preserve isolation/mix-blend wrappers as real boxes; or when removing an isolation boundary, set descendant `mix-blend-mode:normal`.

#### MED — `position:sticky`/`fixed` frozen at flatten-time scroll/viewport position
- **Mechanism:** `measure()` uses live `getBoundingClientRect`; sticky/fixed elements are measured at their transient stuck/viewport position and emitted as `absolute` at that frozen, possibly off-canvas coordinate.
- **Fix:** scroll the section to top before measuring; special-case sticky/fixed to measure relative to the containing block; assert the emitted box lies within `[0, canvas]` and clamp/flag out-of-bounds boxes.

#### MED — Painted rounded shell drops `overflow:hidden` masking of children
- **Mechanism:** a painted, clipping, rounded card becomes a shell with children stripped (`:168`); its rectangular clip rect is not propagated, so an oversized hoisted child escapes the frame (rounded corners carried, rectangular crop not).
- **Fix:** same clip-rect propagation as the nested-clip fix.

#### LOW — `overflow:auto`/`scroll` clipping ignored
- **Mechanism:** `clipRadiusOf` checks only `hidden`/`clip`; `auto`/`scroll` also clip but are treated as non-clipping.
- **Fix:** treat `auto`/`scroll` as clipping (the visible box becomes the clip rect).

#### LOW — Clip not byte-stable across re-flatten
- **Mechanism:** the emitted `overflow:hidden` becomes a new clipper on the next pass; the `!hasOwnRadius` short-circuit can drop a needed inherited mask on pass 2.
- **Fix:** after decoupling overflow from radius, mark flatten-emitted clips with a data attribute so the next pass distinguishes authored from emitted clips and reproduces them from the live mask state.

---

### 3.5 Robustness / architecture defects

#### HIGH — No content-parity check before persist (DEFECT 6 — the core ask)
- See §1 and the full implementation in §4(a). This is the single highest-leverage fix.

#### HIGH — Root is not section-agnostic / not validated
- **Mechanism:** `SlideEditor.tsx:404` does `doc.querySelector("section")`; a legacy `<div>`-root deck returns null → flatten skipped (degraded editor, no data loss yet). The real trap: `flattenSlideSection` never validates that `section` is the positioned 1920×1080 stage (`originRect` at `:137`, `collect(section,"")` at `:253`). A zero-size/detached/wrong root yields garbage geometry persisted silently. `querySelector("section")` also grabs the first section (a decorative inner section would be the wrong root).
- **Fix:** (1) in `flattenSlideSection`, throw if `originRect.width < 1 || originRect.height < 1` so the caller's catch keeps the original. (2) In `wire()`, broaden the lookup (`doc.querySelector("section, [data-tq-root], main") ?? doc.body.firstElementChild`), verify the rect is canvas-sized, and if no plausible root, skip flatten **and** skip persist. (3) Pick the section whose rect best matches canvas dims when there are several.

#### HIGH — Build-then-swap purity depends on a heuristic that mutates the live DOM
- **Mechanism:** flatten is currently all-or-nothing only because the swap (`SlideEditor.tsx:435`) and persist (`:436`) happen *after* flatten returns. But the nowrap heuristic mutates the live element (`flatten.ts:181-183`) with no `try/finally`; a throw between set and restore leaves a stray `white-space:nowrap` that a later save serializes — a half-mutation escaping the all-or-nothing guarantee.
- **Fix:** wrap the nowrap probe in `try/finally`; better, measure on the clone/offscreen so the pass is provably pure. Add a dev assertion that `section.innerHTML` is unchanged when flatten returns.

#### MED — Idempotency drift: re-entering edit mode mutates and re-persists a clean slide
- **Mechanism:** the equality gate (`:434`) compares raw innerHTML, but re-flatten is not byte-stable: the nowrap `+4` slop + `ceil` can flip on borderline text; `freezeInherited` re-resolves to a different fallback font if fonts aren't fully ready; sub-pixel centers round to a different integer at a different fit-scale. Each drift fires `handleNormalize` → a new `SlideVersion` the user never intended.
- **Fix:** compare a normalized signature (geometry on a coarse grid, frozen values, text), not raw innerHTML; mark already-flat sections and run a verify-only pass on re-entry, re-persisting only on >2px drift; gate the nowrap flip with hysteresis (only add nowrap, never remove on re-flatten).

#### MED — Equality gate greenlights shrinks
- **Mechanism:** `:434` treats "different" as "persist," which is exactly backwards for the lossy case — a dropped page number makes innerHTML different, so the gate passes.
- **Fix:** AND the inequality with the parity non-shrink invariant (§4a). Inequality stays only as the cheap idempotence short-circuit.

#### MED — Persist-on-enter with no provisional staging / no source baseline
- **Mechanism:** `handleNormalize` → `applyContentLocally` → `persistContentInPlace` writes the flattened HTML the instant flatten succeeds, before any user edit; merely opening a deck to read it can silently degrade it, and the original AI HTML is overwritten in both stores with no recovery.
- **Fix:** (1) keep the original AI HTML as a recoverable baseline (`data-tq-source` snapshot or a slide-record column). (2) Treat flatten-on-enter as provisional: apply to the live DOM for editing but persist only on the first genuine user mutation. (3) If persist-on-enter stays, gate it behind the parity check.

#### MED — Foreign root structure (shadow DOM, custom elements, embeds) walked as ordinary elements
- **Fix:** add `canvas/iframe/object/embed/video` to the leaf set so their visual presence is preserved; treat a non-empty shadow host as a leaf rather than dissolving; the parity census (with embed counts) catches the rest.

#### LOW — Mid-animation geometry frozen; getComputedStyle called 2-3x per node
- **Fix:** inject a temporary `* { animation-play-state: paused !important; transition: none !important; }` stylesheet for the flatten duration (removed in a finally); read geometry once per element and thread the rect from cull into measure.

#### LOW — Unbounded recursion + O(n) getComputedStyle, no node cap
- **Fix:** convert `collect` to an iterative walk with depth + node-count budgets; on exceed, abort and fall back (same as a throw) with a `console.warn`; cache one `getComputedStyle` per element (currently read at `:231/:236/:240`); surface the abort via telemetry.

---

## 4. The robustness plan (prioritized)

### (a) FIRST: the architectural safety net — post-flatten content parity

This is the one change that makes silent data loss impossible regardless of which defect fires. Implement it inside `flattenSlideSection` (it has both `section` and `out` in scope) and enforce it at the call site.

**In `flatten.ts` — compute a parity census on both trees and return it:**

```ts
// normalized visible text: collapse whitespace, ignore style/script
function visibleTextSig(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("style,script").forEach((n) => n.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

// multiset of content words (order-independent, catches reordering + partial drops)
function wordMultiset(sig: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of sig.split(" ").filter(Boolean)) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
}

// count visual atoms the export cares about
function leafCensus(root: HTMLElement) {
  return {
    img: root.querySelectorAll("img").length,
    svg: root.querySelectorAll("svg").length,
    canvas: root.querySelectorAll("canvas").length,
    iframe: root.querySelectorAll("iframe,video,object,embed").length,
  };
}
```

Return `{ html, parity }` from `flattenSlideSection`:

```ts
const srcSig = visibleTextSig(section);
const outSig = visibleTextSig(out);
const srcWords = wordMultiset(srcSig);
const outWords = wordMultiset(outSig);
const missingWords: string[] = [];
for (const [w, n] of srcWords) {
  const got = outWords.get(w) ?? 0;
  if (got < n) missingWords.push(w);
}
const srcCensus = leafCensus(section);
const outCensus = leafCensus(out);
const censusShrunk =
  outCensus.img < srcCensus.img ||
  outCensus.svg < srcCensus.svg ||
  outCensus.canvas < srcCensus.canvas ||
  outCensus.iframe < srcCensus.iframe;

const ok = missingWords.length === 0 && !censusShrunk;
return { html: out.outerHTML, parity: { ok, missingWords, srcCensus, outCensus, srcSig, outSig } };
```

Notes:
- Text is preserved verbatim in clones, so the text signature should be near-exact; tolerate only whitespace normalization. A multiset (not a set) catches a dropped duplicate ("Build" survives but "Plan" doesn't).
- Census is a strict non-shrink: flatten may *add* boxes, never lose an image/svg/canvas/embed.
- Pseudo-content and list markers won't be in `section.textContent` (they're generated), so parity won't catch them by text alone — but once the per-defect fixes materialize them, their resolved text *will* appear in `out` and parity will protect against regressions. Until then, route any element with non-trivial pseudo/marker content to fallback explicitly.

**In `SlideEditor.tsx` — gate the swap + persist on parity:**

```ts
const { html, parity } = flattenSlideSection(sec, { scale });
if (!parity.ok) {
  console.warn("[flatten] parity mismatch, keeping unflattened", {
    slide: slideKey,
    missingWords: parity.missingWords,
    census: { src: parity.srcCensus, out: parity.outCensus },
  });
  // telemetry hook here (PostHog) — do NOT swap, do NOT persist.
  return; // editor runs on the original HTML: degraded (nested stacking) but LOSSLESS.
}
const flatSec = parse(html);
if (flatSec && flatSec.innerHTML !== sec.innerHTML) {
  sec.innerHTML = flatSec.innerHTML;
  onNormalizeRef.current?.(slideKey, flatSec.innerHTML);
}
```

This converts every drop in §3 into a safe no-op. Ship this before touching anything else.

### (b) HIGH-severity per-dimension fixes (so flatten succeeds instead of falling back)

1. **Preserve bare text + mixed inline content** — iterate `childNodes`; emit `Range`-measured boxes for non-whitespace `TEXT_NODE`s, freezing inherited props from the parent. Fixes DEFECT 1 and its inline-img variant, painted-container bare text, and the dissolve-branch label drop.
2. **Cull in layout px, decouple from descent** — replace the cull body with `offsetWidth || rect/scale` and a 0.5px floor; move the size gate from the kids-filter into the *leaf-emit* branch so a thin/zero wrapper is still descended into. Special-case `display:contents` to never cull. Mirror the same helper in `buildLayerTree`. Fixes DEFECT 2, the asymmetric AND-cull, the floor-then-emit amplifier, zoom non-determinism, and the layer-list/canvas disagreement.
3. **Freeze non-inherited descendant computed styles on the clone** — before dissolving / when full-cloning, walk the live subtree and inline each descendant's computed `display/color/background/border/text-decoration/font-*`; resolve `var()` to computed values; freeze inherited props (and `color`) with `!important`; add `letter-spacing`, `word-spacing`, `text-shadow`, `font-feature-settings`, `font-variation-settings`, `white-space` to the freeze set. Fixes DEFECT 3, var() scope, inner-emphasis loss, RTL flip, structural selectors, icon-font ligatures.
4. **Emit geometry with `box-sizing:border-box` + `!important`** — add `box-sizing:border-box`; emit `left/top/right/bottom/width/height/margin` as `!important` via `setProperty`; add `padding`/`border` awareness via box-sizing (don't strip them); add `min/max-width`, `min/max-height`, `aspect-ratio`, and the logical `inset-*` longhands to `FLATTEN_OWNED`. Fixes the real slide-10 "40px frame," the class-`!important`/min-max override, and class inset over-constraint.
5. **Carry all `<style>` blocks, not just `:scope > style`** — `section.querySelectorAll("style")` into `out`. Fixes nested `@font-face`/`:root`/`@keyframes`/SVG-fill-via-CSS loss in one line.
6. **Proper transform handling** — decompose the matrix; carry the source transform verbatim when scale/skew/mirror/3d is present instead of synthesizing `rotate()`; size rotated/ancestor-transformed leaves from `rect/scale`. Fixes the dropped scale, the mirror-becomes-180°-flip, and ancestor-transform sizing.
7. **Real clip model** — replace the single radius string with a clip stack `[{rect, radius}]`; detect `overflow:hidden/clip/auto/scroll`, `clip-path`, `mask`, `clip`; intersect successive clips; always emit `overflow:hidden` when any ancestor clipped (decouple from `!hasOwnRadius`); preserve `object-fit`/`object-position` on imgs. Fixes rectangular crops, masks, nested clips, own-radius overflow loss, object-fit drift.
8. **SVG self-containment** — inline cross-referenced defs/`<symbol>`/`<use>` targets into each emitted svg; never cull an id-defining svg; inline resolved `fill/stroke`. Fixes gradient/sprite/icon paint loss.
9. **Treat embeds as leaves** — `canvas` (→ `toDataURL` img), `video` (→ poster img), `iframe/object/embed` (keep + flag). Never dissolve them.
10. **Root validation** — throw on zero-size root; broaden + verify the root lookup in `wire()`; skip flatten and persist when no plausible canvas-sized root.

### (c) Medium / low fixes

- CSS paint-tier z-ranking (positioned vs static); negative-z children before the parent shell; preserve stacking-context/isolation/mix-blend wrappers as real boxes.
- nowrap heuristic: compare `scrollHeight`, skip for `<br>`/emoji/clamped/`pre` text, wrap in `try/finally`, measure on the clone; add hysteresis on re-flatten.
- `white-space`/clamp preservation: bake computed `white-space` and `-webkit-line-clamp`/`-webkit-box-orient`/`max-height` when non-default.
- Don't round-trip the author's inline style through CSSOM mutation; capture the original string + parenthesis-aware tokenizer.
- Normalize scroll + pause animations before measuring; read geometry once per node.
- Provisional staging + recoverable `data-tq-source` baseline; persist only on first real edit.
- Idempotency: normalized-signature equality gate; verify-only re-entry pass; `ceil`-consistent left/top.
- Iterative walk with depth/node budget; one `getComputedStyle` per element; telemetry on abort/fallback.
- Form-control value reflection; `box-sizing` already covers most padding cases.

### (d) Test / verification strategy

A flatten parity harness, run in CI and pre-deploy (it needs a real browser DOM — flatten depends on `getComputedStyle`/`getBoundingClientRect` — so drive it in Playwright against a headless page that renders each slide section, or in the existing iframe).

1. **Golden corpus.** Snapshot 30-50 real slides spanning every confirmed pattern: bare-text page numbers, hairline `<hr>`/dividers, `.foot b{display:block}` cells, content-box padding cards, scaled/mirrored transforms, rounded + square crops, clip-path avatars, SVG gradient/sprite/`<use>`, nested `<style>` `@font-face`, lists, pseudo bars/quotes/counters, `object-fit:cover` photos, RTL Arabic text + justification, mixed positioned/static stacks, `opacity:0` reveal states. Include the actual slide-10 that surfaced the "40px frame."

2. **Content-parity assertions** (the must-not-regress gate): for every slide, `flattenSlideSection` then assert `parity.ok === true` — no missing words, no census shrink. This is the same census as the runtime safety net, so green CI means the safety net never has to fall back on the corpus. Add `::before`/`::after`/`::marker` resolved-text to the source signature once those are materialized.

3. **Visual-parity assertions:** render section and flattened `out` at scale 1 in two iframes; screenshot each; assert pixel diff below a small threshold (e.g. <0.3% changed pixels). Catches the transforms, clips, z-order, box-sizing, color/cascade defects that preserve text but render wrong.

4. **Determinism assertion:** flatten each slide at three scales (0.25, 0.5, 1.0) and assert identical census + identical emitted box count. This is the regression guard for DEFECT 2's zoom-dependence — it must pass before the cull fix is considered done.

5. **Idempotence assertion:** flatten twice; assert the normalized signature (coarse-grid geometry + frozen values + text) is byte-stable, so re-entering edit mode never re-persists a clean slide.

6. **Purity assertion:** capture `section.innerHTML` before and after `flattenSlideSection`; assert unchanged (catches the nowrap live-mutation regression).

7. **Fuzz / adversarial:** generate deeply nested wrappers, zero-size containers, `display:contents`, cross-origin embeds; assert flatten either succeeds with parity or falls back cleanly (no throw escaping, no half-mutation, no silent drop).

Wire 2 and 4 as a hard pre-deploy gate; 3, 5, 6 as CI checks; 7 as a periodic fuzz job. Until this harness is green on the corpus, keep the parity safety net (4a) as the production backstop so any slide the fixes miss stays lossless rather than shipping a degraded deck.

---

**Files referenced:** `/Users/osama/taqreer/lib/editor/flatten.ts`, `/Users/osama/taqreer/lib/editor/leaves.ts`, `/Users/osama/taqreer/components/preview/editor/SlideEditor.tsx`, `/Users/osama/taqreer/components/preview/DeckView.tsx` (`handleNormalize`/`applyContentLocally`/`persistContentInPlace`), `/Users/osama/taqreer/lib/editor/serialize.ts`.
