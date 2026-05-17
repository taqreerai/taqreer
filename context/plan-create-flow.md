# Plan — Create-flow UX/UI enhancement

Drafted 2026-05-17 evening, ahead of the next session. User's scope:
4-step flow, no scrolling per step, unified pill-shaped buttons, glass
+ Tailwind tokens linked to the settings preset (no hardcoded hex /
blur / opacity), and ALL current functionality preserved.

> **Why now:** the current 3-step flow grew organically — step 2
> (brand) doubled as the output-config dumping ground (slide size +
> rules + slide count + logo placement landed on the same page as
> colours + fonts + logo upload). The page scrolls heavily, the
> stepper sits inert, and the summary page treats "content" and
> "brand" as one bullet list instead of edit-able regions.

---

## Step layout (4 steps total)

### Step 1 — Content (current step 1, no change)

- Title: "ما هو موضوع عرضك التقديمي؟"
- Two side-by-side cards:
  - Right: "رفع ملفات السياق" (file upload — PPTX / PDF / DOCX)
  - Left: "إدخال نص حر" (free-text textarea, max 5000 chars, with the
    "موصى به للسرعة" badge)
- Keep `keepVerbatim` toggle on the free-text card.

### Step 2 — Brand identity (slimmed from current step 2)

KEEPS: colours, fonts (Google + upload, both slots), logo upload.

REMOVES: slide size, logo position, logo excludes, persistent text +
position, designStyle pills, fixTypos / pagination toggles, slide count.
All of those move to step 3.

Layout:
- Right card: "ألوان العلامة التجارية" — colour swatches + screenshot
  palette extraction (current functionality preserved).
- Left card: "الخطوط" — heading + body slot, each with Google /
  Upload mode toggle (current Google font picker + upload flow stays).
- Bottom-full card: "الشعار" — drag-drop / file picker for SVG / PNG /
  JPG (5 MB max). Just upload here; placement moves to step 3.
- Save-as-brand-kit button stays where it is.

### Step 3 — Output settings (NEW)

2×2 grid of cards so the whole step fits one viewport.

Top row:
- Right (top-right): **حجم الشريحة** — 16:9 ↔ 9:16 toggle (current
  selector preserved; default = 16:9).
- Left (top-left): **عدد الشرائح** — slider OR pill row (current
  `slideCount` UI preserved); default = "auto" / 10.

Bottom row:
- Right (bottom-right): **موقع الشعار** — 3×2 position picker (top-
  left, top-center, top-right, bottom-left, bottom-center, bottom-
  right) + 2 exclude pills ("استثناء من الغلاف" / "استثناء من
  الختام"). Disabled state when no logo was uploaded in step 2.
- Left (bottom-left): **قواعد التوليد** — designStyle pill row
  (إبداعي / بسيط / احترافي / مرح), fixTypos toggle, pagination
  toggle, persistent-text input + corner position picker.

### Step 4 — Summary (current step 3, restructured)

Vertical stack of THREE cards (one per previous step), each with an
"تعديل" pencil button on the right side of the card header. Click =
navigate to that step's route, preserving state via the existing
`taqreer:create:*` sessionStorage keys.

- Card 1 — "المحتوى المدخل" — file name + size OR text preview
  (first 200 chars + char count).
- Card 2 — "الهوية البصرية المختارة" — palette swatches inline +
  font names + logo thumbnail.
- Card 3 — "إعدادات الإخراج" — slide size, slide count, logo
  position (or "بدون شعار"), designStyle, rules summary.

Bottom: gradient pill "إنشاء بذكاء" (primary CTA) + outline pill
"السابق" (back).

---

## Cross-cutting

### Stepper (left rail)

Clickable timeline visible on every step. Each item:
- Done → check icon + "مكتمل" label (current state preserved)
- In-progress → ring + "قيد الإجراء" label
- Pending → muted + "قادم" label

Clicking a DONE step navigates to that route (state intact). Pending
steps stay non-clickable until the user reaches them naturally.

Extract into a shared `<CreateStepper />` component so the four pages
import one source of truth instead of repeating the markup.

### Buttons

Audit every button on the four pages. Replace ad-hoc shapes with one
pill primitive — `<PillButton variant="primary" | "secondary" |
"ghost">`. Sizes: `sm` (within-card actions) / `md` (Next / Previous
/ CTA). All use `btn-pill` / `btn-gradient` / `btn-outline-dark` from
`globals.css` — no inline border-radius, no inline padding.

### No-scroll guarantee

Each step's content fits the viewport at 1280×720 minimum (the dashboard
shell's `max-w-[1280px]`). Strategy:
- Cards in step 1 / step 3 lay out side-by-side or in 2×2.
- Step 2's three cards (colours + fonts on top, logo on bottom) sit in
  a CSS grid that compresses the logo card when viewport height < 800.
- Step 4's three stacked cards each cap their content height (e.g.,
  text preview clamps to 3 lines) so the whole stack fits one viewport.

### Tokens

Everything reads from `app/globals.css` tokens. Quick allowlist of
classes / variables to use:
- Surfaces: `.glass-card`, `.glass-modal`, `.backdrop-blur-glass`
- Buttons: `.btn-pill`, `.btn-gradient`, `.btn-outline-dark`,
  `.btn-icon`
- Borders / chips: `.badge-purple`, `.input-dark`
- Brand tokens: `var(--tq-blue)`, `var(--tq-magenta)`, `var(--tq-violet)`
- Glass preset vars: `var(--glass-opacity)`, `var(--glass-blur)`,
  `var(--glass-border-opacity)`, `var(--glass-saturation)` — driven
  by `<GlassPreflight />` from the user's settings page

No inline hex except slide-content colour overrides (palette swatches,
where the hex IS the data).

---

## Functionality preservation checklist

Confirm each of these still works after the refactor:

- [ ] Auto-load most-recent brand kit on mount (`/api/brand-kits` GET)
- [ ] Google font picker (search + family preview rendering)
- [ ] Upload font (`.woff2` / `.ttf` / `.otf` → Supabase Storage)
- [ ] Palette colour picker (manual + drag-from-screenshot extraction)
- [ ] Logo upload (SVG / PNG / JPG, 5 MB cap, dataURL preview)
- [ ] Save-as-brand-kit (POST `/api/brand-kits`) + the dirty/saved
  fingerprint comparison
- [ ] sessionStorage round-trip across `back` / forward navigation
- [ ] All values reach `POST /api/projects` with the same shape Claude
  expects (brief.brand.colors / .fonts / .logo / .slideSize, plus
  brief.rules and brief.slideCount)
- [ ] Cancel + Resume — leaving and coming back hydrates the same
  sessionStorage

---

## Implementation order (tomorrow)

1. **Read + map current state**: `/app/create/content/page.tsx`,
   `/app/create/brand/page.tsx`, `/app/create/summary/page.tsx`.
   List every state field, sessionStorage key, API contract.
2. **Extract `<CreateStepper />`** with the 4-step shape and the
   clickable navigation rule.
3. **Extract `<PillButton />`** wrapping `.btn-pill` / `.btn-gradient`
   / `.btn-outline-dark` for the three variants.
4. **Split brand page** → keep colours / fonts / logo on
   `/create/brand`; move size / count / placement / rules to a new
   `/create/output` route. Update sessionStorage keys accordingly
   (`taqreer:create:output`).
5. **Rewrite summary page** → three stacked cards with edit buttons.
6. **Wire the stepper's onClick navigation** so completed steps jump
   back without losing state.
7. **No-scroll audit pass** at 1280×720.
8. **Functionality smoke test** against the checklist above.
9. **Doc + commit**: append a 2026-05-XX log entry with the diff
   narrative and update `context/context.md` §09 (Preview & Action
   Bar) — actually scratch that, this is the create flow, not the
   preview. Add a new `## 11A. Create Flow (4-step)` section or
   wherever the preview-flow's neighbour belongs.
