"use client";

// "Use this template" CTA for the template detail pages. A thin client island
// over the shared useUseTemplate flow so the page itself stays a static RSC.

import { useUseTemplate } from "@/hooks/useUseTemplate";

export function UseTemplateCta({
  templateId,
  label,
  busyLabel,
}: {
  templateId: string;
  label: string;
  busyLabel: string;
}) {
  const { busy, startTemplateUse } = useUseTemplate();
  return (
    <button
      type="button"
      onClick={() => startTemplateUse(templateId)}
      disabled={busy}
      className="btn-gradient-anim inline-block rounded-full px-8 py-3 text-sm font-medium disabled:opacity-70"
    >
      {busy ? busyLabel : label}
    </button>
  );
}
