// Content-language detector (2026-10-25). Pure: no Node or network dependency,
// safe to import from client components.
//
// The old helpers (lib/extract/language-*.ts) only told Arabic from Latin, so a
// French, Spanish or Turkish deck was just "en". This works in two layers:
//   1. Script: count letters per Unicode script; the dominant script decides
//      right-to-left or not and settles every non-Latin language.
//   2. Latin ranking: within Latin script, score function words and
//      diacritics per language and pick the best, with a confidence from the
//      margin over the runner-up.
// A second language above SECONDARY_SHARE is reported as `secondary`
// (Arabic with English terms, a bilingual deck). Low confidence returns
// `lang: null` so the caller can fall back to the page-reading vision check.

export type Script = "arabic" | "hebrew" | "latin" | "cyrillic" | "cjk" | "devanagari" | "greek" | "thai" | "ethiopic" | "other";

export type LangResult = {
  /** ISO 639-1 code, or null when the text gives too little signal. */
  lang: string | null;
  script: Script | null;
  direction: "rtl" | "ltr";
  /** 0..1. */
  confidence: number;
  /** A clearly present second language (e.g. "en" in an Arabic deck), else null. */
  secondary: string | null;
};

const MIN_LETTERS = 12;
const SECONDARY_SHARE = 0.25;

const SCRIPT_RANGES: [Script, RegExp][] = [
  ["arabic", /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/],
  ["hebrew", /[֐-׿]/],
  ["cyrillic", /[Ѐ-ӿ]/],
  ["greek", /[Ͱ-Ͽ]/],
  ["devanagari", /[ऀ-ॿ]/],
  ["thai", /[฀-๿]/],
  ["ethiopic", /[ሀ-፿ᎀ-᎙]/],
  ["cjk", /[぀-ヿ㐀-䶿一-鿿가-힯]/],
  ["latin", /[A-Za-zÀ-ɏ]/],
];

/** Script that decides the language outright (one language per script). */
const SCRIPT_LANG: Partial<Record<Script, string>> = {
  hebrew: "he",
  greek: "el",
  devanagari: "hi",
  thai: "th",
  ethiopic: "am",
};

// Function words that are frequent in one Latin-script language and rare in
// the others. Short lists on purpose: they only have to rank 10 languages.
const STOPWORDS: Record<string, string[]> = {
  en: ["the", "and", "of", "to", "in", "is", "that", "for", "with", "are", "this", "on", "as", "by", "from", "be", "or", "at", "an", "it", "we", "our", "your"],
  fr: ["le", "la", "les", "des", "du", "de", "et", "est", "un", "une", "que", "qui", "dans", "pour", "pas", "sur", "au", "aux", "avec", "ce", "ces", "nous", "vous", "sont", "par", "plus"],
  es: ["el", "la", "los", "las", "de", "y", "en", "que", "un", "una", "es", "por", "con", "para", "del", "al", "se", "su", "sus", "como", "más", "nuestro", "este"],
  pt: ["o", "os", "as", "de", "do", "da", "dos", "das", "em", "que", "um", "uma", "para", "com", "não", "por", "mais", "se", "são", "ao", "nos", "é"],
  it: ["il", "lo", "gli", "di", "del", "della", "che", "è", "un", "una", "per", "con", "non", "sono", "le", "dei", "nel", "alla", "più", "come", "questo"],
  de: ["der", "die", "das", "und", "ist", "von", "mit", "den", "dem", "des", "ein", "eine", "nicht", "für", "auf", "zu", "im", "sich", "auch", "wir", "sie", "werden"],
  nl: ["de", "het", "een", "en", "van", "is", "dat", "op", "te", "voor", "met", "niet", "zijn", "aan", "ook", "als", "bij", "om", "naar", "wij", "ons"],
  tr: ["ve", "bir", "bu", "için", "ile", "da", "de", "çok", "daha", "olarak", "gibi", "en", "ne", "ama", "var", "olan", "her", "kadar", "sonra", "biz"],
  id: ["yang", "dan", "di", "dengan", "untuk", "dari", "ini", "itu", "pada", "adalah", "dalam", "akan", "tidak", "juga", "kami", "atau", "oleh", "ke"],
  pl: ["i", "w", "nie", "na", "z", "do", "to", "jest", "się", "że", "o", "jak", "dla", "po", "ale", "przez", "są", "nasz"],
  ru: ["и", "в", "не", "на", "что", "с", "по", "для", "это", "как", "из", "от", "к", "но", "мы", "наш", "или", "за"],
  uk: ["і", "в", "не", "на", "що", "з", "до", "для", "це", "як", "від", "але", "ми", "або", "та", "є", "також"],
};

// Letters that point at a language (each worth more than a stopword hit).
const MARKERS: Record<string, RegExp> = {
  fr: /[àâçéèêëîïôûùüÿœ]/g,
  es: /[ñ¿¡áéíóú]/g,
  pt: /[ãõç]/g,
  it: /[àèìòù]/g,
  de: /[äöüß]/g,
  tr: /[ğışçöü]/g,
  pl: /[ąćęłńóśźż]/g,
  nl: /ij/g,
};
const MARKER_WEIGHT = 0.6;

function scriptCounts(text: string): Record<Script, number> {
  const counts: Record<Script, number> = {
    arabic: 0, hebrew: 0, latin: 0, cyrillic: 0, cjk: 0, devanagari: 0, greek: 0, thai: 0, ethiopic: 0, other: 0,
  };
  for (const ch of text) {
    let matched = false;
    for (const [script, re] of SCRIPT_RANGES) {
      if (re.test(ch)) {
        counts[script]++;
        matched = true;
        break;
      }
    }
    // Any other letter (Armenian, Bengali, ...): counted so a few Latin words
    // inside such a text do not make it look Latin.
    if (!matched && /\p{L}/u.test(ch)) counts.other++;
  }
  return counts;
}

function rankLatin(text: string): [string, number][] {
  const lower = text.toLowerCase();
  const words = lower.match(/[a-zà-ɏ']+/g) ?? [];
  if (words.length === 0) return [];
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  const scores: [string, number][] = [];
  for (const [lang, list] of Object.entries(STOPWORDS)) {
    if (lang === "ru" || lang === "uk") continue; // Cyrillic, ranked separately
    let hits = 0;
    for (const w of list) hits += freq.get(w) ?? 0;
    let score = hits / words.length;
    const marker = MARKERS[lang];
    if (marker) score += (((lower.match(marker) ?? []).length / lower.length) * 12) * MARKER_WEIGHT;
    scores.push([lang, score]);
  }
  return scores.sort((a, b) => b[1] - a[1]);
}

function rankCyrillic(text: string): string {
  // Ukrainian has і ї є ґ; Russian has ы э ъ ё. Default to Russian.
  const uk = (text.match(/[іїєґІЇЄҐ]/g) ?? []).length;
  const ru = (text.match(/[ыэъёЫЭЪЁ]/g) ?? []).length;
  return uk > ru ? "uk" : "ru";
}

function cjkLang(text: string): string {
  if (/[぀-ヿ]/.test(text)) return "ja";
  if (/[가-힯]/.test(text)) return "ko";
  return "zh";
}

function arabicLang(text: string): string {
  // Persian and Urdu letters that Arabic does not use: پ چ ژ گ ک ی ٹ ڈ ڑ ں ے
  const fa = (text.match(/[پچژگکی]/g) ?? []).length;
  const ur = (text.match(/[ٹڈڑںے]/g) ?? []).length;
  if (ur > 2) return "ur";
  if (fa > 2) return "fa";
  return "ar";
}

const RTL: ReadonlySet<string> = new Set(["ar", "fa", "ur", "he"]);

export function detectLanguage(raw: string): LangResult {
  const none: LangResult = { lang: null, script: null, direction: "ltr", confidence: 0, secondary: null };
  // Digits, punctuation and markup are not a language signal.
  const text = raw.replace(/<[^>]+>/g, " ").replace(/https?:\/\/\S+/g, " ");
  const counts = scriptCounts(text);
  const letters = (Object.values(counts) as number[]).reduce((a, b) => a + b, 0);
  if (letters < MIN_LETTERS) return none;

  const ordered = (Object.entries(counts) as [Script, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const [topScript, topCount] = ordered[0];
  const share = topCount / letters;

  const secondScript = ordered[1] && ordered[1][1] / letters >= SECONDARY_SHARE ? ordered[1][0] : null;

  const langOf = (script: Script): { lang: string; confidence: number } | null => {
    if (script === "arabic") return { lang: arabicLang(text), confidence: 0.9 };
    if (script === "cyrillic") return { lang: rankCyrillic(text), confidence: 0.75 };
    if (script === "cjk") return { lang: cjkLang(text), confidence: 0.9 };
    const fixed = SCRIPT_LANG[script];
    if (fixed) return { lang: fixed, confidence: 0.9 };
    if (script === "latin") {
      const ranked = rankLatin(text);
      if (ranked.length === 0) return null;
      const [best, runner] = [ranked[0], ranked[1]];
      if (best[1] < 0.04) return null; // almost no function words: too little to tell
      const margin = runner ? (best[1] - runner[1]) / best[1] : 1;
      return { lang: best[0], confidence: Math.max(0.3, Math.min(0.95, 0.4 + margin * 0.6)) };
    }
    return null;
  };

  const primary = langOf(topScript);
  if (!primary) return { ...none, script: topScript };
  // A weak script majority is mixed content: keep the answer but lower it.
  const confidence = share >= 0.7 ? primary.confidence : primary.confidence * 0.8;
  const second = secondScript ? langOf(secondScript) : null;
  return {
    lang: primary.lang,
    script: topScript,
    direction: RTL.has(primary.lang) ? "rtl" : "ltr",
    confidence,
    secondary: second && second.lang !== primary.lang ? second.lang : null,
  };
}

/** The old two-value shape ("en" = any left-to-right language), for callers not yet migrated. */
export function toLegacyLanguage(r: LangResult): "ar" | "en" | null {
  if (r.lang === null) return null;
  return r.direction === "rtl" ? "ar" : "en";
}
