// /use-template/[id] — "use this saved template" → forked Mimic flow.
// Thin server wrapper; the client driver resolves the template (minting
// the Anthropic design reference) and renders MimicFlow in template mode.

import UseTemplateClient from "@/components/mimic/UseTemplateClient";

export default async function UseTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <UseTemplateClient source="template" id={id} />;
}
