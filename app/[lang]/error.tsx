"use client";

import { RouteError } from "@/components/app/RouteError";

// Catch-all for the marketing and auth pages (the dashboard, studio and open
// tools have their own, which keep their chrome).
export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} where="site" />;
}
