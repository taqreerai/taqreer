// Shared type for the /templates page + its client subtree.
//
// Extends TemplateTileData with:
//   • thumbnailUrls — the 4 showcase PNGs the lightbox renders
//   • language — for the language filter chip (ar/en)
//   • isMine    — set true for templates owned by the viewing user,
//                 false for community templates surfaced via isPublic.
//                 Drives the owner-filter chip (خاصة/المجتمع/الكل).
//
// Kept here so the server page can import without pulling in
// TemplateTile's client-only deps.

import type { TemplateTileData } from "@/components/app/TemplateTile";

export type TemplateForBrowse = TemplateTileData & {
  thumbnailUrls: string[];
  language: string;
  isMine: boolean;
  // True when the template row exists but Inngest hasn't finished
  // rendering the 4 showcase PNGs yet. Drives auto-refresh via
  // useRefreshWhileThumbnailsPending — without it, a freshly-saved
  // template appears in the list but clicking it shows an empty
  // lightbox until the user manually reloads. The hook polls
  // ~3 s and ~8 s after the first pending render.
  thumbnailsPending: boolean;
};
