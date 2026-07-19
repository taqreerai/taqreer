// GET /api/ads/signup-conversion
//
// Tells the client whether to fire the Google Ads "Sign-up" conversion for the
// signed-in user. Called once on the dashboard by <SignupConversion/> - the
// page every signup path (email-instant, email-confirm, Google OAuth) lands on.
//
// Why a server route instead of pasting the event snippet on the page? Google's
// stock instructions ("put the snippet on the thank-you page") would fire on
// EVERY dashboard load, i.e. every login - wildly over-counting. The real
// "new account" signal is server-side: CreditAccount.signupGrantedAt, the same
// idempotent anchor the one-time credit grant keys off. We fire only while that
// is fresh, set a one-shot cookie so refreshes don't re-query, and hand the
// client a transaction_id (the user id) so Google dedupes to one conversion per
// user, ever - belt-and-suspenders on top of the cookie.
//
// No-ops (fire:false) when NEXT_PUBLIC_GOOGLE_ADS_ID is unset, so local / preview
// never touch the Ads account.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { clientIp, rateLimited } from "@/lib/api/rate-limit";

const ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
// The Sign-up conversion label from the Ads account (public value - Google has
// you paste it into page HTML). Combined with the account id from env so a
// preview build with no id stays tag-free.
const SIGNUP_LABEL = "bTk9CLC-jdIcEJK96qRE";

// Guard against re-querying on every dashboard visit. Not httpOnly so the client
// can short-circuit the fetch when it is already set.
const DONE_COOKIE = "tq_sconv";
// Only fire while the grant is fresh. Signup -> dashboard is seconds (for
// email-confirm/OAuth the grant lands at confirm/callback time, moments before
// the dashboard render), so 30 min is generous while barely back-counting any
// signup that predates this feature.
const FRESH_MS = 30 * 60_000;

const noFire = () => NextResponse.json({ fire: false });

export async function GET(request: Request) {
  const limited = rateLimited(`ads-conv:${clientIp(request)}`, 60, 5 * 60_000);
  if (limited) return limited;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse(null, { status: 204 });

  // Already checked once for this browser - nothing more to do.
  const jar = await cookies();
  if (jar.get(DONE_COOKIE)) return noFire();

  const dbUser = await prisma.user.findUnique({
    where: { supabaseUserId: user.id },
    select: {
      id: true,
      creditAccount: { select: { signupGrantedAt: true } },
    },
  });

  const grantedAt = dbUser?.creditAccount?.signupGrantedAt;
  const fresh = !!grantedAt && Date.now() - grantedAt.getTime() < FRESH_MS;

  // Set the one-shot cookie in BOTH branches: a returning user never needs to be
  // asked again, and a fresh user has fired (transaction_id dedupes anyway).
  const res =
    fresh && ADS_ID && dbUser
      ? NextResponse.json({
          fire: true,
          sendTo: `${ADS_ID}/${SIGNUP_LABEL}`,
          transactionId: dbUser.id,
        })
      : noFire();

  res.cookies.set(DONE_COOKIE, "1", {
    path: "/",
    maxAge: 34_560_000, // 400 days (Chrome's cookie cap)
    sameSite: "lax",
  });
  return res;
}
