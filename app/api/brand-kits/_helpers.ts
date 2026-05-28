// Internal helpers shared by the brand-kits API routes. Underscore
// prefix keeps Next.js from treating this as a route segment.
//
// Both GET /api/brand-kits/default and POST /api/brand-kits/[id]/use
// shape the persisted `assetUrls.logo` JSON into the same response
// envelope (`storageUrl` + freshly-signed URL + position + exclude).
// That extraction lives here so the two routes stay byte-identical
// on the logo field.

import { isOwnedBrandAssetPath, signBrandAssetUrl } from "@/lib/storage/sign";

// Shape we serialize back to the caller. `storageUrl` is the bucket
// path (re-signed server-side at brief-submission time); `signedUrl`
// is the short-lived URL the client renders inline.
export type BrandKitLogoResponse = {
  storageUrl: string | null;
  signedUrl: string | null;
  name: string | null;
  position: string;
  exclude: ("cover" | "closing")[];
};

// Persisted logo blob shape inside `BrandKit.assetUrls.logo` JSON.
// Loose because the column is `Json` — hand-edited or legacy rows
// could carry anything.
type PersistedLogo = {
  storageUrl?: string | null;
  name?: string | null;
  position?: string | null;
  exclude?: ("cover" | "closing")[];
} | null;

/**
 * Pull the logo blob out of a kit's `assetUrls` JSON. Returns `null`
 * when the column is empty/missing or the logo sub-object is absent.
 */
export function extractLogoBlob(assetUrls: unknown): PersistedLogo {
  const wrapped = assetUrls as { logo?: PersistedLogo } | null;
  return wrapped?.logo ?? null;
}

/**
 * Build the response-shaped logo object from a persisted blob,
 * re-signing the storage path with a fresh URL when ownership checks
 * out. Returns `null` when the kit has no logo on file.
 *
 * Ownership is re-verified at signing time — legacy rows or hand-
 * edited data could carry a path that no longer matches the caller.
 * In that case the kit still loads, just without an inline preview.
 */
export async function buildLogoResponse(
  logoBlob: PersistedLogo,
  supabaseUserId: string,
): Promise<BrandKitLogoResponse | null> {
  if (!logoBlob) return null;

  const storageUrl = logoBlob.storageUrl ?? null;
  const signedUrl =
    storageUrl && isOwnedBrandAssetPath(storageUrl, supabaseUserId)
      ? await signBrandAssetUrl(storageUrl)
      : null;

  return {
    storageUrl,
    signedUrl,
    name: logoBlob.name ?? null,
    position: logoBlob.position ?? "top-right",
    // Filter to the declared enum — the column is `Json` so a hand-
    // edited or legacy row could carry anything (e.g. extra slide
    // names from an older schema). Return values must match the
    // `BrandKitLogoResponse.exclude` contract or downstream consumers
    // hit invariant violations.
    exclude: Array.isArray(logoBlob.exclude)
      ? logoBlob.exclude.filter(
          (v): v is "cover" | "closing" => v === "cover" || v === "closing",
        )
      : [],
  };
}
