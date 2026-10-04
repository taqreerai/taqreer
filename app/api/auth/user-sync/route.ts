import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { maybeGrantSignupCredits } from "@/lib/credits/signup";
import { REFERRAL_COOKIE } from "@/lib/referral-code";
import { clientIp, rateLimited } from "@/lib/api/rate-limit";
import { signupGeoFromHeaders } from "@/lib/api/geo";
import { deviceIdFromCookies } from "@/lib/device-cookie";
import { fanOutNotification } from "@/lib/notifications/server";
import { dispatchWelcomeEmail } from "@/lib/email/send-welcome";
import { captureServerEvent } from "@/lib/analytics/posthog-server";

export async function POST(request: Request) {
  try {
    // Flood guard before the Supabase round-trip. The 400-credit grant is
    // already idempotent (signupGrantedAt); this just stops hammering. Lean
    // generous - a shared NAT IP hits this on every member's login.
    const limited = rateLimited(`auth-sync:${clientIp(request)}`, 60, 5 * 60_000);
    if (limited) return limited;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profile = {
      email: user.email ?? `${user.id}@supabase.local`,
      name: user.user_metadata?.name ?? user.user_metadata?.full_name ?? null,
      image: user.user_metadata?.avatar_url ?? null,
    };

    // Read the prior row (for the email-change check) AND its signup-grant
    // state BEFORE the upsert. The signup grant keys off signupGrantedAt,
    // not row-existence, so a row another path already created (dashboard /
    // projects / invite) still gets granted on this first authenticated sync.
    const existing = await prisma.user.findUnique({
      where: { supabaseUserId: user.id },
      select: {
        id: true,
        email: true,
        creditAccount: { select: { signupGrantedAt: true } },
      },
    });

    // Signup forensics (first-seen IP/geo) - stamped on CREATE only, never
    // refreshed on later syncs.
    const geo = signupGeoFromHeaders(request.headers);

    // `language` is intentionally NOT in `update` — a returning user keeps
    // their saved choice; a brand-new row takes the column default ("ar").
    const dbUser = await prisma.user.upsert({
      where: { supabaseUserId: user.id },
      update: profile,
      create: {
        supabaseUserId: user.id,
        ...profile,
        plan: "free",
        signupIp: geo.ip,
        signupCountry: geo.country,
        signupCity: geo.city,
      },
      select: { id: true, language: true },
    });

    // Email-change confirmation landed (settings flow, 2026-06-12): the
    // Supabase email differs from the mirrored Prisma row the upsert just
    // replaced - tell the user via the bell. Fire-and-forget.
    if (existing && existing.email !== profile.email) {
      void fanOutNotification({
        type: "account.email_changed",
        projectId: null,
        actorPrismaUserId: dbUser.id,
        recipientUserIds: [dbUser.id],
        allowSelfEcho: true,
        payload: { email: profile.email },
      });
    }

    // One-time Free signup grant (billing plan Phase A). GATED ON
    // signupGrantedAt (the idempotent "already granted" anchor), NOT on
    // whether THIS request created the User row: four paths upsert the User
    // (user-sync, dashboard, projects, invite) and the dashboard/invite
    // ones create it WITHOUT granting, so keying off row-existence skipped
    // the grant whenever one of those won the race. Idempotent under a row
    // lock (fires once across racing syncs) and self-heals on a later sync
    // if an earlier one missed it. Plus the email-alias + IP-velocity abuse
    // checks. Never fails the sync - a blocked/failed grant just leaves 0.
    if (!existing?.creditAccount?.signupGrantedAt) {
      // Conversion-funnel step 1/4: fires once per NEW user (this block is the
      // idempotent first-sync anchor, reached by every signup path).
      // distinctId = Supabase uid to match the client posthog.identify(user.id).
      captureServerEvent(user.id, "signed_up", { email: profile.email });

      const grant = await maybeGrantSignupCredits({
        userId: dbUser.id,
        email: profile.email,
        name: profile.name,
        ip: geo.ip,
        deviceId: deviceIdFromCookies(await cookies()),
      referralCode: (await cookies()).get(REFERRAL_COOKIE)?.value ?? null,
        geo,
      }).catch((err) => {
        console.error(
          "[user-sync] signup grant failed:",
          err instanceof Error ? err.message : String(err),
        );
        return null;
      });

      // Welcome email — once, fire-and-forget (never blocks/fails the sync).
      // Gated on the grant actually landing (granted > 0): atomic under the
      // grant's row lock, so it never double-sends across racing first-syncs
      // (and the projects route fires the SAME dispatcher when IT wins the
      // grant, so the welcome sends from whichever route grants). A
      // farming-blocked account (0 credits) gets none. First authenticated
      // sync, so confirm-email signups get it AFTER confirmation.
      if (grant && grant.granted > 0) {
        void dispatchWelcomeEmail({
          toEmail: profile.email,
          metadataLang: user.user_metadata?.lang,
          cookieHeader: request.headers.get("cookie"),
          fallbackLocale: dbUser.language,
          appOrigin: process.env.NEXT_PUBLIC_SITE_URL ?? "https://taqreer.ai",
          freeCredits: grant.granted,
        });
      }
    }

    // Seed the locale cookie from the account language so a login on a NEW
    // browser/device lands in the user's saved language (the proxy reads only
    // the cookie — it can't reach Prisma at the edge).
    const res = NextResponse.json({ ok: true });
    if (isLocale(dbUser.language)) {
      res.cookies.set(LOCALE_COOKIE, dbUser.language, {
        path: "/",
        maxAge: 31536000,
        sameSite: "lax",
      });
    }
    return res;
  } catch (err) {
    // Log only the message to avoid surfacing PII (Supabase user object,
    // email, headers) into server logs. The stack trace stays on the Error
    // instance for the runtime's own error tracking; we just don't print
    // the whole `err` shape.
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[user-sync] failed:", message);
    return NextResponse.json({ error: "User sync failed" }, { status: 500 });
  }
}
