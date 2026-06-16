# Admin / Ops Console - Build Plan

> Status: Phase 0 (static, mock-data console) APPROVED + LOCKED 2026-06-16. UI-first,
> local-first. Next = Phase 2 wiring, one screen per dev->main PR. Living doc.
>
> Locked UX: 4 role-gated screens (Overview, Templates, Users, Broadcast), dark + light
> (globe + tooltip flip too). Overview = a 5-col grid matching the stat row: Online card
> (COBE globe + ranked country list) spans 3; a stacked Traffic-by device/browser/os +
> Users-by-plan column spans 2. Globe = COBE, theme-aware (blue-on-dark / dark-on-white),
> per-country markers tinted toward #3380FF by traffic, fade in/out on spin, freeze on
> hover, list-hover rotates to the country. Templates listed always 16:9 (like /projects).

## Context & goal
Launch Phase C item. Build a role-gated ops console that consolidates: template
curation (featured + premium, manual order), read-only stats, live online-users + a
world map, broadcast notifications to all users, credit grants (specific / all), and
user bans. Premium-template gating folds in here.

**Approach: UI-first, local-first.**
1. Build the ENTIRE console as static screens with mock data (no backend), locally.
2. Revise the UX together in the browser (light/dark, RTL/LTR).
3. Wire each screen to real backends (almost all already exist), one screen per PR.
4. Test locally each step. Only then ship to prod via the normal dev->main PR + deploy.

Almost no net-new plumbing: grants reuse `grantTopup`, broadcasts reuse
`fanOutNotification`, gating reuses the `user-context` pattern + the existing
`User.role` field, curation rewires the existing marquee queries.

## Constraints (this internal console only)
- **English only** - no i18n, no dictionary keys; hardcode English strings.
- **Dark mode only** - no light-mode support or verification.
- Force `dir="ltr"` on the admin shell so it always reads LTR regardless of the URL locale.
- These OVERRIDE the public product's bilingual + light/dark rules wherever this doc
  mentions ar/en, RTL/LTR, or light/dark below.

## Information architecture (4 screens, not 7 pages)
Credits + bans are ACTIONS on the Users screen, not separate pages.
- `/admin` - **Overview**: stat cards + plan split + live online users + world map + recent activity.
- `/admin/templates` - **Curation**: Featured (ordered, draggable) + All-public pool; Premium toggle.
- `/admin/users` - **Users**: searchable list; per-user Grant credits + Ban/Unban; toolbar "Grant all".
- `/admin/broadcast` - **Broadcast**: compose (with bell preview) + send-to-all + history.

Secondary tab nav at the top of the admin area (reuse the settings-page tab pattern /
`SegmentedToggle`). Main sidebar gets one admin-only "Admin" entry linking to `/admin`.

---

## PHASE 0 - Static console (everything, mock data, local only)
No schema, no API routes, no realtime. Real role gate from day one (the field exists).
All data from a typed mock module so the wiring phase swaps the source, not the UI.

### Shell & gating
- Route group `app/[lang]/(app)/admin/{layout,page}.tsx` + `templates/`, `users/`,
  `broadcast/` pages.
- `lib/api/admin-context.ts` (new): `requireAdminPage()` - getUser -> prisma `{ role }`
  -> `notFound()` if `role !== "admin"`. Mirrors dashboard/page.tsx. (Real, used now.)
- `scripts/set-admin.ts` (new): one-off `tsx` to set role=admin by email; run for
  dev@taqreer.ai so the console is reachable in local dev.
- Sidebar (components/app/Sidebar.tsx): admin-only entry. Add `role` to the (app)
  layout's user lookup -> thread `isAdmin` through DashboardShell -> Sidebar -> conditional
  render. English label "Admin" (no dict key).
- `lib/admin/mock.ts` (new): typed mock arrays (users, templates, stats, broadcasts, geo)
  marked TEMP so wiring removes it cleanly.

### Screen specs (static)
**Overview (`/admin`)**
- Stat-card row (`.surface-card`): Total users, Active subs, MRR, Decks generated,
  Credits spent (30d). Number + label + tiny inline-SVG sparkline. Mock numbers.
- Plan split: Free / Plus / Pro / Max counts as a segmented bar.
- Live online card: "N online now" + a lightweight inline-SVG world map shaded by
  country (mock: SA/EG/AE/US...). One blue accent for intensity.
- Recent activity list (`.settings-row` rows): signups / generations / purchases (mock).

**Templates (`/admin/templates`)**
- "Featured" region: ordered, drag-reorderable cards (thumbnail, name, Premium toggle,
  drag handle, Unfeature). Manual order is the product choice.
- "All public templates" pool: grid with Feature action + Premium toggle each.
- Reuse existing template-card visuals + `badge-purple` for the Premium marker.
- Mock: ~12 templates (reuse existing thumbnail URLs where handy).

**Users (`/admin/users`)**
- Toolbar: search (name/email), plan filter, status filter, "Grant credits to all".
- List as `.settings-row` rows (NEVER `<table>`): initial avatar, name+email, plan badge,
  credits balance, signup date, status pill (Active / Banned), actions menu (Grant
  credits, Ban / Unban).
- Grant-credits modal (reuse an existing dialog primitive): amount + reason; target =
  one user or "all". Ban = reuse a confirm dialog. Mock: ~10 users, varied plan/status.

**Broadcast (`/admin/broadcast`)**
- Compose card: title + message, a live preview of the bell notification, "Send to all"
  (with confirm). Open UX q: single message or bilingual ar+en (see Open decisions).
- History list: past broadcasts (title, sent date, recipient count) - mock.

### Reused primitives (do NOT fork)
`.surface-card` / `.settings-card` / `.settings-row`, the settings tab pattern /
`SegmentedToggle`, existing modal + confirm dialogs, `btn-pill` / `btn-gradient`,
`badge-purple`, material-symbol icons, the notification-bell rendering. Charts + world
map = inline SVG only (no new heavy dep). Everything inside Taqreer tokens; check
/ar/brand before designing each surface.

### Phase 0 verify
Connected Chrome on localhost:3000: admin account (after set-admin.ts) sees /admin + the
4 tabs + nav entry; non-admin -> 404 + no nav entry. All screens render with mock data,
correct in light/dark and RTL/LTR. No backend touched.

---

## PHASE 1 - UX revision pass
Iterate on the static screens in the browser until the UX is signed off. Resolve the
Open decisions below. No wiring until this is done.

---

## PHASE 2+ - Wiring (one screen per dev->main PR; security-review on the write ones)
Each: swap mock -> real data, keep the reviewed components; lint + tsc; local browser
test; then PR (CodeRabbit) + `./deploy.sh`.

**W-Templates**
- Schema: `Template.featuredOrder Int?` (null = not featured; int = manual order) + index.
  Migration backfills featuredOrder for current dev@taqreer.ai public templates by
  publishedAt so landing/marquee are unchanged at cutover.
- Rewire `lib/auth/marquee-projects.ts` (getMarqueeColumns + getLandingTemplates): replace
  the `u.email = MARQUEE_OWNER_EMAIL AND isPublic` filter with `featuredOrder IS NOT NULL`,
  `ORDER BY "featuredOrder"`. Bust the `auth-marquee-columns` cache tag on each write.
- `PATCH /api/admin/templates/[id]` (isPremium, featured on/off) + reorder endpoint.
  Premium enforcement at use-time already returns 402 (templates/[id]/use); no change.

**W-Users + credits + bans**
- Schema: `User.bannedAt DateTime?` (+ optional `banReason String?`).
- Users list query (plan, status, signup) + balance via `getBalance` (lib/credits/server.ts).
- Grant: `POST /api/admin/credits/grant` -> `grantTopup({ userId, credits, sourceKey:
  "admin-grant:<uuid>:<userId>", notify:true })`, mirroring the Stripe webhook call;
  grant-all loops users (tiny volume). Idempotent + audited in UsageEvent. No Free block.
- Ban: `POST /api/admin/users/[id]/ban` (+ unban) sets bannedAt. Enforce in (1)
  app/[lang]/(app)/layout.tsx after getUser -> redirect `/banned`; (2) resolveUserContext /
  admin-context -> 403 so a banned session can't mutate. Local flag only (Supabase has no
  native reversible ban). Optionally revoke the Supabase session.

**W-Broadcast**
- Add `admin.broadcast` notification type + bell rendering. `POST /api/admin/broadcast`
  -> loop all user ids, `fanOutNotification` per user (lib/notifications/server.ts; emits
  on `user:{supabaseUserId}`). Validates the currently-untested fan-out path end-to-end.
  History: derive from the broadcast Notification rows, or a small AdminBroadcast model.

**W-Overview / stats / live users + map**
- Stats: Prisma aggregates over User.plan, Project/Presentation, UsageEvent/ledger,
  Subscription (tier + MRR).
- Live users: Supabase Realtime presence on a shared authed channel (reuse realtime +
  token mint), or a last-seen heartbeat.
- Geo: capture `CF-IPCountry` (free, Cloudflare sets it per request - the site IS behind
  Cloudflare) at login/session -> aggregate by country -> feed the same map component.
  Alt: Cloudflare GraphQL Analytics API (needs a CF API token). Decide at this step.

All admin write endpoints go through `requireAdminApi()` (403) + `/security-review`.

---

## Schema changes (wiring only, not Phase 0)
- `Template.featuredOrder Int?` (+ index) - W-Templates.
- `User.bannedAt DateTime?` (+ `banReason String?`) - W-Users.
- Optional `AdminBroadcast` model for history - W-Broadcast (or reuse Notification rows).

## Not in scope of this console (tracked separately)
Inngest concurrency caps + the Cloudflare `CF-Connecting-IP` rate-limit correction
(PR #74) ship independent of this console.

## Local build + test + ship workflow
- Phase 0 + 1 entirely local (`npm run dev` :3000, connected Chrome). Nothing to prod.
- Each wiring PR: lint + tsc, security-review (writes), local browser test (light/dark +
  RTL/LTR), then dev->main PR for CodeRabbit, then `./deploy.sh`.

## Open UX decisions (resolve in Phase 1)
- Broadcast: single message, or bilingual ar + en fields?
- Live users: "online now" (realtime presence) or "active in last N min" (heartbeat)?
- Geo map: choropleth vs dotted points; country-granularity from CF-IPCountry.
- Templates: feature from ANY public template, or only the curator account's?
- Grant-all: a confirm + a sanity cap (max amount) to prevent a fat-finger mass-grant?

## Critical files
- New: lib/api/admin-context.ts, scripts/set-admin.ts, lib/admin/mock.ts,
  app/[lang]/(app)/admin/{layout,page,templates,users,broadcast}.tsx, app/api/admin/*.
- Edit: components/app/Sidebar.tsx + app/[lang]/(app)/layout.tsx + DashboardShell (nav),
  lib/auth/marquee-projects.ts (curation), prisma/schema.prisma (+ migrations),
  dictionaries/{ar,en}.json (admin keys, parity).
- Reuse: lib/credits/server.ts (grantTopup, getBalance), lib/notifications/server.ts
  (fanOutNotification), lib/realtime/* (presence/emit), lib/api/user-context.ts.
