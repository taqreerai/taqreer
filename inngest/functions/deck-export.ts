import type { Prisma } from "@prisma/client";
import { inngest } from "@/inngest/client";
import { SlideManifestSchema } from "@/lib/schema/slide";

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export const deckExport = inngest.createFunction(
  {
    id: "deck-export",
    name: "Export Presentation",
    retries: 2,
    triggers: [{ event: "deck.export.requested" }],
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
  async ({ event, step, logger }) => {
    const { projectId, versionId, format, userId, jobId } = event.data as {
      projectId: string;
      versionId: string;
      format: "pptx" | "pdf";
      userId: string;
      jobId?: string;
    };

    const slideJson = await step.run("fetch-slide-json", async () => {
      const { prisma } = await import("@/lib/prisma");
      const version = await prisma.presentationVersion.findUnique({ where: { id: versionId } });
      if (!version) throw new Error("Version not found");
      return version.slideJson;
    });

    if (format === "pptx") {
      const pptxBuffer = await step.run("generate-pptx", async () => {
        const PptxGenJS = (await import("pptxgenjs")).default;
        const manifest = SlideManifestSchema.parse(slideJson);
        const pptx = new PptxGenJS();
        pptx.layout = "LAYOUT_WIDE";

        const SLIDE_W_IN = 10, SLIDE_H_IN = 5.63, CANVAS_W = 1920, CANVAS_H = 1080;
        const toIn = (px: number, axis: "x" | "y") =>
          axis === "x" ? (px / CANVAS_W) * SLIDE_W_IN : (px / CANVAS_H) * SLIDE_H_IN;
        const hexToRgb = (hex: string) => {
          const value = hex.replace("#", "");
          return value.length === 3
            ? value.split("").map((char) => char + char).join("")
            : value;
        };

        for (const slide of manifest.slides) {
          const pptSlide = pptx.addSlide();
          if (slide.background.type === "color") {
            pptSlide.background = { color: hexToRgb(slide.background.value) };
          }
          for (const el of slide.elements) {
            const x = toIn(el.x, "x"), y = toIn(el.y, "y"), w = toIn(el.width, "x"), h = toIn(el.height, "y");
            if (el.type === "text") {
              pptSlide.addText(el.content, { x, y, w, h, fontFace: el.fontFamily, fontSize: el.fontSize * 0.75, bold: el.fontWeight >= 600, color: hexToRgb(el.color), align: el.textAlign, rtlMode: el.direction === "rtl", valign: "top", wrap: true });
            }
            if (el.type === "shape") {
              const fill = el.fill?.type === "color" ? { color: hexToRgb(el.fill.value), transparency: el.opacity === undefined ? 0 : (1 - el.opacity) * 100 } : undefined;
              const line = el.border ? { color: hexToRgb(el.border.color), width: el.border.width } : { transparency: 100 };
              const shapeType =
                el.kind === "circle" || el.kind === "ellipse" ? pptx.ShapeType.ellipse :
                el.kind === "triangle" ? pptx.ShapeType.triangle :
                el.kind === "line" ? pptx.ShapeType.line :
                pptx.ShapeType.rect;

              if (el.kind === "line") {
                pptSlide.addShape(shapeType, { x, y, w, h, line, rotate: el.rotation });
              } else {
                pptSlide.addShape(shapeType, { x, y, w, h, fill, line, rotate: el.rotation });
              }
            }
            if (el.type === "image") {
              pptSlide.addImage({ path: el.src, x, y, w, h, rotate: el.rotation, transparency: el.opacity === undefined ? 0 : (1 - el.opacity) * 100 });
            }
          }
        }
        return await pptx.write({ outputType: "nodebuffer" });
      });

      const signedUrl = await step.run("upload-pptx", async () => {
        const { createClient } = await import("@supabase/supabase-js");
        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
        const fileName = `exports/${userId}/${projectId}-${Date.now()}.pptx`;
        const { error: uploadError } = await supabase.storage.from("generated-presentations").upload(fileName, pptxBuffer as unknown as Buffer, { contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
        if (uploadError) throw new Error(`Supabase upload failed: ${uploadError.message}`);

        const { data, error: urlError } = await supabase.storage.from("generated-presentations").createSignedUrl(fileName, 3600);
        if (urlError) throw new Error(`Supabase signed URL failed: ${urlError.message}`);
        if (!data?.signedUrl) throw new Error("Supabase signed URL missing from response");
        return data.signedUrl;
      });

      if (jobId) {
        await step.run("update-job-success", async () => {
          const { prisma } = await import("@/lib/prisma");
          await prisma.job.update({
            where: { id: jobId },
            data: {
              status: "succeeded",
              outputJson: toJson({ signedUrl, format: "pptx" }),
            },
          });
        });
      }

      logger.info("export_complete", { projectId, format: "pptx" });
      return { success: true, signedUrl, format: "pptx" };
    }

    throw new Error(`Unsupported export format: ${format}. Only "pptx" is implemented.`);
  }
);
