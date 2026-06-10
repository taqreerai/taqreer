import { headers } from "next/headers";
import { NotFoundView } from "@/components/app/NotFoundView";
import { stripLocale } from "@/lib/i18n/navigation";

// App-area route prefixes — a not-found under one of these keeps the dashboard
// chrome ("a 404 on /dashboard/… stays in the dashboard"); everything else is
// treated as public and gets the landing chrome.
const APP_SEGMENTS = new Set([
  "dashboard",
  "projects",
  "favorites",
  "library",
  "templates",
  "brand-kits",
  "settings",
  "create",
  "enhance",
  "mimic",
  "datasheet",
  "project",
  "preview",
  "use-template",
]);

// Not-found boundary for the [lang] segment — renders for the [...rest] catch-all
// (unmatched URLs) and for explicit notFound() calls outside the (app) group,
// carrying a real 404 status. It receives no params/pathname, so it reads the
// request path from the `x-pathname` header the proxy forwards, and chooses chrome
// from the first segment.
export default async function NotFound() {
  const pathname = stripLocale((await headers()).get("x-pathname") ?? "");
  const firstSeg = pathname.split("/")[1] ?? "";
  return <NotFoundView forceDashboard={APP_SEGMENTS.has(firstSeg)} />;
}
