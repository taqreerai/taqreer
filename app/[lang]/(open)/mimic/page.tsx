// /mimic — standalone Mimic flow (upload your own design reference).
// The flow body lives in components/mimic/MimicFlow.tsx, shared with
// /use-template/[id] (template mode). This route just renders it in
// the default standalone mode.

import MimicFlow from "@/components/mimic/MimicFlow";

export default function MimicPage() {
  return <MimicFlow />;
}
