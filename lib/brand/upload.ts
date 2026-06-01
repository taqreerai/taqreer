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

// The brief shape for an uploaded brand-font family: a display name + one
// storageUrl per weight face. Shared by all four flow submit bridges (create /
// enhance / mimic / datasheet) so they build the `fonts.uploaded` payload
// identically — /api/projects validates + signs every face from here.
export type UploadedFontFieldBrief = {
  name: string;
  faces: { weight: number; storageUrl: string }[];
};

// Upload every weight face of every picked font family in one parallel pass,
// then assemble the brief payload. A face already carrying a `storageUrl`
// (hydrated from a saved kit) is reused; a freshly-picked `file` is uploaded.
// Families that resolve no faces are dropped. The `uploaded` arg is the
// `BrandFontState.uploaded` array (UploadedFontFamily[]).
export async function resolveUploadedFontFamilies(
  uploaded: {
    name: string;
    faces: { weight: number; file: File | null; storageUrl: string | null }[];
  }[],
): Promise<UploadedFontFieldBrief[]> {
  const families = await Promise.all(
    uploaded.map(async (fam) => {
      const faces = await Promise.all(
        fam.faces.map(async (face) => {
          const storageUrl = face.file
            ? (await uploadAsset("brand-assets", "fonts", face.file))
                ?.storageUrl ??
              face.storageUrl ??
              null
            : face.storageUrl ?? null;
          return storageUrl ? { weight: face.weight, storageUrl } : null;
        }),
      );
      const valid = faces.filter(
        (f): f is { weight: number; storageUrl: string } => f !== null,
      );
      return valid.length > 0 ? { name: fam.name, faces: valid } : null;
    }),
  );
  return families.filter((f): f is UploadedFontFieldBrief => f !== null);
}
