// TEMP - Phase 0 mock data for the static admin console. Each export is the
// exact shape its screen consumes, so the wiring phase swaps the SOURCE (real
// Prisma queries / aggregates) without touching the UI components. Delete this
// file as each screen is wired.
//
// English-only, dark-only internal tool (see adminpanel.md). No i18n here.

export type Plan = "free" | "plus" | "pro" | "max";

export const PLAN_LABEL: Record<Plan, string> = {
  free: "Free",
  plus: "Plus",
  pro: "Pro",
  max: "Max",
};

// ─── Overview ─────────────────────────────────────────────────────────────

export type AdminStat = {
  key: string;
  label: string;
  value: string; // preformatted for display
  delta?: string; // e.g. "+12%"
  trend?: "up" | "down" | "flat";
  spark: number[]; // sparkline series (normalized later)
};

export const MOCK_STATS: AdminStat[] = [
  { key: "users", label: "Total users", value: "1,284", delta: "+8.2%", trend: "up", spark: [12, 18, 16, 22, 28, 31, 40, 44] },
  { key: "subs", label: "Active subscriptions", value: "304", delta: "+3.1%", trend: "up", spark: [20, 22, 21, 24, 26, 27, 29, 30] },
  { key: "mrr", label: "MRR", value: "$6,820", delta: "+5.7%", trend: "up", spark: [40, 42, 44, 47, 50, 55, 62, 68] },
  { key: "decks", label: "Decks generated (30d)", value: "2,941", delta: "+14%", trend: "up", spark: [60, 80, 70, 95, 110, 130, 150, 170] },
  { key: "credits", label: "Credits spent (30d)", value: "418,200", delta: "-2.4%", trend: "down", spark: [80, 78, 76, 70, 72, 69, 66, 64] },
];

export const MOCK_PLAN_SPLIT: Record<Plan, number> = {
  free: 980,
  plus: 180,
  pro: 90,
  max: 34,
};

export type ActivityItem = {
  id: string;
  kind: "signup" | "generation" | "purchase";
  text: string;
  at: string; // relative, mock
};

export const MOCK_ACTIVITY: ActivityItem[] = [
  { id: "a1", kind: "signup", text: "noura@example.com signed up", at: "2m ago" },
  { id: "a2", kind: "purchase", text: "khalid@example.com upgraded to Pro", at: "9m ago" },
  { id: "a3", kind: "generation", text: "A 12-slide deck was generated", at: "14m ago" },
  { id: "a4", kind: "purchase", text: "Top-up pack purchased (2,000 credits)", at: "31m ago" },
  { id: "a5", kind: "signup", text: "sami@example.com signed up", at: "48m ago" },
  { id: "a6", kind: "generation", text: "A 6-slide deck was regenerated", at: "1h ago" },
];

// ─── Live online + geo (per-country visitor counts for the globe widget) ────
// `name` must match world-atlas (Natural Earth) country names so globe.gl can
// tint the right country; lat/lng drive the "rotate to country" interaction.

// `name` must match world-atlas (Natural Earth) country names so the globe can
// label the right country; lat/lng (PostHog GeoIP centroids) drive the
// "rotate to country" interaction. Rows now come from lib/analytics/posthog.ts.
export type CountryVisitors = {
  name: string;
  code: string;
  lat: number;
  lng: number;
  count: number;
};

// 1670 -> "1.67k", 266 -> "266".
export function formatCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(2)}k`;
  }
  return String(n);
}

// ─── Users ──────────────────────────────────────────────────────────────

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  plan: Plan;
  credits: number;
  // Subscription-bucket share of `credits` - what the Set credits action
  // overwrites (the remainder is top-ups, which it never touches).
  subscriptionCredits: number;
  joinedAt: string; // ISO date
  banned: boolean;
  // Signup forensics (User.signupIp/Country/City, stamped at provisioning).
  signupIp: string | null;
  signupCountry: string | null; // ISO alpha-2
  signupCity: string | null;
  // Same signupIp as at least one other listed user (multi-account signal).
  sharedIp: boolean;
  // Complimentary-tier expiry (User.planCompExpiresAt) as an ISO date, or
  // null when the plan is not a comp. Drives the "comp until X" badge note.
  compExpiresAt: string | null;
};

const MOCK_USERS_BASE: Omit<
  AdminUser,
  | "signupIp"
  | "signupCountry"
  | "signupCity"
  | "sharedIp"
  | "subscriptionCredits"
  | "compExpiresAt"
>[] = [
  { id: "u1", name: "Noura Al-Otaibi", email: "noura@example.com", plan: "pro", credits: 4120, joinedAt: "2026-06-14", banned: false },
  { id: "u2", name: "Khalid Hassan", email: "khalid@example.com", plan: "max", credits: 11380, joinedAt: "2026-06-12", banned: false },
  { id: "u3", name: "Sami Farouk", email: "sami@example.com", plan: "free", credits: 280, joinedAt: "2026-06-16", banned: false },
  { id: "u4", name: "Layla Mansour", email: "layla@example.com", plan: "plus", credits: 1640, joinedAt: "2026-06-09", banned: false },
  { id: "u5", name: "Omar Said", email: "omar@example.com", plan: "free", credits: 0, joinedAt: "2026-05-30", banned: true },
  { id: "u6", name: "Huda Nasser", email: "huda@example.com", plan: "pro", credits: 3015, joinedAt: "2026-06-02", banned: false },
  { id: "u7", name: "Yusuf Karim", email: "yusuf@example.com", plan: "plus", credits: 920, joinedAt: "2026-06-15", banned: false },
  { id: "u8", name: "Mariam Adel", email: "mariam@example.com", plan: "free", credits: 400, joinedAt: "2026-06-16", banned: false },
  { id: "u9", name: "Tariq Aziz", email: "tariq@example.com", plan: "max", credits: 8740, joinedAt: "2026-05-22", banned: false },
  { id: "u10", name: "Salma Rahimi", email: "salma@example.com", plan: "pro", credits: 5230, joinedAt: "2026-06-07", banned: false },
];

export const MOCK_USERS: AdminUser[] = MOCK_USERS_BASE.map((u) => ({
  ...u,
  subscriptionCredits: u.credits,
  signupIp: null,
  signupCountry: null,
  signupCity: null,
  sharedIp: false,
  compExpiresAt: null,
}));

// ─── Templates ────────────────────────────────────────────────────────────

export type AdminTemplateSeo = {
  slug: string | null;
  nameAr: string | null;
  nameEn: string | null;
  descriptionAr: string | null;
  descriptionEn: string | null;
};

export type AdminTemplate = {
  id: string;
  name: string;
  thumbnail: string | null; // null -> render a placeholder tile
  format: "16:9" | "9:16";
  premium: boolean;
  featured: boolean;
  order: number | null; // manual landing order when featured (0-based)
  // Public detail-page metadata (/presentation-templates/[slug]); optional so
  // the mock fixtures don't need it. null slug = no detail page.
  seo?: AdminTemplateSeo;
};

// A user's outstanding request to publish a template to the community,
// awaiting admin approval (Template.reviewStatus === "PENDING"). Rendered in
// the Pending-review queue at the top of the admin Templates tab. Unlike
// AdminTemplate this spans EVERY user (not just the curator), so it carries the
// owner's email for context.
export type AdminPendingTemplate = {
  id: string;
  thumbnail: string | null;
  format: "16:9" | "9:16";
  language: string;
  slideCount: number;
  ownerEmail: string | null;
  requestedAt: string; // ISO date (Template.createdAt / updatedAt)
};

export const MOCK_TEMPLATES: AdminTemplate[] = [
  { id: "t1", name: "Quarterly Business Review", thumbnail: null, format: "16:9", premium: false, featured: true, order: 0 },
  { id: "t2", name: "Product Launch", thumbnail: null, format: "16:9", premium: true, featured: true, order: 1 },
  { id: "t3", name: "Pitch Deck", thumbnail: null, format: "16:9", premium: true, featured: true, order: 2 },
  { id: "t4", name: "Marketing Plan", thumbnail: null, format: "16:9", premium: false, featured: true, order: 3 },
  { id: "t5", name: "Sales Report", thumbnail: null, format: "9:16", premium: false, featured: false, order: null },
  { id: "t6", name: "Company Profile", thumbnail: null, format: "16:9", premium: true, featured: false, order: null },
  { id: "t7", name: "Onboarding Guide", thumbnail: null, format: "16:9", premium: false, featured: false, order: null },
  { id: "t8", name: "Annual Report", thumbnail: null, format: "16:9", premium: false, featured: false, order: null },
  { id: "t9", name: "Case Study", thumbnail: null, format: "9:16", premium: true, featured: false, order: null },
  { id: "t10", name: "Roadmap", thumbnail: null, format: "16:9", premium: false, featured: false, order: null },
  { id: "t11", name: "Team Intro", thumbnail: null, format: "9:16", premium: false, featured: false, order: null },
  { id: "t12", name: "Financial Overview", thumbnail: null, format: "16:9", premium: true, featured: false, order: null },
];

// ─── Broadcast history ────────────────────────────────────────────────────

export type BroadcastItem = {
  id: string;
  title: string;
  message: string;
  sentAt: string; // ISO date
  recipients: number;
};

export const MOCK_BROADCASTS: BroadcastItem[] = [
  { id: "b1", title: "New: top-up packs", message: "You can now buy credit top-ups from the Plans page.", sentAt: "2026-06-15", recipients: 1241 },
  { id: "b2", title: "Scheduled maintenance", message: "Brief downtime on June 18, 02:00-02:30 UTC.", sentAt: "2026-06-13", recipients: 1198 },
  { id: "b3", title: "Welcome to Taqreer", message: "Thanks for joining. Generate your first deck in minutes.", sentAt: "2026-06-10", recipients: 980 },
];

// ─── Traffic by device / browser / os ──────────────────────────────────────

// Rows now come from lib/analytics/posthog.ts (PostHog $device_type/$browser/$os).
export type Breakdown = { label: string; pct: number };
