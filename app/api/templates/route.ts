// GET /api/templates
//
// The template list for the /create Design step's picker (2026-10-02): the
// viewer's own templates first, then the live community / curated ones
// (curator-featured order first, newest after). Read-only metadata only; the
// design reference itself is minted per pick by POST /api/templates/[id]/use,
// which keeps its own visibility + premium gates.
//
// Visibility mirrors the /templates page: own rows + `isPublic` rows (public
// <=> admin-approved). Templates still rendering (no thumbnail / PDF yet)
// are skipped, since they can't drive a generation.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

const OWN_CAP = 24;
const COMMUNITY_CAP = 60;

export type PickerTemplate = {
  id: string;
  thumbnailUrl: string;
  isMine: boolean;
  isPremium: boolean;
  // Free-plan template: free users may generate with it (the template flow
  // is otherwise Plus+). Listed first in the community section.
  isFree: boolean;
  format: "16:9" | "9:16";
  palette: string[];
  name: { ar: string | null; en: string | null };
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dbUser = await prisma.user.findUnique({
    where: { supabaseUserId: user.id },
    select: { id: true },
  });
  if (!dbUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const select = {
    id: true,
    brand: true,
    thumbnailUrls: true,
    isPremium: true,
    isFree: true,
    nameAr: true,
    nameEn: true,
  } as const;
  const ready = { pdfUrl: { not: null }, NOT: { thumbnailUrls: { isEmpty: true } } };

  const [own, community] = await Promise.all([
    prisma.template.findMany({
      where: { ownerId: dbUser.id, ...ready },
      orderBy: { createdAt: "desc" },
      take: OWN_CAP,
      select,
    }),
    prisma.template.findMany({
      where: { isPublic: true, ownerId: { not: dbUser.id }, ...ready },
      orderBy: [
        { isFree: "desc" },
        { featuredOrder: { sort: "asc", nulls: "last" } },
        { publishedAt: "desc" },
      ],
      take: COMMUNITY_CAP,
      select,
    }),
  ]);

  const narrow = (
    row: (typeof own)[number],
    isMine: boolean,
  ): PickerTemplate => {
    const brand = (row.brand ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      thumbnailUrl: row.thumbnailUrls[0],
      isMine,
      isPremium: row.isPremium,
      isFree: row.isFree,
      format: brand.format === "9:16" ? "9:16" : "16:9",
      palette: Array.isArray(brand.palette)
        ? brand.palette.filter((v): v is string => typeof v === "string").slice(0, 6)
        : [],
      name: { ar: row.nameAr, en: row.nameEn },
    };
  };

  return NextResponse.json({
    templates: [
      ...own.map((r) => narrow(r, true)),
      ...community.map((r) => narrow(r, false)),
    ],
  });
}
