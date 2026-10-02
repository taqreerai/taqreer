// /use-template/[id] — legacy "use this saved template" entry. Since the
// 2026-10-02 Design-step rework, templates are picked inside /create, so this
// route just forwards there with the template preselected (old links and
// bookmarks keep working). /use-template/project/[id] (a project used
// directly as a template) still renders the forked Mimic flow.

import { redirect } from "next/navigation";

export default async function UseTemplatePage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const { lang, id } = await params;
  redirect(`/${lang}/create?template=${encodeURIComponent(id)}`);
}
