// Admin > Templates curation (server). Gates on admin, fetches the curator
// account's public templates (featured first, in curated order), maps them to
// the client shape, and renders the wired client. Only the curator's templates
// are featurable (curator-only policy); /templates still shows every public
// template to all users.

import { requireAdminPage } from "@/lib/api/admin-context";
import { prisma } from "@/lib/prisma";
import { MARQUEE_OWNER_EMAIL } from "@/lib/auth/marquee-projects";
import { TemplatesClient } from "@/components/admin/TemplatesClient";
import type { AdminTemplate } from "@/lib/admin/mock";

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

  const rows = curator
    ? await prisma.template.findMany({
        where: { ownerId: curator.id, isPublic: true },
        select: {
          id: true,
          brand: true,
          thumbnailUrls: true,
          language: true,
          isPremium: true,
          featuredOrder: true,
        },
        // Featured first (by curated order), then the rest by recency.
        orderBy: [
          { featuredOrder: { sort: "asc", nulls: "last" } },
          { publishedAt: "desc" },
        ],
      })
    : [];

  const templates: AdminTemplate[] = rows.map((r) => {
    const fmt = brandFormat(r.brand);
    // Real cover: first non-showcase slide thumbnail (showcase-* are the
    // synthetic typography/palette slides).
    const cover =
      (r.thumbnailUrls ?? []).find((u) => u && !u.includes("/showcase-")) ?? null;
    return {
      id: r.id,
      // Templates have no name; caption with format + language (middot ok).
      name: `${fmt} · ${r.language.toUpperCase()}`,
      thumbnail: cover,
      format: fmt,
      premium: r.isPremium,
      featured: r.featuredOrder !== null,
      order: r.featuredOrder,
    };
  });

  return <TemplatesClient initialTemplates={templates} />;
}
