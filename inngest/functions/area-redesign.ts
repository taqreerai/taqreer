import { inngest } from "@/inngest/client";
import { SlideManifestSchema } from "@/lib/schema/slide";

export const areaRedesign = inngest.createFunction(
  {
    id: "area-redesign",
    name: "Redesign Slide Areas",
    retries: 3,
    triggers: [{ event: "area.redesign.requested" }],
  },
  async ({ event, step }) => {
    const { projectId, versionId, slides } = event.data;

    const updatedSlides = await step.run("call-claude-redesign", async () => {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-opus-4-5",
          max_tokens: 8192,
          system: `You are Taqreer's slide redesign engine. Only modify specified element IDs. Return ONLY valid JSON for updated slides.`,
          messages: [{
            role: "user",
            content: `Redesign these areas based on comments: ${JSON.stringify(slides)}`,
          }],
        }),
      });

      if (!response.ok) throw new Error(`Claude API error: ${response.status}`);
      const data = await response.json();
      const content = data.content[0]?.text;
      if (!content) throw new Error("No content from Claude");
      return JSON.parse(content.replace(/```json|```/g, "").trim());
    });

    const validated = await step.run("validate-updated-slides", async () => {
      const result = SlideManifestSchema.safeParse(updatedSlides);
      if (!result.success) {
        throw new Error(`Zod validation failed: ${JSON.stringify(result.error.issues)}`);
      }
      return result.data;
    });

    await step.run("save-updated-version", async () => {
      const { prisma } = await import("@/lib/prisma");
      const current = await prisma.presentationVersion.findUnique({ where: { id: versionId } });
      if (!current) throw new Error("Version not found");
      await prisma.presentationVersion.create({
        data: {
          presentationId: current.presentationId,
          versionNumber: current.versionNumber + 1,
          slideJson: validated,
          status: "completed",
        },
      });
    });

    return { success: true, projectId };
  }
);
