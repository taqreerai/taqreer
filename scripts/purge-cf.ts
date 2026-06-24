// Deploy-time + manual Cloudflare edge-cache purge.
//
// Run on the prod box, where CLOUDFLARE_ZONE_ID + CLOUDFLARE_PURGE_TOKEN live
// in .env (dotenv/config loads them into process.env before purge.ts reads
// them at import):
//   npx tsx -r dotenv/config scripts/purge-cf.ts
//
// scripts/post-receive.sh calls this after a successful deploy — a new build
// changes every hashed chunk filename, so cached HTML must re-fetch or it loads
// pointing at 404'd chunks (static HTML, no hydration). No-ops + logs when the
// credentials are unset (local dev / unconfigured envs).
import { purgeCloudflareEverything } from "../lib/cloudflare/purge";

(async () => {
  await purgeCloudflareEverything();
})();
