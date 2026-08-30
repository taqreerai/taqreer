// Streaming fallback for /create - mirrors the wizard layout (2026-08-30):
// centered header + ONE card visible per step (min-h-[440px] rounded-2xl).
// See components/app/PageSkeletons.tsx.

import { FlowPageSkeleton } from "@/components/app/PageSkeletons";

export default function Loading() {
  return <FlowPageSkeleton cards={1} />;
}
