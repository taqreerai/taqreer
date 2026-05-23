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
    return (
      text
        // Execution vectors
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
        .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
        .replace(/javascript:/gi, "")
        // Prompt-injection vectors — strip elements that carry arbitrary
        // free-text Claude would otherwise read as instructions.
        .replace(/<title[\s\S]*?<\/title>/gi, "")
        .replace(/<desc[\s\S]*?<\/desc>/gi, "")
        .replace(/<metadata[\s\S]*?<\/metadata>/gi, "")
        .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
        // HTML / XML comments (can hide injected directives in plain text)
        .replace(/<!--[\s\S]*?-->/g, "")
        // XML processing instructions (e.g. `<?xml-stylesheet ...?>`) and
        // DOCTYPE declarations — both carry free-text payloads and the
        // export pipeline doesn't need them once the SVG is inlined.
        .replace(/<\?[\s\S]*?\?>/g, "")
        .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
        // CDATA sections wrap arbitrary text including unescaped HTML —
        // a clean removal target since nothing legitimate in our logo
        // pipeline relies on CDATA-wrapped content.
        .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
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

export async function POST(request: Request) {
  try {
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

    // Slim brand for Claude: drop base64 `previewDataUrl` (saves ~3000 input tokens).
    // Also fill in font fallbacks — if the user didn't upload custom fonts,
    // Arial is the universal default (available on every OS, supports both
    // Arabic and Latin scripts).
    // Brand page passes `url` for Google fonts (CSS link), `storageUrl`
    // for uploaded font files, plus `family` (alias of `name`). Carry
    // ALL of them through — earlier this only forwarded name + storageUrl,
    // so Google fonts arrived at Claude as `{ name: "Playfair Display",
    // storageUrl: null }` with no URL, forcing Claude to guess the
    // Google CSS endpoint (and frequently miss).
    const incomingFonts = (payload.brand?.fonts ?? null) as
      | {
          heading?: {
            name?: string | null;
            storageUrl?: string | null;
            url?: string | null;
            family?: string | null;
          } | null;
          body?: {
            name?: string | null;
            storageUrl?: string | null;
            url?: string | null;
            family?: string | null;
          } | null;
        }
      | null;
    const headingFontName = incomingFonts?.heading?.name?.trim() || "Arial";
    const headingFontStorageUrl = incomingFonts?.heading?.storageUrl || null;
    const headingFontUrl = safeFontUrl(incomingFonts?.heading?.url);
    const bodyFontName = incomingFonts?.body?.name?.trim() || "Arial";
    const bodyFontStorageUrl = incomingFonts?.body?.storageUrl || null;
    const bodyFontUrl = safeFontUrl(incomingFonts?.body?.url);
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
    // Fetch sign URL + SVG markup in parallel — both hit Supabase Storage so
    // pipelining saves a round trip. svgMarkup is the Option B addition:
    // Claude inlines the SVG directly per slide and overrides `fill` for
    // per-slide contrast instead of using <img src="..."> with a runtime
    // fetch / recolour step. See `inngest/functions/deck-generate.ts` for
    // how the markup is presented to Claude.
    const [logoSignedUrl, logoSvgMarkup] = logoPath
      ? await Promise.all([
          signBrandAssetUrl(logoPath),
          readLogoSvgMarkup(logoPath),
        ])
      : [null, null];
    const claudeBrand = payload.brand
      ? {
          ...payload.brand,
          fonts: {
            // Carry `url` (Google CSS link) and `storageUrl` (uploaded
            // file) BOTH through to the brief. The system prompt's
            // OUTPUT schema asks Claude to emit `fontHeading.url` /
            // `fontBody.url`; without `url` here Claude was guessing.
            heading: {
              name: headingFontName,
              storageUrl: headingFontStorageUrl,
              url: headingFontUrl,
            },
            body: {
              name: bodyFontName,
              storageUrl: bodyFontStorageUrl,
              url: bodyFontUrl,
            },
          },
          logo: payload.brand.logo
            ? {
                name: payload.brand.logo.name,
                storageUrl: payload.brand.logo.storageUrl,
                // Signed HTTPS URL — fallback when svgMarkup is missing
                // (caller renders an <img> instead of inline SVG).
                url: logoSignedUrl ?? payload.brand.logo.storageUrl,
                // Inline SVG markup. When present, Claude inlines this
                // directly per slide and sets `fill="#hex"` on the <svg>
                // root for per-slide contrast. When null (fetch failed
                // or non-SVG), buildUserMessage emits the URL-only block
                // and Claude falls back to <img src="...">.
                svgMarkup: logoSvgMarkup,
                position: payload.brand.logo.position ?? "top-right",
                exclude: payload.brand.logo.exclude ?? [],
              }
            : payload.brand.logo,
        }
      : payload.brand;

    // Auto slide-count when the user defers ("auto" mode on /create/summary):
    // estimate from the input text (cover + content slides distributed at
    // ~100 words/slide + closing). For file uploads we don't have the text
    // in-hand, so fall back to null and let the prompt's "8–12 if unset"
    // guidance stand. See estimateSlideCountFromText for the formula.
    const resolvedSlideCount =
      payload.slideCount ??
      (payload.content?.type === "text"
        ? estimateSlideCountFromText(payload.content.text)
        : null);

    // User-picked language from /create/content (since 2026-05-20).
    // Falls back to "ar" if the payload doesn't carry the field —
    // covers legacy clients + bookmarklets that POST without
    // language. Anything off-axis (string we don't recognise)
    // also collapses to "ar"; we don't 400 here because the union
    // is a UX detail, not a security boundary. Phase B/C will
    // branch on this for prompt selection + BiDi gating.
    const contentLanguage: ContentLanguage = isContentLanguage(payload.language)
      ? payload.language
      : "ar";
    const contentDirection = directionForLanguage(contentLanguage);
    const brief = {
      title,
      language: contentLanguage,
      direction: contentDirection,
      content: payload.content,
      brand: claudeBrand,
      rules: payload.rules ?? null,
      slideCount: resolvedSlideCount,
    };
    // Quality preset — user-picked on /create/summary. Validated
    // here so a malformed value can't drive the Claude call params.
    // Defaults to "medium" (current backend baseline) on missing /
    // unknown values, including from older queued jobs that
    // predate this field.
    const quality: Quality = isQuality(payload.quality)
      ? payload.quality
      : DEFAULT_QUALITY;
    const eventPayload = {
      type: projectType,
      enhance: projectType === "enhance" ? payload.enhance ?? null : null,
      brief,
      quality,
    };

    const result = await prisma.$transaction(async (tx) => {
      // Upsert is inside the tx so a tx failure rolls back the user row too;
      // also lets concurrent first-time-user requests resolve cleanly via the
      // unique constraint on supabaseUserId.
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

      // Mirror the `safeLogo` filter from /api/brand-kits POST — without
      // it the saveBrandKit branch would persist `payload.brand.logo`
      // verbatim, including any base64 `previewDataUrl` that bloats the
      // row by 50–500 KB and rides along on every subsequent GET. The
      // shape allowlist also clamps `position` / `exclude` to known
      // values so unrelated fields the client may have stuffed into the
      // logo object don't end up in storage. The `storageUrl` ownership
      // check already ran above (`isOwnedBrandAssetPath`).
      const safeLogoForKit = payload.brand?.logo
        ? {
            name:
              typeof payload.brand.logo.name === "string"
                ? payload.brand.logo.name.slice(0, 200)
                : null,
            storageUrl:
              typeof payload.brand.logo.storageUrl === "string"
                ? payload.brand.logo.storageUrl.slice(0, 2000)
                : null,
            position:
              typeof payload.brand.logo.position === "string"
                ? payload.brand.logo.position.slice(0, 32)
                : null,
            exclude: Array.isArray(payload.brand.logo.exclude)
              ? payload.brand.logo.exclude.filter(
                  (v): v is "cover" | "closing" =>
                    v === "cover" || v === "closing",
                )
              : [],
          }
        : null;

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
          }),
        },
      });

      // Presentation.language + .direction now reflect the user's
      // pick (see `contentLanguage` above for the validation +
      // fallback contract).
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
          // notification fan-out (Phase 16.E will reuse it).
          actorPrismaUserId: result.dbUser.id,
          ...eventPayload,
        },
      });
    } catch (error) {
      // Inngest unreachable after retries — mark the rows so the user sees a
      // failed state instead of an indefinite "queued".
      await prisma.project
        .update({ where: { id: result.project.id }, data: { status: "failed" } })
        .catch(() => undefined);
      await prisma.presentationVersion
        .update({ where: { id: result.version.id }, data: { status: "failed" } })
        .catch(() => undefined);
      await prisma.job
        .update({
          where: { id: result.job.id },
          data: { status: "failed", outputJson: toJson({ error: String(error) }) },
        })
        .catch(() => undefined);
      throw error;
    }

    return NextResponse.json({
      projectId: result.project.id,
      presentationId: result.presentation.id,
    });
  } catch (error) {
    console.error("Create project error:", error);
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}
