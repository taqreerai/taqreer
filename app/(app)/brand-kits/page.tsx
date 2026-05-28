// /brand-kits — every brand kit the user has saved.
//
// SSR mirror of /projects: fetch the user's kits newest-first,
// re-sign each logo's storage path into a short-lived display URL
// (the bucket is private; a raw path won't load in an <img>), then
// hand off to the client wrapper for the grid + handlers.

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { isOwnedBrandAssetPath, signBrandAssetUrl } from "@/lib/storage/sign";
import { BrandKitsPageClient } from "./BrandKitsPageClient";
import type { BrandKitTileData } from "@/components/app/BrandKitTile";

export const dynamic = "force-dynamic";

// Narrow `BrandKit.colors` (Json) to a string[] of valid hex codes.
// Same shape `lib/project/derive-color-tags.ts` reads. Silently
// drops anything off-axis so a corrupt row doesn't crash the page.
function readColors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is string =>
      typeof v === "string" && /^#[0-9A-Fa-f]{3,8}$/.test(v),
  );
}

// Narrow `BrandKit.fonts` (Json) to the heading + body name pair
// the tile renders. Accepts both shapes the create flow writes:
//   { heading: { name }, body: { name } }   // canonical post-Phase 17.D
//   { heading: { family }, body: { family } } // legacy alias
function readFontNames(value: unknown): {
  heading: string | null;
  body: string | null;
} {
  if (!value || typeof value !== "object") {
    return { heading: null, body: null };
  }
  const f = value as {
    heading?: { name?: unknown; family?: unknown } | null;
    body?: { name?: unknown; family?: unknown } | null;
  };
  const pick = (slot: { name?: unknown; family?: unknown } | null | undefined) => {
    if (!slot) return null;
    if (typeof slot.name === "string" && slot.name.trim()) return slot.name;
    if (typeof slot.family === "string" && slot.family.trim()) return slot.family;
    return null;
  };
  return { heading: pick(f.heading), body: pick(f.body) };
}

export default async function BrandKitsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/auth/login?next=/brand-kits");
  }
  const dbUser = await prisma.user.findUnique({
    where: { supabaseUserId: user.id },
    select: { id: true },
  });
  if (!dbUser) {
    // First-login user-sync race — bounce to dashboard so the upsert
    // happens, same recovery /projects uses.
    redirect("/dashboard");
  }

  const kits = await prisma.brandKit.findMany({
    where: { userId: dbUser.id },
    // Default kit floats to the top (above newest-first) so the
    // user's primary kit reads as the most prominent tile in the
    // list — same UX hint a "starred" badge gives them visually.
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      colors: true,
      fonts: true,
      assetUrls: true,
      isDefault: true,
      createdAt: true,
    },
  });

  // Re-sign each kit's logo path (bucket is private). Ownership is
  // re-checked at signing time — legacy / hand-edited rows could
  // hold a path that no longer matches; in that case we skip the
  // signed URL silently and the tile renders its fallback icon.
  const tiles: BrandKitTileData[] = await Promise.all(
    kits.map(async (kit) => {
      const assetUrls = kit.assetUrls as
        | { logo?: { storageUrl?: string | null } | null }
        | null;
      const logoPath = assetUrls?.logo?.storageUrl ?? null;
      let logoDisplayUrl: string | null = null;
      if (logoPath && isOwnedBrandAssetPath(logoPath, user.id)) {
        logoDisplayUrl = await signBrandAssetUrl(logoPath);
      }
      const fonts = readFontNames(kit.fonts);
      return {
        id: kit.id,
        name: kit.name,
        createdAt: kit.createdAt.toISOString(),
        logoDisplayUrl,
        colors: readColors(kit.colors),
        fontHeadingName: fonts.heading,
        fontBodyName: fonts.body,
        isDefault: kit.isDefault,
      };
    }),
  );

  return (
    <div className="page-container">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="tq-h1">هوية الشركة</h1>
          <p className="tq-subhead">
            هويات بصرية محفوظة. اضغط على أي بطاقة لاستخدامها في أحد التدفقات،
            أو احذفها من قائمة الخيارات.
          </p>
        </div>
        <a
          href="/brand-kits/new"
          className="btn-gradient flex shrink-0 items-center gap-2 px-4 py-2 text-sm"
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 18 }}
            aria-hidden
          >
            add
          </span>
          هوية جديدة
        </a>
      </header>
      <BrandKitsPageClient kits={tiles} />
    </div>
  );
}
