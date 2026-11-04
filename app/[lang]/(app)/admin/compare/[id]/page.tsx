// Admin > Compare one deck (server): the original upload beside the generated
// slides, for checking by eye what carried over and what went wrong.

import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/api/admin-context";
import { CompareClient } from "@/components/admin/CompareClient";
import { prisma } from "@/lib/prisma";
import { SlideManifestSchema } from "@/lib/schema/slide";

export const dynamic = "force-dynamic";

export default async function AdminCompareDeckPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      type: true,
      createdAt: true,
      teaserLockedCount: true,
      user: { select: { email: true, plan: true } },
      presentation: { select: { currentVersionId: true } },
    },
  });
  if (!project) notFound();

  const versionId = project.presentation?.currentVersionId;
  const version = versionId
    ? await prisma.presentationVersion.findUnique({ where: { id: versionId }, select: { slideJson: true } })
    : null;
  const parsed = version ? SlideManifestSchema.safeParse(version.slideJson) : null;
  const job = await prisma.job.findFirst({
    where: { projectId: id, type: "deck.generate" },
    orderBy: { createdAt: "desc" },
    select: { model: true, status: true },
  });

  return (
    <CompareClient
      projectId={project.id}
      title={project.title}
      flow={project.type}
      owner={project.user.email}
      plan={project.user.plan}
      createdAt={project.createdAt.toISOString()}
      model={job?.model ?? null}
      jobStatus={job?.status ?? null}
      lockedCount={project.teaserLockedCount ?? 0}
      manifest={parsed?.success ? parsed.data : null}
    />
  );
}
