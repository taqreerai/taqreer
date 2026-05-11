import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

type CreateProjectPayload = {
  type?: "create" | "enhance";
  content?: {
    type?: "file" | "text";
    fileName?: string;
    fileSize?: number;
    storageUrl?: string;
    text?: string;
  };
  brand?: {
    palette?: Record<string, string>;
    fonts?: unknown;
    logo?: { name?: string; storageUrl?: string } | null;
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
  outline?: string[];
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
    // The full brand (including previewDataUrl) is still kept in `aiPrompt` for debugging.
    const claudeBrand = payload.brand
      ? {
          ...payload.brand,
          logo: payload.brand.logo
            ? {
                name: payload.brand.logo.name,
                storageUrl: payload.brand.logo.storageUrl,
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
      outline: payload.outline,
      slideCount: payload.slideCount,
    };
    const eventPayload = {
      type: projectType,
      enhance: projectType === "enhance" ? payload.enhance ?? null : null,
      brief,
    };

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
      },
    });

    const result = await prisma.$transaction(async (tx) => {
      const brandKit = payload.saveBrandKit
        ? await tx.brandKit.create({
            data: {
              userId: dbUser.id,
              name: `${title} — هوية بصرية`,
              logo: payload.brand?.logo?.storageUrl ?? null,
              colors: toJson(payload.brand?.palette ?? null),
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
            outline: payload.outline,
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

    await inngest.send({
      name: "deck.generate.requested",
      data: {
        projectId: result.project.id,
        presentationId: result.presentation.id,
        versionId: result.version.id,
        jobId: result.job.id,
        ...eventPayload,
      },
    });

    return NextResponse.json({
      projectId: result.project.id,
      presentationId: result.presentation.id,
    });
  } catch (error) {
    console.error("Create project error:", error);
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}
