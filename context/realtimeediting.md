# Realtime Editing — Phase 16 Plan

Working doc for **Phase 16 (Supabase Realtime)**. Branch: `dev`. Owner:
Osama. Drafted 2026-05-23 right after Phase 15 (sharing) shipped — see
`plan-share.md` for the role/access foundation this phase builds on top
of.

## Intent (from user, paraphrased)

> Two collaborators on the same project should see each other live.
>
> 1. Each viewer's avatar appears on the top-start corner of the slide
>    thumbnail they're currently focused on, inside `SlideNavSidebar`.
>    Multiple viewers on the same slide overlap their avatars like
>    stacked planets.
> 2. If a viewer's tab is hidden, their avatar dims.
> 3. Comments, partial regens, and full deck regens fire **persisted**
>    bell notifications for every collaborator with role ≥ comment.
> 4. The same events update the canvas in real time — comments appear
>    without refetch, slides flip into the regenerating blur overlay
>    while another viewer is regenerating them.

## Locked architectural decisions

| Question | Answer |
| --- | --- |
| Whose avatars render on thumbnails? | **Only other viewers.** Self is filtered out — the user already sees their own focus via the active thumbnail border. |
| Bell persistence? | **Persisted** — new `Notification` Prisma model. Unread count survives refresh; bell history scrollable. |
| Live regen viz on other viewers' screens? | **Same blur overlay** the kicker already sees. Unified UX; reuses existing CSS. |
| Single channel or split? | **One channel per project** (`project:{projectId}`) carrying both presence + Postgres-Changes subscriptions. |
| Source of truth for events? | **Server-emitted Broadcast** from our API routes / Inngest steps, NOT Postgres Changes. Reason: per `project_local_dev.md` our data lives in docker-compose Postgres (`localhost:5432`); Supabase Postgres is auth-only. Postgres Changes can't see our tables. |
| Realtime payloads carry what? | **Only pointers** (`commentId`, `slideId`, `actorUserId`), never sensitive content. Clients dereference via existing REST routes which already enforce `resolveProjectAccess`. |
| Channel auth? | Gate subscribe via a short-lived `/api/projects/[id]/realtime-token` that calls `resolveProjectAccess(view)` first. Clients without access never get the channel; data access is still REST-gated as the second layer. |
| Self-actions in the bell? | **Filtered out.** Don't notify yourself about your own comment / regen. |

## Roles + reach (inherited from Phase 15)

```text
view  <  comment  <  edit  ≤  owner
```

- `view` invitees subscribe to presence + comments + regen status — they
  can see what's happening but the bell shows nothing they're allowed
  to act on (no bell entries for view-only).
- `comment` invitees + `edit` invitees + `owner` get full bell + live
  canvas updates.

## Phase breakdown

Each phase is independently shippable.

### Phase 16.A — Channel foundation (Broadcast + Presence only)

NOTE: No Postgres Changes, no RLS, no publication setup. Our Prisma
tables live in docker-compose Postgres which Supabase Realtime cannot
see. We use Supabase Realtime as a pure socket service.

- [x] `lib/realtime/project-channel.ts` — opens
      `supabase.channel("project:{projectId}", { config: { presence: { key: userId } } })`,
      tracks presence on join, returns
      `{ presenceState, on(event, cb), broadcast(event, payload), unsubscribe }`.
- [x] `lib/realtime/supabase-browser.ts` — singleton browser Supabase
      client. `lib/supabase/client.ts` already exports `createClient()`
      but instantiates a fresh client per call; wrap it in a module-
      scoped singleton so the same socket is reused across hook calls.
- [x] `lib/realtime/server-broadcast.ts` — server-side helper
      `broadcastToProject(projectId, event, payload)` that opens a
      transient Supabase client with the service role key, sends one
      broadcast message, and disconnects. Used by API routes + Inngest
      step bodies after successful writes.
- [x] `app/api/projects/[id]/realtime-token/route.ts` — GET endpoint
      that runs `resolveProjectAccess(view)` and returns
      `{ channel: "project:{id}", joinable: true }` on success, 403/404
      otherwise. Clients call this BEFORE subscribing. Token-gating
      itself isn't really needed since the channel name is the
      projectId (which clients already know), but the gate gives us a
      clean "should I even open a socket" check + an obvious place to
      add stricter signed JWTs later if we tighten security.
- [x] Smoke test: open two tabs of `/project/[id]`, fire a manual
      broadcast from one via the browser console (`channel.send({
      type: "broadcast", event: "ping", payload: {} })`), confirm the
      other tab's `on("broadcast", { event: "ping" })` handler logs.

### Phase 16.B — Presence: avatars + tab-out dim

- [x] On `DeckView` mount, track presence payload
      `{ userId, name, avatar, slideIndex, tabActive: !document.hidden }`.
- [x] `useEffect` for `visibilitychange` → re-track with flipped
      `tabActive`. Throttle to one update per 200 ms.
- [x] On `focusedIndex` change → re-track with new `slideIndex`.
- [x] New `components/preview/SlidePresenceAvatars.tsx`:
      - Props: `viewers: PresenceViewer[]` (already filtered to this
        slide and to NOT-self by caller).
      - Renders up to 2 avatars overlapping, then `+N` glass chip if
        more. Stacked with `margin-inline-start: -8px` to overlap.
      - Single avatar = circle with image OR fallback initial on a
        per-user hue (`color-mix(in oklab, var(--tq-blue) 70%, white)`).
      - `tabActive=false` → `opacity: 0.4`, no transition (instant).
- [x] Mount inside `SlideNavSidebar` thumbnail at top-start corner
      (absolute, `top-1 start-1`). Pointer-events: none — never blocks
      the thumbnail click.

### Phase 16.C — Live comments via Broadcast

- [x] `POST /api/projects/[id]/comments` after the Prisma INSERT calls
      `broadcastToProject(projectId, "comment.created", { commentId, slideId, actorPrismaUserId })`.
- [x] `DELETE /api/projects/[id]/comments/[commentId]` after the Prisma
      DELETE calls `broadcastToProject(projectId, "comment.deleted", { commentId, slideId, actorPrismaUserId })`.
      `authoriseProject` extended to surface `slideId` + `callerPrismaUserId`
      BEFORE the delete so we have the broadcast payload when the row's gone.
- [x] `DeckView` subscribes via the same channel handle that presence
      uses. On `comment.created` it GETs
      `/api/projects/[id]/comments?ids={commentId}` (new query-param,
      filters with a `^[a-zA-Z0-9_]+$` whitelist and 64-char cap) and
      merges into local state. De-dup by id; skips broadcasts whose
      `actorPrismaUserId === currentUserId` to avoid echoing our own
      POST back into state.
- [x] On `comment.deleted` drop by id from local state (same self-echo
      skip).
- [x] `HeroCommentOverlay` markers + `CommentsPanel` list already
      consume the same `comments` state — no duplicate subscriptions
      needed.
- [x] Initial GET on DeckView mount kept as the seed. No open-comment-
      mode refetch effect existed to remove — turned out to be a
      ghost item from a pre-Phase-15 doc; the existing fetch only
      runs once on mount with deps `[projectId, status, presentationId, canComment]`.

### Phase 16.D — Live regen status via Broadcast

- [x] `inngest/functions/deck-regenerate-partial.ts` — two new
      `step.run` blocks: `broadcast-regen-started` (Promise.all over
      `targetSlideIds`, emits `slide.regen.started` per id) at entry
      and `broadcast-regen-finished` at function exit. `RegenPartialEvent`
      type extended with optional `actorPrismaUserId`.
- [x] `inngest/functions/deck-generate.ts` — same shape with
      `deck.regen.started` at entry, `deck.regen.finished` at exit.
      Always emits — initial-create has no listeners so it's a no-op
      there. `DeckGenerateEvent` type extended with optional
      `actorPrismaUserId`.
- [x] Five route dispatches updated to include `actorPrismaUserId:
      access.user.prismaId` in the event payload:
      `/api/projects/[id]/regenerate-partial`,
      `/api/projects/[id]/slides/[slideKey]/regen`,
      `/api/projects/[id]/regenerate`,
      `/api/projects/[id]/retry`,
      `POST /api/projects` (initial create — uses the prisma user id
      already resolved in the transaction).
- [x] `DeckView` listens for `slide.regen.started` — sets the new
      `remoteRegenSlideIds: Set<string>` state. The derived
      `isFocusedRegenerating` flag now reads from EITHER local
      `applying` (actor's tab) OR `remoteRegenSlideIds.has(...)`
      (observers). Same dim+spinner overlay renders without any
      change to the existing render code.
- [x] On `slide.regen.finished` clears from the set + calls
      `router.refresh()` — Next re-runs the page's server data fetch
      and the new slide content lands. Cheaper than wiring a
      manifest-refetch endpoint specifically for the broadcast path.
- [x] On `deck.regen.{started,finished}` calls `router.refresh()` —
      the page's status-based route gate (`/project` ↔ `/preview`
      redirect) auto-handles the navigation. Observers on `/project`
      jump to `/preview` when a full-deck regen starts and back to
      `/project` when it finishes.
- [x] Self-echo skip in all four handlers (`actorPrismaUserId ===
      currentUserId` returns early) so the actor's tab doesn't
      re-trigger router.refresh on its own click — their apply-poller
      already picks up the new version smoothly.
- [x] Polling fallback decision — kept the existing apply-poller for
      the actor's tab; for observers the broadcast IS the only signal.
      The visibility-regain refetch in DeckView (added 2026-05-24)
      covers the "tab was backgrounded, broadcast missed" Safari case.
      No separate 30-s fallback poll needed.

### Phase 16.D revisions (2026-05-24)

Changes to the originally-shipped 16.D shape, not regressions:

- **`.started` broadcasts REMOVED entirely** from both
  `deck-generate.ts` and `deck-regenerate-partial.ts` — the live
  dim+spinner overlay on observers' canvases competed with whatever
  they were doing during the regen window. New shape: observers
  stay silent on the previous version until `.finished` fires; the
  `remoteRegenSlideIds` state in DeckView was removed alongside.
- **`router.refresh()` in broadcast handlers REPLACED with
  in-place state swap.** Per user direction "anything realtime
  should not reload the page". `slide.regen.finished` +
  `deck.regen.finished` handlers now fetch
  `/status?includeManifest=true&includeSlideStates=true` (one
  round-trip) and call `setManifest` + `setSlideStates` +
  `setHistoryVersions`. No SSR refresh, no flicker.
- **Broadcasts fire-and-forget** (`.catch(logger.warn)`) — earlier
  shape used `step.run` which blocked the Inngest function when
  `admin.removeChannel(channel)` deadlocked waiting for a graceful
  close. `broadcastToProject` got a 3-s overall timeout wrapper to
  bound the failure mode.
- **`actorPrismaUserId` self-echo skip path** stays the same — the
  actor's tab already has the new version via the apply-poller's
  `setManifest` from `/status?versionId=...`.

### Phase 16.D.5 — Lock/unlock as realtime broadcast (added 2026-05-24)

Not in the original plan; emerged from the user-experience surface
during 16.D work. Lock-pill state needed to flip in lockstep across
collaborators (peer locks a slide → other tabs' pills grey out the
Comment button live).

- [x] `slide.lock.changed { slideKey, lockedAt, actorPrismaUserId }`
      broadcast event added to `ProjectBroadcastEvent` union.
      Single-slide lock route (`POST /api/projects/[id]/slides/[slideKey]/lock`)
      emits after the upsert.
- [x] `slides.locks.bulk-changed { allLocked, lockedAt, actorPrismaUserId }`
      for the lock-all route. One event for the whole deck (vs. N
      per-slide events) to avoid socket spam on a 20-slide deck.
- [x] DeckView listeners update `slideStates[slideKey].lockedAt` from
      the payload directly (no fetch — payload carries the canonical
      ISO). Self-echo skip on both.
- [x] **Bell notifications NOT wired** for lock events. User decision:
      "no need for lock notifications, it happens in realtime". The
      lock pill is the realtime signal; a bell entry would just be noise.

### Phase 16.E — Notification table + bell (plumbing complete 2026-05-24, end-to-end UNTESTED — resume here)

Built shape diverged from the original plan in a few places. Diffs
called out inline below.

- [x] Prisma migration `20260524003918_add_notifications`. Final
      schema differs from the spec above in three places:
      ```prisma
      model Notification {
        id              String   @id @default(cuid())
        recipientUserId String   // prisma User.id
        type            String   // free-form string, not enum — see note
        payload         Json
        projectId       String?  // optional now (account-scoped events)
        actorUserId     String?
        createdAt       DateTime @default(now())
        readAt          DateTime?
        recipient User    @relation("RecipientNotifications", fields: [recipientUserId], references: [id], onDelete: Cascade)
        actor     User?   @relation("ActorNotifications", fields: [actorUserId], references: [id], onDelete: SetNull)
        project   Project? @relation(fields: [projectId], references: [id], onDelete: Cascade)
        @@index([recipientUserId, createdAt(sort: Desc)])
        @@index([recipientUserId, readAt])
      }
      ```
      Three deviations: (a) `type` (not `kind`) is a **free-form
      string** rather than an enum — new event kinds shouldn't force
      a migration; unknown types fall back to a generic renderer.
      (b) `projectId` is **nullable** so account-scoped events
      (`share.invited` to a user pre-membership, etc.) can write a
      row without a project context. (c) Primary index sorts
      `createdAt` DESC explicitly so the bell's
      newest-first query reads from the index without an extra sort.
- [x] Server-side fan-out helper `lib/notifications/server.ts`
      (NOT `lib/notifications/fan-out.ts` per the spec — file name
      drift, function is `fanOutNotification`). Resolves project
      members from `Project.userId` + accepted `ProjectShare` rows
      (`acceptedAt != null AND userId != null`). **Role-≥-comment
      filter dropped** — every project member regardless of role gets
      bell entries (view-only viewers care about peer activity too;
      the bell payload is pointer-only so no view-only PII leak).
      Self-echo skip default-on with `allowSelfEcho: true` opt-out
      for `deck.generate.finished` (actor IS the recipient there).
      Plus a feature not in the spec: **10-minute grouping window**
      on `(recipientUserId, type, projectId, actorUserId)`. Merges
      slideKeys arrays, bumps `createdAt` + clears `readAt` so the
      merged row floats up + re-unreads. Saves the bell from N rows
      when a peer rapid-fires N comments on the same project. Per-
      recipient `try/catch` so a single recipient's write blip doesn't
      skip the rest.
- [x] Call sites — final mapping:
      - `POST /api/projects/[id]/comments` → `comment.created` (project
        members minus actor)
      - `inngest/functions/deck-regenerate-partial.ts` → `slide.regen.finished`
        per slide (grouped by the merge window — "X redesigned 3 slides")
      - `inngest/functions/deck-generate.ts` (finished) → both
        `deck.regen.finished` (project members minus actor) AND
        `deck.generate.finished` to **the actor only** with
        `allowSelfEcho: true` (you kicked it off, you should be told
        it finished even if you navigated away)
      - `POST /api/projects/[id]/share` → `share.invited` to the
        **invitee only** (recipientUserIds override). Guarded on
        `prisma.user.findUnique({ where: { email } })` — first-touch
        email-only invites SKIP the bell since there's no User row
        yet to write to (the email IS the primary delivery channel
        for those).
      - `POST /api/invitations/[token]/accept` → `share.accepted`
        to the project owner. Gated on `firstTimeAccept` so re-
        clicking the same accept link doesn't re-notify.
      - **Lock events are NOT wired** to the bell per user direction
        — lock state is realtime via `slide.lock.changed` broadcast,
        no bell entry needed.
      - **`deck.generate.failed` NOT wired** — needs an Inngest
        function watching `inngest/function.failed` events.
        Deferred — `deck-generate.ts` doesn't currently surface a
        failure callback point.
- [x] API:
      - `GET /api/notifications` — last 50 by `recipientUserId`,
        server formats each row into the bell's existing
        `{id, kind, title, desc, href, createdAt, read}` shape with
        Arabic copy + per-type kind mapping (`comment.created`/
        `slide.regen.finished`/`deck.regen.finished` → info,
        `deck.generate.finished`/`share.accepted` → success,
        `deck.generate.failed` → error, `share.invited` → info).
        Supports `?ids=` for the realtime push refetch (same shape
        as the comments route's `?ids=`).
      - `POST /api/notifications/read-all` — bulk mark-read with
        `updateMany({ readAt: null }, { readAt: new Date() })`.
        Idempotent OK with count:0 on user-sync race.
      - **`PATCH /api/notifications/[id]/read` NOT built** — per
        product decision "mark all read on bell open" (NOT per-row),
        the bell never needs single-row read state.
      - `GET /api/me` — returns `{supabaseUserId, prismaUserId}` so
        BellDropdown can topic the per-user channel. 204 for anon.
- [x] `components/app/BellDropdown.tsx`:
      - Initial GET on user set (NOT on bell open) — store hydrates
        the moment we know the prisma id. Bell open just marks-all-read.
      - **Per-user Supabase channel** `user:{prismaUserId}` opened by
        the **notificationStore itself** (NOT Header.tsx per the spec)
        on `setUser(supabaseId, prismaId)`. Cleaner ownership — the
        channel lifecycle tracks the auth lifecycle in one place.
      - Click row routes to row's `href` (server-formatted) — currently
        all rows resolve to `/project/{projectId}` or
        `/preview/{projectId}`. Slide-anchor (`?slide=...`) not yet
        wired — would need server to resolve slideKey → slideIndex
        at format time.
      - **Mark-all-read on bell open** wired: `setOpen((v) => {
        const next = !v; if (next) notificationStore.markAllRead(); }
        )`. Store optimistically flips every local row's `read` to
        true + fires the API call in the background.
- [x] **Unread-count badge** uses local state (`items.filter(!read).length`)
      — no separate `/unread-count` endpoint needed since the GET
      already returns the read state per row. Increments live as
      `pushFromServer` upserts new rows.

### Phase 16.E open items (next session)

1. End-to-end test: two browsers, different users, both on the same
   project. Verify (a) comment in tab A → bell badge increments in
   tab B + toast pops, (b) regen in tab A → bell row + canvas swap
   in tab B, (c) bell open in tab B clears the badge + the next
   `GET /api/notifications` returns rows with `readAt` set.
2. Commit the Phase 16.E plumbing (currently uncommitted on dev) +
   push to PR #33.
3. Decide whether to wire `deck.generate.failed` (needs Inngest
   `function.failed` listener — separate function, ~30 LoC).
4. Optional polish: slide-anchor (`?slide=N`) on comment notifications
   — requires server-side slideKey → slideIndex resolution at format
   time; punt unless feedback says so.

## Reuse map (per `feedback_reuse_existing_components.md`)

| Need | Existing component to reuse |
| --- | --- |
| Bell dropdown chrome | `BellDropdown` (already in app) |
| "All notifications" full modal | `AllNotificationsModal` |
| Avatar with image / initial fallback | check `components/app/Header.tsx` and the comment system — there's already an avatar render for `CommentsPanel`; lift it to `components/common/Avatar.tsx` if not already a shared atom |
| Glass popover shell | `glass-popover` token + `backdrop-blur-glass` |
| Toast / error surface | none today — bell IS the surface for now |

**No new modals.** No new popover chrome. No new buttons.

## Design tokens / classes to add (must go in globals.css)

Stake out the additions here so we don't drift later:

- `.presence-avatar` — circle, fixed 20×20 px, glass border, image-fill,
  fallback initial centered. Compose from existing token vocabulary.
- `.presence-avatar--inactive` — opacity 0.4 (no transition).
- `.presence-stack` — flex row, RTL-aware overlapping via
  `margin-inline-start: calc(var(--spacing) * -2);` on `> * + *`.
- `.presence-overflow` — small glass pill `+N` chip; reuses
  `.glass-popover` recipe at pill-radius.

These are **placeholders to be added to globals.css**, not hex literals
in TSX. If the visual ends up not needing four classes, fold them down
— but never inline.

## Note on environment variables

`broadcastToProject` (server-side) needs `SUPABASE_SERVICE_ROLE_KEY` —
this key is already in `.env.local` for storage signing (see
`lib/storage/sign.ts`). No new env var required.

The browser client uses `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
both already wired through `lib/supabase/client.ts`.

## Open questions — all resolved

(16.B) Avatar source — **resolved**: invitee `User.image` is populated
via Google OAuth (verified via `useUser()`). Email/password signups
get a deterministic OKLCH gradient per `userId` via
`lib/util/avatar-gradient.ts`.

(16.E) Bell payload snippet for `comment.created` — **dropped**.
Server-formatted title is "X علّقت على شريحة في {project}" with no
snippet body. Cleaner + privacy-safe (no PII over the user channel);
the user clicks through to read the actual comment in context.

(16.E) Bell for share invites — **in scope, shipped 2026-05-24** as
`share.invited` (invitee only, gated on existing User row) +
`share.accepted` (project owner). First-touch email-only invites
skip the bell since there's no User row yet; the email IS the
delivery channel for those.

## Acceptance criteria

1. Open `/project/[id]` in two browsers as two different collaborators.
   Each sees the other's avatar on the slide thumbnail the other is
   focused on. Navigating slides moves the avatar live.
2. Tab out of browser A. Browser B sees A's avatar dim instantly. Tab
   back in → undims.
3. A posts a comment. B's `CommentsPanel` shows the comment without
   refresh; B's bell badge increments by 1.
4. A kicks off a partial regen on slide 3. B sees slide 3 in the canvas
   flip to the blur overlay; B's bell shows "A is regenerating slide 3."
5. A's regen finishes. B's canvas snaps back to the new slide; B's bell
   shows a second entry "A finished regenerating slide 3."
6. B refreshes the page. Unread count + bell history persist.
7. A view-only invitee in browser C does NOT receive bell entries (role
   below comment), but DOES see presence + live comments.

## Out of scope (deferred)

- Cursor-position presence (showing where each viewer's cursor is). Avatars
  on thumbnails answer the same question 80% as well at 10% of the cost.
- @mentions in comments. Tracked in `plan-share.md`'s Out of Scope.
- Comment threading (replies). Comments stay flat for now.
- Email digests of unread notifications. Resend already wired for invites;
  digests are a Phase 17+ feature.
- Push notifications (browser/mobile). Bell is web-only.
