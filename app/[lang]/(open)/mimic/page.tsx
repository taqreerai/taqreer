// /mimic - retired (2026-10-15). "Your own template" is now the "Upload your own"
// tile inside /create's Templates tab, so this route only forwards old links and
// search results there. The flow body (components/mimic/MimicFlow.tsx) still
// backs /use-template/[id].

import { redirect } from "next/navigation";
import { defaultLocale, isLocale } from "@/lib/i18n/config";

export default async function MimicPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  // Only a real locale ever reaches the redirect target (never the raw segment).
  redirect(`/${isLocale(lang) ? lang : defaultLocale}/create`);
}
