// Read-only Bing Webmaster report: crawl stats, URL submission quota and the
// index state of every URL in the live sitemap.
//
//   npx tsx --env-file=.env.local scripts/bing-status.ts [--urls a,b]
//
// Needs BING_WEBMASTER_API_KEY (Webmaster Tools > Settings > API Access). The
// key is read from the environment and never printed. Changes nothing on Bing.
const KEY = process.env.BING_WEBMASTER_API_KEY;
const SITE = "https://taqreer.ai/";
const API = "https://ssl.bing.com/webmaster/api.svc/json";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const when = (v: unknown) => {
  const ms = Number(/\d+/.exec(String(v ?? ""))?.[0]);
  const d = ms > 0 ? new Date(ms).toISOString().slice(0, 10) : "never";
  return d.startsWith("3939") ? "never" : d; // 3939 is Bing's "no data" sentinel
};

async function call(method: string, params: Record<string, string> = {}, tries = 4): Promise<unknown> {
  const qs = new URLSearchParams({ apikey: KEY!, ...params });
  const res = await fetch(`${API}/${method}?${qs}`);
  const body = (await res.json().catch(() => null)) as { d?: unknown; Message?: string } | null;
  if (!res.ok && tries > 1 && /Throttle/i.test(body?.Message ?? "")) {
    await sleep(4000);
    return call(method, params, tries - 1);
  }
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status} ${body?.Message ?? ""}`);
  return body?.d;
}

async function main() {
  if (!KEY) throw new Error("BING_WEBMASTER_API_KEY is not set");
  const arg = process.argv.indexOf("--urls");
  let urls: string[];
  if (arg >= 0) urls = process.argv[arg + 1].split(",");
  else {
    const xml = await (await fetch(`${SITE}sitemap.xml`)).text();
    urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  }

  console.log("Quota:", JSON.stringify(await call("GetUrlSubmissionQuota", { siteUrl: SITE })));
  const crawl = (await call("GetCrawlStats", { siteUrl: SITE })) as Array<Record<string, unknown>>;
  console.log("Crawl stats (latest 5):", JSON.stringify(crawl.slice(-5)));

  const tally: Record<string, number> = {};
  const rows: string[] = [];
  for (const url of urls) {
    try {
      const i = (await call("GetUrlInfo", { siteUrl: SITE, url })) as Record<string, unknown> | null;
      const crawled = when(i?.LastCrawledDate);
      const state = i ? `last crawled ${crawled}, http ${i.HttpCode ?? "-"}, discovered ${when(i.DiscoveryDate)}` : "unknown to Bing";
      const key = crawled === "never" ? "not crawled" : "crawled";
      await sleep(2500);
      tally[key] = (tally[key] ?? 0) + 1;
      rows.push(`${key.padEnd(11)} ${url}  ${state}`);
    } catch (e) {
      rows.push(`error       ${url}  ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(rows.join("\n"));
  console.log("\nSummary:", JSON.stringify(tally), `of ${urls.length} URLs`);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
