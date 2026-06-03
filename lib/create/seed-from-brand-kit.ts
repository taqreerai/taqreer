// Seed any of the four landing flows from a saved brand kit.
//
// Called by `BrandKitsPageClient` (tile click → use-dialog → flow
// pick). POSTs to `/api/brand-kits/[id]/use` to fetch the validated
// kit data + a freshly-signed logo URL, writes the same
// `taqreer:create:brand` sessionStorage key the existing four
// landing flows (/create, /enhance, /mimic, /datasheet) already
// consume on mount, then asks the caller to navigate.
//
// Mirrors `lib/create/seed-from-template.ts` in shape — the only
// differences:
//   - The kit DOES carry a logo (templates don't) - written into the
//     brand blob's `logo` field.
//   - No `templateSeed` marker is written: brand-kit seeding is
//     transient (use once, no recurring "from kit" pill).
//   - No `output` (slideSize / language) write - the kit doesn't
//     pin those. Users still pick on the landing flow.

import { z } from "zod";

export const CREATE_BRAND_KEY = "taqreer:create:brand";

// Valid flow targets — must match the four landing pages.
export type BrandKitTargetFlow = "create" | "enhance" | "mimic" | "datasheet";

// API response contract — validated at runtime so a deploy mismatch
// (older client, newer server response) fails fast with a meaningful
// error instead of writing garbage into sessionStorage.
const UseBrandKitResponseSchema = z.object({
  name: z.string(),
  colors: z.unknown(),
  fonts: z.unknown(),
  logo: z
    .object({
      storageUrl: z.string().nullable(),
      signedUrl: z.string().nullable(),
      name: z.string().nullable(),
      position: z.string(),
      exclude: z.array(z.enum(["cover", "closing"])),
    })
    .nullable(),
});

// Best-effort JSON body read — returns null when the response isn't
// valid JSON (e.g. a network proxy returning HTML on 502).
async function readJsonBody(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

// Read the existing brand blob so we don't clobber unrelated fields
// (logo position the user just tweaked, paletteMode, etc.). Returns
// an empty object when the key is missing or corrupt.
function readExistingBrand(): Record<string, unknown> {
  try {
    const raw = sessionStorage.getItem(CREATE_BRAND_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Hit the kit's `/use` endpoint, write `taqreer:create:brand`,
 * dispatch the create-state-changed event so any stepper that
 * happens to be mounted re-reads its blob. Does NOT navigate —
 * the caller decides when to `window.location.assign` so it can
 * wrap the call in a loading state.
 *
 * Throws on network / HTTP / parse failure so the caller can
 * surface an error toast.
 */
export async function seedFromBrandKit(kitId: string): Promise<void> {
  const response = await fetch(`/api/brand-kits/${kitId}/use`, {
    method: "POST",
  });

  if (!response.ok) {
    const errorBody = (await readJsonBody(response)) as { error?: string } | null;
    throw new Error(
      errorBody?.error ?? `تعذر استخدام هوية الشركة (${response.status})`,
    );
  }

  const parsed = UseBrandKitResponseSchema.safeParse(await readJsonBody(response));
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "invalid response";
    throw new Error(`تعذر قراءة بيانات هوية الشركة (${message})`);
  }
  const { colors, fonts, logo } = parsed.data;

  // Read-modify-write so unrelated fields (paletteMode, logo position
  // the user just tweaked, etc.) survive the seed. The four landing
  // flows consume this same shape on mount.
  const existingBrand = readExistingBrand();
  const nextLogo = logo
    ? {
        name: logo.name,
        storageUrl: logo.storageUrl,
        // `url` is the runtime preview src — LogoUploadSlot reads it
        // when rendering the filled state. The brief submission re-
        // signs `storageUrl` server-side, so we don't need a long-
        // lived URL here.
        url: logo.signedUrl,
        exclude: logo.exclude,
      }
    : null;

  try {
    sessionStorage.setItem(
      CREATE_BRAND_KEY,
      JSON.stringify({
        ...existingBrand,
        colors,
        paletteMode: "manual",
        fonts,
        logo: nextLogo,
      }),
    );
  } catch (err) {
    // Quota exceeded / disabled storage (private mode). Non-fatal — the
    // brand seed just won't pre-fill; the user can re-enter it. Don't
    // throw and break the flow.
    console.error("[seed-from-brand-kit] sessionStorage write failed:", err);
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("taqreer:create:state-changed"));
  }
}
