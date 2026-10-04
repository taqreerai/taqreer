// GET /api/referral - the signed-in user's invite code + stats for the
// invite card (lib/referral.ts). The code is minted on first request.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import {
  INVITEE_BONUS,
  INVITER_REWARD,
  MONTHLY_REWARD_CAP,
  getOrCreateReferralCode,
  referralStats,
} from "@/lib/referral";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dbUser = await prisma.user.findUnique({
    where: { supabaseUserId: user.id },
    select: { id: true, bannedAt: true },
  });
  if (!dbUser || dbUser.bannedAt) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const [code, stats] = await Promise.all([
    getOrCreateReferralCode(dbUser.id),
    referralStats(dbUser.id),
  ]);
  return NextResponse.json({
    code,
    inviteeBonus: INVITEE_BONUS,
    inviterReward: INVITER_REWARD,
    monthlyCap: MONTHLY_REWARD_CAP,
    ...stats,
  });
}
