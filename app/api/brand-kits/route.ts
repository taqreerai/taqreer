import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { isOwnedBrandAssetPath, signBrandAssetUrl } from "@/lib/storage/sign";

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

// Resolve the authed user → internal DB user id. Returns null on either
// "no session" or "user not yet synced" (treat both as 401/404).
// `supabaseUserId` is exposed for downstream authorization checks (e.g.
// validating that a posted `storageUrl` lives in the caller's upload
// namespace).
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
  return { userId: dbUser.id, supabaseUserId: user.id };
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
      exclude?: unknown;
    } | null;
  } | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // `ar-u-nu-latn` keeps Arabic month names but forces Latin digits
  // — matches the dashboard's "every number is 0-9" standard.
  const fallbackName = `هوية بصرية — ${new Date().toLocaleDateString("ar-u-nu-latn")}`;
  const name = (body.name?.trim() || fallbackName).slice(0, 120);

  // AUTHORIZE the storage path before we persist it. The brand-assets
  // bucket is private and `GET /api/brand-kits` later re-signs whatever
  // we store with service-role privileges — accepting an arbitrary path
  // would let any authed user mint signed URLs for any object whose key
  // they can guess. Path always starts with the uploader's supabase
  // user id (see app/api/storage/upload/route.ts), so a startsWith()
  // check covers ownership without needing a separate asset record.
  if (
    body.logo &&
    typeof body.logo.storageUrl === "string" &&
    !isOwnedBrandAssetPath(body.logo.storageUrl, ctx.supabaseUserId)
  ) {
    return NextResponse.json(
      { error: "Logo storageUrl is not owned by the current user" },
      { status: 403 },
    );
  }

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

  // The brand-assets bucket is private, so the stored `logo.storageUrl`
  // is a bucket-relative PATH that won't load as an <img src>. Add a
  // SEPARATE `displayUrl` field (1-year signed) for the brand page's
  // preview, while keeping the original path so `/api/projects` (and
  // its `readLogoSvgMarkup` helper) can still fetch the file from
  // Supabase Storage server-side.
  type Kit = (typeof kits)[number];
  const signedKits = await Promise.all(
    kits.map(async (kit: Kit) => {
      const assetUrls = kit.assetUrls as
        | { logo?: { storageUrl?: string | null } | null }
        | null;
      const logoPath = assetUrls?.logo?.storageUrl ?? null;
      if (!logoPath) return kit;
      // Re-check ownership before signing. The POST path validates this
      // when a kit is created, but a legacy / migrated / hand-edited row
      // could still hold a path that doesn't match this user — minting a
      // signed URL would leak access to another user's asset. Skip the
      // displayUrl in that case; the kit still loads, just without a
      // logo preview.
      if (!isOwnedBrandAssetPath(logoPath, ctx.supabaseUserId)) return kit;
      const signed = await signBrandAssetUrl(logoPath);
      if (!signed) return kit;
      return {
        ...kit,
        assetUrls: {
          ...(assetUrls ?? {}),
          logo: {
            ...(assetUrls?.logo ?? {}),
            // Keep storageUrl as the PATH — the brief submission
            // needs it raw to round-trip through signing again.
            storageUrl: logoPath,
            displayUrl: signed,
          },
        },
      };
    }),
  );

  return NextResponse.json({ kits: signedKits });
}
