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
- [ ] Polling path stays as a 30-s fallback if the channel hasn't
      connected yet. (Existing apply-poller covers the actor's
      tab. For observers, the broadcast IS the only signal —
      acceptable for MVP; if Realtime is down a manual refresh
      recovers them.)

### Phase 16.E — Notification table + bell

- [ ] Prisma migration `20260524_add_notification`:
      ```prisma
      model Notification {
        id              String   @id @default(cuid())
        projectId       String
        project         Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
        recipientUserId String   // prisma User.id, not supabaseUserId
        recipient       User     @relation("NotificationRecipient", fields: [recipientUserId], references: [id], onDelete: Cascade)
        actorUserId     String?  // null = system event
        actor           User?    @relation("NotificationActor", fields: [actorUserId], references: [id], onDelete: SetNull)
        kind            String   // "comment_created" | "partial_regen_started" | "partial_regen_finished" | "full_regen_started" | "full_regen_finished"
        payload         Json     // { commentId? slideIndex? jobId? snippet? }
        readAt          DateTime?
        createdAt       DateTime @default(now())
        @@index([recipientUserId, readAt])
        @@index([projectId, createdAt])
      }
      ```
- [ ] Server-side fan-out helper `lib/notifications/fan-out.ts`:
      enumerates project collaborators with role≥comment (owner +
      accepted ProjectShare rows where accessLevel ≠ "view"), filters
      out the actor, inserts one Notification per recipient in a single
      `createMany`.
- [ ] Call sites:
      - `POST /api/projects/[id]/comments` after Comment INSERT
      - `inngest/functions/regenerate-slide.ts` at `step.run("notify-start")`
        + `step.run("notify-finish")`
      - `inngest/functions/regenerate-presentation.ts` same shape
- [ ] API:
      - `GET /api/notifications` — paginated list for current user
      - `PATCH /api/notifications/[id]/read`
      - `PATCH /api/notifications/read-all`
- [ ] `components/app/BellDropdown.tsx` — **reuse existing** dropdown.
      Adapt to consume:
      - Initial GET on open + a 1-min poll for cross-project events
      - A **user-scoped Broadcast channel** `user:{prismaUserId}` —
        opened once on app mount via `Header.tsx` — that the fan-out
        helper broadcasts to alongside the project channel. Carries
        only `notificationId` as the payload; bell GETs the full row.
      - Click row → routes to `/project/{projectId}` (or to the comment
        anchor if kind = `comment_created`).
- [ ] Unread-count badge: GET `/api/notifications/unread-count` on
      mount + increment locally on each incoming broadcast.

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

## Open questions to surface BEFORE 16.E start

(16.B's open questions resolved during ship: invitee `User.image` is
populated via Google OAuth — verified via `useUser()`. Email/password
signups get a deterministic OKLCH gradient per `userId` via
`lib/util/avatar-gradient.ts`.)


- (16.B) Avatar source: do invitees have `image` set on the Prisma
  `User` model today? Or is it Supabase auth metadata only? Phase 15
  threaded `name` + `image` through `Comment.author` — same source
  should work, but verify before coding.
- (16.E) Bell payload "snippet" for `comment_created`: first 60 chars
  of the comment body, or empty (force user to click through)? — UX
  choice.
- (16.E) Bell notifications for **share invites** (someone added me to
  a project) — in scope or out? `plan-share.md` lists this as
  out-of-scope for Phase 15; rolling into Phase 16.E adds another
  `kind="share_invited"` event. Decide before migration.

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
