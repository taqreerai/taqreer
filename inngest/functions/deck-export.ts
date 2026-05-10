import { inngest } from "@/inngest/client";

export const deckExport = inngest.createFunction(
  {
    id: "deck-export",
    name: "Export Presentation",
    retries: 2,
    triggers: [{ event: "deck/export.requested" }],
  },
  async ({ event, step }) => {
    const { projectId, versionId, format, userId } = event.data;

    const slideJson = await step.run("fetch-slide-json", async () => {
      const { prisma } = await import("@/lib/prisma");
      const version = await prisma.presentationVersion.findUnique({ where: { id: versionId } });
      if (!version) throw new Error("Version not found");
      return version.slideJson;
    });

    if (format === "pptx") {
      const pptxBuffer = await step.run("generate-pptx", async () => {
        const PptxGenJS = (await import("pptxgenjs")).default;
        const manifest = slideJson as any;
        const pptx = new PptxGenJS();
        pptx.layout = "LAYOUT_WIDE";

        const SLIDE_W_IN = 10, SLIDE_H_IN = 5.63, CANVAS_W = 1920, CANVAS_H = 1080;
        const toIn = (px: number, axis: "x" | "y") =>
          axis === "x" ? (px / CANVAS_W) * SLIDE_W_IN : (px / CANVAS_H) * SLIDE_H_IN;

        for (const slide of manifest.slides) {
          const pptSlide = pptx.addSlide();
          if (slide.background.type === "color") {
            pptSlide.background = { color: slide.background.value.replace("#", "") };
          }
          for (const el of slide.elements) {
            const x = toIn(el.x, "x"), y = toIn(el.y, "y"), w = toIn(el.width, "x"), h = toIn(el.height, "y");
            if (el.type === "text") {
              pptSlide.addText(el.content, { x, y, w, h, fontFace: el.fontFamily, fontSize: el.fontSize * 0.75, bold: el.fontWeight >= 600, color: el.color.replace("#", ""), align: el.textAlign, rtlMode: el.direction === "rtl", valign: "top", wrap: true });
            }
          }
        }
        return await pptx.write({ outputType: "nodebuffer" });
      });

      const signedUrl = await step.run("upload-pptx", async () => {
        const { createClient } = await import("@supabase/supabase-js");
        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
        const fileName = `exports/${userId}/${projectId}-${Date.now()}.pptx`;
        await supabase.storage.from("generated-presentations").upload(fileName, pptxBuffer as Buffer, { contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
        const { data } = await supabase.storage.from("generated-presentations").createSignedUrl(fileName, 3600);
        return data?.signedUrl;
      });

      return { success: true, signedUrl, format: "pptx" };
    }

    throw new Error(`Unknown format: ${format}`);
  }
);
