import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { deckGenerate, brandAnalyze, templateSave } from "@/inngest/index";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [deckGenerate, brandAnalyze, templateSave],
});
