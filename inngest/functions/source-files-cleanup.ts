// Hourly janitor: purge user-uploaded source files older than 24h.
//
// Uploaded deck CONTENT (PDF / PPTX / DOCX) is staged in the
// `source-files` bucket only so the extraction pipeline can normalize
// it to a PDF and hand it to Claude. Once the deck is generated the
// original upload is dead weight, and keeping it forever is a privacy +
// storage liability. Policy (product call 2026-06-25): nothing a user
// uploads as deck content lives on our storage past one day.
//
// Why a bucket-age walk (not a Job-row join): the bucket is the single
// source of truth and catches every producer (the /api/extract staging
// path AND any direct /api/storage/upload writes) with no schema
// coupling. Normal generation finishes minutes after upload, so a 24h
// floor never races a live run, a retry, or a same-session regen. The
// only thing it forecloses is regenerating a deck from its ORIGINAL
// file more than a day later (the generated deck and its edit history
// live in the manifest and are untouched), which matches the "useless
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
  if (depth > MAX_DEPTH) {
    // Never silently retain: an over-depth prefix means the bucket nests
    // deeper than expected, so flag the run instead of skipping quietly.
    acc.truncated = true;
    return;
  }
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
        // Folder placeholder; descend into it.
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
    // Hourly. A daily sweep plus a 24h cutoff would let a file uploaded
    // just after the run linger up to ~48h; running hourly bounds real
    // retention to ~24-25h, honoring the "off storage past one day" policy.
    triggers: [{ cron: "0 * * * *" }],
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
        `source-files-cleanup left some stale objects unswept (hit the ` +
          `${MAX_DELETE_PER_RUN}-object per-run cap or an over-depth prefix); ` +
          `the remainder is purged on a subsequent hourly run.`,
      );
    }
    return result;
  },
);
