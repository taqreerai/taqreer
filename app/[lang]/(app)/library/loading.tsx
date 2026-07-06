// Streaming fallback for /library - the page mirrors the /projects browse
// structure (header + filters row + 5-column thumbnail grid), so the shared
// BrowsePageSkeleton matches it 1:1. See components/app/PageSkeletons.tsx.

import { BrowsePageSkeleton } from "@/components/app/PageSkeletons";

export default function Loading() {
  return <BrowsePageSkeleton />;
}
