# Changelog

Compact log of fixes / features / decisions. Newest first. One line each: `tag · what → why · where`.

Tags: **fix** · **feat** · **docs** · **decision** · **chore**

---

## 2026-05-15

- **chore** · compact context to markdown + log file → drop HTML/CSS clutter, single ledger of changes, delete `MAC_MIGRATION.md` (migration done) + 2 orphaned files (`LogoutButton.tsx`, `lib/constants.ts`) · `context/context.md`, `context/log.md`
- **fix** · CodeRabbit follow-ups on PR #22 → localhost regex too strict + DOMPurify TODO buried in §20 prose · `MAC_MIGRATION.md` (then deleted), `context/context.html` (then converted)
- **fix** · CodeRabbit Major findings on PR #21 → user-sync upsert never refreshed existing users + no try-catch + MAC localhost guard missing + ExportOptions casts · `app/api/auth/user-sync/route.ts`, `MAC_MIGRATION.md`, `types/dom-to-pptx.d.ts`, `lib/export/html-export.ts`, `app/spike/page.tsx`
- **docs** · §21 patch index → single ledger of all 13 enhancements, prevents losing track during future iterations · `context/context.html`
- **feat** · gradient text via CSS `background-clip: text` → SVG `<text fill="url(#g)">` exports as empty box; CSS-clipped text fully handled in code with sentinel-hex bridge + PASS 4 swap; removed SVG-text rule from prompt · `lib/export/gradient-text.ts` (new), `lib/export/bidi-postprocess.ts`, `inngest/functions/deck-generate.ts`
- **chore** · branch cleanup → merged `html-pivot` → `dev`, deleted `html-pivot` local + remote; future work goes directly to `dev` · git remote

## 2026-05-14

- **docs** · 99% parity checkpoint → §20 HTML Pivot what-shipped section + lint fix · `context/context.html`
- **fix** · CSS padding patch — second emission path → only one of two text-emission sites in dom-to-pptx was patched (bg-image branch only); user-reported bug was the bgColor/border branch · `patches/dom-to-pptx+1.1.8.patch` ≈L2771
- **fix** · CSS padding emitted as PptxGenJS `margin` not `inset` → upstream wrote `inset: padding, margin: 0`; PptxGenJS only honours `margin`, so all CSS padding silently dropped to `<a:bodyPr lIns=tIns=rIns=bIns=0>` · `patches/dom-to-pptx+1.1.8.patch` ≈L2646
- **fix** · DOM preprocess — strip Arabic letter-spacing + script-transition spaces + narrow PASS 3 + one-pagination prompt rule → letter-spacing breaks Arabic shaping; missing script-transition spaces glue Latin to Arabic in BiDi resolver; PASS 3 was widening headlines and overrunning neighbours · `lib/export/html-export.ts`, `lib/export/bidi-postprocess.ts`, `inngest/functions/deck-generate.ts`
- **fix** · direction-aware PASS 3 shape extension → grow `cx` opposite the text anchor (not symmetric) so Claude's slide margins are preserved · `lib/export/bidi-postprocess.ts`
- **fix** · swap `cx` slack for `wrap="none"` (then later swapped back) → symmetric slack shifted shape positions visibly; `wrap="none"` overflowed past the slide edge for RTL anchored content · `lib/export/bidi-postprocess.ts`
- **fix** · concrete code patterns for slide margins + pill centering in prompt → Claude was using flex `justify-content` for centering (lost in PPT); pill text-align must be on the element, not the parent · `inngest/functions/deck-generate.ts`
- **fix** · DOMPurify graceful fallback → SSR singleton lacks `.sanitize` under Turbopack module-sharing; renderer falls back to RAW HTML when missing (TODO: server-side sanitization before sharing/templates ship) · `components/slides/SlideRenderer.tsx`
- **fix** · `isSafeInline` excludes bordered / rounded elements → upstream collapsed pills/badges into bare inline text, dropping their styling · `patches/dom-to-pptx+1.1.8.patch` ≈L795
- **fix** · `taqreer_hasUniformScript` in `isTextContainer` → mixed-script flex/grid rows collapsing into one PowerPoint text frame; helper recurses on script mismatch · `patches/dom-to-pptx+1.1.8.patch` ≈L720
- **fix** · `splitMixedScriptFlexChildren` DOM preprocess → wrap direct text nodes when sibling has explicit `dir` or parent is flex/grid; lets the patched isTextContainer split shapes correctly · `lib/export/html-export.ts`
- **fix** · direction-blind `text-align` patch → upstream maps `text-align: start` to `algn="l"` regardless of `direction`; every Arabic paragraph relying on inherited RTL came out left-aligned · `patches/dom-to-pptx+1.1.8.patch` ≈L307 + ≈L2545
- **fix** · BiDi 99% parity via 4-pass post-processor → 3 OOXML layers (`rtlCol="1"` on bodyPr + `pPr rtl/algn` + `rPr lang=ar-SA`) + run-merge all required for PowerPoint to render correctly; Keynote tolerated partial state, PowerPoint didn't · `lib/export/bidi-postprocess.ts`

## 2026-05-13

- **decision** · pivot from JSON-element schema + PptxGenJS to HTML-first + `dom-to-pptx` → BiDi was death-by-a-thousand-cuts; coordinate math leaked across renderer/export; Claude was doing layout instead of design · `lib/schema/slide.ts`, `inngest/functions/deck-generate.ts`, `components/slides/SlideRenderer.tsx`, removed `lib/bidi.ts` + `inngest/functions/deck-export.ts` + JSON manifest
- **decision** · adopt `dom-to-pptx` v1.1.8 over `html2pptx` → BiDi spike comparison; dom-to-pptx had cleaner OOXML output, more recent maintenance, working SVG vector path · evaluated, picked

---

*Format: `tag · what → why · where`. Add new entries at the top of the current date section. New month/year gets its own `##` heading.*
