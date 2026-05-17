# Plan — Slide Comments & Partial Regeneration

> ⚠️ **SUPERSEDED / ARCHIVED — 2026-05-17.**
> This plan describes the Lightbox-based UX that shipped on 2026-05-15.
> The lightbox was removed in PR #26 (canvas-ux refactor); comments now
> live on the in-page hero canvas via `HeroCommentOverlay.tsx`, and the
> slide-nav swaps with `CommentsPanel.tsx` in the same fixed slot.
> Source of truth for the current implementation:
> - `components/preview/HeroCommentOverlay.tsx` (drag-box + editor)
> - `components/preview/CommentsPanel.tsx` (panel + Apply action)
> - `components/preview/DeckView.tsx` (state machine — `commentMode`,
>   `commentsArmed`, `applying`)
> - `context/log.md` 2026-05-17 section for the full diff narrative.
> Do not implement the Lightbox steps below.

Drafted 2026-05-15 after dev → main PR #24 went up. **Step 1 (Lightbox) shipped on dev (uncommitted, no push yet); paused for visual verify before continuing.** Resume on user signal.

> **Reminder when resuming (or in a new window):** all UI work uses the design tokens + class system in `app/globals.css` — never guess hex / rgba / blur values. Always read the top-of-file manual first (`.glass-card`, `.glass-modal`, `.btn-icon`, `.btn-gradient`, `--tq-*` tokens). Inline raw `bg-white/10` / `bg-black/85` is a smell — find the matching semantic class.

---

## User-confirmed decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Comment spatial reference | **Drag-box (region select)**, not point/pin |
| 2 | Quick-action chips | **Yes** (4-6 common Arabic phrasings above the textarea) |
| 3 | Multiple comments per slide | **Yes** — pile boxes, list comments |
| 4 | Comment persistence | **Per-user DB (`Comment` table)** — schema already exists |

User's open question: *"What if the user wants a comment applied to all slides? We send the HTML back to Claude and tell him the comment?"*

**Answer — yes.** A "global" comment fans out through the same per-slide regen path; each slide's Claude call receives the global comment alongside any slide-specific ones. Two implementation options for the scope flag (see schema-gap section below).

---

## The user's mental model (preserved verbatim)

> "The preview page should list 4 slides in a row, and when the generation complete, you should be able to click to enlarge. When the user clicks on the comment icon, he be able to click on any area of the enlarged slide, once they click, a text box will appear just under the place where they clicked, they write their comment and they submit. After submitting, the comment is saved into the new prompt mentioning to claude the slide and what was the comment.
>
> While the comment tool is selected the regenerate icon switch to a check mark, meaning apply the comment, and we should lock in any slides that had 0 comments.
>
> Once the user hit the generate with comments, only the slides that have comments should regenerate, maintaining the same chrome and color style so claude should give us the same slides but keeping the comments in mind."

## Suggestions that diverge from the verbatim design (with rationale)

| Original | Suggested | Why |
|---|---|---|
| Click → point comment | **Drag-box → region comment** | Single point leaves "title vs icon vs body?" ambiguity for Claude. A box gives explicit spatial scope. |
| Regenerate icon flips to checkmark | **Comment toggle turns orange; separate "Apply Comments (N)" button arms the state; the regenerate icon morphs into a check icon and BECOMES the fire button** ("arm then fire") | Distinct actions deserve distinct controls, but the user expected the regen button to "fire" the change. Apply now arms only — lets the user iterate on the draft before committing — and the morphed check on the regen button is what actually hits Claude. Matches what shipped (see `log.md` 2026-05-16 entry). |
| (not mentioned) | **0-comment slides visibly dim in comment mode**; "locked" indicator | User needs to see what's about to NOT change. |
| (not mentioned) | **Quick-action chips above the textarea** — "اجعل النص أكبر", "غيّر اللون", "احذف", "بسّط", etc. | Saves ~70% of clicks on common edits. |
| One batched Claude call | **Per-slide Claude calls in parallel (`Promise.all`)** | Faster; one slide's failure doesn't take the rest down. |
| (not mentioned) | **Save drafts to DB so refresh doesn't lose them** | Comment table has `status` field — use `draft` until applied. |
| (not mentioned) | **Before/after diff after regen + per-slide revert** | `PresentationVersion` history makes this free. Builds user trust. |

---

## Architecture

```text
DeckView (existing — extend)
├── SlideGrid (existing 4-up cascade)
│   └── Slide cells — `onClick` opens LightboxModal
│
├── LightboxModal (NEW)
│   ├── SlideRenderer at scale=1 in scaled viewport
│   ├── Comment-mode overlay layer:
│   │   ├── Existing pins/boxes — clickable (edit/delete)
│   │   ├── Empty area → drag → bounding box → text input under box
│   │   └── Quick-action chips above textarea
│   ├── Nav (prev / next slide)
│   └── Close
│
└── PreviewActionBar (extend)
    ├── Regenerate (existing) — disabled in comment mode
    ├── Comment Toggle (NEW) — orange when active
    ├── Apply Comments (N) (NEW) — visible in comment mode when N > 0
    ├── Export PPTX (existing)
    ├── Save Template (existing)
```

### Comment data shape (per row in `Comment` table)

```ts
{
  id: cuid                          // existing default
  presentationId: string            // existing
  versionId: string                 // existing — the version the comment was made AGAINST
  slideId: string                   // existing — "_global" for deck-wide, else slide ID
  boundsJson: { x, y, w, h }        // drag-box in slide-coordinate space (0..1920, 0..1080)
                                    //   null when slideId === "_global"
  content: string                   // the comment text
  status: "draft" | "applied"       // existing — gated transitions
  createdAt: DateTime               // existing
  // unused for our flow: areaId, elementIds, screenshotUrl
}
```

### Schema gap to address

**No native "apply to all slides" scope.** Two options:

- **A. Sentinel `slideId = "_global"`** — no migration. Less typesafe. Server-side helper to expand on apply.
- **B. Add `scope: String` enum column** — needs Prisma migration. Cleaner. Recommended for production but adds friction for v1.

For v1 we go with **(A) sentinel** to ship faster. Migration can come later if/when we add other scopes (e.g., `slide-group`, `theme`).

---

## API surface

### Drafts

```text
GET    /api/projects/[id]/comments?versionId=…
POST   /api/projects/[id]/comments              { slideId, boundsJson, content, status:"draft" }
PATCH  /api/projects/[id]/comments/[commentId]  { content?, boundsJson? }
DELETE /api/projects/[id]/comments/[commentId]
```

### Apply (the main one)

```text
POST /api/projects/[id]/regenerate-partial
{
  // server reads pending draft comments from DB and uses those,
  // OR optionally accepts a body for "stateless" apply:
  comments?: [{slideId, boundsJson, content}]
}

Response: { versionId, status: "queued" }
```

Server steps:
1. Move applicable Comment rows from `status=draft` to `status=applied`
2. Resolve `_global` → expand to all slide IDs
3. Determine `targetSlideIds = unique slideIds with applied comments on this version`
4. Create new `PresentationVersion` (v_n+1) with `status=queued` and `slideJson=copy of v_n`
5. Fire `deck.regenerate.partial.requested` with `{versionId: v_n+1.id, targetSlideIds, comments}`

---

## Inngest flow

```text
event: deck.regenerate.partial.requested
data: { versionId, targetSlideIds, comments }

handler:
  manifest = await loadManifest(versionId)
  results = await Promise.all(
    targetSlideIds.map(async (slideId) => {
      const slide = manifest.slides.find(s => s.slideId === slideId)
      const slideComments = comments.filter(c => c.slideId === slideId || c.slideId === "_global")
      const prompt = buildPartialRegenPrompt({
        manifest,
        targetSlideId: slideId,
        slideHtml: slide.html,
        comments: slideComments,
      })
      const newHtml = await claudeRegenerateSlide(prompt)
      return { slideId, html: newHtml }
    })
  )
  // splice into manifest
  for (const r of results) {
    const idx = manifest.slides.findIndex(s => s.slideId === r.slideId)
    manifest.slides[idx].html = r.html
  }
  await persistManifest(versionId, manifest, status="completed")
  emit deck.regenerate.partial.completed
```

### Per-slide prompt shape (`buildPartialRegenPrompt`)

```text
You are regenerating ONE slide in an existing deck. The other slides are
fixed — keep the chrome / theme / fonts / layout language identical.

ACTIVE SLIDE: {targetSlideId}

USER COMMENTS ON THIS SLIDE:
  1. Region at (x:.., y:.., w:.., h:..): "{content}"
  2. Global: "{content}"
  ...

CURRENT SLIDE HTML (the one to regenerate):
{slideHtml}

SIBLING CHROME REFERENCE — read but DO NOT modify these:
  Slide {slideId-1}: {first 800 chars of html}  // truncated
  Slide {slideId-2}: {first 800 chars of html}
  ...

THEME (locked, do not change):
{manifest.theme}

Return ONLY the new HTML for the active slide. No prose, no JSON wrapper,
no markdown fences. Match the chrome pattern visible in the sibling slides
exactly. Keep the slide's role ("{slide.role}").
```

**Why truncate siblings to 800 chars:** chrome is in the first/last ~200 chars (the slide-root div, the chrome row markup). Truncating saves tokens; full sibling HTML isn't needed.

**Token budget per per-slide call:**
- System prompt (cached): ~5KB
- Sibling chrome reference: ~5-8KB total (5-8 slides × 800 chars)
- Active slide HTML: ~1-3KB
- Comments: <500 bytes
- **Total per call:** ~12-16KB input. Cheap. Five parallel calls = ~$0.15 per regen at Opus pricing.

---

## Prompt additions

Add a new top-level section to `SYSTEM_PROMPT`:

```text
PARTIAL REGENERATION MODE
When the user message includes a "PARTIAL REGEN — ACTIVE SLIDE" block:
- Regenerate ONLY the slide named there.
- Read the SIBLING CHROME REFERENCE block to match chrome (header row,
  footer row, kicker, pagination, brand mark, slide margins) exactly.
- DO NOT change the theme — palette, fonts, brand colours stay locked.
- Apply the user's comments faithfully but conservatively. If a comment
  says "make this bigger", scale 1.2-1.5×, not 3×. Aim for minimal
  diff from the existing slide.
- Return ONLY the slide body HTML (no JSON, no fences).
```

---

## UI states (DeckView extensions)

**Mode states:**
- `idle` — normal preview, slides clickable to enlarge
- `comment` — comment toggle ON, lightbox closed → 0-comment slides dimmed in grid
- `comment-enlarged` — lightbox open with a slide; drag-to-comment active
- `applying` — regenerate-partial fired, target slides re-enter generating state, others static

**Toolbar visibility per mode:**

| Button | idle | comment | comment-enlarged | applying |
|---|---|---|---|---|
| Regenerate | enabled | disabled | disabled | disabled |
| Comment Toggle | enabled | active (orange) | active (orange) | disabled |
| Apply Comments (N) | hidden | visible if N > 0 | visible if N > 0 | hidden |
| Export PPTX | enabled | enabled | enabled | enabled |
| Save Template | enabled | enabled | enabled | enabled |

---

## Lightbox interaction details

**Opening:** click any slide cell → modal opens at full-slide size scaled to viewport (e.g., 1920×1080 at scale 0.65 → 1248×702 with 80px chrome around it).

**Drag-box:**
1. mousedown on empty slide area → start drag rectangle
2. drag → live preview of the box
3. mouseup → freeze the box, show text input + chips below
4. user types comment + clicks "حفظ" → bound to DB (status: draft), pin appears
5. user can click an existing pin to edit / delete

**Coordinate translation:**
- Capture mouse in viewport pixels
- Convert to slide-space coords: `slideX = (viewportX - slideLeftEdge) / scale`
- Persist `{x, y, w, h}` in slide-space (0..1920, 0..1080)
- On render, multiply back by scale for visual placement

**Keyboard:**
- `Esc` — close lightbox (cancel current drag if active)
- `Enter` in textarea — submit comment
- `←` / `→` — nav between slides
- `Delete` while a pin is selected — remove it

**Multi-comment per slide:** each new drag creates a separate Comment row. Multiple pins visible. Each editable independently.

---

## Quick-action chips (Arabic, 6 most-common)

| Chip | Translates to comment text |
|---|---|
| اجعل النص أكبر | "Increase font size by ~1.3× while keeping the rest of the slide layout unchanged." |
| اجعل النص أصغر | "Decrease font size by ~1.3×." |
| غيّر اللون | "Change the colour of the highlighted region to a more visible / contrasting palette entry." |
| احذف هذا | "Remove the highlighted element entirely from the slide." |
| بسّط | "Simplify the visual content — fewer elements, more whitespace, cleaner hierarchy." |
| أضف أيقونة | "Add a relevant inline SVG icon to reinforce the content meaning." |

Clicking a chip appends its text to the textarea. User can edit before submitting.

---

## Before/after diff (post-regen, optional polish)

After Inngest completes, the regenerated slides flash highlight on cascade-in. User can:
- **Accept** (default — keep the new version)
- **Revert this slide** — restore the slide's HTML from v_n into v_n+1. Cheap because manifest is versioned.

Implementation: small "Revert" pill on changed slides in the grid for the first 30s after apply. Cleaner UX than a giant modal.

---

## Implementation order

1. ✅ **Lightbox modal** — slide enlargement, nav, close. (DONE 2026-05-15, uncommitted)
2. ⏳ **Comment mode state machine** — toggle in toolbar, dim 0-comment slides in grid.
3. ⏳ **Drag-box overlay + textarea + chips** — inside the lightbox, with the DB persistence (`POST /api/.../comments`).
4. ⏳ **Apply Comments button** — partial regen API + Inngest event + per-slide Claude call. The prompt section for `PARTIAL REGENERATION MODE`.
5. ⏳ **Polish:** dim-locked slides, before/after diff, per-slide revert.

Roughly 4-6 commits worth, spread over 2-3 sessions.

---

## Step 1 — what shipped (DONE 2026-05-15, awaiting visual verify + commit)

**Files:**
- `components/preview/SlideLightbox.tsx` (NEW, ~205 lines)
- `components/preview/DeckView.tsx` (modified — slide cells clickable, single morphing toolbar)

**Architecture:**
- Lightbox is portal'd to `document.body` (`createPortal`). Renders an enlarged `<SlideRenderer>` at fit-to-viewport scale via a `ResizeObserver` on the stage element. ESC + ←/→ nav, backdrop-click close, body-scroll lock while open.
- Slide cells in the deck grid are now `<motion.button>` with `whileHover` (dim + zoom-in icon overlay) and `cursor-zoom-in`. Click sets `lightboxIndex` in DeckView state.
- Stage width: `min(calc(90vw - 220px), calc((100vh - 160px) * 16/9))` — the `220px` reservation matches `TOOLBAR_RESERVE_PX` in DeckView so the toolbar always lands clear of the stage.
- Stage + chrome (close, prev, next, counter pill) use the **same** `.glass-card` class for one consistent surface language.
- RTL-aware: prev sits on the start side (right in RTL) with a right-pointing chevron — Arabic page-turn metaphor. Keyboard arrows keep universal meaning (left=prev, right=next).

**Toolbar morph (the cool bit):**
- Single `<PreviewActionBar>` instance lives at the DeckView root, **portal'd to `document.body`** (gated by `bodyMounted` state for SSR safety) so its `z-[1050]` is in the same stacking context as the lightbox portal (`z-[1000]`). Without the portal an ancestor stacking context (transform/filter/isolation) would trap the toolbar below the lightbox.
- Outer `<motion.div>` animates `left` between `16` (page edge) and `toolbarLightboxLeft` (= `stageLeftEdge - TOOLBAR_STAGE_GAP_PX - TOOLBAR_WIDTH_PX`) via a spring (`stiffness: 180, damping: 24`). Toolbar lands on the **LEFT** of the enlarged slide (user's call — feels more consistent since it lives on page-left when closed).
- Inner `<motion.div>` has `key={lightboxIndex !== null ? "open" : "closed"}` — flipping the key remounts on each state change, firing `initial={{ scale: 0.88 }} animate={{ scale: 1 }}` via a bouncier spring (`stiffness: 280, damping: 14`). The "lift off, land" 3d pulse.
- Viewport size tracked via `useState({ w, h })` + `window resize` listener so `toolbarLightboxLeft` recomputes on rotate / sidebar toggle.
- **Constants kept in sync between SlideLightbox + DeckView** — both files reference the `220px` stage reservation. If you change one, change the other (or extract to a shared constant).
- **Trade-off accepted:** when the toolbar morphs, React unmounts/remounts the inner motion.div, so `<PreviewActionBar>`'s internal state (regen running, save-template form open, export status) resets. Functional impact minimal — async work continues, just the visual indicator clears. If users hit this, lift toolbar state into DeckView.

**Theme conformance:**
- All new chrome uses `globals.css` semantic classes — `.glass-modal` (backdrop), `.glass-card` (stage + counter + close + prev + next), framer-motion (no CSS keyframes / transitions).
- No raw `bg-*` / `blur-*` / `shadow-*` literals on chrome.

---

## Step 2 next session — comment-mode state machine

When you resume, start with the toolbar's "comment toggle" button. Currently `<ToolButton icon="comment" disabled badge="قريباً">` in `PreviewActionBar.tsx:202-206`. Replace with:
- Active toggle (orange when on)
- Hides Regenerate, shows "Apply Comments (N)" button (only when N > 0)
- 0-comment slides in the grid get dimmed + lock indicator

DeckView gets a `mode: "idle" | "comment"` state machine. The lightbox's `comment-enlarged` mode (drag-box overlay) lands in step 3.

Schema reminder (from §"Schema gap to address"): we agreed on **sentinel `slideId="_global"`** for v1 to avoid a Prisma migration. Server expands sentinel to all slide IDs at apply time.

---

## Open questions to revisit

- Should the lightbox allow editing existing pins from a previous version (i.e., load old comments) or always start fresh? My lean: always fresh — `versionId` keys the comments to a specific generation; v_n+1 starts with zero comments.
- When applying comments, should ALL drafts apply or should user pick? My lean: all drafts apply (UI doesn't have per-comment apply / skip; users delete what they don't want first).
- Global-comment scope: extend to slide-role-based scopes later (e.g., "apply to all content slides but not cover")? Future work, not v1.

---

*Step 1 shipped 2026-05-15, uncommitted. CR review on PR #24 was triaged and pushed via 3 prior commits (still local — no push yet). Resume on explicit user signal.*
