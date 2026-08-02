// One-off backfill: pre-generate static gen/thumb/*.webp siblings for every
// existing generated image, so the gallery/library tiles stop hitting
// Supabase's billed render/image transformations (510 origin images last
// period and climbing). New images get their thumb live in
// storeGeneratedImage (lib/images/store.ts); this sweeps the back catalog.
//
//   dry-run:  npx tsx scripts/backfill-image-thumbs.ts
//   apply:    npx tsx scripts/backfill-image-thumbs.ts --apply
//   prod:     scp to the box + `cd /root/taqreer && node_modules/.bin/tsx
//             scripts/backfill-image-thumbs.ts --apply`
//
// Rows-only iteration is sufficient: both galleries render exclusively
// GeneratedImage rows (lib/stock-images/query.ts + the /library page).
// Re-run once ~a day after deploy: decks mid-generation AT deploy time had
// their originals stored by the old code (no thumb) and their rows written by
// the post-deploy reconcile, so the first pass can miss them. Idempotent:
// existing thumbs are skipped via one storage list per project.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
// `ws` ships no bundled type declarations; runtime WebSocket shim for
// supabase-js's eagerly-built Realtime client under Node 20.
// @ts-expect-error - no types for 'ws'
import ws from "ws";
import { makeThumbBytes } from "../lib/images/store";

const APPLY = process.argv.includes("--apply");
const BUCKET = "generated-images";
const OBJECT_MARKER = "/storage/v1/object/public/generated-images/";
const PAGE = 1000;
// Parallel download+encode+upload per batch. Modest: the box also serves prod.
const CONCURRENCY = 4;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws as unknown as typeof WebSocket },
  },
);

// storageUrl → { projectId, file } — only canonical gen-image URLs qualify
// (same scoping as the client rewrite in components/app/gen-thumb.tsx).
function parseGenUrl(url: string): { projectId: string; file: string } | null {
  const idx = url.indexOf(OBJECT_MARKER);
  if (idx === -1 || url.includes("?")) return null;
  const rest = url.slice(idx + OBJECT_MARKER.length);
  const m = rest.match(/^([^/]+)\/gen\/([^/]+\.[a-z0-9]+)$/i);
  return m ? { projectId: m[1], file: m[2] } : null;
}

async function listThumbs(projectId: string): Promise<Set<string>> {
  const names = new Set<string>();
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(`${projectId}/gen/thumb`, { limit: PAGE, offset });
    if (error) throw new Error(`list thumbs ${projectId}: ${error.message}`);
    for (const f of data ?? []) names.add(f.name);
    if (!data || data.length < PAGE) return names;
    offset += PAGE;
  }
}

async function main() {
  const { prisma } = await import("../lib/prisma");
  const rows = await prisma.generatedImage.findMany({
    where: { status: "ready", storageUrl: { not: null } },
    select: { storageUrl: true },
  });
  await prisma.$disconnect();

  // Dedupe by path — identical-prompt regens across versions share an object.
  const byProject = new Map<string, Set<string>>();
  let unparsable = 0;
  for (const r of rows) {
    const parsed = parseGenUrl(r.storageUrl!);
    if (!parsed) {
      unparsable += 1;
      continue;
    }
    const files = byProject.get(parsed.projectId) ?? new Set<string>();
    files.add(parsed.file);
    byProject.set(parsed.projectId, files);
  }

  let scanned = 0;
  let skipped = 0;
  let written = 0;
  let failed = 0;

  for (const [projectId, files] of byProject) {
    const existing = await listThumbs(projectId).catch((err) => {
      console.warn(`[skip project] ${projectId}: ${String(err)}`);
      return null;
    });
    if (!existing) {
      failed += files.size;
      continue;
    }

    const todo: string[] = [];
    for (const file of files) {
      scanned += 1;
      const thumbName = file.replace(/\.[a-z0-9]+$/i, ".webp");
      if (existing.has(thumbName)) {
        skipped += 1;
        continue;
      }
      todo.push(file);
    }

    for (let i = 0; i < todo.length; i += CONCURRENCY) {
      const batch = todo.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (file) => {
          const thumbName = file.replace(/\.[a-z0-9]+$/i, ".webp");
          if (!APPLY) {
            written += 1;
            console.log(`[dry-run] would write ${projectId}/gen/thumb/${thumbName}`);
            return;
          }
          try {
            const { data, error } = await supabase.storage
              .from(BUCKET)
              .download(`${projectId}/gen/${file}`);
            if (error || !data) throw new Error(error?.message ?? "download failed");
            const thumb = await makeThumbBytes(Buffer.from(await data.arrayBuffer()));
            const { error: upErr } = await supabase.storage
              .from(BUCKET)
              .upload(`${projectId}/gen/thumb/${thumbName}`, thumb, {
                contentType: "image/webp",
                upsert: true,
                cacheControl: "31536000",
              });
            if (upErr) throw new Error(upErr.message);
            written += 1;
          } catch (err) {
            failed += 1;
            console.warn(`[failed] ${projectId}/gen/${file}: ${String(err)}`);
          }
        }),
      );
    }
  }

  console.log(
    `${APPLY ? "APPLIED" : "DRY-RUN"} — projects: ${byProject.size}, scanned: ${scanned}, ` +
      `skipped(existing): ${skipped}, written: ${written}, failed: ${failed}, unparsable rows: ${unparsable}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
