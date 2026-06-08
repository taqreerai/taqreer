# Dashboard Home — layout snapshot (2026-06-08)

> Captured BEFORE a planned full redesign of the dashboard layout. This exact
> composition is to be reconstructed inside the future **admin panel**. Source:
> [app/(app)/dashboard/page.tsx](app/(app)/dashboard/page.tsx). Visual reference:
> `context/dashboard-home-snapshot.png`. Chrome (header/sidebar) is the shared
> `DashboardShell`, documented in [context/architecture.md](context/architecture.md) §3.

## Page container
`app/(app)/dashboard/page.tsx` — `export const dynamic = "force-dynamic"` (fresh SSR so thumbnails appear once Inngest renders them). Auth-gated (redirect `/login?next=/dashboard`); upserts the Prisma user.

Root: `<div className="page-container space-y-16 pt-8 pb-12">` — RTL, 64px gaps between four stacked sections.

## SSR data (one `Promise.all`)
- **projects**: `prisma.project.findMany` — `where userId, status ≠ "cancelled"`, `orderBy updatedAt desc`, `take 6`; select `id, title, type, thumbnailUrls, createdAt, isFavorite, status`. → `recentGenerations: GenerationItem[]` (thumbnail = `thumbnailUrls[0]`).
- **templates**: `prisma.template.findMany` — `where ownerId`, `orderBy createdAt desc`, `take 10`; select `id, brand(JSON), thumbnailUrls, isPublic, isPremium`. → `templateTiles` (brand narrowed: background/text/palette/fontHeading/format with fallbacks; `isMine: true`, `thumbnailsPending = thumbnailUrls.length===0`).
- **subscription**: `prisma.subscription.findFirst({ userId })` → `renewalDate`.
- **usageCount**: `prisma.usageEvent.count` — `eventType "presentation_generated"`, `createdAt ≥ start-of-month-UTC`.
- Plan limits: `free 10 · plus 60 · pro 90` (`normalizePlan(dbUser.plan)`).

## Sections (top → bottom)
1. **`<QuickActions />`** ([components/app/QuickActions.tsx](components/app/QuickActions.tsx)) — 4-card grid (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4`): إنشاء (`/create`), تحسين (`/enhance`), محاكاة (`/mimic`), من بيانات (`/datasheet`, قريباً). Each glass card = animated icon (`AnimatedIcon`) + title + a bottom sparkline. NewProjectDialog mirrors this grid.
2. **Widget pair** — `<div className="grid grid-cols-1 gap-6 lg:grid-cols-3">`:
   - `lg:col-span-2` → **`<RecentGenerationWidget generations={recentGenerations} />`** ([components/app/RecentGenerationWidget.tsx](components/app/RecentGenerationWidget.tsx)) — "أحدث المشاريع" table: up to 6 rows (`ProjectTableRow`), columns ≈ thumbnail · title + flow-type + date · status (with pending spinner for queued/generating) · points (static placeholder) · 3-dots actions (star/share/rename/use-as-template/save-as-template/trash via `ProjectActionsMenu`). Optimistic delete + router refresh. Row click → `/project/[id]`.
   - `lg:col-span-1` → **`<RecentActivityWidget />`** ([components/app/RecentActivityWidget.tsx](components/app/RecentActivityWidget.tsx)) — "النشاطات الأخيرة" feed (recent generations + comments merged).
3. **`<MyTemplates templates={templateTiles} />`** ([components/app/MyTemplates.tsx](components/app/MyTemplates.tsx)) — full-width "ابدأ من قالب" card: up to 10 own templates (5/row × 2 rows) via `TemplateTile`; tile click opens `TemplateLightbox` in place (z-[2000]); auto-refreshes while thumbnails render.
4. **`<PlanUsage plan usageCount limit renewalDate />`** ([components/app/PlanUsage.tsx](components/app/PlanUsage.tsx)) — "الخطة المجانية / الاستخدام" banner: brand-gradient progress bar (`usageCount / limit`), plan label, renewal date, upgrade link.

## Widget chrome (reuse when rebuilding)
`DashboardWidget`, `DashboardWidgetHeader` (title + "عرض الكل" link), `DashboardEmptyState` ([components/app/DashboardWidget.tsx](components/app/DashboardWidget.tsx)). Tiles: `ProjectThumbnail`, `ProjectTableRow`, `TemplateTile`, `Sparkline`.

## Visual (from the snapshot)
Dark near-black bg with the violet bottom-glow. Top: 4 glass quick-action cards in a row. Below: two glass panels side-by-side — left (wider) the projects table, right the activity list. Then a full-width templates strip of thumbnail tiles. Bottom: a wide violet-tinted plan/usage banner with a progress bar and an upgrade button. All RTL, Cairo, pill buttons, glass surfaces.

## Rebuild note
To move this into the admin panel: the four section components + their SSR queries are self-contained — lift `<QuickActions/>`, the widget-pair grid, `<MyTemplates/>`, `<PlanUsage/>` and the `Promise.all` data block into the admin route. The new public dashboard layout then replaces `page.tsx`'s body.
