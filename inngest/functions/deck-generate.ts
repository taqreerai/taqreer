import { inngest } from "@/inngest/client";

export const deckGenerate = inngest.createFunction(
  {
    id: "deck-generate",
    name: "Generate Presentation Deck",
    retries: 3,
    triggers: [{ event: "deck/generate.requested" }],
  },
  async ({ event, step }) => {
    const { projectId, brief } = event.data;

    const slideJson = await step.run("call-claude-generate", async () => {
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
          messages: [{ role: "user", content: `Generate slides for: ${JSON.stringify(brief)}` }],
        }),
      });
      if (!response.ok) throw new Error(`Claude API error: ${response.status}`);
      const data = await response.json();
      const content = data.content[0]?.text;
      if (!content) throw new Error("No content from Claude");
      return JSON.parse(content.replace(/```json|```/g, "").trim());
    });

    const validated = await step.run("validate-slide-json", async () => {
      const { SlideManifestSchema } = await import("@/lib/schema/slide");
      const result = SlideManifestSchema.safeParse(slideJson);
      if (!result.success) throw new Error(`Zod validation failed: ${JSON.stringify(result.error.issues)}`);
      return result.data;
    });

    await step.run("save-to-database", async () => {
      const { prisma } = await import("@/lib/prisma");
      await prisma.presentationVersion.create({
        data: {
          presentation: { connect: { projectId } },
          versionNumber: 1,
          slideJson: validated as any,
          status: "completed",
        },
      });
    });

    return { success: true, projectId };
  }
);
