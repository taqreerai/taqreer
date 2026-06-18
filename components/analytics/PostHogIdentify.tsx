"use client";

// Links PostHog events to the signed-in person. Split out of PostHogProvider and
// mounted ONLY in the (app) layout so the Supabase client (useUser) it depends on
// is never bundled into the static marketing pages — anon marketing visitors
// don't need identifying, and person_profiles is "identified_only" anyway.
//
// distinct_id = Supabase auth uid so future server-side events (posthog-node)
// link to the same person. No-ops until PostHog is actually booted (consent
// granted) per posthogStarted().

import { useEffect } from "react";
import posthog from "posthog-js";
import { useUser } from "@/hooks/useUser";
import { posthogStarted } from "@/components/analytics/PostHogProvider";

export function PostHogIdentify() {
  const { user } = useUser();

  useEffect(() => {
    if (!posthogStarted()) return;
    if (user) {
      posthog.identify(user.id, user.email ? { email: user.email } : undefined);
    } else {
      posthog.reset();
    }
  }, [user]);

  return null;
}
