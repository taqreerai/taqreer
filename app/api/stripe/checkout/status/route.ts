// GET /api/stripe/checkout/status?session_id=cs_...
//
// Read-only status check for the embedded-checkout RETURN page. The
// grant itself lands via the webhook (the trusted path); this only
// drives the return UX (success vs still-processing vs failed).
//
// Auth: the session must belong to the calling user - we compare the
// session's metadata.prismaUserId to the caller's row, so user A can't
// probe user B's checkout sessions.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/billing/stripe";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dbUser = await prisma.user.findUnique({
    where: { supabaseUserId: user.id },
    select: { id: true },
  });
  if (!dbUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId).catch(() => null);
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Ownership gate.
  if ((session.metadata as Record<string, string>)?.prismaUserId !== dbUser.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    status: session.status, // open | complete | expired
    paymentStatus: session.payment_status, // paid | unpaid | no_payment_required
  });
}
