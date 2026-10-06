import "server-only";

// Materialize the signed-in Supabase user's Prisma row and land the one-time
// signup grant (+ welcome email) if it never happened. Extracted 2026-10-06
// from the dashboard page, which was the landing for every signup path; the
// open /create page is now a second landing (a visitor signs up from its
// Create button and comes straight back), so both call this.
//
// Single round trip: the upsert IS the existence check (empty update returns
// the existing row; a brand-new user comes back with creditAccount null,
// which is exactly what gates the grant). The grant is idempotent under a row
// lock (signupGrantedAt); abuse checks live in maybeGrantSignupCredits, and a
// failure or block just leaves the balance untouched (never breaks a render).

import type { User } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { maybeGrantSignupCredits } from "@/lib/credits/signup";
import { dispatchWelcomeEmail } from "@/lib/email/send-welcome";
import { signupGeoFromHeaders } from "@/lib/api/geo";
import { deviceIdFromCookies } from "@/lib/device-cookie";

export async function ensureAppUser(user: User, lang: string) {
  // Signup forensics (first-seen IP/geo) - stamped on CREATE only.
  const hdrs = await headers();
  const geo = signupGeoFromHeaders(hdrs);

  const dbUser = await prisma.user.upsert({
    where: { supabaseUserId: user.id },
    update: {},
    create: {
      supabaseUserId: user.id,
      email: user.email ?? `${user.id}@supabase.local`,
      name: user.user_metadata?.name ?? user.user_metadata?.full_name ?? null,
      image: user.user_metadata?.avatar_url ?? null,
      plan: "free",
      signupIp: geo.ip,
      signupCountry: geo.country,
      signupCity: geo.city,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      bannedAt: true,
      creditAccount: { select: { signupGrantedAt: true } },
    },
  });

  if (!dbUser.creditAccount?.signupGrantedAt && !dbUser.bannedAt) {
    const grant = await maybeGrantSignupCredits({
      userId: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      ip: geo.ip,
      deviceId: deviceIdFromCookies(await cookies()),
      geo,
    }).catch(() => null);
    // Welcome email, once, when THIS path lands the grant - mirrors user-sync
    // and projects. Fire-and-forget; never blocks the render.
    if (grant && grant.granted > 0) {
      void dispatchWelcomeEmail({
        toEmail: dbUser.email,
        metadataLang: user.user_metadata?.lang,
        cookieHeader: hdrs.get("cookie"),
        fallbackLocale: lang,
        appOrigin: process.env.NEXT_PUBLIC_SITE_URL ?? "https://taqreer.ai",
        freeCredits: grant.granted,
      });
    }
  }

  return dbUser;
}
