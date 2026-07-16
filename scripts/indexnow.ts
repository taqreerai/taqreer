// Submit URLs to IndexNow (Bing/Yandex/AI crawlers). Complements the Google
// sitemap flow. scripts/post-receive.sh runs this after a successful deploy
// (fail-soft), so every deploy re-announces the live URL set; also runnable
// by hand:
//
//   npx tsx scripts/indexnow.ts                 # all URLs from the live sitemap
//   npx tsx scripts/indexnow.ts https://taqreer.ai/en/free-stock-images ...
//
// No secrets needed (the IndexNow key is public), so no dotenv required.

import {
  submitToIndexNow,
  INDEXNOW_HOST,
} from "../lib/seo/indexnow";

// Pull every <loc> from the live sitemap so a deploy announces the current
// public URL set without a hand-maintained list. Fail-soft to [].
async function sitemapUrls(): Promise<string[]> {
  try {
    const res = await fetch(`https://${INDEXNOW_HOST}/sitemap.xml`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(`[indexnow] sitemap fetch failed: HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  } catch (err) {
    console.error("[indexnow] sitemap fetch error", err);
    return [];
  }
}

(async () => {
  const args = process.argv.slice(2);
  const urls = args.length > 0 ? args : await sitemapUrls();
  if (urls.length === 0) {
    console.log("[indexnow] no URLs to submit");
    return;
  }
  const { ok, status, count } = await submitToIndexNow(urls);
  console.log(
    `[indexnow] submitted ${count} url(s) -> ${ok ? "OK" : "FAILED"}${
      status ? ` (HTTP ${status})` : ""
    }`,
  );
})();
