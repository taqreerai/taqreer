import { inngest } from "@/inngest/client";

export const templateSave = inngest.createFunction(
  {
    id: "template-save",
    name: "Save Presentation as Template",
    retries: 2,
    triggers: [{ event: "template/save.requested" }],
  },
  async ({ event, step }) => {
    const { versionId, userId, meta } = event.data;

    const slideJson = await step.run("fetch-slide-json", async () => {
      const { prisma } = await import("@/lib/prisma");
      const version = await prisma.presentationVersion.findUnique({ where: { id: versionId } });
      if (!version) throw new Error("Version not found");
      return version.slideJson as any;
    });

    await step.run("save-template", async () => {
      const { prisma } = await import("@/lib/prisma");
      await prisma.template.create({
        data: {
          ownerId: userId,
          title: meta.name,
          category: meta.category,
          industry: meta.industry,
          language: meta.language,
          direction: slideJson.direction,
          slideCount: slideJson.slides.length,
          styleContract: slideJson,
          thumbnailUrls: [],
          isPublic: meta.isPublic,
          featured: false,
          useCount: 0,
        },
      });
    });

    return { success: true };
  }
);
