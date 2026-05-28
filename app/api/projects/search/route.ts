// GET /api/projects/search?q=...
//
// Header autocomplete endpoint. Returns up to MAX_RESULTS projects
// whose title matches the query (case-insensitive `contains`),
// owner-scoped, ordered newest-first.
//
// Distinct from /api/projects (the full SSR list endpoint): this
// route returns only the fields the dropdown row renders and skips
// the access-control joins — search is owner-only by design, so
// shared-with-me projects don't surface in autocomplete.
//
// Empty query returns `{ projects: [] }` so the client can call
// this unconditionally.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveUserContext } from "@/lib/api/user-context";

// Server-side cap on payload size. The client also enforces this.
const MAX_RESULTS = 4;
// Trim long queries to keep the SQL `contains` regex bounded.
const MAX_QUERY_LENGTH = 100;

export async function GET(request: Request): Promise<NextResponse> {
  const ctx = await resolveUserContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const q = (new URL(request.url).searchParams.get("q") ?? "")
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
  if (!q) return NextResponse.json({ projects: [] });

  const projects = await prisma.project.findMany({
    where: {
      userId: ctx.userId,
      title: { contains: q, mode: "insensitive" },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_RESULTS,
    select: {
      id: true,
      title: true,
      thumbnailUrls: true,
      format: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    projects: projects.map((p) => ({
      id: p.id,
      title: p.title,
      thumbnailUrls: p.thumbnailUrls ?? [],
      format: p.format,
      createdAt: p.createdAt.toISOString(),
    })),
  });
}
