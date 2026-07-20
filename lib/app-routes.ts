// App-route detection by first path segment. Used to (a) pick 404 chrome and
// (b) set the body-scroll mode server-side on first paint so the RTL scrollbar
// doesn't jump from the html scrollbar (right) to the body scrollbar (left) when
// DashboardShell mounts. Keep in sync with the (app) route group folders.
export const APP_ROUTE_SEGMENTS = new Set([
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
  "social",
  "project",
  "preview",
  "use-template",
]);

// `pathname` should be locale-stripped (e.g. "/dashboard", "/project/abc").
export function isAppPath(pathname: string): boolean {
  return APP_ROUTE_SEGMENTS.has(pathname.split("/")[1] ?? "");
}
