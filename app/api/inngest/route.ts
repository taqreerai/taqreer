import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import {
  deckGenerate,
  deckImagesGenerate,
  deckImageWarm,
  deckRegeneratePartial,
  brandAnalyze,
  templateRender,
  thumbnailRender,
  extractSource,
  creditsMaintenance,
} from "@/inngest/index";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    deckGenerate,
    deckImagesGenerate,
    deckImageWarm,
    deckRegeneratePartial,
    brandAnalyze,
    templateRender,
    thumbnailRender,
    extractSource,
    creditsMaintenance,
  ],
});
