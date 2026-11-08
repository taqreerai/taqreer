// Enhance translation (owner, 2026-11-08). Enhance keeps the file's language
// by default; the user can ask for the deck in Arabic or English instead,
// either with the "Translate to" choice on the Enhance card or in their own
// note ("translate it into Arabic", "ترجم المضمون عربي"). The picked choice
// always wins; the note is only read when the user left the choice on Auto.
// Pure + client-safe: the Enhance page shows what the note asked for, and
// /api/projects resolves the same answer server-side.

export const TRANSLATE_TARGETS = ["ar", "en"] as const;
export type TranslateTarget = (typeof TRANSLATE_TARGETS)[number];

// The Enhance card's choice: undefined = Auto (follow the note), "keep" =
// keep the file's language, else a target.
export type TranslatePick = TranslateTarget | "keep" | undefined;

const VERB = /(translat|tradu|ترجم|übersetz)/gi;
// A verb right after one of these is a "don't translate".
const NEGATION = /(don'?t|do not|never|without|no|not|ne|pas|sans|sin|لا|بدون|دون|عدم)\s*[تي]?$/i;
const TARGET_WORDS: Record<TranslateTarget, RegExp> = {
  ar: /(arabic|arabe|árabe|arabisch|عربي|العربية|عربية|العربي)/i,
  en: /(english|anglais|inglés|ingles|englisch|انجليزي|إنجليزي|الإنجليزية|الانجليزية|انكليزي|الانكليزية|إنكليزي)/i,
};

export function isTranslateTarget(v: unknown): v is TranslateTarget {
  return typeof v === "string" && (TRANSLATE_TARGETS as readonly string[]).includes(v);
}

/**
 * The language a free-text note asks the deck to be translated into, or null.
 * Reads the words after the first non-negated "translate" verb and takes the
 * earliest target language named there that is not the file's own language
 * ("from French into Arabic" -> ar; "ترجم المضمون عربي انجليزي" -> ar, the
 * first one named, with the other kept for terms).
 */
export function translateTargetFromNote(
  note: string | null | undefined,
  sourceLang: string | null | undefined,
): TranslateTarget | null {
  if (!note) return null;
  for (const m of note.matchAll(VERB)) {
    const before = note.slice(Math.max(0, m.index - 16), m.index);
    if (NEGATION.test(before)) continue;
    const after = note.slice(m.index, m.index + 300);
    let best: { code: TranslateTarget; at: number } | null = null;
    for (const code of TRANSLATE_TARGETS) {
      if (code === sourceLang) continue;
      const hit = TARGET_WORDS[code].exec(after);
      if (hit && (!best || hit.index < best.at)) best = { code, at: hit.index };
    }
    if (best) return best.code;
  }
  return null;
}

/**
 * The TRANSLATION rules for the deck generator (deck-generate, and deck-unlock
 * for the slides behind the paywall). `srcName` is the file's language name.
 */
export function translationLines(target: { code: string; name: string }, srcName: string | null): string[] {
  const src = srcName ?? "the source language";
  return [
    `TRANSLATION (the user asked for this; it overrides every "keep the words" and "keep the language" rule): the source deck is written in ${src}. Write the redesigned deck in ${target.name}. Translate EVERY visible string of every slide into ${target.name}: headings, body, bullets, captions, table cells, chart labels, buttons and chrome.`,
    `  • Translate completely and faithfully, sentence by sentence: every fact, explanation, example, list item and number survives. Never summarise, shorten or skip a sentence because it is long; the "exact words" of each slide now mean their faithful ${target.name} translation.`,
    `  • Names of people, brands, products, URLs and code stay as written. Numbers use Latin digits (0-9).`,
    ...(target.code === "ar"
      ? [
          `  • Professional Modern Standard Arabic. For a technical term the field also knows in English (AI, Machine Learning, Neural Network, NLP), write the Arabic term and add the English term once in Latin after it, e.g. "التعلم الآلي (Machine Learning)"; later mentions may use either. Follow the user's own note on terms when it says more.`,
          `  • Every slide root is dir="rtl" lang="ar", right-aligned, Arabic typography.`,
        ]
      : [`  • Set lang="${target.code}" on the slides' text and follow ${target.name} typography.`]),
    `  • No slide, heading or label is left in ${src}.`,
  ];
}

/** The target the deck is translated into, or null to keep the file's language. */
export function resolveTranslateTarget(
  pick: unknown,
  note: unknown,
  sourceLang: string | null | undefined,
): TranslateTarget | null {
  if (pick === "keep") return null;
  if (isTranslateTarget(pick)) return pick === sourceLang ? null : pick;
  return translateTargetFromNote(typeof note === "string" ? note : null, sourceLang);
}
