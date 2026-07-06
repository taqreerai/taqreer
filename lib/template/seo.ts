// Template SEO copy: shared validation constants + pure helpers for the
// auto-generation pipeline (inngest/functions/template-seo-generate.ts) and
// the manual admin editor (app/api/admin/templates/[id]/route.ts).
//
// The Haiku output is UNTRUSTED model output derived from user deck content
// (prompt-injection surface): everything here validates/normalizes before a
// single byte reaches the DB or a public page. House copy rules are enforced
// mechanically where possible: no em/en dash, Latin numerals only,
// tashkeel-free Arabic, brand spelled "taqreer.ai".

import { z } from "zod";

// Latinized kebab-case, e.g. "business-pitch". Mirrored client-side in the
// admin SEO editor.
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_MAX = 80;
export const SEO_TEXT_MAX = 300;

// What we ask Haiku to return (structured output). Kept permissive here;
// hard limits are applied by normalizeSeoDraft below.
export const SeoDraftSchema = z.object({
  nameAr: z.string(),
  nameEn: z.string(),
  descriptionAr: z.string(),
  descriptionEn: z.string(),
  slug: z.string(),
});
export type SeoDraft = z.infer<typeof SeoDraftSchema>;

// Plain-text extraction from slide HTML fragments — same lightweight regex
// pattern deck-generate.ts uses for language detection (strip <style> and
// <svg> subtrees, then all tags). Slides are fragments, not documents, so a
// full DOM parse buys nothing here.
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// The deck content given to Haiku: title + per-slide text, capped so a huge
// deck can't blow up the prompt (or the bill).
const DECK_TEXT_CAP = 4000;
export function extractDeckText(manifest: {
  title: string;
  slides: { html: string }[];
}): string {
  const parts = [manifest.title.trim()];
  for (const slide of manifest.slides) {
    const text = htmlToText(slide.html);
    if (text) parts.push(text);
  }
  return parts.join("\n\n").slice(0, DECK_TEXT_CAP);
}

// House copy rules applied mechanically to generated text:
//   - em/en dashes -> comma-space / hyphen (never ship a dash)
//   - Arabic-Indic + Extended digits -> Latin (0-9 only, even in Arabic copy)
//   - tashkeel (Arabic diacritics + tatweel) stripped (SEO rule)
//   - bidi controls + zero-width chars stripped (visual-spoofing hardening:
//     these survive JSX/JSON-LD escaping and could reorder SERP snippets)
export function applyCopyRules(text: string): string {
  return text
    .replace(/—/g, ", ") // em dash
    .replace(/–/g, "-") // en dash
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[ـً-ْٰ]/g, "") // tatweel + tashkeel
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Latinized kebab-case fallback when the model's slug is unusable. Works off
// the EN name (ASCII); returns null when nothing latinizable remains.
export function slugifyName(name: string): string | null {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
  return SLUG_RE.test(slug) ? slug : null;
}

export type NormalizedSeoDraft = {
  nameAr: string | null;
  nameEn: string | null;
  descriptionAr: string | null;
  descriptionEn: string | null;
  slug: string | null;
};

// Normalize the raw model draft into DB-safe values. Any field can come back
// unusable -> null (callers write what survived; the template stays valid
// without SEO copy). The slug falls back to a latinized nameEn.
export function normalizeSeoDraft(draft: SeoDraft): NormalizedSeoDraft {
  const text = (value: string): string | null => {
    const cleaned = applyCopyRules(value).slice(0, SEO_TEXT_MAX).trim();
    return cleaned.length > 0 ? cleaned : null;
  };
  const nameAr = text(draft.nameAr);
  const nameEn = text(draft.nameEn);
  const descriptionAr = text(draft.descriptionAr);
  const descriptionEn = text(draft.descriptionEn);

  const rawSlug = draft.slug.trim().toLowerCase();
  let slug: string | null =
    rawSlug.length > 0 && rawSlug.length <= SLUG_MAX && SLUG_RE.test(rawSlug)
      ? rawSlug
      : null;
  if (!slug && nameEn) slug = slugifyName(nameEn);

  return { nameAr, nameEn, descriptionAr, descriptionEn, slug };
}
