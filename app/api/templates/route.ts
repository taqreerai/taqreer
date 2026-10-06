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
//
// Signed-out visitors (2026-10-06, /create open before sign-up) get the
// community list only: approved public rows, the same metadata the public
// /templates gallery already shows. Rate-limited per IP; no "mine" rows.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { clientIp, rateLimited } from "@/lib/api/rate-limit";

const OWN_CAP = 24;
const COMMUNITY_CAP = 60;

// Slide thumbnails sent per template for the hover preview.
const PREVIEW_CAP = 16;

export type PickerTemplate = {
  id: string;
  thumbnailUrl: string;
  // Every slide's thumbnail (capped), for the picker's hover flip-through and
  // the preview window. thumbnailUrl stays the cover.
  thumbnails: string[];
  slideCount: number;
  isMine: boolean;
  isPremium: boolean;
  // Free-plan template: free users may generate with it (the template flow
  // is otherwise Plus+). Listed first in the community section.
  isFree: boolean;
  format: "16:9" | "9:16";
  palette: string[];
  name: { ar: string | null; en: string | null };
};

const SELECT = {
  id: true,
  brand: true,
  thumbnailUrls: true,
  slideCount: true,
  isPremium: true,
  isFree: true,
  nameAr: true,
  nameEn: true,
} as const;
const READY = { pdfUrl: { not: null }, NOT: { thumbnailUrls: { isEmpty: true } } };
const COMMUNITY_ORDER = [
  { isFree: "desc" as const },
  { featuredOrder: { sort: "asc" as const, nulls: "last" as const } },
  { publishedAt: "desc" as const },
];

type Row = {
  id: string;
  brand: unknown;
  thumbnailUrls: string[];
  slideCount: number;
  isPremium: boolean;
  isFree: boolean;
  nameAr: string | null;
  nameEn: string | null;
};

function narrow(row: Row, isMine: boolean): PickerTemplate {
  const brand = (row.brand ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    thumbnailUrl: row.thumbnailUrls[0],
    thumbnails: row.thumbnailUrls.slice(0, PREVIEW_CAP),
    slideCount: Math.max(row.slideCount, row.thumbnailUrls.length),
    isMine,
    isPremium: row.isPremium,
    isFree: row.isFree,
    format: brand.format === "9:16" ? "9:16" : "16:9",
    palette: Array.isArray(brand.palette)
      ? brand.palette.filter((v): v is string => typeof v === "string").slice(0, 6)
      : [],
    name: { ar: row.nameAr, en: row.nameEn },
  };
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const dbUser = user
    ? await prisma.user.findUnique({
        where: { supabaseUserId: user.id },
        select: { id: true },
      })
    : null;

  if (!dbUser) {
    const limited = rateLimited(`templates-guest:${clientIp(request)}`, 60, 5 * 60_000);
    if (limited) return limited;
    const community = await prisma.template.findMany({
      where: { isPublic: true, ...READY },
      orderBy: COMMUNITY_ORDER,
      take: COMMUNITY_CAP,
      select: SELECT,
    });
    return NextResponse.json({ templates: community.map((r) => narrow(r, false)) });
  }

  const [own, community] = await Promise.all([
    prisma.template.findMany({
      where: { ownerId: dbUser.id, ...READY },
      orderBy: { createdAt: "desc" },
      take: OWN_CAP,
      select: SELECT,
    }),
    prisma.template.findMany({
      where: { isPublic: true, ownerId: { not: dbUser.id }, ...READY },
      orderBy: COMMUNITY_ORDER,
      take: COMMUNITY_CAP,
      select: SELECT,
    }),
  ]);

  return NextResponse.json({
    templates: [
      ...own.map((r) => narrow(r, true)),
      ...community.map((r) => narrow(r, false)),
    ],
  });
}
