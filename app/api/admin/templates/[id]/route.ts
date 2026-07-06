// PATCH /api/admin/templates/[id] - admin curation of one template.
//
// Admin-only (requireAdminApi). Body: { isPremium?, featured?, seo? }.
//   - isPremium: flips the Pro-plan gate (enforced at use-time, 402).
//   - featured true:  append to the END of the curator's featured order so it
//     appears on the landing marquee/grid. Curator-only + must be public.
//   - featured false: clear featuredOrder (drop it from the public surfaces).
//   - seo: slug + per-locale name/description powering the public
//     /presentation-templates/[slug] detail page. Curator-only. slug must be
//     latinized kebab-case (or null to unpublish the detail page); uniqueness
//     is enforced by the DB (P2002 → 409).
// Any write busts the cached template surfaces.

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAdminApi } from "@/lib/api/admin-context";
import { prisma } from "@/lib/prisma";
import {
  MARQUEE_OWNER_EMAIL,
  revalidateTemplateSurfaces,
} from "@/lib/auth/marquee-projects";
// Shared with the Haiku auto-generation pipeline (lib/template/seo.ts) so the
// manual and generated paths enforce identical slug/text rules.
import { SLUG_RE, SLUG_MAX, SEO_TEXT_MAX } from "@/lib/template/seo";

type SeoBody = {
  slug?: string | null;
  nameAr?: string | null;
  nameEn?: string | null;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
};

// Normalize one optional SEO text field: undefined = leave unchanged,
// "" / null = clear, otherwise trim + cap. Returns { invalid } on non-strings.
function seoText(
  value: unknown,
): { value?: string | null; invalid?: boolean } {
  if (value === undefined) return {};
  if (value === null) return { value: null };
  if (typeof value !== "string") return { invalid: true };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { value: null };
  if (trimmed.length > SEO_TEXT_MAX) return { invalid: true };
  return { value: trimmed };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdminApi();
  if ("error" in ctx) return ctx.error;

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    isPremium?: boolean;
    featured?: boolean;
    seo?: SeoBody;
  } | null;
  if (
    !body ||
    (typeof body.isPremium !== "boolean" &&
      typeof body.featured !== "boolean" &&
      (typeof body.seo !== "object" || body.seo === null))
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const tpl = await prisma.template.findUnique({
    where: { id },
    select: {
      id: true,
      isPublic: true,
      featuredOrder: true,
      owner: { select: { email: true } },
    },
  });
  if (!tpl) {
    return NextResponse.json({ error: "template_not_found" }, { status: 404 });
  }

  const data: {
    isPremium?: boolean;
    featuredOrder?: number | null;
    slug?: string | null;
    nameAr?: string | null;
    nameEn?: string | null;
    descriptionAr?: string | null;
    descriptionEn?: string | null;
  } = {};

  if (typeof body.isPremium === "boolean") {
    data.isPremium = body.isPremium;
  }

  if (body.seo && typeof body.seo === "object") {
    // Detail-page metadata is curator-only, like featuring: other users'
    // templates never get public URLs.
    if (tpl.owner.email !== MARQUEE_OWNER_EMAIL) {
      return NextResponse.json({ error: "not_curator_template" }, { status: 400 });
    }

    if (body.seo.slug !== undefined) {
      if (body.seo.slug === null || body.seo.slug === "") {
        data.slug = null; // unpublish the detail page
      } else if (
        typeof body.seo.slug === "string" &&
        body.seo.slug.length <= SLUG_MAX &&
        SLUG_RE.test(body.seo.slug)
      ) {
        data.slug = body.seo.slug;
      } else {
        return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
      }
    }

    for (const key of [
      "nameAr",
      "nameEn",
      "descriptionAr",
      "descriptionEn",
    ] as const) {
      const parsed = seoText(body.seo[key]);
      if (parsed.invalid) {
        return NextResponse.json({ error: `invalid_${key}` }, { status: 400 });
      }
      if ("value" in parsed) data[key] = parsed.value;
    }
  }

  if (typeof body.featured === "boolean") {
    if (body.featured) {
      // Curator-only featuring; only public templates reach the landing.
      if (tpl.owner.email !== MARQUEE_OWNER_EMAIL) {
        return NextResponse.json({ error: "not_curator_template" }, { status: 400 });
      }
      if (!tpl.isPublic) {
        return NextResponse.json({ error: "not_public" }, { status: 400 });
      }
      // Append to the end (no-op if already featured).
      if (tpl.featuredOrder === null) {
        const agg = await prisma.template.aggregate({
          where: { owner: { email: MARQUEE_OWNER_EMAIL }, featuredOrder: { not: null } },
          _max: { featuredOrder: true },
        });
        data.featuredOrder = (agg._max.featuredOrder ?? -1) + 1;
      }
    } else {
      data.featuredOrder = null;
    }
  }

  try {
    await prisma.template.update({ where: { id }, data });
  } catch (err) {
    // Unique-violation on slug → a clear 409 instead of a generic 500.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json({ error: "slug_taken" }, { status: 409 });
    }
    throw err;
  }
  await revalidateTemplateSurfaces();
  return NextResponse.json({ ok: true });
}
