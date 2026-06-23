// POST /api/admin/settings/presets - admin creates a generation preset.
// Admin-only. Validates, writes in a transaction that bumps configVersion +
// audits, then invalidates the runtime-config cache (see settings-mutations.ts).

import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api/admin-context";
import {
  createPreset,
  parsePresetInput,
  ValidationError,
} from "@/lib/config/settings-mutations";

export async function POST(request: Request) {
  const ctx = await requireAdminApi();
  if ("error" in ctx) return ctx.error;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    await createPreset(ctx.userId, parsePresetInput(body));
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[settings/presets] create failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
