// Daily janitor: purge user-uploaded source files older than 24h.
//
// Uploaded deck CONTENT (PDF / PPTX / DOCX) is staged in the
// `source-files` bucket only so the extraction pipeline can normalize
// it to a PDF and hand it to Claude. Once the deck is generated the
// original upload is dead weight — keeping it forever is a privacy +
// storage liability. Policy (product call 2026-06-25): nothing a user
// uploads as deck content lives on our storage past one day.
//
// Why a bucket-age walk (not a Job-row join): the bucket is the single
// source of truth and catches every producer (the /api/extract staging
// path AND any direct /api/storage/upload writes) with no schema
// coupling. Normal generation finishes minutes after upload, so a 24h
// floor never races a live run, a retry, or a same-session regen. The
// only thing it forecloses is regenerating a deck from its ORIGINAL
// file more than a day later — the generated deck and its edit history
// live in the manifest and are untouched — which matches the "useless
// once generated" policy.

import { inngest } from "@/inngest/client";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

const SOURCE_FILES_BUCKET = "source-files";
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 1 day
// The bucket nests at most user/extract/<jobId>/<file> (and
// user/create/<folder>/<file>); depth 5 covers it with headroom.
const MAX_DEPTH = 5;
const PAGE = 100;
// Per-run safety ceiling so one sweep can't spin forever on a runaway
// bucket. Anything beyond it is logged and picked up the next night.
const MAX_DELETE_PER_RUN = 5000;

type Walk = { stale: string[]; truncated: boolean };

// Recursively collect object keys older than `cutoff`. Supabase
// `.list()` returns folder placeholders (null id, no metadata) and
// real files; we recurse into the former and age-check the latter.
async function collectStaleObjects(
  admin: SupabaseClient,
  prefix: string,
  cutoff: number,
  depth: number,
  acc: Walk,
): Promise<void> {
  if (depth > MAX_DEPTH) return;
  let offset = 0;
  for (;;) {
    if (acc.stale.length >= MAX_DELETE_PER_RUN) {
      acc.truncated = true;
      return;
    }
    const { data, error } = await admin.storage
      .from(SOURCE_FILES_BUCKET)
      .list(prefix, {
        limit: PAGE,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
    if (error) throw new Error(`list "${prefix}" failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!entry.id) {
        // Folder placeholder — descend.
        await collectStaleObjects(admin, path, cutoff, depth + 1, acc);
        continue;
      }
      // created_at is `string | null` on Supabase's FileObject; a null /
      // unparseable timestamp → NaN → skip, never risk a fresh upload.
      const created = entry.created_at ? Date.parse(entry.created_at) : NaN;
      if (Number.isFinite(created) && created < cutoff) acc.stale.push(path);
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
}

export const sourceFilesCleanup = inngest.createFunction(
  {
    id: "source-files-cleanup",
    name: "Source-files cleanup (purge user uploads > 24h)",
    retries: 2,
    // 02:00 daily — off-peak, ahead of the 03:00 credits + 04:00
    // notifications janitors so the nightly window stays staggered.
    triggers: [{ cron: "0 2 * * *" }],
  },
  async ({ step, logger }) => {
    const result = await step.run("purge-stale-source-files", async () => {
      const admin = getSupabaseAdmin();
      const cutoff = Date.now() - MAX_AGE_MS;
      const acc: Walk = { stale: [], truncated: false };
      await collectStaleObjects(admin, "", cutoff, 0, acc);

      let removed = 0;
      // Supabase caps a single remove() payload; chunk to stay under it.
      for (let i = 0; i < acc.stale.length; i += PAGE) {
        const batch = acc.stale.slice(i, i + PAGE);
        const { error } = await admin.storage
          .from(SOURCE_FILES_BUCKET)
          .remove(batch);
        if (error) throw new Error(`remove failed: ${error.message}`);
        removed += batch.length;
      }
      return { removed, truncated: acc.truncated };
    });

    logger.info("source-files-cleanup complete", result);
    if (result.truncated) {
      logger.warn(
        `source-files-cleanup hit the ${MAX_DELETE_PER_RUN}-object per-run ` +
          `cap; the remainder will be purged on the next nightly run.`,
      );
    }
    return result;
  },
);
