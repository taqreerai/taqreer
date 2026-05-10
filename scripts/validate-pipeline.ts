/**
 * Pipeline Validation Script
 * Run: npx ts-node --esm scripts/validate-pipeline.ts
 *
 * Tests:
 * 1. Zod schema validation (pass + fail)
 * 2. JSON → PPTX via PptxGenJS
 *
 * Open the output PPTX in PowerPoint and verify:
 * - Arabic text is connected (not broken letters)
 * - Font is Cairo
 * - Layout matches the sample manifest
 */

import * as path from "path";
import * as fs from "fs";
import PptxGenJS from "pptxgenjs";
import { SlideManifestSchema, SlideManifest } from "../lib/schema/slide.js";
import { sampleManifest } from "../lib/test/sample-manifest.js";

const OUTPUT_DIR = path.join(process.cwd(), "test-output");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

// Convert 1920x1080 canvas coords to PptxGenJS inches (10x7.5 slide)
function toInches(px: number, axis: "x" | "y"): number {
  const SLIDE_W_IN = 10;
  const SLIDE_H_IN = 5.63;
  const CANVAS_W = 1920;
  const CANVAS_H = 1080;
  return axis === "x"
    ? (px / CANVAS_W) * SLIDE_W_IN
    : (px / CANVAS_H) * SLIDE_H_IN;
}

function ptToIn(pt: number): number {
  return pt / 72;
}

// ─── Step 1: Validate Schema ──────────────────────────────────────────────────

function testSchemaValidation() {
  console.log("\n─── Step 1: Zod Schema Validation ───────────────────────────");

  // Test valid manifest
  const result = SlideManifestSchema.safeParse(sampleManifest);
  if (result.success) {
    console.log("✅ Valid manifest passes Zod schema");
  } else {
    console.error("❌ Valid manifest failed Zod schema:", result.error.format());
    process.exit(1);
  }

  // Test invalid manifest
  const badManifest = {
    version: "1.0",
    presentationId: "bad_test",
    language: "ar",
    direction: "rtl",
    canvas: { width: 1920, height: 1080 },
    fonts: {
      heading: { name: "Cairo", url: "not-a-url" }, // ← invalid URL
      body: { name: "Cairo", url: "https://valid.com/font.woff2" },
    },
    palette: {
      primary: "blue", // ← not a hex color
      secondary: "#E036B8",
      background: "#03030D",
      text: "#FFFFFF",
      muted: "#9A94A8",
    },
    slides: [], // ← empty slides array
  };

  const badResult = SlideManifestSchema.safeParse(badManifest);
  if (!badResult.success) {
    console.log("✅ Invalid manifest correctly rejected by Zod schema");
    console.log("   Errors caught:", badResult.error.issues.map((e) => e.message).join(", "));
  } else {
    console.error("❌ Invalid manifest incorrectly passed Zod schema");
    process.exit(1);
  }
}

// ─── Step 2: Generate PPTX ────────────────────────────────────────────────────

async function generatePptx(manifest: SlideManifest) {
  console.log("\n─── Step 2: JSON → PPTX via PptxGenJS ───────────────────────");

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 16:9

  for (const slide of manifest.slides) {
    const pptSlide = pptx.addSlide();

    // Background
    if (slide.background.type === "color") {
      pptSlide.background = { color: slide.background.value.replace("#", "") };
    } else if (slide.background.type === "gradient") {
      const { stops } = slide.background.gradient;
      pptSlide.background = {
        color: stops[0].color.replace("#", ""),
      };
    }

    for (const el of slide.elements) {
      const x = toInches(el.x, "x");
      const y = toInches(el.y, "y");
      const w = toInches(el.width, "x");
      const h = toInches(el.height, "y");

      if (el.type === "text") {
        pptSlide.addText(el.content, {
          x,
          y,
          w,
          h,
          fontFace: el.fontFamily,
          fontSize: el.fontSize * 0.75, // pt to px rough conversion
          bold: el.fontWeight ? el.fontWeight >= 600 : false,
          italic: el.italic ?? false,
          underline: el.underline ? { style: "sng" } : undefined,
          color: el.color.replace("#", ""),
          align: el.textAlign === "right" ? "right" : el.textAlign === "center" ? "center" : "left",
          rtlMode: el.direction === "rtl",
          valign: "top",
          wrap: true,
        });
      }

      if (el.type === "shape") {
        const shapeMap: Record<string, string> = {
          rectangle: "rect",
          circle: "ellipse",
          ellipse: "ellipse",
          triangle: "triangle",
          line: "line",
        };

        let fillColor = "TRANSPARENT";
        if (el.fill?.type === "color") {
          fillColor = el.fill.value.replace("#", "");
        } else if (el.fill?.type === "gradient") {
          fillColor = el.fill.gradient.stops[0].color.replace("#", "");
        }

        pptSlide.addShape(shapeMap[el.kind] as any, {
          x,
          y,
          w,
          h,
          fill: { color: fillColor },
          line: { color: "TRANSPARENT", width: 0 },
        });
      }

      if (el.type === "image") {
        pptSlide.addImage({
          path: el.src,
          x,
          y,
          w,
          h,
        });
      }
    }
  }

  const outputPath = path.join(OUTPUT_DIR, "pipeline-test.pptx");
  await pptx.writeFile({ fileName: outputPath });
  console.log(`✅ PPTX generated → ${outputPath}`);
  console.log("   Open in PowerPoint and verify:");
  console.log("   • Arabic text is connected (مرحباً — not broken letters)");
  console.log("   • Font appears as Cairo");
  console.log("   • Layout matches expected positions");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🔍 Taqreer Pipeline Validation Test");
  console.log("=====================================");

  ensureOutputDir();

  // Step 1: Schema validation
  testSchemaValidation();

  // Step 2: Generate PPTX
  await generatePptx(sampleManifest);

  console.log("\n=====================================");
  console.log("✅ Script complete. Check test-output/ folder.");
  console.log("Next: open pipeline-test.pptx in PowerPoint and verify Arabic rendering.");
}

main().catch((err) => {
  console.error("❌ Pipeline validation failed:", err);
  process.exit(1);
});
