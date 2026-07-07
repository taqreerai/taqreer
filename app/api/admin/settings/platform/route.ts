// PATCH /api/admin/settings/platform - admin edits platform-wide pricing
// knobs (currently: imageCredits, the per-generated-image surcharge on
// images-mode decks). Admin-only.

import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api/admin-context";
import {
  updatePlatformSettings,
  ValidationError,
} from "@/lib/config/settings-mutations";

export async function PATCH(request: Request) {
  const ctx = await requireAdminApi();
  if ("error" in ctx) return ctx.error;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    // NaN for absent/empty input (not 0, which would silently make
    // images free) - updatePlatformSettings rejects NaN with a 400.
    const raw = String(body.imageCredits ?? "").trim();
    const imageCredits = raw === "" ? NaN : Number(raw);
    await updatePlatformSettings(ctx.userId, { imageCredits });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[settings/platform] update failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
