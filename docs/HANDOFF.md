# Handoff: cloud to desktop (updated 2026-10-06)

Read with `CLAUDE.md` (conventions + the "Cloud sessions" rules) and `CONTEXT.md` (full
system reference). This is the working state between sessions. Update it when a task
lands or a new one starts.

## State

- **Live (taqreer.ai)** = commit `6967b33`, deployed 2026-10-05.
- **Waiting, NOT on dev yet:** 34 commits on branch `claude/awesome-cannon-uay51e`
  (cloud session 2026-10-05/06), listed below. Bring them in on the desktop:
  `cd ~/Taqreer && git checkout dev && git pull --no-edit origin claude/awesome-cannon-uay51e`
  then test locally (checklist below), then `./deploy.sh`.
- The batch includes a **data migration** `20261005120000_free_trial_unlock` (free tier:
  all flows, slideCap 30, configVersion bump). deploy.sh runs `prisma migrate deploy` on
  the server; locally run `npx prisma migrate deploy` + `npx prisma generate` first.
- `/security-review` was NOT run on this batch (only quick self-checks). Prompt-pipeline
  edits (styles, enhance photos, real-people rule) and the AI-edit gate qualify; run it
  before deploying if the owner wants the full review.
- The owner works on Windows (Git Bash), is not a developer: give plain steps.

## The free-trial model (decided 2026-10-05, owner)

- `lib/free-trial.ts`: `FREE_PLAN_FEATURE_LOCKS = false` (every flow, non-premium
  template, logo, export open to free) and `FREE_AI_EDIT_LOCK = true` (AI edits after
  generation are PAID: studio AI tab shows a crown + upsell; slide / partial regen routes
  402 `ai_edit_locked`; full regenerate = Retry stays open via `aiEdit: false`).
- The only other free gate is the **teaser**: 5 slides designed (`TEASER_VISIBLE_COUNT`,
  lib/credits/cost.ts), the rest locked until they subscribe (`app/api/projects/route.ts`).
- **Before generating**, free users get the pop-up again (`SlideCapUpsellDialog` via
  `GenerateSplitButton`): "خطة التجربة المجانية", body says first 5 slides, buttons
  "عرض الخطط" (UpgradeModal at plus) / "تصميم أول 5 شرائح".
- Quiet watermark on free exports (`lib/export/free-branding.ts`), clickable in PPTX.
- AI photos cost free users 0 credits but the toggle now starts OFF for everyone.
- CTA copy: every free button is "جرّب مجانا" / "Try it free" (was "ابدأ مجانا");
  hero shows "بدون بطاقة ائتمان" under the button; FAQ / plans copy says "first 5 slides",
  never "your first deck". Paid plan cards keep "ابدأ الآن".

## Waiting batch: what changed (branch claude/awesome-cannon-uay51e)

**Creation flows (create, mimic, social, enhance, datasheet)**
- Desktop cards fill the screen width (cap 1800px, `desk` breakpoint = 1180px in
  globals.css `@theme`); template + colour-preset grids add columns via container queries.
- Cards are numbered (`CardStepBadge` in components/create/controls.tsx).
- Compact cards on enhance + mimic; font "install this font" hint with a Google Fonts
  link (`FontInstallHint`); logo upload zone redesigned (icon tile beside the text).
- AI photos row: square icon tile with an AI sparkle; free-trial badge removed.
- Enhance: Auto colours button; deck templates for enhance; **AI photos for enhance**
  (`ENHANCE_IMG_ADDENDUM`). Enhance projects reach deck-generate as type "create", so
  enhance logic must key off `source.kind === "enhance"`, never `event.type`.
- Real-people photo rule in lib/deck/frame.ts: a slide about a real person/team/brand
  shows their world (stadium, stage, city), never a lookalike or an unrelated metaphor.

**Design styles (biggest change)**
- `lib/design-styles.ts` = the single list: 24 deck styles + Auto = 25 tiles. `label` is
  the English name AND the `DESIGN_STYLE_DIRECTIVES` key in deck-generate.ts (never rename
  without migrating); `key` indexes the dictionary + thumbnail; `photos` auto-enables AI
  photos; `sectors` drive the filter chips.
- New styles: Classroom, Official, Heritage, Luxury, Tech/Glass, Startup, Infographic,
  Hand-drawn, Organic, Retro, Collage, plus 5 education stages: Early Years / KG,
  Primary, Middle School, High School, University Lecture.
- Names, one-line descriptions and a "what it does / best for" guide per style in AR + EN
  (`dict.flows.stylePicker.names / descs / info / sectors`).
- `components/create/StyleThumb.tsx`: illustrated colourful mini-slide per style, RTL
  mirrored. `StyleInfoButton.tsx`: "i" pop-up (hover on mouse, tap on touch, portaled).
- `DesignStyleGrid` (create) + `DesignStylePicker` (datasheet dialog): sector chips
  (All, Education, Business, Government, Marketing, Tech, Creative, Culture, Lifestyle),
  "Show all" gallery. Social styles unchanged.

**Studio / editor**
- Image pill "Replace" is now "رفع صورة / Upload photo"; the failed-AI-photo card has
  "ارفع صورتك / Upload yours" (DeckView `handleUploadForFailed`).
- Phones: while generating with the slides panel closed, the edge arrow sits in a chip
  and nudges (`.tq-edge-nudge` in globals.css).

## Local test checklist before deploying this batch

1. `npm run dev` + `npx inngest-cli@latest dev`; migrate + generate first.
2. /ar/create and /en/create: wide cards, numbered cards, style tab (chips, "i" pop-ups,
   Show all, Arabic names), colour presets, logo zone, photo row. Light + dark.
3. Free account: Generate shows the trial pop-up on create / enhance / mimic; both
   buttons work; closing it does not generate. AI tab in the studio shows the upsell.
4. Enhance with photos ON on a deck with photos + a chart: photos come back as generated
   images, the chart stays a placeholder, text intact. Also with a template.
5. Editor: upload your own photo into a generated photo box (in-well + side panel),
   reload, it stays.
6. Generate one lesson with Early Years, Middle School and High School: decks must feel
   clearly different in age. Report any style whose result doesn't match its thumbnail.
7. Phone view (F12 + Ctrl+Shift+M) during generation: the nudging arrow chip.
8. /ar + /en homepage: "جرّب مجانا" button + "بدون بطاقة ائتمان" line, fold intact.

## Education templates (owner to generate, then save as templates)

Topic for all stages: the water cycle. Prompts were given in chat (2026-10-06); settings:

| Style | Slides | Photos | Font |
|---|---|---|---|
| Early Years / KG | 8 | on | Baloo Bhaijaan 2 |
| Primary School | 10 | on | Playpen Sans Arabic |
| Middle School | 10 | on | Changa |
| High School | 12 | off | IBM Plex Sans Arabic |
| University Lecture | 12 | off | Noto Naskh Arabic |
| Classroom / Academic | 10 | off | Cairo |
| Hand-drawn (topic: كيف تذاكر بذكاء) | 10 | off | Playpen Sans Arabic |

Name templates by stage ("درس المرحلة الابتدائية"), Arabic first, English later.

## Recently shipped (live, 6967b33)

- `/gamma-arabic` comparison page ("A vs B" layout, keyword table in git history of this
  file); request Search Console indexing for `/ar/gamma-arabic` + `/en/gamma-arabic`.
- Referrals (`lib/referral.ts`, migration `20261004120000_referrals`, InviteCard on
  /plans), 48 colour palettes, quiet watermark, Google Fonts catalog search.
- **"Your own template" (قالبك الخاص)** = the mimic flow (URL `/mimic`).
- PowerPoint donut charts: `normalizeSvgPathLength` + `donutCirclesToArcs` in
  `lib/export/html-export.ts`.

## How to add an SEO page (the pattern)

1. Copy a spoke such as `app/[lang]/(marketing)/pdf-to-powerpoint/page.tsx`, which uses
   `components/marketing/FeatureSpokePage.tsx`. Use `gamma-arabic/page.tsx` as the
   model for custom sections.
2. Add the copy as a top-level key in BOTH `dictionaries/ar.json` and `en.json`, with
   meta, hero, why, article, faq. Arabic first, Latin numerals, no em or en dash.
3. Add the path to `app/sitemap.ts`.
4. Add a `SpokeKey` + path in `components/marketing/ExploreMoreSection.tsx`, plus
   `exploreMore.links.<key>` in both dictionaries.
5. Put keywords in the meta title, the h1, the h2/h3 headings phrased as the searcher's
   question, the FAQ questions and the image alts. Use each keyword once or twice; no
   stuffing. Claims about competitors must be verifiable.

## Pending work (owner decides order)

0. **Education push (decided 2026-10-04).** Research in
   `docs/seo-research-education-2026-10-04.md`: per-subject pages do NOT pay off (all 25
   subjects ~600/mo combined). Plan: (a) owner generates 5 lesson decks (math gr8,
   science gr7, chemistry gr10, physics gr10, Arabic gr8; prompts with per-subject
   writing guides were given in chat) and saves them as templates; (b) one
   "ready-made presentations" page (عرض بوربوينت جاهز 720, بوربوينت جاهز 720, عرض تقديمي
   جاهز 480, عروض بوربوينت جاهزة 210, all KD 0-1, SA) showing those templates; (c) a
   teachers' lesson-prep page (تحضير الدروس 260/mo, CPC $2.53); (d) teacher outreach to
   Gulf university e-learning / teacher resource pages; (e) proposed referral program:
   +400 credits to the invitee, 2,000 to the inviter when the invitee PAYS, capped;
   25% recurring 12 months for approved teacher ambassadors via Rewardful/Tolt. Amounts
   not yet confirmed by the owner. Referral needs a schema change: PR + security review.

1. **More SEO pages.** The OpenSEO MCP is NOT available in the cloud: use these numbers
   (Saudi Arabia, monthly searches) and don't invent new ones.

   | Page | Keywords | Monthly | KD |
   |---|---|---|---|
   | Compress PowerPoint | ضغط ملف بوربوينت | ~1,000 | low |
   | Ready-made decks | عروض بوربوينت جاهزة pdf, بوربوينت جاهز | ~2,710 combined | |
   | Templates (check the existing `/presentation-templates` first; may be an upgrade, not a new page) | قالب بوربوينت | 1,600 | 0 |
   | | قوالب بوربوينت | 1,600 | 0 |
   | | تصميم بوربوينت | 480 | 0 |
   | | بوربوينت بالذكاء الاصطناعي | 320 | |
   | Canva in Arabic | كانفا بالعربي | 2,400 | |

   Later: an English Gamma page (English "gamma ai" is 27-33k but navigational, harder),
   outreach emails, opt-in public deck pages.
2. **Ideas raised, not started:** the ready-made presentations page and the teachers'
   lesson-prep page (step 0 above) should showcase the education templates once saved.
   Social styles could get the same Arabic names / info pop-ups / thumbnails treatment.
   Also:  viewer analytics on shared decks (who opened
   it, which slides). This is Gamma's edge and would make a paid-plan feature.
3. **Small fixes, offered but not requested:**
   - Missing space before "في" and after "،" in exported PowerPoint text
     ("مختصةفي", "متقنة،في"). Gamma's export shows the same, so it may come from
     PowerPoint's font rendering. Investigate before claiming anything.
   - "Failed to start extraction" shows in English on the Arabic UI
     (`app/api/extract/route.ts` + `lib/extract/error-codes.ts`).
   - Free image-PPTX export logs both a `png` and a `pptx` activity row.
   - `networkidle` waits in other render paths (same fix as
     `lib/export/render-deck-pdf.ts`).

## Facts worth knowing

- **Credits** (`lib/credits/cost.ts`):

  | Model | Base | Per slide | 8-slide deck |
  |---|---|---|---|
  | sonnet-fast | 160 | 27 | 376 |
  | opus-fast | 460 | 34 | 732 |

  - AI images +10/slide (0 for the free plan, `imageCreditsForPlan`).
  - Auto slide count holds the plan cap, then refunds.
  - Mimic has no surcharge of its own.
  - Admin accounts are not metered (no CreditHold row).

## Owner to-dos (not code)

- Stripe: add a promotion code to the "Yearly offer 10%" coupon; delete the two old
  11.76% coupons (0 redemptions).
- Local account `dev@taqreer.ai` is currently a FREE user for testing; restore admin
  locally with `npx tsx --env-file=.env.local scripts/set-admin.ts dev@taqreer.ai`.
