import { z } from "zod";

// HTML-first deck schema (v2 — the dom-to-pptx pivot).
//
// Claude emits a JSON manifest where each slide is a string of HTML/CSS.
// The browser does layout; `dom-to-pptx` measures the rendered DOM; our
// `bidi-postprocess` fixes the OOXML BiDi metadata. No coordinate math,
// no bbox arithmetic, no per-element discriminated union — Claude is a
// designer, not a layout engine.
//
// CRITICAL: keep this schema permissive. The whole point of the pivot is
// to stop fighting Claude with rigid Zod retries that burn 10 minutes
// generating a single deck. Validate the SHAPE, not the content.

const HexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3,4}){1,2}$/);
const Direction = z.enum(["rtl", "ltr"]);

const FontDefinition = z.object({
  name: z.string().min(1),
  // System fonts (Arial, Cairo if pre-installed) don't need a webfont URL.
  // The renderer + dom-to-pptx fall back to the system font when absent.
  url: z.string().url().optional(),
});

const Theme = z.object({
  // Brand accent palette (3–8 hex). Exposed as CSS vars
  // --brand-1, --brand-2, ... by the renderer.
  palette: z.array(HexColor).min(2).max(8),
  // Heading + body fonts. Exposed as --font-heading, --font-body.
  fontHeading: FontDefinition,
  fontBody: FontDefinition,
  // Background + text colors for the chrome. Claude picks these.
  background: HexColor,
  text: HexColor,
});

const Slide = z.object({
  slideId: z.string().min(1),
  role: z
    .enum(["cover", "section", "content", "stats", "quote", "image", "closing"])
    .optional(),
  // Body HTML — no <!DOCTYPE>, <html>, <head>, <body> wrapper. The
  // renderer wraps each slide in a 1920×1080 container with the theme
  // CSS vars and the document direction set on the root.
  // <style>, <svg>, <link>, <img> tags are allowed; <script>, event
  // handlers, javascript: URIs are stripped by DOMPurify in the renderer.
  html: z.string().min(1),
});

export const SlideManifestSchema = z.object({
  version: z.literal("2.0"),
  presentationId: z.string().min(1),
  // 3–8 word presentation title — becomes dashboard title + export
  // filename. Generic "عرض تقديمي" is rejected by the prompt rather
  // than the schema; the schema just guards length.
  title: z.string().trim().min(1).max(160),
  language: z.enum(["ar", "en"]),
  direction: Direction,
  theme: Theme,
  slides: z.array(Slide).min(1),
  // Streaming progress, written during generation and removed once final.
  // Optional so the schema validates both transient and final states.
  progress: z
    .object({
      stage: z.string(),
      currentSlide: z.number(),
      estimatedTotal: z.number(),
    })
    .optional(),
});

export type SlideManifest = z.infer<typeof SlideManifestSchema>;
export type SlideType = z.infer<typeof Slide>;
export type ThemeType = z.infer<typeof Theme>;
