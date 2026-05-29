// /use-template/project/[id] — "use this project as a template" →
// forked Mimic flow. Same client driver, sourced from a project: it
// renders the project's deck to PDF + mints the Anthropic reference on
// the fly (nothing persisted), then renders MimicFlow in template mode.

import UseTemplateClient from "@/components/mimic/UseTemplateClient";

export default async function UseProjectAsTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <UseTemplateClient source="project" id={id} />;
}
