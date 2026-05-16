import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

// Resolve the authed user → internal DB user id. Returns null on either
// "no session" or "user not yet synced" (treat both as 401/404).
async function resolveUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" as const, status: 401 };
  const dbUser = await prisma.user.findFirst({
    where: { supabaseUserId: user.id },
    select: { id: true },
  });
  if (!dbUser) return { error: "User not found" as const, status: 404 };
  return { userId: dbUser.id };
}

// Save the brand-page state as a BrandKit. Now stores the FULL state —
// colours, fonts (Google family or uploaded storage URL), logo (storage
// URL + position + exclude config) — not just colours + font names. The
// auto-load flow on the brand page reads this back to repopulate state.
export async function POST(request: Request) {
  const ctx = await resolveUser();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const body = (await request.json().catch(() => null)) as {
    name?: string;
    colors?: unknown;
    fonts?: unknown;
    logo?: {
      name?: string | null;
      storageUrl?: string | null;
      previewDataUrl?: string | null;
      position?: string | null;
      exclude?: unknown;
    } | null;
  } | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const fallbackName = `هوية بصرية — ${new Date().toLocaleDateString("ar")}`;
  const name = (body.name?.trim() || fallbackName).slice(0, 120);

  // Allowlist the persisted logo shape — `previewDataUrl` can be a base64
  // image that bloats the row (and every GET /api/brand-kits response, up
  // to 20 kits). Hydration falls back to `storageUrl` for the preview, so
  // dropping the data URL costs one image fetch on load and nothing else.
  const safeLogo = body.logo
    ? {
        name: typeof body.logo.name === "string" ? body.logo.name.slice(0, 200) : null,
        storageUrl:
          typeof body.logo.storageUrl === "string"
            ? body.logo.storageUrl.slice(0, 2000)
            : null,
        position:
          typeof body.logo.position === "string"
            ? body.logo.position.slice(0, 32)
            : null,
        exclude: Array.isArray(body.logo.exclude)
          ? body.logo.exclude.filter(
              (v): v is "cover" | "closing" => v === "cover" || v === "closing",
            )
          : [],
      }
    : null;

  const kit = await prisma.brandKit.create({
    data: {
      userId: ctx.userId,
      name,
      logo: safeLogo?.storageUrl ?? null,
      colors: toJson(body.colors ?? null),
      fonts: toJson(body.fonts ?? null),
      // assetUrls carries the BOUNDED logo shape (storageUrl + position +
      // exclude) so the load flow can rehydrate the brand page exactly.
      // `previewDataUrl` is intentionally NOT persisted — it's a base64
      // blob that would balloon rows + list responses. Hydration falls
      // back to storageUrl for the preview image.
      assetUrls: toJson({ logo: safeLogo }),
    },
  });

  return NextResponse.json({ ok: true, brandKitId: kit.id, name: kit.name });
}

// List the user's brand kits, newest first. The brand page calls this on
// mount to auto-load the most recent kit when there's no sessionStorage
// brand data (i.e. the user is starting a fresh create flow).
export async function GET() {
  const ctx = await resolveUser();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const kits = await prisma.brandKit.findMany({
    where: { userId: ctx.userId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      name: true,
      logo: true,
      colors: true,
      fonts: true,
      assetUrls: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ kits });
}
