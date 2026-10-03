# Handoff: desktop to cloud sessions (2026-10-04)

Read with `CLAUDE.md` (conventions + the "Cloud sessions" rules) and `CONTEXT.md` (full
system reference). This file is the working state that used to live only on the owner's
machine. Update it when a task lands or a new one starts.

## State

- `dev` = `main` = live at commit `324a46a` (2026-10-04). Working tree clean.
- Everything below under "Recently shipped" is LIVE.

## Recently shipped (2026-10-01 to 2026-10-04)

- **/create**: one "Design" step (template picker, design style, colour presets) in
  same-size cards; free users see every template, 2 are free (`Template.isFree`), the
  rest show the gold premium badge. Templates open via `/create?template=<id>`.
- **Studio**: deck-wide recolor (`lib/deck/recolor.ts`, `/api/projects/[id]/recolor`)
  and font change (`lib/deck/refont.ts`, `/api/projects/[id]/font`), both deterministic
  (no AI), both undoable (deck-wide undo history in `DeckView.tsx`). Font popover has a
  "check your text after a font change" note.
- **Default font**: Noto Sans Arabic. **Default model** on paid plans: Opus
  (`lib/credits/use-default-quality.ts`).
- **Free branding**: clickable watermark opens a small Plus upsell
  (`WatermarkUpsellPopover.tsx`).
- **Pricing**: yearly is the default on the pricing page, monthly in the upgrade modal;
  yearly cards show the billed total; `checkout_started` server event.
- **Sharing/SEO**: OG previews for public decks; viewer CTA on shared decks
  (`SharedDeckCta.tsx`); disposable-email signup block.
- **"Your own template" (internal name: mimic, URL stays `/mimic`)**:
  - Renamed from "Mimic / محاكاة" to "قالبك الخاص / Your own template" in all
    user-facing copy (search demand is on "قالب", not "محاكاة").
  - 3-step wizard (`components/mimic/MimicFlow.tsx`): (1) content + design reference in
    two framed panels, (2) brand, (3) slide size + count, AI images, instructions,
    Generate.
  - Brand card colours: "ألوان القالب / Template colors" (default) vs "ألوان مخصصة /
    Custom colors". Template colors sends NO brand colours; `deck-generate.ts`
    `REFERENCE_PALETTE_ADDENDUM` makes Claude read the reference's palette and emit it as
    `data-deck-palette` on the cover, adopted into `theme.palette`.
    **Not yet verified with a real generation**: first thing to check on desktop.
- The free-plan slide-cap hint ("حتى 8 شرائح...") shows only on /create (the only free
  flow).

## Pending work (owner decides order)

1. **SEO pages** (approved in principle, waiting on the owner's "go ahead"). Data from
   OpenSEO, Saudi Arabia, Arabic, monthly searches / keyword difficulty:
   - Compress PowerPoint page: "ضغط ملف بوربوينت" ~1,000 / low KD.
   - Ready-made decks page: "عروض بوربوينت جاهزة pdf", "بوربوينت جاهز" ~2,710 combined.
   - Templates angle: "قالب بوربوينت" 1,600 / KD 0, "قوالب بوربوينت" 1,600 / KD 0,
     "تصميم بوربوينت" 480 / KD 0, "بوربوينت بالذكاء الاصطناعي" 320.
   - Later: Arabic Gamma comparison page (Arabic spellings of Gamma ~12,640 / KD 0,
     waits on the owner's side-by-side Gamma test), English Gamma page, "كانفا بالعربي"
     (2,400) page, outreach emails, opt-in public deck pages.
   - Existing SEO landing pages live under `app/[lang]/(marketing)/` (e.g.
     `presentation-style`, pdf-to-powerpoint); copy lives in `dictionaries/*.json`.
     Follow their structure. The OpenSEO MCP is NOT available in the cloud: use the
     numbers above, don't invent new ones.
2. **Optional, offered but not requested**:
   - Free image-PPTX export logs both a `png` and a `pptx` row (activity over-count).
   - `networkidle` waits in other render paths (same fix as `lib/export/render-deck-pdf.ts`:
     `waitUntil: "load"` + `waitForNetworkIdle({ idleTime: 500, timeout: 10000 })`).
   - The extract error "Failed to start extraction" is English on the Arabic UI
     (`app/api/extract/route.ts` + `lib/extract/error-codes.ts`).
   - Mimic: PDF references give no extracted colours at upload time (only PPTX theme
     colours); fine now that the generator reads them.

## Owner to-dos (not code)

- Stripe: add a promotion code to the "Yearly offer 10%" coupon; delete the two old
  11.76% coupons (0 redemptions).
- Local account `dev@taqreer.ai` is currently a FREE user for testing; restore admin with
  `npx tsx --env-file=.env.local scripts/set-admin.ts dev@taqreer.ai` when needed.
