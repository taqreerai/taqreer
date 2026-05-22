// POST /api/templates/[id]/use
//
// "Start a new deck seeded from this template." Returns the template's
// BrandSnapshot + title so the client can hydrate the /create flow's
// sessionStorage keys (brand colors+fonts, output format+language)
// before navigating to step 1.
//
// Visibility gate: owner can always use their own template; non-owners
// can only use a template flagged `isPublic: true`. 403 (not 404) when
// the row exists but is gated — leaking "this template exists" to the
// requester is fine; what matters is that the gate is enforced.
// Compare with DELETE/PATCH which lean on `findFirst({ ownerId })` to
// hide existence — those are destructive and must not signal "row
// exists but you can't touch it."
//
// Side effect: atomically increments `useCount`. Powers the future
// "popular templates" sort even though no consumer exposes the field
// today; coupling the increment to a successful use here means the
// counter stays accurate without separate analytics plumbing.
//
// Response:
//   200 { title, brand: BrandSnapshot, useCount }
//   401 unauthorised
//   403 template is private + user isn't the owner
//   404 template not found
//   500 brand snapshot failed schema validation (corrupt row)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { BrandSnapshotSchema } from "@/lib/template/derive-brand";

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

  // Fetch by id only — visibility check is the next gate. This
  // contrasts with DELETE / PATCH which scope by owner up-front to
  // hide existence of others' rows; here we WANT to signal "exists
  // but locked" via 403 so the caller knows the difference between
  // "deleted" and "made private."
  const template = await prisma.template.findUnique({
    where: { id: templateId },
    select: {
      id: true,
      title: true,
      brand: true,
      isPublic: true,
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

  // Re-validate the stored snapshot. Templates persist `brand` as a
  // JSON column written at save-time; if the BrandSnapshot schema
  // shifts shape (added a required field, regex tightened) an older
  // row could fail to parse. Surface a 500 here so the client shows
  // "couldn't load template" instead of seeding garbage into the
  // create flow and crashing /create/summary mid-render.
  const parsed = BrandSnapshotSchema.safeParse(template.brand);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Template brand data is invalid" },
      { status: 500 },
    );
  }

  // Atomic useCount bump. `update` not `updateMany` since we just
  // proved the row exists — and we want the post-increment value
  // back so the client could optimistically reflect it (not exposed
  // anywhere yet, but the field is in the response for free).
  const updated = await prisma.template.update({
    where: { id: templateId },
    data: { useCount: { increment: 1 } },
    select: { useCount: true },
  });

  return NextResponse.json({
    title: template.title,
    brand: parsed.data,
    useCount: updated.useCount,
  });
}
