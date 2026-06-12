"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    // Instant paint from the locally-cached session (no network) - the menu
    // mounts its own hook instance on open, and waiting on getUser()'s
    // round-trip made the email pop in late (user report 2026-06-13).
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser((u) => u ?? session.user);
        setLoading(false);
      }
    });

    // Authoritative refresh: getUser() validates against the server (catches
    // revoked sessions / stale cached emails) and overwrites the quick value.
    const getUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);
      setLoading(false);
    };

    getUser();

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  const avatarUrl: string | null = user?.user_metadata?.avatar_url ?? null;
  const name: string =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    "User";
  const email: string = user?.email ?? "";

  return { user, loading, avatarUrl, name, email };
}
