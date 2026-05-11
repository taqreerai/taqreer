import type { Prisma } from "@prisma/client";
import { inngest } from "@/inngest/client";

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export const templateSave = inngest.createFunction(
  {
    id: "template-save",
    name: "Save Presentation as Template",
    retries: 2,
    triggers: [{ event: "template.save.requested" }],
    onFailure: async ({ event, error }) => {
      const jobId = (event.data.event?.data as { jobId?: string } | undefined)?.jobId;
      if (!jobId) return;
      const { prisma } = await import("@/lib/prisma");
      await prisma.job
        .update({
          where: { id: jobId },
          data: {
            status: "failed",
            outputJson: toJson({ error: error.message ?? String(error) }),
          },
        })
        .catch(() => undefined);
    },
  },
  async ({ event, step }) => {
    const { versionId, userId, meta, jobId } = event.data as {
      versionId: string;
      userId: string;
      jobId?: string;
      meta: {
        name: string;
        category: string;
        industry: string;
        language: string;
        isPublic: boolean;
      };
    };

    const slideJson = await step.run("fetch-slide-json", async () => {
      const { prisma } = await import("@/lib/prisma");
      const version = await prisma.presentationVersion.findUnique({ where: { id: versionId } });
      if (!version) throw new Error("Version not found");
      return version.slideJson as { direction: string; slides: unknown[] };
    });

    const template = await step.run("save-template", async () => {
      const { prisma } = await import("@/lib/prisma");
      return prisma.template.create({
        data: {
          ownerId: userId,
          title: meta.name,
          category: meta.category,
          industry: meta.industry,
          language: meta.language,
          direction: slideJson.direction,
          slideCount: slideJson.slides.length,
          styleContract: slideJson as Prisma.InputJsonValue,
          thumbnailUrls: [],
          isPublic: meta.isPublic,
          featured: false,
          useCount: 0,
        },
        select: { id: true, title: true },
      });
    });

    if (jobId) {
      await step.run("update-job-success", async () => {
        const { prisma } = await import("@/lib/prisma");
        await prisma.job.update({
          where: { id: jobId },
          data: {
            status: "succeeded",
            outputJson: toJson({
              templateId: template.id,
              templateTitle: template.title,
            }),
          },
        });
      });
    }

    return { success: true, templateId: template.id };
  },
);
