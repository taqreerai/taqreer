// /use-template/[id] — "use this template" → forked Mimic flow.
//
// Thin server wrapper: unwraps the route param and hands off to the
// client driver, which resolves the template (minting the Anthropic
// design reference) and renders MimicFlow in template mode.

import UseTemplateClient from "@/components/mimic/UseTemplateClient";

export default async function UseTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <UseTemplateClient templateId={id} />;
}
