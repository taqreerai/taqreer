// PATCH /api/admin/settings/tiers/[plan] - admin edits a tier's knobs
// (monthly credits, signup grant = free credits, slide cap, unlocked presets,
// flows). Price is display-only and not editable here. Admin-only.

import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api/admin-context";
import {
  updateTier,
  parseTierInput,
  ValidationError,
} from "@/lib/config/settings-mutations";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ plan: string }> },
) {
  const ctx = await requireAdminApi();
  if ("error" in ctx) return ctx.error;
  const { plan } = await params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    await updateTier(ctx.userId, plan, parseTierInput(body));
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[settings/tiers] update failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
