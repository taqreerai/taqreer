// Enhance's start questions (owner, 2026-10-22, after Gamma's "Beautify").
//
// Once the file is analysed, Create opens three general questions about the
// feel of the redesign: what happens to the wording, to the pictures, and who
// the deck is for and how it is shown. The questions are the same for every
// deck; only the option labels lean on what the analysis found ("drop the
// decorative frames"), written by Haiku at extraction
// (lib/extract/enhance-questions.ts) with dictionary fallbacks. With no
// analysis there are no questions and the deck starts on the suggested
// answers. Every option is a FIXED value the engine maps to rules it already
// has, so a bad label can never change what the engine does.
//
//   wording  exact   -> the classic content-fidelity rules
//            tidy    -> "Redesign freely" essence rules (brief.reworkDeck)
//   pictures keep    -> every content picture kept, template decoration dropped
//            refresh -> keep, and replace the main generic photos (brief.refreshPhotos)
//            replace -> replace EVERY generic photo with a new one (brief.refreshPhotos + refreshAll;
//                       people, products and drawn diagrams are still kept; paid plans only)
//            redraw  -> decorative clip-art becomes generated images (brief.swapPictures;
//                       offered only with AI images on)
//   display  projected / screen -> type size and density lines in the prompt
//
// "Something else..." text goes into the existing, clamped enhance
// instructions; it never becomes a value here. Shared by the page, the
// projects route and the generators, so it imports nothing server-only.

export type WordingChoice = "exact" | "tidy";
export type PicturesChoice = "keep" | "refresh" | "replace" | "redraw";
export type DisplayChoice = "projected" | "screen";

export type EnhanceAnswers = {
  wording: WordingChoice;
  pictures: PicturesChoice;
  display: DisplayChoice;
};

export type QuestionKey = keyof EnhanceAnswers;

export const WORDING_CHOICES: readonly WordingChoice[] = ["exact", "tidy"];
export const PICTURES_CHOICES: readonly PicturesChoice[] = ["keep", "refresh", "replace", "redraw"];
export const DISPLAY_CHOICES: readonly DisplayChoice[] = ["projected", "screen"];

export type EnhanceOptionKey = WordingChoice | PicturesChoice | DisplayChoice;

/** What extraction stores for the questions (Job.outputJson.questions). */
export type EnhanceQuestions = {
  // Who the deck is for, in the page's language ("Sixth graders"); null when unclear.
  audience: string | null;
  // The likely way it is shown, preselected.
  display: DisplayChoice;
  // False when the file has no pictures of its own (the question is skipped).
  pictures: boolean;
  // Option labels fitted to the deck; a missing key falls back to the dictionary.
  labels: Partial<Record<EnhanceOptionKey, string>>;
};

/**
 * The preselected answers: the file's analysis (lib/extract/rework-score.ts)
 * decides wording and pictures, so one click on Start gives what Auto gave.
 */
export function recommendedAnswers(
  decision: { mode: "rework" | "preserve" } | null | undefined,
  questions: EnhanceQuestions | null | undefined,
  imagesOn: boolean,
): EnhanceAnswers {
  const rework = decision?.mode === "rework";
  return {
    wording: rework ? "tidy" : "exact",
    pictures: rework && imagesOn && questions?.pictures !== false ? "redraw" : "keep",
    display: questions?.display ?? "projected",
  };
}

/** Server-side check: only known values pass; anything else is null. */
export function parseEnhanceAnswers(raw: unknown): EnhanceAnswers | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
    typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
  const wording = pick(r.wording, WORDING_CHOICES);
  const pictures = pick(r.pictures, PICTURES_CHOICES);
  const display = pick(r.display, DISPLAY_CHOICES);
  return wording && pictures && display ? { wording, pictures, display } : null;
}

/** The answers as stored on the brief (brief.enhanceAnswers). */
export type BriefEnhanceAnswers = EnhanceAnswers & { audience?: string };

/** Read brief.enhanceAnswers back (null on decks made before the questions). */
export function readBriefAnswers(brief: unknown): BriefEnhanceAnswers | null {
  const raw = (brief as { enhanceAnswers?: unknown } | null)?.enhanceAnswers;
  const answers = parseEnhanceAnswers(raw);
  if (!answers) return null;
  const audience = (raw as { audience?: unknown }).audience;
  return typeof audience === "string" && audience ? { ...answers, audience: audience.slice(0, 80) } : answers;
}

/**
 * The audience and display lines for the generation prompt (deck-generate and
 * deck-unlock, so the slides behind the paywall follow the same answers).
 * Under "exact" wording the type grows, never the cuts.
 */
export function enhanceAnswerLines(answers: BriefEnhanceAnswers): string[] {
  const who = answers.audience ? `The deck is for: ${answers.audience.replace(/["<>]/g, "")}. ` : "";
  const how =
    answers.display === "projected"
      ? `It is PROJECTED in a room: large type (body text at least 28px on the 1920x1080 canvas, headings much larger), strong contrast, generous spacing, one clear focus per slide.${
          answers.wording === "tidy" ? " Keep the words per slide few: tighten wording within the ESSENCE limits." : " Never cut words to make room: use the space and type scale instead."
        }`
      : `It is READ on the reader's own screen: a comfortable reading size (body text at least 22px on the 1920x1080 canvas), and a denser layout is fine when the content needs it.`;
  return [`AUDIENCE AND DISPLAY (the user's answer): ${who}${how}`];
}
