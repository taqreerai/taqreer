import { Inngest } from "inngest";
import { UsageContextMiddleware } from "./usage-middleware";

export const inngest = new Inngest({
  id: "taqreer",
  name: "Taqreer",
  // Re-applies AI cost attribution inside every step (inngest/usage-middleware.ts).
  middleware: [UsageContextMiddleware],
});
