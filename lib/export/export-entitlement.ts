// Server-side half of the export tier gate (see lib/export/export-gating.ts
// for the format table). Resolves whether the CALLER - not the deck owner -
// may use paid export formats: exports on shared/public decks are gated by
// the exporter's own plan (user direction 2026-07-13), so a free or
// anonymous public-link viewer hits the same wall as a free owner.

import { FREE_PLAN_FEATURE_LOCKS } from "@/lib/free-trial";
import { prisma } from "@/lib/prisma";
import { isPaidPlan } from "@/lib/plan";

/**
 * True when the Supabase user behind the request is on a paid plan or is
 * an admin (superuser bypass - never gated, mirrors preflightGenerate).
 * `null` (anonymous public-link caller) is always false.
 */
export async function exporterHasPaidExports(
  supabaseUserId: string | null,
): Promise<boolean> {
  if (!supabaseUserId) return false;
  const row = await prisma.user.findUnique({
    where: { supabaseUserId },
    select: { plan: true, role: true },
  });
  if (!row) return false;
  // Free trial (lib/free-trial): every signed-in account may export.
  if (!FREE_PLAN_FEATURE_LOCKS) return true;
  return row.role === "admin" || isPaidPlan(row.plan);
}
