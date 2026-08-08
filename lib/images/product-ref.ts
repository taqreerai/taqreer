// Product-photo reference URL guards.
//
// A product photo is uploaded via POST /api/storage/upload-image, which
// stores it in the PUBLIC `generated-images` bucket at
// `uploads/<supabaseUserId>/<uuid>.<ext>` and returns the permanent public
// URL. That URL then travels: client payload → brief → baked into slide
// HTML as data-genref → fetched by the image pipeline as the gpt-image
// edit input. Two distinct trust boundaries, two guards:
//
//  • isOwnedUploadedImageUrl — the /api/projects POST boundary: the URL
//    arrives from the client, so it must point inside the CALLER's own
//    uploads namespace (mirror of isOwnedBrandAssetPath in
//    lib/storage/sign.ts — otherwise any authenticated user could build
//    posts around another user's uploads, confirming their existence).
//
//  • isAllowedProductRefUrl — the fetch boundary: data-genref lives in
//    user-editable slide HTML, so before the pipeline fetches it, the URL
//    must resolve to OUR public uploads prefix. A hand-crafted ref to an
//    internal host (169.254.169.254 and friends) must never be fetched.

const UPLOADS_SEGMENT = "/storage/v1/object/public/generated-images/uploads/";

export function uploadedImagePublicPrefix(): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}${UPLOADS_SEGMENT}`;
}

export function isAllowedProductRefUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  if (url.length > 600 || url.includes("..")) return false;
  const prefix = uploadedImagePublicPrefix();
  if (!prefix) return false;
  return url.startsWith(prefix);
}

export function isOwnedUploadedImageUrl(
  url: string | null | undefined,
  supabaseUserId: string,
): boolean {
  if (!isAllowedProductRefUrl(url)) return false;
  const prefix = uploadedImagePublicPrefix();
  if (!prefix || !supabaseUserId) return false;
  return (url as string).startsWith(`${prefix}${supabaseUserId}/`);
}
