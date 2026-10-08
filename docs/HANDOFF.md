# Handoff: cloud to desktop (updated 2026-10-08)

Read with `CLAUDE.md` (conventions + the "Cloud sessions" rules) and `CONTEXT.md` (full
system reference). This is the working state between sessions. Update it when a task
lands or a new one starts.

## State

- **Live (2026-10-08): `main` = `55f3507`** (after PR #208 `41b9d2d`): everything below marked "NOT live
  yet" / "NOT committed yet" in the 2026-10-07 section is now live.
- Earlier: `e6bcf86`. Everything in "Batch on dev, 2026-10-06"
  below is live too (deployed 2026-10-07), plus the Oct 7 items in the next section.
- **Checkout crash fixed (2026-10-07, `759a4ba` + `e6bcf86`):** Stripe's checkout threw
  "fonts should be used in elements()" (Sentry TAQREER-13) and the page fell to the
  global error screen. Fonts are no longer passed to the checkout; `CheckoutBoundary`
  and per-group `error.tsx` keep any future crash inside the card / the app frame.
  Mark TAQREER-13 resolved once a live checkout loads.
- **`main` = commit `4c419db`** (pushed 2026-10-05 by deploy.sh). It contains the whole
  2026-10-05/06 cloud batch (34 commits from `claude/awesome-cannon-uay51e`, listed
  below), now merged into `dev`. Confirm on taqreer.ai/ar: the "جرّب مجانا" button with
  "بدون بطاقة ائتمان" under it means the batch is live.
- The batch included the **data migration** `20261005120000_free_trial_unlock` (free
  tier: all flows, slideCap 30, configVersion bump), applied by deploy.sh on the server.
- `/security-review` was NOT run on this batch (only quick self-checks). Prompt-pipeline
  edits (styles, enhance photos, real-people rule) and the AI-edit gate qualify; run it
  after the fact.
- The owner works on Windows (Git Bash), is not a developer: give plain steps.

## 2026-10-07: every creation tool is a 2-step wizard

- **/create (live, `3d23809` `53a62e8` `e76e2af`):** 2 steps instead of 4, each one wide
  card + one narrow card (`WizardStage` / `SplitStep` / `WizardCard` / `DesignCard` /
  `BrandCard` in `components/create/wizard.tsx`). Step 1 = content + presentation
  settings, step 2 = design + brand, Generate on step 2. No step rail, no hint line, no
  "Or try" row; Next reads "التالي: الشكل". On desktop (`stage:` variant, >= 1180px wide
  and >= 640px tall) the page is exactly one viewport (`.tq-wizard-fit` in globals.css):
  the page never scrolls; colour templates show the rows that fit + "عرض الكل" (template
  and style grids scroll again since the follow-up below). Phones and short windows scroll, the sticky bar keeps Next on
  screen. Brand card: font, logo, colours, "save as default" at the bottom. Slide size =
  two picture tiles (`SlideSizeFields big`). "قالبي" tag removed from template tiles.
- **Studio (live, `2b98d46` `be305fa`):** first open no longer clips the slide; it stays
  hidden until its size settles, then fades in.
- **Enhance, mimic, social on the same layout (on dev, NOT live yet):**
  - enhance: 1 = your deck (wide) + instructions and AI photos (narrow); 2 = templates /
    styles + brand.
  - mimic: 1 = your content (wide) + size, count, AI photos, instructions (narrow);
    2 = design reference (wide; template mode shows the locked template) + brand (Auto =
    the reference's colours, via `BrandCard autoLabel/autoHint`). Next needs content
    only; Create still waits for the reference.
  - social: 1 = topic, product photo, persistent element (wide) + platform / size,
    count, AI photos (narrow; ratio tiles 2 per row, `SocialFormatFields twoColumns`);
    2 = social styles (`SocialStyleGrid fit`, 2 rows then "عرض الكل") + brand.
  - mimic's instructions box sits under the reference deck on step 2 (the settings card
    did not fit 1280x640 with it).
  - Guest drafts saved with the old step numbers clamp to the new last step.
- **Tool switcher on all four wizards (on dev, NOT live yet):** `FlowSwitcher` (Create /
  Enhance / Your own template / Social, current one marked) via `WizardHead tool=`,
  under the title, right above the cards (owner pick; the top-bar row looked cramped).
  Style `.tool-tabs` / `.tool-tab` in globals.css: the design-tabs track, current tool
  = raised surface chip with a blue icon (not a blue fill, so it never competes with
  Create). Under 720px tall the subhead hides and the column gaps tighten
  (`stage-tight:`); phones show icons only for the other tools.
- **Template and style grids scroll again (owner direction 2026-10-07):** on a desktop
  stage the template / style / social-style grids render every tile and scroll inside
  the Design card (`useFitCount` returns null for a scrolling box). Colour templates
  keep the no-scroll rows + "عرض الكل". Phones still cap at 4 rows + "Show all".
- **8 more social styles (on dev, NOT live yet, owner request 2026-10-07):** Quote Card,
  Text Post, Heritage Pattern, Luxury Noir, Tech Glow, Doodle Notes, Scrapbook, Step by
  Step (19 tiles with Auto). Each = `SOCIAL_STYLES` entry (DesignStylePicker), an
  illustrated `SocialStyleThumb` case, `socialDescs` in both dictionaries and a
  directive in `DESIGN_STYLE_DIRECTIVES` (deck-generate). Labels differ from the deck
  styles on purpose. Prompt-pipeline edit (static text only): run `/security-review`.
  Not yet tested: a real generation with each new style.
- **Email sign-up keeps the visitor's work (2026-10-07, NOT committed yet):** the
  confirm-signup email always linked to /dashboard, so a visitor who signed up at
  Create lost their setup (and on another device the draft isn't there at all).
  - The confirm screen on /signup now takes the emailed 6-digit code
    (`verifyOtp({ email, token, type: "email" })`) and continues in the same tab
    to `next` (e.g. /create?resume=generate). It also polls the session every 4s
    and on focus, so confirming via the link in another tab moves this tab on.
  - The email shows `{{ .Token }}`; its button link is unchanged. The return
    target travels as the account's `resume_to` metadata (set by the /signup form),
    read by `/confirm` for type=email through `safeNextPath` (shared in
    `lib/auth/safe-next.ts` with /callback). A first try put `{{ .RedirectTo }}` in
    the link; the nested URL sent the email to junk in Outlook, so it was dropped.
  - Supabase's code length is 6 to 10 digits (no 4). Set "Email OTP Length" to 6.
  - The creation tools' sign-up window IS the /signup form now (`components/auth/
    SignupForm.tsx`, shared with the page): same `.auth-modal` panel, copy, steps and
    fine print, with the tool's own heading ("first 5 slides" / "first 3 posts") and
    the "setup is saved" line. The whole sign-up, code included, happens in the window;
    it finishes with a full load of /<flow>?resume=generate. A "fastest, no
    confirmation email" hint sits under Google on both. The code screen keeps the
    "check your junk folder" line (Outlook junks our auth mail; owner chose to leave it).
  - **Owner step:** paste the new body from `docs/auth-emails/PASTE-INTO-SUPABASE.md`
    (section 1) into Supabase, Authentication -> Emails -> Confirm signup, BEFORE
    deploying (the old site ignores the new parts, so pasting first is safe).
- **Social: at least 5 posts, free shows 3 (2026-10-07, NOT committed yet):**
  `SOCIAL_MIN_POSTS` 5 and `SOCIAL_TEASER_VISIBLE` 3 in `lib/credits/cost.ts`
  (`teaserVisibleForFlow`). The route clamps a social count to >= 5, plans the teaser
  with 3 visible (held and charged) and the rest locked; auto social briefs carry
  `slideCountMin` ("Author AT LEAST 5 slides"). Stepper min 5; the free-trial pop-up
  says posts on /social.
  2026-10-08: auto social aims for 6 to 8 posts (`SOCIAL_AUTO_AIM`, brief
  `slideCountAim`), longer only when the content lists more points; a free auto
  carousel plans 7 (`SOCIAL_TEASER_DEFAULT_TOTAL`: 3 built + 4 locked) instead of 10.
- **Unlocked decks exported only the free slides (fixed 2026-10-08, live in `6b7c61c`):**
  the first generation auto-saves the teaser version as `savedVersionId`; deck-unlock
  moved only `currentVersionId`, and PNG / PDF export, thumbnails and the library read
  `savedVersionId` first. deck-unlock now moves the saved pin too. Decks unlocked before
  the fix: `scripts/fix-unlocked-saved-version.ts` was run on production 2026-10-08
  (2 of 4 unlocked decks repaired). Their dashboard thumbnails may still show the old
  version until re-rendered.
- **Enhance file swap left Next disabled (fixed 2026-10-08, live in `fab9ad8`):**
  picking a second file without removing the first ran the old extraction effect's
  cleanup AFTER `validateAndSetFile` reset `pollCancelledRef`, so the new poll read
  "Cancelled" and fell back to idle silently. The cleanup now only aborts its own run,
  and a superseded run no longer touches the stage. Seen with a visitor whose first
  file was over 100 pages. Mimic / create use the abort signal only (not affected).
- **Carousel playbook for every social post (2026-10-08, live in `6fe4a23`):**
  `SOCIAL_PLAYBOOK` in `lib/deck/frame.ts` (social persona only): pick the format from
  the topic (tips, how-to, product, myth/fact or before/after, story, insight,
  announcement), hook card 1 (8 words), card 2 delivers alone, one idea per card
  (8-word headline, ~25 words), one layout across the series, one CTA last, no deck
  habits (chapter dividers, agenda, thank-you, "01 / 07"), no invented facts / numbers
  / testimonials, stay on the subject (images never show another item of the same
  kind; use and care fit the real item). The user's explicit input always wins. Social
  replaces the deck 50-90 word budget with a card-fit rule. Product photo: the CTA card
  shows the product; unmarked boxes show no product of the same kind.
  Found with it: unlock / partial regen / bake keyed the social persona off the 3:4
  format only, so a 4:5 carousel's unlocked posts were written as DECK slides (the bag
  test: posts 1-3 fine, 4-10 deck-like). All jobs now use `frameKindFor` (project type
  social, or a social format), same as generation.
- **Auto font (2026-10-08, live in `55f3507`):** the font picker on create / enhance /
  social starts on "تلقائي" (googleFamily null). `/api/projects` resolves it with
  `pickAutoFont` (lib/brand/auto-font.ts): design style -> family (instant), else a
  3 s Haiku pick by topic, else Noto Sans Arabic. List (owner-approved): Noto Sans
  Arabic, Cairo, Noto Naskh Arabic, Markazi Text, Lemonada for every flow; Reem Kufi,
  Lalezar, Aref Ruqaa for social only (short text). A user pick, a brand kit font or an
  upload always wins. Mimic, template runs, the brand kit editor and datasheet keep
  Noto (`defaultBrandFont`).
- **Now unused (delete or reuse, owner to decide):** `DesignStep` and `BrandStep` in
  `wizard.tsx`, `WizardHead`'s rail / hints props, the `flows.wizard.hints.*` strings.

## Batch on dev, 2026-10-06 desktop session (live since 2026-10-07)

- **/create redesign (superseded by the 2-step wizard above):** a 4-step wizard, full
  width, sticky Back / Next bar (`.tq-wizard-bar`; the panel switches to
  `overflow: clip` only on pages that carry it). Templates: big grid, hover flips
  through the slides, eye button opens a preview window (`/api/templates` now sends
  `thumbnails` + `slideCount`).
- **Visitors before sign-up (lazy registration):** `/create` and `/enhance` live in the
  new `app/[lang]/(open)` group (NOT `(studio)`: that is the deck studio + public
  viewer and keeps its own layout) (guest frame `GuestTopBar` when signed out, the normal
  shell when signed in; `ensureAppUser` there does the Prisma row + signup grant like
  the dashboard, `SignupConversion` mounted too). Nothing paid runs for a visitor:
  files stay in the browser, template setup + extraction wait for sign-in. Draft per
  flow in `lib/create/guest-draft.ts` (localStorage + IndexedDB, 24h). Create opens
  `GuestSignupDialog`; the return is `/<flow>?resume=generate`, which restores the
  draft and presses Create by itself (`GenerateSplitButton autoStart`, trial pop-up
  first). Public `GET /api/templates` (approved public rows only, rate-limited).
- **Auth callback** now honours a safe `next` (it always went to /dashboard before, so
  Google + email-confirm users ignored `next`). Rejects `//`, backslashes, auth pages,
  and dot-segment tricks (`/a/..//evil.com`).
- **Free CTAs:** homepage + feature pages -> `/create`; Redesign page -> `/enhance`;
  Presentation style -> signup?next=/mimic; Social posts -> signup?next=/social; free
  pricing card -> `/create`.
- **Enhance free trial:** no page-cap block for free users up to 100 pages (soft note
  instead); deck-generate sends only the first 5 page images on a teaser run and text up
  to the planned total (`inngest/functions/deck-generate.ts`), so long files cost the
  same as short ones. Mimic keeps its block (it sends the whole file as one document).
- **Enhance photo slots:** enhance never keeps the user's own pictures (asset
  extraction removed 2026-05-25), so a source photo / map / screenshot becomes a
  `<div data-photoslot>` placeholder; the studio shows "Upload your picture" on it
  (`PhotoSlotOverlay`). With AI photos on, maps / screenshots / real places are never
  generated. Older decks have plain placeholders (no button). Next: bring the user's
  real pictures back in enhance (pending item).
- **Free badge placement:** `pickBadgeCorner` (lib/export/free-branding) measures the
  slide's text + pictures and moves the badge to a free corner (default bottom corner,
  other bottom, then top). Used by the studio overlay, the PDF / PNG export (run in
  headless Chrome from its source text, with a `__name` stand-in) and the editable
  PPTX (picture + link shape). Plus a prompt line: the reserved corner overrides a
  source layout's footer.
- **Local sign-up testing:** local uses the LIVE Supabase auth. Add
  `http://localhost:3000/**` to Supabase Redirect URLs, use a fresh private window per
  test account (one signup grant per browser, 3 per IP per day), comment out
  `NEXT_PUBLIC_GOOGLE_ADS_ID` while testing, delete test users in Supabase afterwards.

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

## Last batch: what changed (shipped in 4c419db)

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

## Test checklist for this batch (run on live if not done locally)

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

## Shipped before that (6967b33)

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

000. **Excel / CSV upload in /create (decided 2026-10-06, owner).** The separate
    /datasheet tool has no search demand (OpenSEO, Saudi Arabia: "تحويل اكسل الى
    بوربوينت" unmeasurable; "رسم بياني" 2,900 is graph-paper / school intent; US
    "excel to powerpoint" 170). It stays unlisted (not in the sidebar or dashboard). Plan: let /create's upload accept .xlsx/.csv and reuse the
    datasheet parser (/api/datasheet/parse, source kind "data") so a spreadsheet
    makes a chart deck inside the main tool. Check first that deck-generate handles
    it cleanly. Retiring /datasheet is a separate decision.

00. **Raised 2026-10-07, not started:**
    - **Login redirect loop (permanent fix).** A stale auth cookie for a deleted user
      loops: proxy.ts trusts `getSession()` (cookie only) while the layouts use
      `getUser()` (verified), so they disagree and bounce. Clearing cookies fixed it for
      the owner; real users can hit it too. Auth change: PR + security review.
    - **Outlook junks our auth emails** (SPF/DKIM/DMARC all pass, SCL 5). Fix the
      `send.taqreer.ai` MX (points to smtp.google.com; Resend wants
      `feedback-smtp.eu-west-1.amazonses.com`, priority 10) so the Return-Path aligns;
      optionally drop the hidden preheader + Google Fonts import from
      `lib/email/shell.ts`. Owner chose to leave it for now (junk-folder hint shown).
    - **GA4 shows zero organic visits** while Search Console has ~96 clicks / 28 days:
      check the GA4 setup / consent handling.

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
