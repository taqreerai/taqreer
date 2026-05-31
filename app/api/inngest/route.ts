import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import {
  deckGenerate,
  deckImagesGenerate,
  deckRegeneratePartial,
  brandAnalyze,
  templateRender,
  thumbnailRender,
  extractSource,
} from "@/inngest/index";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    deckGenerate,
    deckImagesGenerate,
    deckRegeneratePartial,
    brandAnalyze,
    templateRender,
    thumbnailRender,
    extractSource,
  ],
});
