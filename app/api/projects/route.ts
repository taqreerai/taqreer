import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { sendInngestEventWithRetry } from "@/lib/inngest-helpers";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

// The brand-assets bucket is private. Upload returns a storage *path* (e.g.
// "userId/create/brand-assets/uuid-name.png"), which Claude / the renderer /
// the PPTX exporter can't fetch directly. Sign it to a long-lived HTTPS URL
// once at brief assembly so the manifest stores a fetchable src.
async function signBrandAssetUrl(path: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  const admin = createSupabaseAdminClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  // 1 year. If we ever need permanent URLs, switch the bucket to public read.
  const { data } = await admin.storage
    .from("brand-assets")
    .createSignedUrl(path, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
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
      position?: "auto" | "top-right" | "top-left" | "bottom-right" | "bottom-left";
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
      position: "auto" | "top-right" | "top-left" | "bottom-right" | "bottom-left";
      exclude: ("cover" | "closing")[];
    } | null;
  };
  saveBrandKit?: boolean;
  slideCount?: number | null;
};

function buildProjectTitle(payload: CreateProjectPayload) {
  if (payload.content?.type === "file" && payload.content.fileName) {
    return payload.content.fileName.replace(/\.[^.]+$/, "");
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
    const incomingFonts = (payload.brand?.fonts ?? null) as
      | {
          heading?: { name?: string | null; storageUrl?: string | null } | null;
          body?: { name?: string | null; storageUrl?: string | null } | null;
        }
      | null;
    const headingFontName = incomingFonts?.heading?.name?.trim() || "Arial";
    const headingFontUrl = incomingFonts?.heading?.storageUrl || null;
    const bodyFontName = incomingFonts?.body?.name?.trim() || "Arial";
    const bodyFontUrl = incomingFonts?.body?.storageUrl || null;
    const logoPath = payload.brand?.logo?.storageUrl ?? null;
    const logoSignedUrl = logoPath ? await signBrandAssetUrl(logoPath) : null;
    const claudeBrand = payload.brand
      ? {
          ...payload.brand,
          fonts: {
            heading: { name: headingFontName, storageUrl: headingFontUrl },
            body: { name: bodyFontName, storageUrl: bodyFontUrl },
          },
          logo: payload.brand.logo
            ? {
                name: payload.brand.logo.name,
                storageUrl: payload.brand.logo.storageUrl,
                // Signed HTTPS URL for the renderer + PPTX export; falls back
                // to the storage path so the brief is never missing the field.
                url: logoSignedUrl ?? payload.brand.logo.storageUrl,
                position: payload.brand.logo.position ?? "auto",
                exclude: payload.brand.logo.exclude ?? [],
              }
            : payload.brand.logo,
        }
      : payload.brand;

    const brief = {
      title,
      language: "ar",
      direction: "rtl",
      content: payload.content,
      brand: claudeBrand,
      rules: payload.rules ?? null,
      slideCount: payload.slideCount,
    };
    const eventPayload = {
      type: projectType,
      enhance: projectType === "enhance" ? payload.enhance ?? null : null,
      brief,
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

      const brandKit = payload.saveBrandKit
        ? await tx.brandKit.create({
            data: {
              userId: dbUser.id,
              name: `${title} — هوية بصرية`,
              logo: payload.brand?.logo?.storageUrl ?? null,
              colors: toJson(payload.brand?.colors ?? null),
              fonts: toJson(payload.brand?.fonts ?? null),
              assetUrls: toJson({
                logo: payload.brand?.logo ?? null,
              }),
            },
          })
        : null;

      const project = await tx.project.create({
        data: {
          userId: dbUser.id,
          title,
          type: projectType,
          language: "ar",
          format: payload.brand?.slideSize ?? "16:9",
          status: "queued",
          brandKitId: brandKit?.id,
          aiPrompt: JSON.stringify({
            type: projectType,
            content: payload.content,
            brand: payload.brand,
            enhance: payload.enhance,
            rules: payload.rules,
            slideCount: payload.slideCount,
          }),
        },
      });

      const presentation = await tx.presentation.create({
        data: {
          projectId: project.id,
          title,
          language: "ar",
          direction: "rtl",
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

      return { project, presentation, version, job };
    });

    try {
      await sendInngestEventWithRetry({
        name: "deck.generate.requested",
        data: {
          projectId: result.project.id,
          presentationId: result.presentation.id,
          versionId: result.version.id,
          jobId: result.job.id,
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
