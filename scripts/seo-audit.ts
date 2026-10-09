// "Three kings" on-page audit: does each marketing page carry its target
// keyword in the title tag, the H1 and the first paragraph of the body? Also
// reports the meta description and a few basic hygiene checks (one H1, title
// and description length, canonical + hreflang).
//
//   npx tsx scripts/seo-audit.ts                       audit live taqreer.ai
//   npx tsx scripts/seo-audit.ts --base http://localhost:3000
//   npx tsx scripts/seo-audit.ts --page pdf-to-powerpoint --lang ar
//   npx tsx scripts/seo-audit.ts --json                machine-readable
//   npx tsx scripts/seo-audit.ts --strict              exit 1 when a king is missing
//
// Read-only: it only GETs the public HTML (no JS executed, same as a crawler's
// first pass). Edit TARGETS below to change what a page is meant to rank for;
// the first keyword of a locale is the primary one. A page/locale with no
// keyword listed is skipped and reported as "no target".
import { JSDOM } from "jsdom";

type Targets = { ar?: string[]; en?: string[] };

// Source: the header comment of each marketing page + docs/HANDOFF.md keyword
// table (Saudi Arabia volumes). Pages with no measured demand are omitted.
const TARGETS: Record<string, Targets> = {
  "": { ar: ["عرض تقديمي بالذكاء الاصطناعي"] },
  "ai-presentations": { ar: ["تصميم عرض تقديمي بالذكاء الاصطناعي"] },
  "arabic-presentations": { ar: ["عروض تقديمية عربية"], en: ["arabic presentations"] },
  "presentation-templates": { ar: ["قوالب عروض تقديمية", "قالب بوربوينت"], en: ["presentation templates"] },
  pricing: { ar: ["اسعار taqreer"] },
  redesign: { ar: ["إعادة تصميم عرض تقديمي"], en: ["redesign powerpoint"] },
  "social-media-posts": { ar: ["تصميم منشورات سوشيال ميديا بالذكاء الاصطناعي"] },
  "presentation-style": { ar: ["تصميم عرض بنفس النمط"] },
  "gamma-arabic": { ar: ["جاما ai", "gamma app بالعربي"] },
  "pdf-to-powerpoint": { ar: ["تحويل pdf الى بوربوينت"], en: ["convert pdf to powerpoint"] },
  "word-to-powerpoint": { ar: ["تحويل وورد الى بوربوينت"], en: ["word to powerpoint"] },
  "powerpoint-online": { ar: ["بوربوينت اون لاين"], en: ["edit powerpoint online"] },
  "powerpoint-images": { ar: ["صور بوربوينت"], en: ["powerpoint images"] },
  "brand-kit": { en: ["brand kit"] },
  "free-stock-images": { en: ["free stock images"] },
};

// ─── Matching ────────────────────────────────────────────────────────
// Arabic is matched loosely: diacritics and tatweel dropped, alef / ta
// marbuta / alef maqsura variants folded, then a leading article or clitic
// (ال, بال, و, ب, ل ...) stripped from each word. Approximate by design: it
// tells you "the phrase is there", not whether it reads well.

const CLITICS = ["وبال", "فبال", "بال", "كال", "وال", "فال", "لل", "ال", "و", "ب", "ل", "ف", "ك"];

function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
}

function stem(word: string): string {
  if (!/[؀-ۿ]/.test(word)) return word;
  for (const c of CLITICS) {
    if (word.startsWith(c) && word.length - c.length >= 3) return word.slice(c.length);
  }
  return word;
}

function words(s: string): string[] {
  return fold(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(stem);
}

type Hit = "exact" | "partial" | "missing";

function match(text: string, keyword: string): Hit {
  const t = words(text);
  const k = words(keyword);
  if (k.length === 0) return "missing";
  for (let i = 0; i + k.length <= t.length; i += 1) {
    if (k.every((w, j) => t[i + j] === w)) return "exact";
  }
  return k.every((w) => t.includes(w)) ? "partial" : "missing";
}

// ─── Page reading ────────────────────────────────────────────────────

type PageFacts = {
  url: string;
  status: number;
  title: string;
  description: string;
  h1s: string[];
  firstParagraph: string;
  canonical: string | null;
  hreflangs: number;
};

const squish = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

async function readPage(url: string): Promise<PageFacts> {
  const res = await fetch(url, {
    headers: { "user-agent": "taqreer-seo-audit/1.0", "accept-language": "en" },
    redirect: "follow",
  });
  const html = await res.text();
  const doc = new JSDOM(html).window.document;
  const h1Els = [...doc.querySelectorAll("h1")];
  const first = h1Els[0];
  let firstParagraph = "";
  if (first) {
    for (const p of doc.querySelectorAll("p")) {
      if (!(first.compareDocumentPosition(p) & 4 /* FOLLOWING */)) continue;
      const text = squish(p.textContent);
      if (text.length >= 20) {
        firstParagraph = text;
        break;
      }
    }
  }
  return {
    url,
    status: res.status,
    title: squish(doc.title),
    description: squish(doc.querySelector('meta[name="description"]')?.getAttribute("content")),
    h1s: h1Els.map((h) => squish(h.textContent)),
    firstParagraph,
    canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
    hreflangs: doc.querySelectorAll('link[rel="alternate"][hreflang]').length,
  };
}

// ─── Report ──────────────────────────────────────────────────────────

type Row = {
  page: string;
  lang: "ar" | "en";
  keyword: string;
  primary: boolean;
  title: Hit;
  h1: Hit;
  firstParagraph: Hit;
  description: Hit;
  notes: string[];
  facts: PageFacts;
};

const MARK: Record<Hit, string> = { exact: "OK", partial: "~", missing: "MISSING" };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const base = (arg("base") ?? "https://taqreer.ai").replace(/\/$/, "");
  const onlyPage = arg("page");
  const onlyLang = arg("lang");
  const asJson = process.argv.includes("--json");
  const strict = process.argv.includes("--strict");

  const jobs: Array<{ page: string; lang: "ar" | "en"; keywords: string[] }> = [];
  for (const [page, t] of Object.entries(TARGETS)) {
    if (onlyPage !== undefined && onlyPage !== page) continue;
    for (const lang of ["ar", "en"] as const) {
      if (onlyLang && onlyLang !== lang) continue;
      const keywords = t[lang];
      if (keywords?.length) jobs.push({ page, lang, keywords });
    }
  }

  const rows: Row[] = [];
  const failed: string[] = [];
  // Small pool: polite to our own server, quick enough for ~25 pages.
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const url = `${base}/${job.lang}${job.page ? `/${job.page}` : ""}`;
        let facts: PageFacts;
        try {
          facts = await readPage(url);
        } catch (err) {
          failed.push(`${url}: ${err instanceof Error ? err.message : err}`);
          continue;
        }
        const notes: string[] = [];
        if (facts.status !== 200) notes.push(`HTTP ${facts.status}`);
        if (facts.h1s.length !== 1) notes.push(`${facts.h1s.length} H1 tags (want 1)`);
        if (facts.title.length > 60) notes.push(`title ${facts.title.length} chars (may truncate past ~60)`);
        if (facts.description.length === 0) notes.push("no meta description");
        else if (facts.description.length > 160) notes.push(`description ${facts.description.length} chars (may truncate past ~160)`);
        if (!facts.canonical) notes.push("no canonical");
        if (facts.hreflangs < 2) notes.push("hreflang alternates missing");
        job.keywords.forEach((keyword, i) => {
          rows.push({
            page: job.page || "(home)",
            lang: job.lang,
            keyword,
            primary: i === 0,
            title: match(facts.title, keyword),
            h1: match(facts.h1s.join(" "), keyword),
            firstParagraph: match(facts.firstParagraph, keyword),
            description: match(facts.description, keyword),
            notes: i === 0 ? notes : [],
            facts,
          });
        });
      }
    }),
  );
  rows.sort(
    (a, b) =>
      a.page.localeCompare(b.page) || a.lang.localeCompare(b.lang) || Number(b.primary) - Number(a.primary),
  );

  if (asJson) {
    console.log(
      JSON.stringify(
        rows.map(({ facts, ...r }) => ({
          ...r,
          title_text: facts.title,
          h1_text: facts.h1s[0] ?? "",
          first_paragraph: facts.firstParagraph,
        })),
        null,
        2,
      ),
    );
  } else {
    console.log(`Three kings audit of ${base}  (OK exact phrase, ~ words present but not as the phrase, MISSING)\n`);
    let misses = 0;
    for (const r of rows) {
      const kings = [r.title, r.h1, r.firstParagraph];
      const bad = kings.filter((k) => k !== "exact").length;
      if (r.primary) misses += bad;
      console.log(`${r.primary ? "*" : " "} /${r.lang}/${r.page === "(home)" ? "" : r.page}   "${r.keyword}"`);
      console.log(
        `    title ${MARK[r.title].padEnd(7)} | h1 ${MARK[r.h1].padEnd(7)} | first paragraph ${MARK[r.firstParagraph].padEnd(7)} | description ${MARK[r.description]}`,
      );
      if (r.primary) {
        const absent = (label: string, hit: Hit, text: string) => {
          if (hit === "exact") return;
          const have = new Set(words(text));
          const gone = words(r.keyword).filter((w) => !have.has(w));
          console.log(`    ${label}: ${gone.length ? `lacks "${gone.join(" ")}"` : "has the words, not as the phrase"}`);
        };
        absent("title gap", r.title, r.facts.title);
        absent("h1 gap", r.h1, r.facts.h1s.join(" "));
        absent("p gap", r.firstParagraph, r.facts.firstParagraph);
        console.log(`    title: ${r.facts.title}`);
        console.log(`    h1:    ${r.facts.h1s[0] ?? "(none)"}`);
        console.log(`    p:     ${r.facts.firstParagraph.slice(0, 140) || "(none)"}`);
        for (const n of r.notes) console.log(`    ! ${n}`);
      }
    }
    for (const f of failed) console.log(`\nCould not read ${f}`);
    const noTarget = Object.entries(TARGETS).flatMap(([p, t]) =>
      (["ar", "en"] as const).filter((l) => !t[l]?.length).map((l) => `/${l}/${p}`),
    );
    console.log(`\nNo target keyword set (skipped): ${noTarget.join(", ") || "none"}`);
    console.log(`Missing or partial kings on primary keywords: ${misses}`);
    if (strict && misses > 0) process.exitCode = 1;
  }
  if (failed.length > 0) process.exitCode = 1;
}

main();
