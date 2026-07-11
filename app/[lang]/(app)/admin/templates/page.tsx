// Admin > Templates curation (server). Gates on admin, then fetches two sets:
// (1) the curator account's public templates (featured first, in curated
// order) for feature/premium/SEO curation, and (2) the cross-user PENDING
// approval queue - every user's outstanding request to publish a template to
// the community. Only the curator's templates are featurable (curator-only
// policy); the pending queue spans all users. /templates shows a template to
// all users only once approved.

import { requireAdminPage } from "@/lib/api/admin-context";
import { prisma } from "@/lib/prisma";
import { MARQUEE_OWNER_EMAIL } from "@/lib/auth/marquee-projects";
import { TemplatesClient } from "@/components/admin/TemplatesClient";
import type { AdminTemplate, AdminPendingTemplate } from "@/lib/admin/mock";

export const dynamic = "force-dynamic";

function brandFormat(brand: unknown): "16:9" | "9:16" {
  return brand &&
    typeof brand === "object" &&
    (brand as { format?: unknown }).format === "9:16"
    ? "9:16"
    : "16:9";
}

export default async function AdminTemplatesPage() {
  await requireAdminPage();

  const curator = await prisma.user.findUnique({
    where: { email: MARQUEE_OWNER_EMAIL },
    select: { id: true },
  });

  // Two independent reads: the curator's public templates (feature/curate) and
  // the cross-user pending-approval queue. They don't depend on each other.
  const [rows, pendingRows] = await Promise.all([
    curator
      ? prisma.template.findMany({
          where: { ownerId: curator.id, isPublic: true },
          select: {
            id: true,
            brand: true,
            thumbnailUrls: true,
            language: true,
            isPremium: true,
            featuredOrder: true,
            slug: true,
            nameAr: true,
            nameEn: true,
            descriptionAr: true,
            descriptionEn: true,
          },
          // Featured first (by curated order), then the rest by recency.
          orderBy: [
            { featuredOrder: { sort: "asc", nulls: "last" } },
            { publishedAt: "desc" },
          ],
        })
      : [],
    // Every user's outstanding publish request, oldest first (FIFO review).
    prisma.template.findMany({
      where: { reviewStatus: "PENDING" },
      select: {
        id: true,
        brand: true,
        thumbnailUrls: true,
        language: true,
        slideCount: true,
        createdAt: true,
        owner: { select: { email: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
  ]);

  const pending: AdminPendingTemplate[] = pendingRows.map((r) => {
    const fmt = brandFormat(r.brand);
    const cover =
      (r.thumbnailUrls ?? []).find((u) => u && !u.includes("/showcase-")) ??
      r.thumbnailUrls?.[0] ??
      null;
    return {
      id: r.id,
      thumbnail: cover,
      format: fmt,
      language: r.language,
      slideCount: r.slideCount,
      ownerEmail: r.owner?.email ?? null,
      requestedAt: r.createdAt.toISOString(),
    };
  });

  const templates: AdminTemplate[] = rows.map((r) => {
    const fmt = brandFormat(r.brand);
    // Real cover: first non-showcase slide thumbnail (showcase-* are the
    // synthetic typography/palette slides).
    const cover =
      (r.thumbnailUrls ?? []).find((u) => u && !u.includes("/showcase-")) ?? null;
    return {
      id: r.id,
      // Caption: curated EN name, else the AR name, else format + language.
      name: r.nameEn ?? r.nameAr ?? `${fmt} · ${r.language.toUpperCase()}`,
      thumbnail: cover,
      format: fmt,
      premium: r.isPremium,
      featured: r.featuredOrder !== null,
      order: r.featuredOrder,
      seo: {
        slug: r.slug,
        nameAr: r.nameAr,
        nameEn: r.nameEn,
        descriptionAr: r.descriptionAr,
        descriptionEn: r.descriptionEn,
      },
    };
  });

  return (
    <TemplatesClient initialTemplates={templates} initialPending={pending} />
  );
}
