// /templates — every template visible to the user, mirroring the
// /projects page structure exactly.
//
// Server-fetches own + community in parallel (capped) then UNIONs the
// two into a single list the client filters/paginates over. The
// per-row `isMine` flag drives the owner filter chip; otherwise the
// page behaves like /projects (search + format + language + colour
// swatch + pagination).
//
// "Community" excludes the user's own templates so they don't appear
// twice when the owner filter is set to "الكل" (otherwise a publisher
// would see their own row twice).

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { TemplatesPageClient } from "./TemplatesPageClient";
import type { TemplateForBrowse } from "./types";

// 60-row per-axis cap. Pagination handles slicing once they're on
// the client; this just bounds the SSR payload.
const PER_AXIS_CAP = 60;

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/templates");
  }

  const dbUser = await prisma.user.findFirst({
    where: { supabaseUserId: user.id },
    select: { id: true },
  });
  if (!dbUser) {
    redirect("/login?next=/templates");
  }

  const selectShape = {
    id: true,
    title: true,
    brand: true,
    thumbnailUrls: true,
    language: true,
    // `isPublic` drives the visibility-toggle chip label in the
    // 3-dots menu. Selected on every row (own + community) so the
    // narrow function can populate it uniformly.
    isPublic: true,
    createdAt: true,
  } as const;

  const [ownRaw, communityRaw] = await Promise.all([
    prisma.template.findMany({
      where: { ownerId: dbUser.id },
      orderBy: { createdAt: "desc" },
      take: PER_AXIS_CAP,
      select: selectShape,
    }),
    prisma.template.findMany({
      where: {
        isPublic: true,
        NOT: { ownerId: dbUser.id },
      },
      orderBy: { publishedAt: "desc" },
      take: PER_AXIS_CAP,
      select: selectShape,
    }),
  ]);

  const own = ownRaw.map((r) => narrow(r, true));
  const community = communityRaw.map((r) => narrow(r, false));
  // Unioned list — own first so the default "خاصة" filter sees the
  // freshest user content at the top of its slice. The client further
  // re-sorts within each filter view as needed.
  const all = [...own, ...community];

  return (
    <TemplatesPageClient
      templates={all}
      ownCount={own.length}
      communityCount={community.length}
    />
  );
}

function narrow(
  row: {
    id: string;
    title: string;
    brand: unknown;
    thumbnailUrls: string[];
    language: string;
    isPublic: boolean;
  },
  isMine: boolean,
): TemplateForBrowse {
  const brand = (row.brand ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    title: row.title,
    thumbnailUrls: row.thumbnailUrls,
    language: row.language,
    isMine,
    isPublic: row.isPublic,
    // Pending = row exists but the Inngest showcase-render hasn't
    // produced the 4 PNGs yet. Drives auto-refresh on the client.
    thumbnailsPending: row.thumbnailUrls.length === 0,
    brand: {
      background:
        typeof brand.background === "string" ? brand.background : "#000000",
      text: typeof brand.text === "string" ? brand.text : "#FFFFFF",
      palette: Array.isArray(brand.palette)
        ? brand.palette.filter((v): v is string => typeof v === "string")
        : [],
      // Constrain to the two valid SLIDE_FORMATS values — `narrow()`
      // was previously `typeof === "string"` which accepted arbitrary
      // strings from legacy/malformed Template.brand JSON. Unsupported
      // formats falling through to the client would break the
      // TemplateTile aspect-video math + the lightbox aspect calc.
      format: brand.format === "9:16" ? "9:16" : "16:9",
    },
  };
}
