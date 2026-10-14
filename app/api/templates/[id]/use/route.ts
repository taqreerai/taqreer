// POST /api/templates/[id]/use
//
// "Use this template in the Mimic flow." Returns the template's brand
// tags (palette/fonts → pre-fills the Mimic branding card) AND a fresh
// Anthropic Files `file_id` for the template's stored deck PDF, which
// becomes the Mimic flow's design reference (`designAnthropicFileId`).
//
// Why mint the file_id here: Anthropic file_ids expire, so we can't
// persist one on the Template. Instead the deck PDF lives in Supabase
// (Template.pdfUrl, written by the template-render Inngest job); at
// use-time we download it and re-upload to the Files API to get a fresh
// id. This is the seam the whole "templates feed Mimic" rework hangs on.
//
// Visibility gate: owner can always use their own template; non-owners
// can only use a template flagged `isPublic: true`. 403 (not 404) when
// the row exists but is gated.
//
// Premium gate: `isPremium` templates require the paid "pro" plan
// (non-owners only — owners can always use their own). Returns 402 so
// the client can route the user to pricing. The flag also rides in the
// response so the UI can badge it.
//
// Side effect: atomically increments `useCount`.
//
// Response:
//   200 { brand, designAnthropicFileId, format, language, isPremium, useCount }
//   401 unauthorised
//   402 premium template + user isn't on the Pro plan
//   403 template is private + user isn't the owner
//   404 template not found
//   409 template PDF not rendered yet (try again shortly)
//   500 brand snapshot failed schema validation (corrupt row)
//   502 could not prepare the design reference (download / Files API)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { BrandSnapshotSchema } from "@/lib/template/derive-brand";
import { mintTemplateDesignFile } from "@/lib/template/mint-design";

// Node runtime — the Anthropic SDK + Buffer handling need it; the
// download + upload can take a few seconds for a large deck.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: templateId } = await params;

  const template = await prisma.template.findUnique({
    where: { id: templateId },
    select: {
      id: true,
      brand: true,
      pdfUrl: true,
      isPublic: true,
      isPremium: true,
      ownerId: true,
      owner: { select: { supabaseUserId: true } },
    },
  });
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const isOwner = template.owner.supabaseUserId === user.id;
  if (!isOwner && !template.isPublic) {
    return NextResponse.json(
      { error: "This template is private" },
      { status: 403 },
    );
  }

  // Premium templates are open to every plan (owner decision 2026-10-14): the
  // `isPremium` flag no longer gates use, so there is no plan lookup here.

  // Re-validate the stored snapshot (schema may have shifted since the
  // row was written). 500 so the client shows "couldn't load template"
  // rather than seeding garbage into the Mimic flow.
  const parsed = BrandSnapshotSchema.safeParse(template.brand);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Template brand data is invalid" },
      { status: 500 },
    );
  }
  const brand = parsed.data;

  // The deck PDF is rendered asynchronously by template-render. If it
  // hasn't landed yet, the template can't drive Mimic — 409 so the
  // client can ask the user to retry shortly (the tile shows a
  // "rendering" state in the gallery anyway).
  if (!template.pdfUrl) {
    return NextResponse.json(
      { error: "Template is still rendering. Try again in a moment." },
      { status: 409 },
    );
  }

  // Download the stored PDF + re-upload to the Anthropic Files API to
  // mint a fresh design-reference file_id (ids expire, so we never
  // persist one). Failures here are upstream/transient → 502.
  let designAnthropicFileId: string;
  try {
    designAnthropicFileId = await mintTemplateDesignFile(templateId, template.pdfUrl);
  } catch (err) {
    console.error("[templates/use] design reference prep failed", {
      templateId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Could not prepare the template's design reference" },
      { status: 502 },
    );
  }

  // Atomic useCount bump — only after the reference is ready, so a
  // failed prep doesn't inflate the counter.
  const updated = await prisma.template.update({
    where: { id: templateId },
    data: { useCount: { increment: 1 } },
    select: { useCount: true },
  });

  return NextResponse.json({
    brand,
    designAnthropicFileId,
    format: brand.format,
    language: brand.language,
    isPremium: template.isPremium,
    useCount: updated.useCount,
  });
}
