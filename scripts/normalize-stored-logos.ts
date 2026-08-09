// One-off remediation: re-normalize every logo SVG already stored in the
// brand-assets bucket, tightening a padded viewBox to the artwork (the same
// transform new uploads now get at upload time — see normalizeLogoViewBox).
//
// This live-fixes existing decks that inject the logo as `<img>` (they load the
// stored file, so a re-normalized object shows up immediately) and any deck
// regenerated later. Decks that inlined a padded SVG into their saved slideJson
// are NOT touched here — they self-heal only on regeneration.
//
// Storage layout: brand-assets/{userId}/create/logos/{uuid}-{name}.svg
//
//   npx tsx scripts/normalize-stored-logos.ts            # dry run (default)
//   npx tsx scripts/normalize-stored-logos.ts --apply    # actually re-upload
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local,
// which point at the real Supabase project (auth + storage live there, not the
// local docker DB) — so --apply mutates PRODUCTION storage. Run the dry run
// first and review the changed list.

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
// Runtime WebSocket shim for supabase-js's Realtime client under Node 20
// (no global WebSocket). ws + @types/ws are devDependencies since 2026-08-09
// (the old @ts-expect-error became an unused-directive build error once the
// types landed).
import ws from "ws";
import { decodeSvgBytes } from "../lib/brand/svg-decode";
import { normalizeLogoViewBox } from "../lib/brand/normalize-logo-svg";

dotenv.config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const BUCKET = "brand-assets";
const PAGE = 1000;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { autoRefreshToken: false, persistSession: false },
    // Node 20 has no global WebSocket; supabase-js eagerly builds a Realtime
    // client on construction, so hand it `ws` even though this script only
    // touches storage.
    realtime: { transport: ws as unknown as typeof WebSocket },
  },
);

const viewBoxOf = (svg: string) =>
  svg.match(/viewBox\s*=\s*["']([^"']+)["']/i)?.[1] ?? "(none)";

// List every immediate child name under a storage prefix, paging through.
async function listAll(prefix: string): Promise<string[]> {
  const names: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit: PAGE, offset });
    if (error) throw new Error(`list ${prefix}: ${error.message}`);
    if (!data || data.length === 0) break;
    names.push(...data.map((e) => e.name));
    if (data.length < PAGE) break;
  }
  return names;
}

async function main() {
  console.log(
    `Re-normalizing stored logos (${APPLY ? "APPLY" : "DRY RUN"}) ...\n`,
  );

  // Top-level entries are the per-user folders.
  const userDirs = await listAll("");
  let scanned = 0;
  let changed = 0;
  let failed = 0;

  for (const userId of userDirs) {
    const prefix = `${userId}/create/logos`;
    let files: string[];
    try {
      // A missing logos folder returns [] (no throw), so a throw here is a REAL
      // error (network / auth / rate limit). Surface it — silently skipping
      // would understate the fix's completeness in the summary.
      files = await listAll(prefix);
    } catch (err) {
      failed += 1;
      console.warn(`  ! list failed: ${prefix}: ${(err as Error).message}`);
      continue;
    }

    for (const name of files) {
      if (!name.toLowerCase().endsWith(".svg")) continue;
      const path = `${prefix}/${name}`;
      scanned += 1;
      try {
        const { data, error } = await supabase.storage
          .from(BUCKET)
          .download(path);
        if (error || !data) {
          failed += 1;
          console.warn(`  ! download failed: ${path}`);
          continue;
        }
        const svg = decodeSvgBytes(await data.arrayBuffer());
        if (!svg.includes("<svg")) continue;
        const normalized = await normalizeLogoViewBox(svg);
        if (normalized === svg) continue;

        changed += 1;
        console.log(
          `  ~ ${path}\n      ${viewBoxOf(svg)}  ->  ${viewBoxOf(normalized)}`,
        );

        if (APPLY) {
          const { error: upErr } = await supabase.storage
            .from(BUCKET)
            .upload(path, Buffer.from(normalized, "utf-8"), {
              contentType: "image/svg+xml",
              upsert: true,
            });
          if (upErr) {
            failed += 1;
            console.warn(`      ! re-upload failed: ${upErr.message}`);
          }
        }
      } catch (err) {
        failed += 1;
        console.warn(`  ! error on ${path}: ${(err as Error).message}`);
      }
    }
  }

  console.log(
    `\nDone. scanned=${scanned} changed=${changed} failed=${failed}` +
      (APPLY ? "" : "  (dry run — re-run with --apply to write)"),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
