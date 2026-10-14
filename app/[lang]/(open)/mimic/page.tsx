// /mimic - retired (2026-10-15). "Your own template" is now the "Upload your own"
// tile inside /create's Templates tab, so this route only forwards old links and
// search results there. The flow body (components/mimic/MimicFlow.tsx) still
// backs /use-template/[id].

import { redirect } from "next/navigation";

export default async function MimicPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  redirect(`/${lang}/create`);
}
