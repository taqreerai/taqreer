"use client";

// Sign-out button for the /banned gate. A banned user keeps a valid Supabase
// session (the ban is a local flag), so this lets them leave the suspended
// state / switch accounts. Mirrors the logout in ProfileMenuContent.

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { localizedHref } from "@/lib/i18n/navigation";
import type { Locale } from "@/lib/i18n/config";

export function BannedSignOut({
  locale,
  label,
}: {
  locale: Locale;
  label: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  const onSignOut = async () => {
    await supabase.auth.signOut();
    router.push(localizedHref("/login", locale));
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={onSignOut}
      className="btn-pill px-5 py-2.5 text-sm font-medium"
    >
      {label}
    </button>
  );
}
