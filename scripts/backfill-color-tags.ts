// One-time backfill for `Project.colorTags`.
//
// Walks every project with an empty `colorTags` array and computes
// the value the new freeze logic in `deck-generate.ts` would have
// written if it had run at the time. Reads two sources in priority
// order (same as the live function):
//
//   1. `Project.aiPrompt` — original POST payload to /api/projects,
//      stringified JSON containing `brand.colors[]` as the user
//      picked them. The deck-generate function consumes the SAME
//      field so this matches what the live code would do.
//   2. The latest completed `PresentationVersion.slideJson`'s
//      `theme.palette` as fallback when the brief had no colors
//      (Claude-decides decks).
//
// Last-resort: `[#000000, #FFFFFF]` (greyscale fallback).
//
// Usage:
//   pnpm tsx scripts/backfill-color-tags.ts            # dry-run
//   pnpm tsx scripts/backfill-color-tags.ts --apply    # write

import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { deriveColorTags } from "../lib/project/derive-color-tags";

const APPLY = process.argv.includes("--apply");

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required (.env.local)");
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter });

  try {
    const projects = await prisma.project.findMany({
      where: { colorTags: { isEmpty: true } },
      select: {
        id: true,
        title: true,
        aiPrompt: true,
        presentation: {
          select: {
            versions: {
              where: { status: "completed" },
              orderBy: { versionNumber: "desc" },
              take: 1,
              select: { slideJson: true },
            },
          },
        },
      },
    });

    console.log(
      `Found ${projects.length} project(s) with empty colorTags. ${
        APPLY ? "Applying writes." : "Dry-run (no --apply)."
      }\n`,
    );

    let written = 0;
    for (const project of projects) {
      const brief = parseBrief(project.aiPrompt);
      // Pass `brief.brand` straight in — `extractStringArray` has a
      // built-in branch that pulls `.colors` off a plain object when no
      // explicit `key` is given. Keeps the call type-safe without
      // adding a cast for an unknown-typed nested property.
      const briefColors = extractStringArray(brief?.brand);
      const manifestColors = extractStringArray(
        project.presentation?.versions[0]?.slideJson &&
          typeof project.presentation.versions[0].slideJson === "object"
          ? (project.presentation.versions[0].slideJson as Record<string, unknown>)
              .theme
          : undefined,
        "palette",
      );
      const tags = deriveColorTags(briefColors, manifestColors);
      console.log(
        `  ${project.id}  "${project.title.slice(0, 40)}"  →  [${tags.join(", ")}]`,
      );
      if (APPLY) {
        await prisma.project.update({
          where: { id: project.id },
          data: { colorTags: tags },
        });
        written++;
      }
    }
    if (APPLY) console.log(`\nWrote ${written} project(s).`);
    else console.log(`\nRe-run with --apply to commit.`);
  } finally {
    await prisma.$disconnect();
  }
}

function parseBrief(aiPrompt: string | null): Record<string, unknown> | null {
  if (!aiPrompt) return null;
  try {
    return JSON.parse(aiPrompt) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Reads colors[] from either `value` directly (when value is a {colors}
// object) OR from `value[key]` (e.g. theme.palette). Tolerant — drops
// non-strings; the deriveColorTags hex validator takes care of the
// final filtering.
function extractStringArray(
  value: unknown,
  key?: string,
): string[] {
  let raw: unknown = value;
  if (key && raw && typeof raw === "object" && !Array.isArray(raw)) {
    raw = (raw as Record<string, unknown>)[key];
  } else if (raw && typeof raw === "object" && !Array.isArray(raw) && "colors" in raw) {
    raw = (raw as Record<string, unknown>).colors;
  }
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === "string");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
