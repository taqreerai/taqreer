import { inngest } from "@/inngest/client";
import { z } from "zod";

const HexColor = z
  .string()
  .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, "Must be a hex color e.g. #FF0000");

const BrandKitSchema = z.object({
  palette: z.object({
    primary: HexColor,
    secondary: HexColor,
    background: HexColor,
    text: HexColor,
    muted: HexColor,
  }),
  typography: z.object({
    headingFont: z.string().nullable(),
    bodyFont: z.string().nullable(),
  }),
});

export const brandAnalyze = inngest.createFunction(
  {
    id: "brand-analyze",
    name: "Analyze Brand Assets",
    retries: 3,
    triggers: [{ event: "brand.analyze.requested" }],
  },
  async ({ event, step }) => {
    const { screenshotUrl } = event.data;

    const brandKit = await step.run("call-claude-vision", async () => {
      const imageRes = await fetch(screenshotUrl);
      const buffer = await imageRes.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      const mimeType = imageRes.headers.get("content-type") || "image/png";

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-opus-4-5",
          max_tokens: 1024,
          system: `Extract brand colors and typography from images. Return ONLY JSON: { "palette": { "primary": "#HEX", "secondary": "#HEX", "background": "#HEX", "text": "#HEX", "muted": "#HEX" }, "typography": { "headingFont": "name or null", "bodyFont": "name or null" } }`,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
              { type: "text", text: "Extract the brand colors and typography from this image." },
            ],
          }],
        }),
      });

      if (!response.ok) throw new Error(`Claude API error: ${response.status}`);
      const data = await response.json();
      const content = data.content[0]?.text;
      if (!content) throw new Error("No content from Claude");
      const parsed = JSON.parse(content.replace(/```json|```/g, "").trim());
      const result = BrandKitSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(`Brand kit validation failed: ${JSON.stringify(result.error.issues)}`);
      }
      return result.data;
    });

    return { success: true, brandKit };
  }
);
