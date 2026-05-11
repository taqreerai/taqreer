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

        // Match canvas exactly: 1920×1080 px at 96dpi = 20"×11.25", scaled to a
        // standard 16:9 PPT slide (10"×5.625"). The pixel-to-inch ratio is the
        // same on both axes, so our coordinates map 1:1 with no distortion.
        pptx.layout = "LAYOUT_16x9";
        const SLIDE_W_IN = 10;
        const SLIDE_H_IN = 5.625;
        const CANVAS_W = 1920;
        const CANVAS_H = 1080;
        const toIn = (px: number, axis: "x" | "y") =>
          axis === "x" ? (px / CANVAS_W) * SLIDE_W_IN : (px / CANVAS_H) * SLIDE_H_IN;
        // Canvas-px to PPTX-pt: our 1920px canvas is rendered to a 10" slide.
        // 10" = 720pt, so 1 canvas px = 720/1920 = 0.375 pt. NOT the 0.75 pt
        // that CSS-px→pt uses at 96 DPI — that would double-size every glyph
        // because we're already scaling the whole canvas down by ~2x.
        const PX_TO_PT = (SLIDE_W_IN / CANVAS_W) * 72;
        const hexToRgb = (hex: string) => {
          const value = hex.replace("#", "");
          return value.length === 3
            ? value.split("").map((char) => char + char).join("")
            : value;
        };

        for (const slide of manifest.slides) {
          const pptSlide = pptx.addSlide();

          // Slide background — solid colors land directly; gradients can't be
          // expressed on a slide background in PptxGenJS, so we paint a
          // full-canvas rectangle to fake a 2-stop linear gradient. The
          // rectangle takes the gradient via XML once added; the high-level
          // API only does solid, so we paint the first stop as the slide bg
          // and overlay a second rect at the second stop's color with
          // transparency. Approximation, but far better than the white default.
          if (slide.background.type === "color") {
            pptSlide.background = { color: hexToRgb(slide.background.value) };
          } else {
            const stops = slide.background.gradient.stops;
            const s0 = stops[0];
            const s1 = stops[1];
            if (s0) {
              pptSlide.background = { color: hexToRgb(s0.color) };
            }
            // Overlay a half-transparent rect of the second stop to suggest
            // the gradient direction. Not a true gradient, but on-brand.
            if (s1) {
              pptSlide.addShape(pptx.ShapeType.rect, {
                x: 0,
                y: 0,
                w: SLIDE_W_IN,
                h: SLIDE_H_IN,
                fill: { color: hexToRgb(s1.color), transparency: 55 },
                line: { transparency: 100 },
              });
            }
          }

          for (const el of slide.elements) {
            const x = toIn(el.x, "x"), y = toIn(el.y, "y"), w = toIn(el.width, "x"), h = toIn(el.height, "y");
            if (el.type === "text") {
              pptSlide.addText(el.content, {
                x,
                y,
                w,
                h,
                fontFace: el.fontFamily,
                fontSize: el.fontSize * PX_TO_PT,
                bold: el.fontWeight >= 600,
                italic: el.italic,
                underline: el.underline ? { style: "sng" } : undefined,
                color: hexToRgb(el.color),
                align: el.textAlign,
                rtlMode: el.direction === "rtl",
                valign: "top",
                wrap: true,
                margin: 0,
                lineSpacingMultiple: el.lineHeight,
              });
            }
            if (el.type === "shape") {
              // Shape fill — solid hex if available, else first gradient stop.
              const fillColor =
                el.fill?.type === "color"
                  ? el.fill.value
                  : el.fill?.type === "gradient"
                    ? el.fill.gradient.stops[0]?.color
                    : undefined;
              const fill = fillColor
                ? {
                    color: hexToRgb(fillColor),
                    transparency: el.opacity === undefined ? 0 : (1 - el.opacity) * 100,
                  }
                : undefined;
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
