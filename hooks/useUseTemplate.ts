"use client";

// Shared "use this template" client flow — the single implementation behind
// the landing/hub lightbox CTA (LandingTemplatesGrid) and the template detail
// page CTA (UseTemplateCta).
//
// Logged-out → straight to the signup funnel (no seed work). Logged-in →
// mint the Mimic reference behind the CTA's busy spinner, then hard-navigate
// to the (now-cached) use flow. The seed logic (lib/mimic/template-seed)
// pulls zod (~280 KB), so it's dynamically imported at click-time — it never
// ships in the static marketing bundles. 402 (premium template, user isn't on
// the gated plan) routes to pricing via redirectToPricingIfGated.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { useIsAuthed } from "@/hooks/useIsAuthed";
import { localizedHref } from "@/lib/i18n/navigation";

export function useUseTemplate(opts?: {
  // Called when the premium gate fired and the user was routed to pricing —
  // lets the caller close its lightbox / release UI state.
  onGated?: () => void;
}) {
  const { locale } = useLocale();
  const isAuthed = useIsAuthed();
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  // Not "useXxx": this is a plain async action, and a use-prefixed name would
  // trip react-hooks/rules-of-hooks at the call sites.
  const startTemplateUse = async (templateId: string) => {
    if (busy) return;
    if (!isAuthed) {
      router.push(localizedHref("/signup", locale));
      return;
    }
    setBusy(true);
    const { prepareTemplateUse, redirectToPricingIfGated } = await import(
      "@/lib/mimic/template-seed"
    );
    try {
      await prepareTemplateUse("template", templateId);
      window.location.assign(`/use-template/${templateId}`);
    } catch (err) {
      if (redirectToPricingIfGated(err)) {
        setBusy(false);
        opts?.onGated?.();
        return;
      }
      console.warn("[useUseTemplate] use prep failed", err);
      setBusy(false);
    }
  };

  return { busy, startTemplateUse };
}
