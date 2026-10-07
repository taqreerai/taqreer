// Streaming fallback for /enhance - mirrors the flow page's centered header +
// 2-fluid card row (min-h-[440px] rounded-2xl cards). See
// components/app/PageSkeletons.tsx.

import { FlowPageSkeleton } from "@/components/app/PageSkeletons";

export default function Loading() {
  return <FlowPageSkeleton cards={1} />;
}
