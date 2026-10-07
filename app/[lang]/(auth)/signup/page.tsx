"use client";

// Signup page: the shared SignupForm inside the auth-layout modal (the page
// wordmark + legal fine print live in `(auth)/layout.tsx`).

import { SignupForm } from "@/components/auth/SignupForm";
import { useAuthNext } from "@/components/auth/useAuthNext";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";

export default function SignupPage() {
  const { locale } = useLocale();
  // Post-auth redirect target (open-redirect guard lives in useAuthNext). The
  // Google button resolves the SAME target, so email and Google signup land in
  // the same place.
  const { nextUrl, templateId } = useAuthNext();
  return (
    <SignupForm
      nextUrl={nextUrl}
      templateId={templateId}
      loginHref={localizedHref("/login", locale)}
    />
  );
}
