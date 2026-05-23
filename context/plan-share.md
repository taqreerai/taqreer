# Share + Export Modal — Plan

Working doc for Phase 15 (share modal redraw + co-owner gating + export
duplication into the modal). Branch: `dev`. Owner: Osama. Drafted
2026-05-23 after user sketched the UX and locked the flow.

## Intent (from user)

> Two tabs: **Share** + **Export**. Copy share link is always view-only.
> Comment-only invitees can comment but cannot regen / apply / see regen
> UI. Edit invitees co-own the SAME project (no clone). Export buttons
> are the same 4 the toolbar already has, mirrored into the modal —
> replace Google Slides with HTML. Everything animated with framer
> motion. No new modal chrome, no native dropdowns — reuse existing
> styled components.

## Architectural shifts vs prior plan

1. **Drop the public-access pill picker.** The 4-way picker (off/view/
   comment/edit) is gone. Public link is fixed view-only. Schema column
   `publicAccessLevel` stays for future "link off" toggle but no UI
   exposes it today; the share API quietly locks it to `"view"` when a
   link exists.
2. **Drop auto-clone on edit.** Edit invitees collaborate on the same
   `Project` row. The earlier "spin up a clone" idea is dead.
3. **Two-tab dialog.** Same modal frame as `SaveAsTemplateDialog`
   (sibling glass overlay + panel), but with a vertical tab strip on
   the trailing edge: **Share** (top) / **Export** (bottom).
4. **Export is duplicated, not moved.** The toolbar keeps its 4 export
   buttons. The modal's Export tab is a second entry point wired to the
   SAME handler logic. Extraction: lift `handleExport` / `handleExportPdf`
   / `handleExportPng` / `handleDownloadHtml` (+ their `exportPptx` /
   `exportPdf` / `exportPng` / `exportHtml` states + the shared
   `exportBusy` flag) into a `useExportActions()` hook. PreviewActionBar
   and ShareDialog both consume it. BiDi post-processor wiring untouched.

## Roles + capability ladder

```text
view  <  comment  <  edit  ≤  owner
```

- **owner** — full access (project owner; resolved via `user.supabaseUserId`)
- **edit-share** — co-owner on the same project; can do anything owner
  can EXCEPT: rename, delete, share-management, save-as-template,
  toggle-favorite
- **comment-share** — can view + create comments only. Regen UI hidden.
  Save / lock / restore hidden.
- **view-share** — can view only
- **public (view-only)** — anyone with the URL, gated by
  `publicAccessLevel = "view"` on the project

## Route gating inventory

New helper: `lib/api/project-access.ts`

```ts
export type ProjectRole = "owner" | "edit" | "comment" | "view";
export async function resolveProjectAccess(
  projectId: string,
  required: ProjectRole,
): Promise<ProjectAccessContext | ProjectContextError>;
```

Maps:

| Route                                                      | Required role  | Notes                                              |
| ---------------------------------------------------------- | -------------- | -------------------------------------------------- |
| `GET    /api/projects/[id]/status`                         | view           | viewer-side polling                                |
| `POST   /api/projects/[id]/save`                           | edit           | save snapshot                                     |
| `POST   /api/projects/[id]/regenerate`                     | edit           |                                                    |
| `POST   /api/projects/[id]/regenerate-partial`             | edit           |                                                    |
| `POST   /api/projects/[id]/retry`                          | edit           |                                                    |
| `POST   /api/projects/[id]/slides/[k]/regen`               | edit           |                                                    |
| `GET/POST /api/projects/[id]/slides/[k]/versions`          | edit           | restore = edit                                    |
| `POST   /api/projects/[id]/slides/[k]/restore`             | edit           |                                                    |
| `POST   /api/projects/[id]/slides/[k]/lock`                | edit           |                                                    |
| `POST   /api/projects/[id]/slides/lock-all`                | edit           |                                                    |
| `GET    /api/projects/[id]/comments`                       | comment        | view-only invitees can't read comments either     |
| `POST   /api/projects/[id]/comments`                       | comment        |                                                    |
| `DELETE /api/projects/[id]/comments/[id]`                  | comment        | author-or-owner check on top                      |
| `POST   /api/projects/[id]/export/{pdf,png}`               | view           | anyone with access can export                     |
| `PATCH  /api/projects/[id]` (rename)                       | owner          |                                                    |
| `PATCH  /api/projects/[id]/favorite`                       | owner          | dashboards are per-owner                          |
| `DELETE /api/projects/[id]`                                | owner          |                                                    |
| `POST   /api/projects/[id]/save-as-template`               | owner          |                                                    |
| `GET    /api/projects/[id]/template-preview`               | owner          |                                                    |
| `GET    /api/projects/[id]/share`                          | owner          | share mgmt                                        |
| `POST   /api/projects/[id]/share`                          | owner          |                                                    |
| `DELETE /api/projects/[id]/share/[shareId]`                | owner          |                                                    |

For `view` access, if the requesting user is not signed in OR not an
invitee, check the project's `publicAccessLevel`. If `= "view"`, grant
view; else 404.

## File-by-file work

### Phase 15.A — Server: access helper + route gating

- [ ] `lib/api/project-access.ts` — new helper. Mirrors
      `resolveProjectContext` shape but returns `{ role, project, user }`.
      Looks up: (a) project ownership by `supabaseUserId`; (b)
      `ProjectShare` row with matching user OR matching email (case
      already normalised) + `acceptedAt != null`; (c) public access fallback.
- [ ] Update all routes in the inventory above to swap
      `resolveProjectContext` → `resolveProjectAccess(id, "edit"|"comment"|"view"|"owner")`.
- [ ] `GET /project/[id]` page-level access gate — server component check
      that returns notFound() when access denied. Surface role to client.

### Phase 15.B — Client: pass role into editor

- [ ] `DeckView` accepts `role: ProjectRole` prop. Threads to
      `PreviewActionBar`, `CommentsPanel`, `HeroCommentOverlay`,
      `SlideNavSidebar`.
- [ ] `PreviewActionBar` — when role !== "edit" && !== "owner": hide
      Regen, Save, Apply Comments, partial-regen "armed" affordance,
      lock-all, restore controls. Keep Comment button (if comment role)
      with `gradient={false}`. Keep export group always.
- [ ] `SlideNavSidebar` — when role !== "edit" && !== "owner": hide
      per-slide lock toggle + restore version controls.
- [ ] `HeroCommentOverlay` / `CommentsPanel` — when role === "view":
      hide entirely. When role === "comment": no regen / no apply.

### Phase 15.C — Modal: tabs + Share tab + Export tab

- [ ] `lib/preview/use-export-actions.ts` — extract the 4 export
      handlers + their states + `exportBusy` from PreviewActionBar.
      Returns `{ runPptx, runPdf, runPng, runHtml, states, busy, lastError }`.
- [ ] `components/app/ShareDialog.tsx` — rewrite into two tabs:
  - Reuse `SaveAsTemplateDialog` outer frame (dim sibling, glass
    panel, AnimatePresence, Esc, body-scroll lock).
  - **Tab strip**: vertical, on the trailing edge, two stacked
    `btn-pill` buttons (active = filled glass, inactive = ghost).
    AnimatePresence on the tab content with fade + 4px y-translate.
  - **Share tab** content:
    - Invite bar: `AccessChipDropdown` (leading) + `<input type="email">`
      with our `.input-dark` chrome (trailing). Submit on Enter.
    - Owner row + invitee rows. Each row: role chip + name + email +
      revoke X (invitees only). All rows animate in/out with framer.
  - **Export tab** content: 4 row buttons — PDF / PPTX / HTML / PNGs.
    Each row uses `.btn-pill` chrome + a brand-colored icon tile on
    the leading side + a download glyph on the trailing side.
    "or you can post this page directly to..." subline + LinkedIn
    button at the bottom of the tab.
  - **Footer (constant across both tabs)**: single "نسخ الرابط"
    `.btn-pill` button copying `/project/[id]` view-only URL.
- [ ] `components/app/AccessChipDropdown.tsx` — new component, but reuses
      the existing `ProjectActionsMenu` portal+glass-popover pattern.
      Glass-popover panel with three rows (عرض / تعليق / تعديل). Chip
      trigger is a `.btn-pill` with a chevron glyph. Flip-above geometry,
      Esc + outside-click dismiss.
- [ ] Trigger surfaces:
  - `ProjectThumbnail` 3-dots → opens with Share tab active (already
    wired; just confirm it works after refactor).
  - `PreviewActionBar` → add a Share button that opens the modal.
    Initial tab = Share. (Export tab is reachable via the strip; the
    toolbar's 4 export buttons remain too.)

### Phase 15.D — Comments gating refinement

- [ ] Audit `CommentsPanel` footer: hide "Apply comments" / regen
      affordances for comment-role users. Show "Send" only.
- [ ] Comment button in PreviewActionBar: when role === "comment",
      render with `gradient={false}` (flat-icon, not AI-stroke).
- [ ] When role === "view", hide the Comment button entirely
      (current behaviour for non-edit assumed).

### Phase 15.E — Public-access fallback + invite acceptance

- [ ] `POST /api/projects/[id]/share` quietly sets `publicAccessLevel =
      "view"` the first time a share row exists OR when the owner
      clicks Copy Link (existing call shape unchanged for the modal).
- [ ] `GET /api/invitations/[token]/accept` — new route. Validates
      token → matches `ProjectShare.inviteToken` → links `userId` =
      current user → sets `acceptedAt = now()`. Redirects to
      `/project/[shareProjectId]`. If not signed in, redirect to login
      with `next=` back to this route.

### Phase 15.F — Email send (Resend wire)

- [ ] `lib/email/send-share-invite.ts` — new module. Reuses the
      existing Resend client used for password-reset + email-
      verification. Template: minimal RTL Arabic body with owner
      name, project title, access level (translated), and the
      `/invitations/[token]/accept` URL.
- [ ] `POST /api/projects/[id]/share` swaps the `console.info("[share]
      would email invite", ...)` stub for a real send call. Errors are
      non-fatal (log + return ok; the share row still exists, and the
      owner can re-send later).

### Phase 15.G — LinkedIn share button

- [ ] Static `https://www.linkedin.com/sharing/share-offsite/?url=...`
      handler. Opens in popup via `window.open(url, "share-linkedin",
      "width=600,height=600")`. No server piece needed.

## Acceptance criteria

1. Owner opens modal from `/projects` 3-dots → Share tab loads,
   public link copies view-only URL.
2. Owner adds `someone@x.com` as comment-role → row appears in list
   with "تعليق" chip + waiting state. (Resend email pending Phase F.)
3. Owner opens modal from inside `/project/[id]` editor → modal
   appears over the editor, Export tab works (all 4 buttons), Share
   tab works.
4. Toolbar's existing export buttons still work identically (no
   regression — same hook, same handlers).
5. An invitee with edit role opens the project URL → sees the editor,
   can save / regen / comment. Cannot delete / rename / share.
6. An invitee with comment role opens the project URL → sees the
   editor, can create comments, regen UI is hidden, comment button
   is flat (no gradient).
7. An invitee with view role opens the project URL → sees the editor
   in read-only mode, no comments, no regen, exports still work.
8. A non-invitee with the URL → sees the project view-only if
   `publicAccessLevel = "view"`, else 404.

## Out of scope (future)

- Comment-link / off-link toggle (the column is there; UI deferred).
- "Anyone with link can edit" — deliberately removed; only explicit
  invitees can edit.
- Notifications / activity feed for new shares.
- Per-comment @mentions of share users.
