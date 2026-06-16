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

export type CountryVisitors = {
  name: string;
  code: string;
  lat: number;
  lng: number;
  count: number;
};

export const MOCK_VISITORS: CountryVisitors[] = [
  { name: "Saudi Arabia", code: "SA", lat: 24, lng: 45, count: 1670 },
  { name: "United States of America", code: "US", lat: 38, lng: -97, count: 266 },
  { name: "Morocco", code: "MA", lat: 32, lng: -6, count: 217 },
  { name: "Germany", code: "DE", lat: 51, lng: 10, count: 80 },
  { name: "Egypt", code: "EG", lat: 27, lng: 30, count: 72 },
  { name: "United Kingdom", code: "GB", lat: 54, lng: -2, count: 64 },
  { name: "Netherlands", code: "NL", lat: 52, lng: 5, count: 59 },
  { name: "Finland", code: "FI", lat: 64, lng: 26, count: 53 },
  { name: "Romania", code: "RO", lat: 46, lng: 25, count: 48 },
  { name: "Canada", code: "CA", lat: 56, lng: -106, count: 48 },
  { name: "France", code: "FR", lat: 46, lng: 2, count: 34 },
  { name: "India", code: "IN", lat: 22, lng: 79, count: 28 },
  { name: "United Arab Emirates", code: "AE", lat: 24, lng: 54, count: 22 },
];

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
  joinedAt: string; // ISO date
  banned: boolean;
};

export const MOCK_USERS: AdminUser[] = [
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

// ─── Templates ────────────────────────────────────────────────────────────

export type AdminTemplate = {
  id: string;
  name: string;
  thumbnail: string | null; // null -> render a placeholder tile
  format: "16:9" | "9:16";
  premium: boolean;
  featured: boolean;
  order: number | null; // manual landing order when featured (0-based)
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

export type Breakdown = { label: string; pct: number };

export const MOCK_DEVICE: Breakdown[] = [
  { label: "Desktop", pct: 62 },
  { label: "Mobile", pct: 33 },
  { label: "Tablet", pct: 5 },
];

export const MOCK_BROWSER: Breakdown[] = [
  { label: "Chrome", pct: 56 },
  { label: "Safari", pct: 25 },
  { label: "Edge", pct: 9 },
  { label: "Firefox", pct: 7 },
  { label: "Other", pct: 3 },
];

export const MOCK_OS: Breakdown[] = [
  { label: "Windows", pct: 39 },
  { label: "iOS", pct: 24 },
  { label: "Android", pct: 18 },
  { label: "macOS", pct: 15 },
  { label: "Linux", pct: 4 },
];
