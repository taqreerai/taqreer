// Seed the create-from-template flow.
//
// Called by TemplateLightbox and TemplateActionsMenu when the user
// hits "Use this template." Fetches the template's BrandSnapshot via
// POST /api/templates/[id]/use, hydrates the SAME sessionStorage keys
// the normal /create flow uses (so the parallel /create-from-template
// pages can read identical shapes), and writes a `templateSeed`
// marker the /create-from-template pages key off of for their seed
// guard + the "from template: <title>" pill.
//
// Navigation target is /create-from-template/content (the parallel
// 2-step route tree, not /create). Callers are responsible for the
// router.push / window.location.assign call.
//
// Storage shape contract — must match what /app/create/* read:
//
//   taqreer:create:templateSeed  (NEW — only set in template mode)
//     { id, title, brand: BrandSnapshot }
//     • Presence flips CREATE_STEPS to the 2-step layout.
//     • `id` is sent back with POST /api/projects so the server can
//       attribute the deck to its source template (future analytics).
//     • `title` drives the "إنشاء من قالب: <title>" pill on step 1.
//
//   taqreer:create:brand
//     Same shape the brand page writes on its handleNext (read by
//     summary + by the brand page if the user comes back). Filled
//     entirely from the BrandSnapshot:
//       colors        ← brand.palette
//       paletteMode   ← "manual"     (templates have no source screenshot)
//       fonts.heading ← { name, url, storageUrl: null, family: null }
//       fonts.body    ← same shape
//       logo          ← null         (template carries no logo by policy
//                                     — see derive-brand.ts header)
//
//   taqreer:create:output
//     Two fields the BrandSnapshot dictates; everything else (slide
//     count mode, rules, persistent overlay, logo placement) is left
//     undefined so step 1's hydrate paths fall back to defaults.
//       slideSize ← brand.format
//       language  ← brand.language
//
// Content (`taqreer:create:content`) is NOT touched — the user picks
// content themselves on step 1, which is the point of "use this
// template." We don't clear an existing content blob either; the user
// confirmed: starting from a template means a fresh content state,
// but we don't actively wipe in case they had drafted something
// they wanted to keep across the seed.

import { BrandSnapshotSchema, type BrandSnapshot } from "@/lib/template/derive-brand";
import { z } from "zod";

// Wire shape returned by POST /api/templates/[id]/use. Schema lives
// here (not imported from the route) because the API and the client
// run in different bundles; co-locating the schema with the client
// keeps both the response-parsing and the storage-rehydrate paths
// validating against the same definition.
const UseTemplateResponseSchema = z.object({
  title: z.string().min(1),
  brand: BrandSnapshotSchema,
  useCount: z.number().int().nonnegative(),
});

const TemplateSeedSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  brand: BrandSnapshotSchema,
});

export const TEMPLATE_SEED_KEY = "taqreer:create:templateSeed";
export const CREATE_BRAND_KEY = "taqreer:create:brand";
export const CREATE_OUTPUT_KEY = "taqreer:create:output";

export type TemplateSeed = {
  id: string;
  title: string;
  brand: BrandSnapshot;
};

// Inferred from the schema so the type stays in lockstep with the
// runtime validator (single source of truth).
export type UseTemplateResponse = z.infer<typeof UseTemplateResponseSchema>;

/**
 * Fire the POST /api/templates/[id]/use endpoint, get the snapshot,
 * write all three sessionStorage keys. Throws on network / HTTP /
 * parse failure so the caller can surface an error toast.
 *
 * Does NOT navigate — the caller decides when to router.push so it
 * can wrap the call in a loading state.
 */
export async function seedFromTemplate(
  templateId: string,
): Promise<TemplateSeed> {
  const response = await fetch(`/api/templates/${templateId}/use`, {
    method: "POST",
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(
      data?.error ?? `تعذر استخدام القالب (${response.status})`,
    );
  }
  // Validate the response shape at runtime — the API returns this
  // contract today, but a deploy mismatch (older client, newer
  // server response with a missing field) would otherwise propagate
  // garbage into sessionStorage and crash the create flow downstream.
  // Fail fast here so the caller's error toast surfaces a meaningful
  // message instead of a "cannot read brand.palette" later.
  const rawBody = await response.json().catch(() => null);
  const parsed = UseTemplateResponseSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new Error(
      `تعذر قراءة بيانات القالب (${parsed.error.issues[0]?.message ?? "invalid response"})`,
    );
  }
  const { brand, title } = parsed.data;

  // ─── Write taqreer:create:templateSeed ─────────────────────────────
  const seed: TemplateSeed = { id: templateId, title, brand };
  sessionStorage.setItem(TEMPLATE_SEED_KEY, JSON.stringify(seed));

  // ─── Write taqreer:create:brand ────────────────────────────────────
  // Shape mirrors what /create/brand handleNext writes. Templates carry
  // a `font.url` for Google-loaded fonts; uploaded brand fonts are also
  // stored as { name, url? } in the BrandSnapshot, so the same field
  // maps cleanly.
  sessionStorage.setItem(
    CREATE_BRAND_KEY,
    JSON.stringify({
      colors: brand.palette,
      paletteMode: "manual",
      paletteScreenshotUrl: null,
      fonts: {
        heading: {
          name: brand.fontHeading.name,
          url: brand.fontHeading.url ?? null,
          storageUrl: null,
          family: brand.fontHeading.name,
        },
        body: {
          name: brand.fontBody.name,
          url: brand.fontBody.url ?? null,
          storageUrl: null,
          family: brand.fontBody.name,
        },
      },
      logo: null,
    }),
  );

  // ─── Write taqreer:create:output ───────────────────────────────────
  // Read-modify-write so we don't wipe anything the user might have
  // typed (slide count, persistent overlay, etc.) in a previous fresh
  // create attempt. The two fields the template fixes are slideSize
  // and language.
  let existingOutput: Record<string, unknown> = {};
  try {
    const raw = sessionStorage.getItem(CREATE_OUTPUT_KEY);
    if (raw) existingOutput = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* corrupt blob — start fresh */
  }
  sessionStorage.setItem(
    CREATE_OUTPUT_KEY,
    JSON.stringify({
      ...existingOutput,
      slideSize: brand.format,
      language: brand.language,
    }),
  );

  // Notify the stepper (and any other create-flow listeners) that
  // storage changed. Inline custom-event dispatch instead of importing
  // CreateStepper's `notifyCreateStateChange` to avoid pulling a
  // "use client" component module into this helper's import graph —
  // this file is consumed by client components but stays framework-
  // agnostic itself. Same event name CreateStepper subscribes to.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("taqreer:create:state-changed"));
  }

  return seed;
}

/**
 * Read the templateSeed marker. Returns null if not in template mode,
 * the blob is missing/corrupt, OR fails schema validation. Safe to
 * call during SSR (returns null when sessionStorage is unavailable).
 *
 * Validation matters even though we wrote the blob ourselves — a
 * BrandSnapshot schema bump or a stray edit in another tab could
 * leave a stale-shaped blob in storage. Returning null here makes the
 * /create-from-template pages bounce to the normal /create flow,
 * which is the right fallback for an unreadable seed.
 */
export function readTemplateSeed(): TemplateSeed | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(TEMPLATE_SEED_KEY);
    if (!raw) return null;
    const parsed = TemplateSeedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Clear the templateSeed marker. Called by /create/summary after a
 * successful POST /api/projects so the next /create visit starts in
 * normal 3-step mode. Not called on cancel — we keep the seed alive
 * across navigation so the user can poke around the create flow and
 * come back without re-fetching.
 */
export function clearTemplateSeed(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(TEMPLATE_SEED_KEY);
  } catch {
    /* best-effort */
  }
}
