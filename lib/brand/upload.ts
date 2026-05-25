// Shared upload helper for brand assets (logo SVG/PNG, font files).
//
// Wraps POST /api/storage/upload — that route handles auth + the
// service-role write to the brand-assets bucket. Caller receives a
// bucket-relative storageUrl + the asset's metadata. Returns null
// when the input file is null, so callers can hand a possibly-null
// File without an extra branch.
//
// Extracted from /create/brand/page.tsx (2026-05-25) so /enhance can
// reuse the same upload path.

export type UploadedAsset = {
  name: string;
  storageUrl: string;
  size?: number;
  type?: string;
} | null;

export async function uploadAsset(
  bucket: "brand-assets",
  folder: string,
  file: File | null,
): Promise<UploadedAsset> {
  if (!file) return null;

  const formData = new FormData();
  formData.append("bucket", bucket);
  formData.append("folder", folder);
  formData.append("file", file);

  const response = await fetch("/api/storage/upload", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(data?.error ?? "Upload failed");
  }

  return (await response.json()) as UploadedAsset;
}
