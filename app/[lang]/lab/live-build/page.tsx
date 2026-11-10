// Lab harness for the live slide build (2026-11-10): replays a finished deck
// as a fake, bursty generation stream so the build's feel can be tuned on
// real slides at no AI cost. Dev only.

import { notFound } from "next/navigation";
import { LiveBuildLab } from "@/components/lab/LiveBuildLab";

export default function LiveBuildLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LiveBuildLab />;
}
