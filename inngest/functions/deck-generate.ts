import { inngest } from "@/inngest/client";
import { SlideManifestSchema } from "@/lib/schema/slide";
import { getPostHogClient } from "@/lib/posthog-server";

export const deckGenerate = inngest.createFunction(
  {
    id: "deck-generate",
    name: "Generate Presentation Deck",
    retries: 3,
    triggers: [{ event: "deck.generate.requested" }],
  },
  async ({ event, step }) => {
    const { projectId, brief, userId } = event.data;

    const validated = await step.run("generate-and-validate-slide-json", async () => {
      let prompt = `Generate slides for: ${JSON.stringify(brief)}`;
      let lastError: string | undefined;

      for (let attempt = 1; attempt <= 3; attempt += 1) {
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
            system: `You are Taqreer's presentation design engine. Generate slide JSON manifests for Arabic RTL presentations. Return ONLY valid JSON — no markdown, no explanation.`,
            messages: [{ role: "user", content: prompt }],
          }),
        });
        if (!response.ok) throw new Error(`Claude API error: ${response.status}`);
        const data = await response.json();
        const content = data.content[0]?.text;
        if (!content) throw new Error("No content from Claude");

        let slideJson: unknown;
        try {
          slideJson = JSON.parse(content.replace(/```json|```/g, "").trim());
        } catch (error) {
          lastError = `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`;
          prompt += `\n\nPrevious attempt failed validation:\n${lastError}\nReturn corrected JSON only.`;
          continue;
        }

        const result = SlideManifestSchema.safeParse(slideJson);
        if (result.success) return result.data;

        lastError = JSON.stringify(result.error.issues);
        prompt += `\n\nPrevious attempt failed Zod validation:\n${lastError}\nReturn corrected JSON only.`;
      }

      throw new Error(`Zod validation failed after 3 attempts: ${lastError}`);
    });

    await step.run("save-to-database", async () => {
      const { prisma } = await import("@/lib/prisma");
      const latestVersion = await prisma.presentationVersion.findFirst({
        where: { presentation: { projectId } },
        orderBy: { versionNumber: "desc" },
        select: { versionNumber: true },
      });

      await prisma.presentationVersion.create({
        data: {
          presentation: { connect: { projectId } },
          versionNumber: (latestVersion?.versionNumber ?? 0) + 1,
          slideJson: validated,
          status: "completed",
        },
      });
    });

    await step.run("track-presentation-generated", async () => {
      if (userId) {
        const posthog = getPostHogClient();
        posthog.capture({
          distinctId: userId,
          event: "presentation_generated",
          properties: { project_id: projectId },
        });
        await posthog.shutdown();
      }
    });

    return { success: true, projectId };
  }
);
