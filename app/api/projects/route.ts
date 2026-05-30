import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { sendInngestEventWithRetry } from "@/lib/inngest-helpers";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { isOwnedBrandAssetPath, signBrandAssetUrl } from "@/lib/storage/sign";
import { ALLOWED_FONT_HOSTS } from "@/lib/schema/slide";
import {
  DEFAULT_QUALITY,
  estimateSlideCountFromText,
  isQuality,
  type Quality,
} from "@/lib/types/quality";
import { SourceMetaSchema, type SourceMeta } from "@/lib/types/source";

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
// Returns null on any failure (file missing, fetch failure, non-SVG content,
// parse error). The caller falls back to the URL-only logo block in that case.
//
// Earlier revisions returned a `{ markup, isPolychrome, aspectRatio }` blob.
// Both extra signals were dropped (2026-05-27, user direction): every
// supported logo is treated as "flatten to a single contrast color per
// slide" + a single fixed wrapper size. Less metadata to plumb, less
// prompt prose to render, faster Claude turnaround.
async function readLogoSvgMarkup(path: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  try {
    const admin = createSupabaseAdminClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await admin.storage
      .from("brand-assets")
      .download(path);
    if (error || !data) return null;
    const text = await data.text();
    if (!text.includes("<svg")) return null;
    // Run every pattern from the module-scope strip list. See the
    // `SVG_STRIP_PATTERNS` declaration for the per-pattern rationale.
    return SVG_STRIP_PATTERNS.reduce(
      (acc, re) => acc.replace(re, ""),
      text,
    );
  } catch {
    return null;
  }
}

type CreateProjectPayload = {
  type?: "create" | "enhance";
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
      position:
        | "top-left"
        | "top-center"
        | "top-right"
        | "bottom-left"
        | "bottom-center"
        | "bottom-right";
      exclude: ("cover" | "closing")[];
    } | null;
  };
  saveBrandKit?: boolean;
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

function buildProjectTitle(payload: CreateProjectPayload) {
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

  return "عرض جديد";
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
function readBriefFont(slot: BriefFontSlot): {
  name: string;
  storageUrl: string | null;
  url: string | null;
} {
  return {
    name: slot?.name?.trim() || "Arial",
    storageUrl: slot?.storageUrl || null,
    url: safeFontUrl(slot?.url),
  };
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
        position?: string;
        exclude?: ("cover" | "closing")[];
      }
    | null
    | undefined,
): {
  name: string | null;
  storageUrl: string | null;
  position: string | null;
  exclude: ("cover" | "closing")[];
} | null {
  if (!logo) return null;
  return {
    name: typeof logo.name === "string" ? logo.name.slice(0, 200) : null,
    storageUrl:
      typeof logo.storageUrl === "string"
        ? logo.storageUrl.slice(0, 2000)
        : null,
    position:
      typeof logo.position === "string" ? logo.position.slice(0, 32) : null,
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
  headingFont: ReturnType<typeof readBriefFont>,
  bodyFont: ReturnType<typeof readBriefFont>,
  logoSignedUrl: string | null,
  logoSvgMarkup: string | null,
): CreateProjectPayload["brand"] {
  if (!rawBrand) return rawBrand;
  return {
    ...rawBrand,
    fonts: {
      // Carry `url` (Google CSS link) and `storageUrl` (uploaded
      // file) BOTH through to the brief. The system prompt's OUTPUT
      // schema asks Claude to emit `fontHeading.url` / `fontBody.url`;
      // without `url` here Claude was guessing.
      heading: headingFont,
      body: bodyFont,
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
          position: rawBrand.logo.position ?? "top-right",
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
function resolveQuality(raw: unknown): Quality {
  return isQuality(raw) ? raw : DEFAULT_QUALITY;
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json()) as CreateProjectPayload;
  const title = buildProjectTitle(payload);
  const projectType = payload.type === "enhance" ? "enhance" : "create";

  // Slim brand for Claude: drop base64 `previewDataUrl` (saves ~3000
  // input tokens). Falls back to Arial when no font configured — the
  // universal default available on every OS, supports both Arabic and
  // Latin scripts.
  const incomingFonts = payload.brand?.fonts as
    | { heading?: BriefFontSlot; body?: BriefFontSlot }
    | undefined;
  const headingFont = readBriefFont(incomingFonts?.heading);
  const bodyFont = readBriefFont(incomingFonts?.body);
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
  const [logoSignedUrl, logoSvgMarkup] = logoPath
    ? await Promise.all([
        signBrandAssetUrl(logoPath),
        readLogoSvgMarkup(logoPath),
      ])
    : [null, null];
  const claudeBrand = buildClaudeBrand(
    payload.brand,
    headingFont,
    bodyFont,
    logoSignedUrl,
    logoSvgMarkup,
  );

  // Auto slide-count when the user defers ("auto" mode on
  // /create/summary): estimate from the input text. For file uploads
  // we don't have the text in-hand, so fall back to null and let the
  // prompt's "8–12 if unset" guidance stand.
  const resolvedSlideCount =
    payload.slideCount ??
    (payload.content?.type === "text"
      ? estimateSlideCountFromText(payload.content.text)
      : null);

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
  const quality = resolveQuality(payload.quality);

  const brief = {
    title,
    language: contentLanguage,
    direction: contentDirection,
    content: payload.content,
    brand: claudeBrand,
    rules: payload.rules ?? null,
    slideCount: resolvedSlideCount,
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
  };

  // Allowlist-filtered logo blob for the optional brand-kit save.
  // Lives outside the tx because it's pure data shaping — no DB
  // dependency. See `buildSafeLogoForKit` for the per-field rules
  // (size clamps, position/exclude allowlist). The `storageUrl`
  // ownership check already ran above (`isOwnedBrandAssetPath`).
  const safeLogoForKit = buildSafeLogoForKit(payload.brand?.logo);

  const result = await prisma.$transaction(async (tx) => {
    // Upsert is inside the tx so a tx failure rolls back the user row
    // too; also lets concurrent first-time-user requests resolve cleanly
    // via the unique constraint on supabaseUserId.
    const dbUser = await tx.user.upsert({
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
      },
    });

    const brandKit = payload.saveBrandKit
      ? await tx.brandKit.create({
          data: {
            userId: dbUser.id,
            name: `${title} — هوية بصرية`,
            logo: safeLogoForKit?.storageUrl ?? null,
            colors: toJson(payload.brand?.colors ?? null),
            fonts: toJson(payload.brand?.fonts ?? null),
            assetUrls: toJson({ logo: safeLogoForKit }),
          },
        })
      : null;

    const project = await tx.project.create({
      data: {
        userId: dbUser.id,
        title,
        type: projectType,
        language: contentLanguage,
        format: payload.brand?.slideSize ?? "16:9",
        status: "queued",
        brandKitId: brandKit?.id,
        aiPrompt: JSON.stringify({
          type: projectType,
          content: payload.content,
          brand: payload.brand,
          enhance: payload.enhance,
          rules: payload.rules,
          slideCount: resolvedSlideCount,
          // Persist only the SOURCE KIND — `loadProject`'s
          // `readSourceKind` keys off `source.kind` to pick the
          // generating-state status copy in DeckView ("جارٍ تحليل
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
        ...eventPayload,
      },
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
