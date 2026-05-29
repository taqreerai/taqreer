// Client helper for the "use a template" → Mimic flow.
//
// Flow: the gallery "use" CTA navigates to /use-template/[id]. That page
// (UseTemplateClient) calls `fetchTemplateUse` (POST /api/templates/[id]/use),
// which mints a fresh Anthropic Files `file_id` for the template's deck
// PDF and returns the brand tags. `applyTemplateUse` then writes the
// branding into the SAME `CREATE_BRAND_KEY` sessionStorage that MimicFlow
// already hydrates from (so the branding card pre-fills via the existing
// pipeline — no new font-mapping), and returns the design seed MimicFlow
// needs (the file_id + title + format).
//
// The use-result is cached per template id so a refresh of
// /use-template/[id] doesn't re-mint the (paid) Anthropic upload.

import { z } from "zod";
import { BrandSnapshotSchema } from "@/lib/template/derive-brand";
import { CREATE_BRAND_KEY } from "@/lib/create/hydrate-brand-from-session";

const SLIDE_FORMAT = z.union([z.literal("16:9"), z.literal("9:16")]);

// Wire shape returned by POST /api/templates/[id]/use. Co-located with
// the client (API + client run in different bundles) so both validate
// against one definition.
export const MimicTemplateUseSchema = z.object({
  title: z.string().min(1),
  brand: BrandSnapshotSchema,
  designAnthropicFileId: z.string().min(1),
  format: SLIDE_FORMAT,
  language: z.union([z.literal("ar"), z.literal("en")]),
  isPremium: z.boolean().optional(),
  useCount: z.number().int().nonnegative().optional(),
});
export type MimicTemplateUse = z.infer<typeof MimicTemplateUseSchema>;

// The prop MimicFlow consumes in template mode — the design reference
// (preset file_id) + display + format. Branding rides separately via
// CREATE_BRAND_KEY.
export type MimicTemplateSeed = {
  id: string;
  title: string;
  designAnthropicFileId: string;
  format: "16:9" | "9:16";
};

const CACHE_PREFIX = "taqreer:mimic:templateUse:";

// Where the design reference comes from:
//   "template" → a saved Template (POST /api/templates/[id]/use)
//   "project"  → a project used directly (POST /api/projects/[id]/use-as-template)
// Both return the same MimicTemplateUse shape.
export type TemplateSource = "template" | "project";

function buildUseRoute(source: TemplateSource, id: string): string {
  const encoded = encodeURIComponent(id);
  return source === "template"
    ? `/api/templates/${encoded}/use`
    : `/api/projects/${encoded}/use-as-template`;
}

// HTTP error carrying the status so callers can branch (401 → sign in,
// 409 → still rendering).
export class TemplateUseError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "TemplateUseError";
    this.status = status;
  }
}

/** Landing pricing section — where premium-gated (402) users are sent. */
export const PRICING_HREF = "/#pricing";

/**
 * If `err` is the premium-gate 402 from the use route (premium template,
 * non-Pro user), send the user to the pricing section and return true
 * (handled). Otherwise return false so the caller can fall through to its
 * own error handling. Shared by every template "use" CTA.
 */
export function redirectToPricingIfGated(err: unknown): boolean {
  if (err instanceof TemplateUseError && err.status === 402) {
    window.location.assign(PRICING_HREF);
    return true;
  }
  return false;
}

/** POST the appropriate use route, validate the response. */
export async function fetchUse(
  source: TemplateSource,
  id: string,
): Promise<MimicTemplateUse> {
  const res = await fetch(buildUseRoute(source, id), { method: "POST" });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new TemplateUseError(
      data?.error ?? `تعذر استخدام القالب (${res.status})`,
      res.status,
    );
  }
  const parsed = MimicTemplateUseSchema.safeParse(
    await res.json().catch(() => null),
  );
  if (!parsed.success) {
    throw new TemplateUseError("تعذر قراءة بيانات القالب", 500);
  }
  return parsed.data;
}

/**
 * Write the template's branding into CREATE_BRAND_KEY (so MimicFlow's
 * existing hydration pre-fills the branding card + flips the
 * "mimic branding" toggle off) and return the design seed for MimicFlow.
 */
export function applyTemplateUse(
  templateId: string,
  use: MimicTemplateUse,
): MimicTemplateSeed {
  try {
    sessionStorage.setItem(
      CREATE_BRAND_KEY,
      JSON.stringify({
        colors: use.brand.palette,
        paletteMode: "manual",
        paletteScreenshotUrl: null,
        fonts: {
          heading: {
            name: use.brand.fontHeading.name,
            url: use.brand.fontHeading.url ?? null,
            storageUrl: null,
            family: use.brand.fontHeading.name,
          },
          body: {
            name: use.brand.fontBody.name,
            url: use.brand.fontBody.url ?? null,
            storageUrl: null,
            family: use.brand.fontBody.name,
          },
        },
        logo: null,
      }),
    );
    window.dispatchEvent(new CustomEvent("taqreer:create:state-changed"));
  } catch {
    /* best-effort — branding just won't pre-fill */
  }
  return {
    id: templateId,
    title: use.title,
    designAnthropicFileId: use.designAnthropicFileId,
    format: use.format,
  };
}

function cacheKey(source: TemplateSource, id: string): string {
  return `${CACHE_PREFIX}${source}:${id}`;
}

/**
 * Resolve a template/project for the Mimic flow IN PLACE (from the tile
 * that was clicked), so the heavy work — render PDF + mint the Anthropic
 * reference — happens behind a dimmed-thumbnail loader instead of a
 * full-screen route loader. Fetches, caches the result (so the
 * destination page renders instantly), and writes the branding session.
 * The caller then navigates to /use-template/[id] (or /project/[id]),
 * which reads the cache and shows MimicFlow with no loading screen.
 * Throws on failure so the caller can clear its busy state.
 */
export async function prepareTemplateUse(
  source: TemplateSource,
  id: string,
): Promise<void> {
  let use = readCachedUse(source, id);
  if (!use) {
    use = await fetchUse(source, id);
    writeCachedUse(source, id, use);
  }
  applyTemplateUse(id, use);
}

/** Read the cached use-result (survives refresh; avoids re-minting). */
export function readCachedUse(
  source: TemplateSource,
  id: string,
): MimicTemplateUse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(cacheKey(source, id));
    if (!raw) return null;
    const parsed = MimicTemplateUseSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeCachedUse(
  source: TemplateSource,
  id: string,
  use: MimicTemplateUse,
): void {
  try {
    window.sessionStorage.setItem(cacheKey(source, id), JSON.stringify(use));
  } catch {
    /* best-effort */
  }
}
