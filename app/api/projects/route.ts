import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { Prisma } from "@prisma/client";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { sendInngestEventWithRetry } from "@/lib/inngest-helpers";
import { captureServerEvent } from "@/lib/analytics/posthog-server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { isOwnedBrandAssetPath, signBrandAssetUrl } from "@/lib/storage/sign";
import { decodeSvgBytes } from "@/lib/brand/svg-decode";
import { isPolychromeSvg } from "@/lib/brand/svg-polychrome";
import { ALLOWED_FONT_HOSTS } from "@/lib/schema/slide";
import { type Quality } from "@/lib/types/quality";
import {
  ensureFresh,
  getActivePresetKeys,
  defaultPresetKey,
} from "@/lib/config/runtime-config";
import { SourceMetaSchema, type SourceMeta } from "@/lib/types/source";
import {
  MAX_CONTENT_TEXT_CHARS,
  MAX_EVENT_DATA_BYTES,
} from "@/lib/types/brief-limits";
import { detectImageRegion } from "@/lib/geo/image-region";
import { preflightGenerate } from "@/lib/credits/preflight";
import type { Flow as CreditFlow, SlideEstimateInput } from "@/lib/credits/cost";
import { TEASER_LOCKED_COUNT } from "@/lib/credits/cost";
import { normalizePlan } from "@/lib/plan";
import { maybeGrantSignupCredits } from "@/lib/credits/signup";
import { clientIp, rateLimited } from "@/lib/api/rate-limit";
import { signupGeoFromHeaders } from "@/lib/api/geo";
import { deviceIdFromCookies } from "@/lib/device-cookie";
import { dispatchWelcomeEmail } from "@/lib/email/send-welcome";
import { getDictionary, type Dictionary } from "@/lib/i18n/dictionaries";
import { isLocale, LOCALE_COOKIE } from "@/lib/i18n/config";

// Defence-in-depth strip list for user-uploaded SVG markup. Compiled
// once at module load instead of being rebuilt on every request. The
// real XSS gate is DOMPurify at slide-render time (`lib/export/
// sanitize.ts`); this layer hardens two things on top:
//
//   - Execution vectors that DOMPurify would also block, removed early
//     so the prompt body that reaches Claude is clean.
//   - PROMPT-INJECTION vectors (<title>, <desc>, <metadata>, HTML
//     comments, PI, DOCTYPE, CDATA, <foreignObject>) — Claude reads
//     the inlined markup as part of the prompt body, so free-text
//     payloads inside would otherwise look like instructions.
//
// We DO NOT strip <text>. Wordmark logos use <text> for the actual
// visible brand name; stripping it would silently break a large
// class of legitimate logos and isn't a meaningful injection
// surface beyond <title>.
const SVG_STRIP_PATTERNS: readonly RegExp[] = [
  // Execution vectors
  /<script[\s\S]*?<\/script>/gi,
  /\son\w+\s*=\s*"[^"]*"/gi,
  /\son\w+\s*=\s*'[^']*'/gi,
  /javascript:/gi,
  // Prompt-injection vectors — elements that carry arbitrary
  // free-text Claude would otherwise read as instructions.
  /<title[\s\S]*?<\/title>/gi,
  /<desc[\s\S]*?<\/desc>/gi,
  /<metadata[\s\S]*?<\/metadata>/gi,
  /<foreignObject[\s\S]*?<\/foreignObject>/gi,
  // HTML / XML comments (can hide injected directives in plain text)
  /<!--[\s\S]*?-->/g,
  // XML processing instructions + DOCTYPE — both carry free-text
  // payloads and the export pipeline doesn't need them once the SVG
  // is inlined.
  /<\?[\s\S]*?\?>/g,
  /<!DOCTYPE[\s\S]*?>/gi,
  // CDATA sections wrap arbitrary text including unescaped HTML —
  // nothing legitimate in our logo pipeline relies on CDATA-wrapped
  // content.
  /<!\[CDATA\[[\s\S]*?\]\]>/g,
];

// Allowlist client-supplied font URLs against the schema's trusted-host
// set (HTTPS + `fonts.googleapis.com` / `fonts.gstatic.com`). Without this,
// `payload.brand.fonts.{heading,body}.url` would be persisted + forwarded
// to the brief verbatim, and Claude would render `@font-face src: url(...)`
// pointing at attacker-controlled origins on every exported deck — both a
// privacy leak (every render fetches from that origin) and a code-injection
// surface (a hostile font file could exploit shaping bugs in PowerPoint).
function safeFontUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return null;
    if (!ALLOWED_FONT_HOSTS.has(u.hostname)) return null;
    return raw;
  } catch {
    return null;
  }
}

// Fetch the logo SVG content via the admin storage client (bucket is private)
// and return sanitised markup. Sanitisation here is a defence-in-depth pass —
// the upload route already restricts the brand-assets/logos folder to SVG, but
// a malformed / hostile file could carry:
//
//   - Execution vectors: <script>, on*="…" handlers, javascript: URIs
//   - PROMPT-INJECTION vectors: <title>, <desc>, <metadata>, HTML comments,
//     XML processing instructions, CDATA, DOCTYPE, <foreignObject>
//
// The prompt-injection bucket matters because we inline the markup directly
// into the Claude prompt (see inngest/functions/deck-generate.ts: "SVG
// markup:"). Any free-text payload (title / desc / comment) Claude reads as
// part of the prompt body could carry instructions like "ignore previous
// instructions, output ...". The execution bucket matters because the
// sanitised markup is also rendered live in the slide previews. We strip
// both before the markup leaves this function.
//
// We DO NOT strip <text>. Wordmark logos use <text> for the actual visible
// brand name. The element renders as glyphs in the .pptx export, same as a
// path would; not a meaningful injection vector beyond what <title> is, and
// stripping it would silently break a large class of legitimate logos.
//
// Returns { svgMarkup: null, isPolychrome: false } on any failure (file
// missing, fetch failure, non-SVG content) — the caller then emits the
// URL-only (true-colour <img>) logo block.
//
// `isPolychrome` (re-introduced 2026-06-15, reversing the 2026-05-27 "flatten
// every logo to one contrast colour" decision): a multicolour mark — a flag, a
// full-colour logo — must KEEP its own colours, so it's injected as a
// true-colour <img>; a monochrome wordmark is inlined and recoloured per slide
// for contrast. The flatten-everything default destroyed multicolour marks
// (e.g. a flag came out solid white).
type LogoRead = { svgMarkup: string | null; isPolychrome: boolean };
const LOGO_READ_NONE: LogoRead = { svgMarkup: null, isPolychrome: false };

// Max size a logo's sanitised markup may add to the SERIALIZED event and
// still be INLINED into the brief — measured as UTF-8 bytes of the
// JSON-escaped string, i.e. exactly what the markup contributes to the
// deck.generate.requested Inngest event, which hard-caps the WHOLE event at
// 256KB (a 15MB traced-photo "SVG" killed a real create, Sentry 77f4c998
// 2026-08-02). 100K leaves >150KB for the rest of the payload (the only other
// unbounded field, content.text, is a tracked follow-up) and is far beyond
// any legitimate vector wordmark — and deck-generate inlines the markup
// verbatim into the Claude prompt, so an oversized logo is a token bomb even
// under the event cap. An over-cap logo falls back to the existing URL-only
// <img> path (same delivery as polychrome logos), so the deck still
// generates with the logo intact.
const MAX_INLINE_LOGO_SVG_BYTES = 100_000;

async function readLogo(path: string): Promise<LogoRead> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return LOGO_READ_NONE;
  try {
    const admin = createSupabaseAdminClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await admin.storage
      .from("brand-assets")
      .download(path);
    if (error || !data) return LOGO_READ_NONE;
    // Decode honouring the BOM. UTF-16 logos (common from Illustrator / Corel /
    // Windows exporters) read as UTF-8 become `<\0s\0v\0g…`, which fails the
    // `<svg` guard + the colour scan and silently routes the logo to the wrong
    // path — the original flag bug. See lib/brand/svg-decode.
    const text = decodeSvgBytes(await data.arrayBuffer());
    if (!text.includes("<svg")) return LOGO_READ_NONE;
    const isPolychrome = isPolychromeSvg(text);
    // Run every pattern from the module-scope strip list. See the
    // `SVG_STRIP_PATTERNS` declaration for the per-pattern rationale.
    const svgMarkup = SVG_STRIP_PATTERNS.reduce(
      (acc, re) => acc.replace(re, ""),
      text,
    );
    // Over the inline cap (traced-photo / embedded-raster "SVG") → route to
    // the URL-only <img> fallback instead of blowing the Inngest event cap
    // and the prompt. Measured on the JSON-escaped UTF-8 form (CR #180) so
    // escaping/multi-byte inflation can't sneak past the byte budget.
    // isPolychrome is kept: it still picks the right block.
    if (
      Buffer.byteLength(JSON.stringify(svgMarkup), "utf8") >
      MAX_INLINE_LOGO_SVG_BYTES
    ) {
      return { svgMarkup: null, isPolychrome };
    }
    return { svgMarkup, isPolychrome };
  } catch {
    return LOGO_READ_NONE;
  }
}

type CreateProjectPayload = {
  type?: "create" | "enhance" | "social";
  content?: {
    type?: "file" | "text";
    fileName?: string;
    fileSize?: number;
    storageUrl?: string;
    text?: string;
    keepVerbatim?: boolean;
  };
  brand?: {
    colors?: string[];
    fonts?: unknown;
    logo?: {
      name?: string;
      storageUrl?: string;
      position?:
        | "top-left"
        | "top-center"
        | "top-right"
        | "bottom-left"
        | "bottom-center"
        | "bottom-right";
      exclude?: ("cover" | "closing")[];
    } | null;
    slideSize?: string;
    slideCount?: { mode?: string; value?: number | null };
  };
  enhance?: {
    level?: "light" | "medium" | "radical";
    keepColors?: boolean;
    keepFonts?: boolean;
    instructions?: string;
    slideCountMode?: "match" | "custom";
    slideCountValue?: number | null;
  };
  rules?: {
    designStyle: string | null;
    fixTypos: boolean;
    pagination: boolean;
    persistent: {
      text: string;
      // `position` dropped 2026-06-02 — Claude freestyles the persistent
      // overlay's placement now (only the logo corner is reserved).
      exclude: ("cover" | "closing")[];
    } | null;
  };
  saveBrandKit?: boolean;
  // context/images.md — opt-in "images deck" (the /create toggle lands in
  // Phase 3; until then it's settable via the payload for testing). Only
  // honoured for create flows in deck-generate's buildUserMessage gate.
  imagesMode?: boolean;
  slideCount?: number | null;
  quality?: Quality | null;
  // User-picked on /create/content (2026-05-20). Drives Project.language
  // + Presentation.direction (ar → rtl, en → ltr) + the brief sent to
  // deck-generate. Missing → defaults to "ar" so legacy clients +
  // bookmarklets keep working as-is. Legacy "bi" payloads (from the
  // brief 3-bucket period earlier 2026-05-20) collapse to "ar" via
  // the guard below — same behavior the AR prompt has always
  // produced for mixed content.
  language?: "ar" | "en";
  // Phase 17.A — SourceMeta blob from the upload-driven create flows
  // (Enhance / Mimic / Data). Validated against SourceMetaSchema
  // below; missing or invalid → treated as scratch flow (the
  // default existing behavior). The brief carries this through to
  // deck-generate, which branches the Claude message shape on
  // source.kind (see buildSourceContentBlocks in deck-generate.ts).
  source?: unknown;
};

// Whitelist-validated language → direction mapping. Centralised so
// every persistence site (Project.language, Presentation.language +
// direction, brief.language + direction) reads from the same source.
type ContentLanguage = "ar" | "en";
function isContentLanguage(v: unknown): v is ContentLanguage {
  return v === "ar" || v === "en";
}
function directionForLanguage(lang: ContentLanguage): "rtl" | "ltr" {
  return lang === "en" ? "ltr" : "rtl";
}

function buildProjectTitle(payload: CreateProjectPayload, dict: Dictionary) {
  if (payload.content?.type === "file" && payload.content.fileName) {
    let name = payload.content.fileName;
    // Decode URL-percent-encoded names (some file pickers hand them back
    // pre-encoded). Best-effort — fall back to the raw string on failure.
    if (/%[0-9A-Fa-f]{2}/.test(name)) {
      try {
        name = decodeURIComponent(name);
      } catch {
        /* keep raw */
      }
    }
    return name.replace(/\.[^.]+$/, "");
  }

  const text = payload.content?.text?.trim();
  if (text) return text.slice(0, 48);

  return dict.defaults.newDeck;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

// Brief font slot. `family` aliased to `name` upstream — we only
// forward `name` to Claude. `url` is allowlisted via `safeFontUrl`;
// `storageUrl` is the uploaded-file path passed through verbatim.
// Centralised so heading + body sides share one narrowing path.
type BriefFontSlot =
  | {
      name?: string | null;
      storageUrl?: string | null;
      url?: string | null;
      family?: string | null;
    }
  | null
  | undefined;
// Default family when the client sent no font at all. Name AND css2 URL
// together — a bare name with no URL renders as a system font (that's how
// the old "Arial" default produced Arial decks). Literals (not an import of
// lib/brand/fonts' googleFontUrl) to keep this server route off the client
// font module; mirrors DEFAULT_GOOGLE_FAMILY there.
const DEFAULT_FONT_NAME = "Noto Sans Arabic";
const DEFAULT_FONT_URL =
  "https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@100;200;300;400;500;600;700;800;900&display=swap";

function readBriefFont(slot: BriefFontSlot): {
  name: string;
  storageUrl: string | null;
  url: string | null;
} {
  const name = slot?.name?.trim();
  if (!name) {
    return { name: DEFAULT_FONT_NAME, storageUrl: null, url: DEFAULT_FONT_URL };
  }
  return {
    name,
    storageUrl: slot?.storageUrl || null,
    url: safeFontUrl(slot?.url),
  };
}

// One uploaded font FAMILY in the brief: a display name + its weight faces.
// A user who drops "Brand-Light/Regular/Bold.otf" sends ONE family with three
// faces. `weight` is the CSS numeric weight (100–900) the picker parsed off
// each filename; `storageUrl` is the per-weight uploaded-file path. The names
// reach Claude (paired into heading/body); the storageUrls stay server-side
// (sanitised out of the prompt; signed post-manifest by injectUploadedFontSources).
type IncomingUploadedFamily = {
  name?: string | null;
  faces?: Array<{ weight?: unknown; storageUrl?: unknown } | null> | null;
} | null;
type UploadedFontFamilyBrief = {
  name: string;
  faces: Array<{ weight: number; storageUrl: string }>;
};

// Caps mirror the picker's MAX_UPLOADED_FONTS / MAX_FACES_PER_FAMILY. Kept as
// local literals so this server route doesn't pull the client font module.
const MAX_UPLOADED_FAMILIES = 5;
const MAX_FACES_PER_FAMILY = 9;

// Coerce an incoming face weight to a standard CSS weight (100–900). Anything
// out of range / non-numeric falls back to 400 — the run still renders, just
// at regular.
function clampFontWeight(raw: unknown): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 100 || n > 900) return 400;
  return n;
}

// Allowlist + size-clamp the brand-kit logo shape. Mirrors the
// `safeLogo` filter in `/api/brand-kits` POST — without this the
// `saveBrandKit` branch would persist `payload.brand.logo` verbatim,
// including any base64 `previewDataUrl` that bloats the row by
// 50-500 KB and rides along on every subsequent GET. Caller has
// already verified `storageUrl` ownership via
// `isOwnedBrandAssetPath`.
function buildSafeLogoForKit(
  logo:
    | {
        name?: string;
        storageUrl?: string;
        exclude?: ("cover" | "closing")[];
      }
    | null
    | undefined,
): {
  name: string | null;
  storageUrl: string | null;
  exclude: ("cover" | "closing")[];
} | null {
  if (!logo) return null;
  return {
    name: typeof logo.name === "string" ? logo.name.slice(0, 200) : null,
    storageUrl:
      typeof logo.storageUrl === "string"
        ? logo.storageUrl.slice(0, 2000)
        : null,
    exclude: Array.isArray(logo.exclude)
      ? logo.exclude.filter(
          (v): v is "cover" | "closing" => v === "cover" || v === "closing",
        )
      : [],
  };
}

// Assemble the brand block that travels in the brief to Claude.
// Pulls the per-font shape from `readBriefFont` and the logo block
// (when set) from the inline shape — Claude needs `name`,
// `storageUrl`, `url` (signed when private), `svgMarkup` (inline
// markup when SVG fetch succeeded), `position`, `exclude`. Returns
// the same `payload.brand` value when no brand is set, so calls
// site stays a no-op for legacy payloads.
function buildClaudeBrand(
  rawBrand: CreateProjectPayload["brand"],
  font: ReturnType<typeof readBriefFont>,
  uploadedFonts: UploadedFontFamilyBrief[],
  logoSignedUrl: string | null,
  logoSvgMarkup: string | null,
  logoIsPolychrome: boolean,
): CreateProjectPayload["brand"] {
  if (!rawBrand) return rawBrand;
  return {
    ...rawBrand,
    fonts: {
      // SINGLE brand font (2026-06-04 collapse). Carry `url` (Google CSS
      // link) and `storageUrl` (uploaded file) through to the brief — the
      // OUTPUT schema asks Claude to emit `theme.font.url`; without `url`
      // here Claude was guessing.
      font,
      // The full uploaded-family list (name + weight faces) — present only
      // when the user uploaded fonts. deck-generate's FONT SOURCING rule
      // tells Claude to use one for `theme.font.name`; the
      // injectUploadedFontSources step signs each face post-manifest.
      ...(uploadedFonts.length > 0 ? { uploaded: uploadedFonts } : {}),
    },
    logo: rawBrand.logo
      ? {
          name: rawBrand.logo.name,
          storageUrl: rawBrand.logo.storageUrl,
          // Signed HTTPS URL — fallback when svgMarkup is missing
          // (caller renders an <img> instead of inline SVG). NULL when
          // signing fails: never fall back to the raw `storageUrl`, which
          // is a private object key, not a fetchable URL — emitting it as
          // `url` would both leak the path and hand Claude a dead src.
          url: logoSignedUrl ?? null,
          // Inline SVG markup. When present, Claude inlines this
          // directly per slide and sets `fill="#hex"` on the <svg>
          // root for per-slide contrast. When null (fetch failed
          // or non-SVG), buildUserMessage emits the URL-only block
          // and Claude falls back to <img src="...">.
          svgMarkup: logoSvgMarkup,
          // Polychrome (flag / full-colour) → injected as a true-colour <img>;
          // monochrome → inlined + recoloured per slide. See buildLogoBlock.
          isPolychrome: logoIsPolychrome,
          exclude: rawBrand.logo.exclude ?? [],
        }
      : rawBrand.logo,
  } as CreateProjectPayload["brand"];
}

// Three small "validate-or-fallback" resolvers. Each is tiny on its
// own; co-locating keeps the POST handler reading as orchestration
// instead of a sequence of inline narrowings.
function resolveLanguage(raw: unknown): ContentLanguage {
  return isContentLanguage(raw) ? raw : "ar";
}
// Validates against the ACTIVE DB presets (admin Settings can add/retire them),
// not the bundled snapshot — so a newly added preset is selectable and a
// retired one falls back to the default. Caller awaits ensureFresh() first.
function resolveQuality(raw: unknown): Quality {
  return typeof raw === "string" && getActivePresetKeys().includes(raw)
    ? raw
    : defaultPresetKey();
}
function resolveSource(raw: unknown): SourceMeta | null {
  if (raw == null) return null;
  const parsed = SourceMetaSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function POST(request: Request) {
  // No outer try/catch wrapping the whole POST — Next.js's error
  // boundary returns 500 on unhandled throws and the inner Inngest-
  // failure block (further down) does have domain-specific work
  // (mark rows failed) that stays. Per project convention: only
  // wrap when there's something concrete to translate. (2026-05-27
  // simplifier pass.)
  // Resolve the requester's UI locale once so any user-facing default
  // names (project title, brand-kit name) match the chrome they see.

  // Reject floods cheaply, before the auth + credit + DB work. The real per-user
  // cost cap is the deck-generate Inngest concurrency limit; this is the HTTP
  // flood guard, keyed by IP (Cloudflare CF-Connecting-IP).
  const limited = rateLimited(`projects:${clientIp(request)}`, 20, 5 * 60_000);
  if (limited) return limited;

  const localeRaw = (await cookies()).get(LOCALE_COOKIE)?.value;
  const dict = await getDictionary(isLocale(localeRaw) ? localeRaw : "ar");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json()) as CreateProjectPayload;
  // User-typed deck content cap (PR #180 follow-up: the logo was capped
  // there; content.text is the next unbounded rider on the 256KB Inngest
  // event). Explicit 400, not silent truncation: this is the user's own
  // content, and the flow textareas enforce the same maxLength so a legit
  // client never sees this. Checked FIRST so no DB work happens for a
  // payload that can't generate.
  if ((payload.content?.text?.length ?? 0) > MAX_CONTENT_TEXT_CHARS) {
    return NextResponse.json(
      {
        error: `content text exceeds the ${MAX_CONTENT_TEXT_CHARS.toLocaleString("en-US")} character limit`,
      },
      { status: 400 },
    );
  }
  const title = buildProjectTitle(payload, dict);
  const projectType =
    payload.type === "enhance"
      ? "enhance"
      : payload.type === "social"
        ? "social"
        : "create";

  // Resolve the Prisma user UP FRONT (lifted out of the tx below) - the
  // credit preflight needs the user id + plan BEFORE we create any
  // rows. The upsert is idempotent; concurrent first-time requests
  // still resolve via the supabaseUserId unique constraint. A brand-new
  // row also receives the one-time signup grant here (the user-sync
  // path covers normal logins; this covers a first request that beats
  // it).
  const existingUser = await prisma.user.findUnique({
    where: { supabaseUserId: user.id },
    select: {
      id: true,
      bannedAt: true,
      creditAccount: { select: { signupGrantedAt: true } },
    },
  });
  // A banned user keeps a valid Supabase session; block deck creation (the
  // signup grant + generation spend) for suspended accounts.
  if (existingUser?.bannedAt) {
    return NextResponse.json({ error: "Account suspended" }, { status: 403 });
  }
  // Signup forensics (first-seen IP/geo) - stamped on CREATE only.
  const geo = signupGeoFromHeaders(request.headers);
  const dbUser = await prisma.user.upsert({
    where: { supabaseUserId: user.id },
    update: {
      email: user.email ?? `${user.id}@supabase.local`,
      name: user.user_metadata?.name ?? user.user_metadata?.full_name ?? null,
      image: user.user_metadata?.avatar_url ?? null,
    },
    create: {
      supabaseUserId: user.id,
      email: user.email ?? `${user.id}@supabase.local`,
      name: user.user_metadata?.name ?? user.user_metadata?.full_name ?? null,
      image: user.user_metadata?.avatar_url ?? null,
      plan: "free",
      signupIp: geo.ip,
      signupCountry: geo.country,
      signupCity: geo.city,
    },
  });
  // Gate on signupGrantedAt (the idempotent grant anchor), NOT row-
  // existence - another path (dashboard / user-sync / invite) may have
  // created the User row first, which would otherwise skip the grant.
  if (!existingUser?.creditAccount?.signupGrantedAt) {
    const grant = await maybeGrantSignupCredits({
      userId: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      ip: geo.ip,
      deviceId: deviceIdFromCookies(await cookies()),
      geo,
    }).catch((err) => {
      // A grant hiccup must never fail project creation - the next
      // authenticated user-sync grants idempotently.
      console.error(
        "[projects] signup grant failed:",
        err instanceof Error ? err.message : String(err),
      );
      return null;
    });
    // Welcome email — when THIS route lands the grant (granted > 0), send the
    // welcome from here too. The grant is row-locked + idempotent, so exactly
    // one route reports granted>0, so the welcome sends once (the bug: it only
    // lived in user-sync, so when projects granted first it was dropped).
    // Fire-and-forget — never blocks project creation.
    if (grant && grant.granted > 0) {
      void dispatchWelcomeEmail({
        toEmail: dbUser.email,
        metadataLang: user.user_metadata?.lang,
        cookieHeader: request.headers.get("cookie"),
        fallbackLocale: dbUser.language,
        appOrigin: process.env.NEXT_PUBLIC_SITE_URL ?? "https://taqreer.ai",
        freeCredits: grant.granted,
      });
    }
  }

  // Slim brand for Claude: drop base64 `previewDataUrl` (saves ~3000
  // input tokens). Falls back to Noto Sans Arabic (name + css2 URL) when
  // no font configured, so a no-font deck still loads a real Arabic-and-
  // Latin webfont instead of rendering in a system font.
  const incomingFonts = payload.brand?.fonts as
    | {
        // The brand UI emits one font; the 4 flow pages still send it in BOTH
        // `heading` and `body` (same value). Read `heading` (then `body` as a
        // fallback) and forward a single `font`.
        heading?: BriefFontSlot;
        body?: BriefFontSlot;
        font?: BriefFontSlot;
        uploaded?: IncomingUploadedFamily[];
      }
    | undefined;
  const font = readBriefFont(
    incomingFonts?.font ?? incomingFonts?.heading ?? incomingFonts?.body,
  );
  // Uploaded brand fonts (the "Claude pairs" path): forward EVERY family with
  // ALL its weight faces (capped) so deck-generate can attach each weight file
  // to whichever role Claude assigns. Names go to Claude; storageUrls stay
  // server-side (sanitised out of the prompt; signed post-manifest).
  const uploadedFonts: UploadedFontFamilyBrief[] = (
    Array.isArray(incomingFonts?.uploaded) ? incomingFonts.uploaded : []
  )
    .slice(0, MAX_UPLOADED_FAMILIES)
    .map((fam) => ({
      name: fam?.name?.trim() || "Custom",
      faces: (Array.isArray(fam?.faces) ? fam.faces : [])
        .slice(0, MAX_FACES_PER_FAMILY)
        .map((f) => ({
          weight: clampFontWeight(f?.weight),
          storageUrl: typeof f?.storageUrl === "string" ? f.storageUrl : null,
        }))
        .filter(
          (f): f is { weight: number; storageUrl: string } => !!f.storageUrl,
        ),
    }))
    .filter((fam) => fam.faces.length > 0);

  // AUTHORIZE every font storageUrl (heading / body / every uploaded face)
  // before it reaches the brief. At generation time deck-generate SIGNS these
  // with service-role creds (injectUploadedFontSources) to @font-face + embed
  // them — an unowned path would mint a signed URL for another tenant's
  // object. Same threat the logo path is guarded against below.
  for (const fontPath of [
    font.storageUrl,
    ...uploadedFonts.flatMap((fam) => fam.faces.map((f) => f.storageUrl)),
  ]) {
    if (fontPath && !isOwnedBrandAssetPath(fontPath, user.id)) {
      return NextResponse.json(
        { error: "Font storageUrl is not owned by the current user" },
        { status: 403 },
      );
    }
  }
  const logoPath = payload.brand?.logo?.storageUrl ?? null;
    // AUTHORIZE the logo path before we touch Supabase. The helpers below
    // both run with service-role credentials (signed URL → embedded in
    // brief; SVG markup → inlined into the Claude prompt and every
    // slide), so an unowned path would leak any object whose key the
    // attacker can guess. Match by the upload namespace prefix (the
    // upload route writes `${supabaseUserId}/create/...` paths).
  if (logoPath && !isOwnedBrandAssetPath(logoPath, user.id)) {
    return NextResponse.json(
      { error: "Logo storageUrl is not owned by the current user" },
      { status: 403 },
    );
  }
  // Fetch signed URL + SVG markup in parallel — both hit Supabase
  // Storage so pipelining saves a round trip. `svgMarkup` enables
  // the inline-per-slide path (Claude overrides `fill` for per-slide
  // contrast); `signedUrl` is the fallback to <img src=...>.
  const [logoSignedUrl, logoRead] = logoPath
    ? await Promise.all([signBrandAssetUrl(logoPath), readLogo(logoPath)])
    : [null, LOGO_READ_NONE];
  const claudeBrand = buildClaudeBrand(
    payload.brand,
    font,
    uploadedFonts,
    logoSignedUrl,
    logoRead.svgMarkup,
    logoRead.isPolychrome,
  );

  // Auto slide-count ("auto" mode on /create/summary): the MODEL decides
  // (owner ruling 2026-07-18) - no our-side text heuristic. null rides to
  // preflight as an UNKNOWN estimate, which holds the hard ceiling
  // (tier cap ∧ affordable credits) and briefs the model with
  // slideCountMode "ceiling" below.
  const resolvedSlideCount = payload.slideCount ?? null;

  const contentLanguage = resolveLanguage(payload.language);
  const contentDirection = directionForLanguage(contentLanguage);
  const validatedSource = resolveSource(payload.source);
  // AUTHORIZE the enhance source path — same threat as the logo path
  // above. `source.sourcePath` round-trips through the client, and at
  // generation time deck-generate downloads it with SERVICE-ROLE creds
  // (bypasses RLS) to rasterize the slides. Without an ownership check a
  // user could swap in another tenant's object key and have the deck
  // exfiltrate that file. `isOwnedBrandAssetPath` is the generic
  // owner-prefix guard (verifies the `${userId}/` namespace + rejects
  // `..`); `source-files` keys share that `${supabaseUserId}/extract/...`
  // convention, so it applies directly.
  if (
    validatedSource?.kind === "enhance" &&
    !isOwnedBrandAssetPath(validatedSource.sourcePath, user.id)
  ) {
    return NextResponse.json(
      { error: "source.sourcePath is not owned by the current user" },
      { status: 403 },
    );
  }
  // Social is a scratch, TEXT-ONLY flow. `type` + `content` are both client-
  // controlled, so reject a `type:"social"` payload that smuggles in either a
  // non-scratch source (enhance/mimic/data) OR file content: otherwise a
  // source/file-driven brief would run under social's flow gating + slide cap
  // (and pricing), overriding the real flow. Keeps persistence/enqueue/pricing
  // aligned with the declared social contract.
  if (
    projectType === "social" &&
    (payload.content?.type === "file" ||
      (validatedSource && validatedSource.kind !== "scratch"))
  ) {
    return NextResponse.json(
      { error: "social flow accepts text content only" },
      { status: 400 },
    );
  }
  await ensureFresh();
  const quality = resolveQuality(payload.quality);

  // First-deck gift REMOVED (2026-07-21): the deck runs on + is charged for the
  // preset the user picked, from deck 1. No free upgrade to a thinking preset on
  // the first deck (that ran a thinking model at the no-thinking price). Free
  // users are gated to the draft preset like every other deck.

  // ─── Credit preflight (billing plan Phase A) ──────────────────────
  // The ONLY money gate before the Inngest hold: tier flow/preset/cap
  // checks + balance vs the quote. Blocks with a 402 + the two offers
  // (reduce / top up) BEFORE any rows or Claude calls exist. The
  // payload shape feeds CreditGateDialog client-side.
  const creditFlow: CreditFlow =
    projectType === "social"
      ? "social"
      : validatedSource?.kind === "enhance"
        ? "enhance"
        : validatedSource?.kind === "mimic"
          ? "mimic"
          : validatedSource?.kind === "data"
            ? "datasheet"
            : "create";
  let slideInput: SlideEstimateInput;
  if (typeof payload.slideCount === "number" && payload.slideCount > 0) {
    slideInput = { kind: "fixed", count: payload.slideCount };
  } else if (validatedSource?.kind === "enhance") {
    // 1:1 rebuild - the source page count IS the count. PPTX ships
    // verbatim per-slide text so the length is exact; text-less PDFs
    // fall through to the unknown-input hold (known gap: surfacing the
    // PDF page count at route time needs the locked extraction
    // pipeline to expose it).
    slideInput =
      validatedSource.textPerSlide.length > 0
        ? { kind: "enhance", pageCount: validatedSource.textPerSlide.length }
        : { kind: "text", text: "" };
  } else if (validatedSource?.kind === "data") {
    slideInput = {
      kind: "datasheet",
      sheetCount: validatedSource.sheetCount,
      totalRows: validatedSource.totalRows,
    };
  } else if (validatedSource?.kind === "mimic") {
    slideInput = { kind: "mimic", briefText: validatedSource.userContent ?? null };
  } else {
    slideInput = {
      kind: "text",
      text: payload.content?.type === "text" ? payload.content.text ?? "" : "",
    };
  }
  const preflight = await preflightGenerate({
    userId: dbUser.id,
    plan: dbUser.plan,
    flow: creditFlow,
    preset: quality,
    slideInput,
    // Images-mode decks hold (and settle) a per-image surcharge on top
    // of the slide cost - 2026-07 repricing; images were free before.
    imagesMode: payload.imagesMode === true,
    // Admin/superuser: no flow/preset/slide-cap/credit gate. The deck
    // still generates; the hold is waived in the pipeline (owner role).
    isAdmin: dbUser.role === "admin",
  });
  if (!preflight.ok) {
    return NextResponse.json(
      {
        error: preflight.reason,
        balance: preflight.balance.total,
        slideCap: preflight.slideCap ?? null,
        minFlowTier: preflight.minFlowTier ?? null,
        options: preflight.options ?? null,
        quotes: preflight.quotes,
      },
      { status: 402 },
    );
  }
  // Honest authoring size = the number we HELD for. The settle clamps
  // the charge to the hold, so if Claude authored MORE slides than the
  // hold covers, the overflow would be free. Pinning the brief's target
  // to `holdSlides` keeps shown == authored == charged across every
  // path - critical for the flows whose count is only an ESTIMATE
  // (datasheet from sheet/row scalars, a text-less PDF enhance, typed
  // mimic): without this the client could under-quote via small
  // estimate inputs while a large `markdown`/source still drives Claude
  // to author a full deck (security review 2026-06-11, findings 1+2).
  //
  // EXACT user picks (`fixed` count) already equal holdSlides, so this
  // is a no-op for them. Auto/create-from-text keeps its own estimate
  // (it IS the holdSlides basis). The only behavioural change is that
  // estimate-driven source flows now author at the quoted size instead
  // of the prompt's free-running default.
  const cappedSlideCount = preflight.exact
    ? resolvedSlideCount
    : preflight.holdSlides;

  // Teaser paywall (free-tier conversion). A free-tier `create` deck is
  // authored as a longer deck (visible + TEASER_LOCKED_COUNT) but ONLY the
  // visible slides are held, charged, and streamed - deck-generate keeps its
  // slide-cap abort at holdSlides, so cost is identical to today. The locked
  // slides render blurred in the viewer and are generated (on Opus, comped)
  // only if the owner subscribes. Images decks included: the unlock authors
  // the tail with images too (deck-unlock mirrors the deck.images.requested
  // fill when the source is an images deck). Admins are never gated.
  // `plannedTotal` is what the model designs toward so the visible slides read
  // as an unfinished first act.
  const isTeaser =
    creditFlow === "create" &&
    dbUser.role !== "admin" &&
    normalizePlan(dbUser.plan) === "free";
  const teaserLockedCount = isTeaser ? TEASER_LOCKED_COUNT : 0;
  // `cappedSlideCount` is only null in the (unreachable-for-teaser) exact path
  // with no picked count; fall back to the held count so the planned total is
  // always a number.
  const teaserPlannedTotal =
    (cappedSlideCount ?? preflight.holdSlides) + teaserLockedCount;

  // Location-aware lifestyle imagery: map the REQUEST's country (the "area of
  // generation") to a regional people descriptor so an images-deck made from
  // Saudi Arabia depicts local people, not a generic cast. Only resolved for
  // images decks (the only place generated photos exist); null when the geo
  // can't be determined, which keeps the brief — and the prompt — unchanged.
  const imageRegion =
    payload.imagesMode === true ? detectImageRegion(request.headers) : null;

  const brief = {
    title,
    language: contentLanguage,
    direction: contentDirection,
    content: payload.content,
    brand: claudeBrand,
    rules: payload.rules ?? null,
    slideCount: cappedSlideCount,
    // "exact" = the user picked the number (author exactly N).
    // "ceiling" = auto/estimate - slideCount is the HELD MAXIMUM; the model
    // authors what the content calls for, up to it (deck-generate appends
    // the matching directive after the Brief JSON). The stream's slide-cap
    // abort at holdSlides stays the hard enforcement either way.
    slideCountMode: preflight.exact ? "exact" : "ceiling",
    // Teaser paywall: when present, deck-generate declares `plannedTotal`
    // slides to the model (so it designs a full arc) but still aborts the
    // stream at slideCount/holdSlides, leaving the visible slides a
    // deliberately-unfinished first act. Absent on non-teaser decks, so a
    // normal brief (and the prompt built from it) is byte-for-byte unchanged.
    ...(isTeaser
      ? {
          teaser: {
            plannedTotal: teaserPlannedTotal,
            lockedCount: teaserLockedCount,
          },
        }
      : {}),
    // context/images.md — when on (create flow), deck-generate swaps the
    // SVG-only graphics directive for the images-deck override + reserves
    // generated-image boxes. OMITTED when off, so a normal deck's brief
    // (and the prompt built from it) stays byte-for-byte unchanged.
    ...(payload.imagesMode === true ? { imagesMode: true } : {}),
    // Regional people descriptor for generated lifestyle images (only when
    // resolvable). buildUserMessage turns this into the cast directive.
    ...(imageRegion ? { imageRegion } : {}),
    // Only include `source` when a valid SourceMeta was provided.
    // deck-generate's readSource() also treats `kind: "scratch"`
    // as null, so a future explicit-scratch payload remains a
    // no-op on the multipart message shape.
    ...(validatedSource ? { source: validatedSource } : {}),
  };
  const eventPayload = {
    type: projectType,
    enhance: projectType === "enhance" ? payload.enhance ?? null : null,
    brief,
    quality,
    // Pre-auth contract for deck-generate's holdCredits step: the
    // amount quoted (and shown) here is the MOST the job may charge.
    credit: {
      holdCredits: preflight.holdCredits,
      holdSlides: preflight.holdSlides,
      exact: preflight.exact,
      flow: creditFlow,
    },
  };

  // Backstop for the WHOLE event: Inngest hard-rejects deck.generate.requested
  // over 256KB (the PR #180 failure class, Sentry 77f4c998), and the per-field
  // caps above can't name every free-text rider (mimic userContent from a PDF
  // text layer, datasheet userContext, enhance instructions, a maxed-out
  // combination). Measured on the serialized form, the same unit Inngest
  // enforces, BEFORE the tx so no rows exist for a job that could never
  // enqueue. 413 so the client can tell "too big" apart from a shape error.
  if (Buffer.byteLength(JSON.stringify(eventPayload), "utf8") > MAX_EVENT_DATA_BYTES) {
    return NextResponse.json(
      {
        error:
          "brief is too large to process; reduce the content text or use a smaller source file",
      },
      { status: 413 },
    );
  }

  // Allowlist-filtered logo blob for the optional brand-kit save.
  // Lives outside the tx because it's pure data shaping — no DB
  // dependency. See `buildSafeLogoForKit` for the per-field rules
  // (size clamps, position/exclude allowlist). The `storageUrl`
  // ownership check already ran above (`isOwnedBrandAssetPath`).
  const safeLogoForKit = buildSafeLogoForKit(payload.brand?.logo);

  const result = await prisma.$transaction(async (tx) => {
    // (The user upsert moved ABOVE the credit preflight - `dbUser` in
    // scope here is that lifted row.)

    // "Save as default identity" (حفظ كهوية افتراضية). The saved kit becomes
    // the user's DEFAULT so the landing flows auto-hydrate it — colours, fonts,
    // AND the logo position — on the next mount (`fetchDefaultBrandKit`). Before
    // this, the toggle saved the kit but never set `isDefault`, so the default-
    // kit fetch always found nothing and nothing restored. Clear any prior
    // default first (the partial unique index allows one per user); the clear-
    // then-create is atomic inside this transaction.
    let brandKit: { id: string } | null = null;
    if (payload.saveBrandKit) {
      await tx.brandKit.updateMany({
        where: { userId: dbUser.id, isDefault: true },
        data: { isDefault: false },
      });
      brandKit = await tx.brandKit.create({
        data: {
          userId: dbUser.id,
          name: dict.defaults.brandKitNamed.replace("{title}", title),
          logo: safeLogoForKit?.storageUrl ?? null,
          colors: toJson(payload.brand?.colors ?? null),
          // Persist the NORMALIZED font — the value already passed safeFontUrl +
          // storage-path ownership + the uploaded-family caps, so a saved default
          // kit can't retain arbitrary URLs / junk fields that generation would
          // reject. The BrandKit JSON keeps its legacy two-slot {heading,body}
          // shape (hydrate-brand-from-session reads both); the brand is one font
          // now, so write the same value into both slots.
          fonts: toJson({
            heading: font,
            body: font,
            ...(uploadedFonts.length > 0 ? { uploaded: uploadedFonts } : {}),
          }),
          assetUrls: toJson({ logo: safeLogoForKit }),
          isDefault: true,
        },
      });
    }

    const project = await tx.project.create({
      data: {
        userId: dbUser.id,
        title,
        type: projectType,
        language: contentLanguage,
        format: payload.brand?.slideSize ?? "16:9",
        status: "queued",
        brandKitId: brandKit?.id,
        // Teaser paywall: locked-slot count frozen at creation from the
        // creator's tier (0 for paid/admin). Deck-level + stable across
        // versions so the deck stays a teaser even if the owner upgrades.
        teaserLockedCount,
        aiPrompt: JSON.stringify({
          type: projectType,
          content: payload.content,
          brand: payload.brand,
          enhance: payload.enhance,
          rules: payload.rules,
          slideCount: cappedSlideCount,
          // Persist only the SOURCE KIND — `loadProject`'s
          // `readSourceKind` keys off `source.kind` to pick the
          // generating-state status copy in DeckView ("جار تحليل
          // البيانات..." for datasheet, etc.). Storing the full
          // SourceMeta here would bloat aiPrompt with the entire
          // parsed-markdown / file_id payload — that data already
          // lives in PresentationVersion.slideJson.brief.source,
          // which is the canonical place deck-generate reads it
          // from on retry. aiPrompt is the lightweight client-side
          // hint surface, not the source of truth for the brief.
          ...(validatedSource
            ? { source: { kind: validatedSource.kind } }
            : {}),
        }),
      },
    });

    // Presentation.language + .direction reflect the user's pick
    // (see `contentLanguage` above for the validation + fallback
    // contract).
    const presentation = await tx.presentation.create({
      data: {
        projectId: project.id,
        title,
        language: contentLanguage,
        direction: contentDirection,
      },
    });

    const version = await tx.presentationVersion.create({
      data: {
        presentationId: presentation.id,
        versionNumber: 1,
        status: "queued",
        slideJson: toJson({
          status: "queued",
          slides: [],
          brief: {
            ...brief,
            enhance: payload.enhance,
          },
        }),
      },
    });

    await tx.presentation.update({
      where: { id: presentation.id },
      data: { currentVersionId: version.id },
    });

    const job = await tx.job.create({
      data: {
        projectId: project.id,
        type: "deck.generate",
        status: "queued",
        inputJson: toJson(eventPayload),
      },
    });

    return { project, presentation, version, job, dbUser };
  });

  try {
    await sendInngestEventWithRetry({
      name: "deck.generate.requested",
      data: {
        projectId: result.project.id,
        presentationId: result.presentation.id,
        versionId: result.version.id,
        jobId: result.job.id,
        // Phase 16.D — actor for `deck.regen.{started,finished}`.
        // On initial create no other collaborator can be on the
        // project yet (it was just created); the broadcast still
        // fires harmlessly and the field's there for downstream
        // notification fan-out.
        actorPrismaUserId: result.dbUser.id,
        // Max-tier processing priority (see deck-generate `priority.run`).
        tier: result.dbUser.plan,
        ...eventPayload,
      },
    });

    // Conversion-funnel step 2/4: a deck generation was enqueued (all 4 flows
    // route through this handler). After the Inngest send so a failed dispatch
    // can't emit a false event. distinctId = Supabase uid. Best-effort.
    captureServerEvent(user.id, "deck_created", {
      project_id: result.project.id,
      flow:
        validatedSource?.kind === "mimic"
          ? "mimic"
          : validatedSource?.kind === "data"
            ? "datasheet"
            : projectType,
    });
  } catch (error) {
    // Inngest unreachable after retries — mark the rows so the user
    // sees a failed state instead of an indefinite "queued". All
    // three writes can run in parallel; `Promise.allSettled` swallows
    // per-row blips uniformly (any of these could fail if the row
    // was deleted underneath us — best-effort cleanup either way).
    await Promise.allSettled([
      prisma.project.update({
        where: { id: result.project.id },
        data: { status: "failed" },
      }),
      prisma.presentationVersion.update({
        where: { id: result.version.id },
        data: { status: "failed" },
      }),
      prisma.job.update({
        where: { id: result.job.id },
        data: {
          status: "failed",
          outputJson: toJson({ error: String(error) }),
        },
      }),
    ]);
    throw error;
  }

  return NextResponse.json({
    projectId: result.project.id,
    presentationId: result.presentation.id,
  });
}
