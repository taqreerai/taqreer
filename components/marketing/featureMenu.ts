// One source of truth for the marketing feature pages (one feature per page,
// SEO 2026-10-01): their routes, menu group, and icon. Read by the navbar's
// Features dropdown (LandingNav) and the shared FeatureSpokePage. Copy lives in
// the dictionaries: landingNav.featuresMenu.items[key] (menu) and dict[key]
// (page). Icons are Material Symbol names; the AnimatedIcon registry animates
// the ones it maps (add_circle, auto_fix_high, content_copy, tag,
// photo_library, id_card) and renders the rest as static symbols.

export type FeatureKey =
  | "aiPresentations"
  | "pdfToPowerpoint"
  | "wordToPowerpoint"
  | "socialMediaPosts"
  | "redesign"
  | "presentationStyle"
  | "arabicPresentations"
  | "powerpointImages"
  | "brandKit"
  | "powerpointOnline"
  | "collaboration"
  | "exportFormats";

export type FeatureGroup = "create" | "design" | "editShare";

export type FeatureEntry = {
  key: FeatureKey;
  path: string;
  icon: string;
  group: FeatureGroup;
};

export const FEATURE_GROUPS: readonly FeatureGroup[] = ["create", "design", "editShare"];

export const FEATURES: readonly FeatureEntry[] = [
  { key: "aiPresentations", path: "/ai-presentations", icon: "add_circle", group: "create" },
  { key: "pdfToPowerpoint", path: "/pdf-to-powerpoint", icon: "picture_as_pdf", group: "create" },
  { key: "wordToPowerpoint", path: "/word-to-powerpoint", icon: "description", group: "create" },
  { key: "socialMediaPosts", path: "/social-media-posts", icon: "tag", group: "create" },
  { key: "redesign", path: "/redesign", icon: "auto_fix_high", group: "design" },
  { key: "presentationStyle", path: "/presentation-style", icon: "content_copy", group: "design" },
  { key: "arabicPresentations", path: "/arabic-presentations", icon: "format_textdirection_r_to_l", group: "design" },
  { key: "powerpointImages", path: "/powerpoint-images", icon: "photo_library", group: "design" },
  { key: "brandKit", path: "/brand-kit", icon: "id_card", group: "design" },
  { key: "powerpointOnline", path: "/powerpoint-online", icon: "edit_square", group: "editShare" },
  { key: "collaboration", path: "/collaboration", icon: "group", group: "editShare" },
  { key: "exportFormats", path: "/export", icon: "download", group: "editShare" },
];
