import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import {
  deckGenerate,
  brandAnalyze,
  areaRedesign,
  deckExport,
  templateSave,
} from "@/inngest/index";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    deckGenerate,
    brandAnalyze,
    areaRedesign,
    deckExport,
    templateSave,
  ],
});
