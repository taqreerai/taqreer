// IndexNow submission — instantly notifies IndexNow-participating engines
// (Bing, Yandex, Seznam, Naver, ...) and the AI crawlers that consume that
// feed when our public URLs are added/updated. Complements the Google
// sitemap flow (Google does NOT use IndexNow).
//
// The key is PUBLIC by design — it's hosted at `keyLocation`
// (public/<key>.txt) so the endpoint can verify we own the host. So it's a
// plain constant here, NOT a secret.
//
// Fail-soft everywhere: a submission failure must never break a deploy or a
// request. Callers ignore the result or just log it.

export const INDEXNOW_KEY = "ff80233c6160f3f6383f96747636696a";
export const INDEXNOW_HOST = "taqreer.ai";
export const INDEXNOW_KEY_LOCATION = `https://${INDEXNOW_HOST}/${INDEXNOW_KEY}.txt`;

// The aggregator endpoint fans a single submission out to every participating
// engine (vs. pinging each one). https://www.indexnow.org/faq
const ENDPOINT = "https://api.indexnow.org/indexnow";
const MAX_URLS = 10_000; // IndexNow per-request cap
const TIMEOUT_MS = 10_000;

/**
 * Submit a batch of same-host URLs to IndexNow. Returns `{ ok, status }`;
 * never throws. Off-host URLs are dropped (IndexNow rejects a batch whose
 * URLs don't all match `host`).
 */
export async function submitToIndexNow(
  urls: string[],
): Promise<{ ok: boolean; status?: number; count: number }> {
  const prefix = `https://${INDEXNOW_HOST}/`;
  const urlList = [...new Set(urls)]
    .filter((u) => u.startsWith(prefix))
    .slice(0, MAX_URLS);
  if (urlList.length === 0) return { ok: false, count: 0 };

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: INDEXNOW_HOST,
        key: INDEXNOW_KEY,
        keyLocation: INDEXNOW_KEY_LOCATION,
        urlList,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 200 = accepted, 202 = accepted (key validation pending). Anything else
    // is a soft failure we just log.
    if (!res.ok) {
      console.error(`[indexnow] submit failed: HTTP ${res.status}`);
    }
    return { ok: res.ok, status: res.status, count: urlList.length };
  } catch (err) {
    console.error("[indexnow] submit error", err);
    return { ok: false, count: urlList.length };
  }
}
