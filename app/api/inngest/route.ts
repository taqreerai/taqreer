import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import {
  deckGenerate,
  deckImagesGenerate,
  deckImageWarm,
  deckRegeneratePartial,
  deckUnlock,
  brandAnalyze,
  templateRender,
  templateSeoGenerate,
  thumbnailRender,
  deckFreezeBake,
  extractSource,
  creditsMaintenance,
  notificationsCleanup,
  sourceFilesCleanup,
} from "@/inngest/index";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    deckGenerate,
    deckImagesGenerate,
    deckImageWarm,
    deckRegeneratePartial,
    deckUnlock,
    brandAnalyze,
    templateRender,
    templateSeoGenerate,
    thumbnailRender,
  deckFreezeBake,
    extractSource,
    creditsMaintenance,
    notificationsCleanup,
    sourceFilesCleanup,
  ],
});
