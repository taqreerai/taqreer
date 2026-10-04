# Handoff: desktop to cloud sessions (updated 2026-10-04)

Read with `CLAUDE.md` (conventions + the "Cloud sessions" rules) and `CONTEXT.md` (full
system reference). This is the working state that used to live only on the owner's
machine. Update it when a task lands or a new one starts.

## State

- **Live (taqreer.ai)** = commit `12136ed`, deployed 2026-10-04. Nothing waiting on `dev`.
- Shipped in that deploy: `/gamma-arabic` in an "A vs B" layout (face-off hero,
  "pick X if" cards, tabbed screenshot pairs that stack below 1024px, comparison grid);
  /create "No template" now reads "تلقائي / Automatic"; /create step 3 card hugs its
  content (`stackedCardVisibility`); the brand/deck font dropdown (`GoogleFontSlot`)
  searches the full ~1,900-family Google Fonts catalog, Arabic-capable first.
- Owner to check: PowerPoint export with a newly selectable Arabic font (e.g. Alexandria);
  request indexing for `/ar/gamma-arabic` + `/en/gamma-arabic` in Search Console.
- The owner works on Windows (Git Bash), not macOS, and is not a developer: give plain
  steps. Cloud branches reach dev via `git pull --no-edit origin <branch>` on the desktop.

## Recently shipped (live)

- **/create**: one "Design" step (template picker, design style, colour presets);
  2 free templates (`Template.isFree`), the rest show the gold premium badge.
- **Studio**: deck-wide recolor (`lib/deck/recolor.ts`) and font change
  (`lib/deck/refont.ts`), deterministic, undoable. Default font Noto Sans Arabic.
  Paid plans default to Opus (`lib/credits/use-default-quality.ts`).
- **"Your own template" (قالبك الخاص)**: user-facing name of the mimic flow (URL stays
  `/mimic`, code says mimic). 3-step wizard in `components/mimic/MimicFlow.tsx`:
  1. content + design reference, in two framed panels
  2. brand
  3. slide size + count, AI images, instructions, then Generate

  The brand card has "ألوان القالب / Template colors" (default): sends no brand colours,
  and `deck-generate.ts` `REFERENCE_PALETTE_ADDENDUM` makes Claude read the reference's
  palette and emit `data-deck-palette` on the cover. "ألوان مخصصة / Custom colors"
  uses the swatches.
- **PowerPoint export, donut charts** (`lib/export/html-export.ts`): Claude draws
  donuts as `<circle>`s with `pathLength="100"` + `stroke-dasharray` percentages.
  PowerPoint ignores `pathLength` and `stroke-dashoffset`, so before export:
  - `normalizeSvgPathLength` rescales the dashes to real lengths
  - `donutCirclesToArcs` redraws each one-arc-per-ring circle as an explicit `<path>` arc

  Verified in PowerPoint on a real deck.
- The free-plan slide-cap hint shows only on /create (the only free flow).

## On dev, waiting for deploy

**`/gamma-arabic` comparison page** (`app/[lang]/(marketing)/gamma-arabic/page.tsx`,
copy in `dict.gammaArabic`, screenshots in `public/compare/*.webp`):
- Same idea (Riyadh specialty coffee shop launch plan) run through Gamma and taqreer.ai,
  exported PowerPoint screenshots side by side, plus a comparison table: colours,
  spacing, design, Arabic mixed with English, charts.
- Keyword targets (Saudi Arabia, monthly, all KD 0), each used once or twice:

  | Keyword | Monthly |
  |---|---|
  | جاما ai | 880 |
  | موقع جاما | 590 |
  | gamma app بالعربي | 480 |
  | جاما اب | 320 |
  | تطبيق جاما | 210 |
  | موقع gamma | 210 |
  | gamma ai بالعربي | 170 |
  | gamma مجاني | 140 |
  | جاما الذكاء الاصطناعي | 140 |
  | جاما بوربوينت | 110 |

  Not an "alternative" page: "بديل gamma" is only ~10/mo.
- Gamma credited honestly for what it does better (documents and webpages,
  embeds, viewer analytics), verified on help.gamma.app. Do NOT credit Gamma
  for English content: taqreer.ai is just as good in English (owner ruling).
- Gamma free plan fact used in the FAQ: 400 credits at sign-up, no refresh
  (help.gamma.app, Oct 2026). gamma.app/pricing blocks automated fetches.
- After deploy, the owner requests indexing in Google Search Console for
  `/ar/gamma-arabic` and `/en/gamma-arabic`.

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

- **On the cloud branch, NOT deployed (2026-10-04 evening):** desktop /create shows
  all 3 cards (xl+); AI images toggle in the settings card, renamed "صور ذكية لمحتواك";
  AI images FREE (0 credits) + default ON for the free plan (imageCreditsForPlan in
  estimate / preflight / settle; free image regen limited to retrying failed boxes);
  48 palettes; quiet free watermark ("Designed with taqreer", 38% opacity, none on
  the cover, NO closing slide: BRANDED_CLOSING_SLIDE=false); free PPTX gets Company
  property + last-slide speaker note; shared-link viewers see no watermark;
  invite-a-colleague referrals (+400 invitee after a passed signup grant, +2,000
  inviter on the invitee's first paid checkout, cap 10/month; schema migration
  20261004120000_referrals; InviteCard on /plans). Needs `npx prisma migrate deploy`
  locally and a dev -> main PR (schema + webhook) before deploy.

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
2. **Product ideas raised, not started:** viewer analytics on shared decks (who opened
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

  - AI images +10/slide.
  - Auto slide count holds the plan cap, then refunds.
  - Mimic has no surcharge of its own.
  - Admin accounts are not metered (no CreditHold row).

## Owner to-dos (not code)

- Stripe: add a promotion code to the "Yearly offer 10%" coupon; delete the two old
  11.76% coupons (0 redemptions).
- Local account `dev@taqreer.ai` is currently a FREE user for testing; restore admin
  locally with `npx tsx --env-file=.env.local scripts/set-admin.ts dev@taqreer.ai`.
