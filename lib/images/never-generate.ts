// Subjects an image model must never draw (owner, 2026-10-22).
//
// The image model is told never to draw text, so a national flag that carries
// writing (the Saudi flag's Shahada and sword) comes out as plain green cloth,
// and a misdrawn sacred text or state emblem is worse than none. Flags,
// emblems, coats of arms, seals and sacred text come from the deck's own
// pictures, a real flag image (flagcdn) or a stock photo, never a generation
// (a stock box is exempt everywhere: it is filled with a real photo).
// The prompt says so; this is the code-side check, because prompt rules alone
// keep slipping. Negated phrases ("no text, no logos, no flags") are ignored.

const NEVER =
  /\b(flags?|national (emblem|symbol)s?|emblems?|coats? of arms|crests?|insignia|state seals?|shahada|quran|qur'?an|koran|holy book|scripture|sacred text|calligraphy)\b/i;

// "no text, no logos" / "without flags": what follows a negation is not the subject.
const NEGATED = /\b(no|without|never|not)\s+[^,.;]*/gi;

/** True when an image prompt asks for something that must not be generated. */
export function mustNotGenerate(prompt: string): boolean {
  return NEVER.test(prompt.replace(NEGATED, " "));
}

const GEN_BOX = /<img\b[^>]*\bdata-genimage\s*=\s*"([^"]*)"[^>]*>/gi;

/**
 * Remove every in-slide generated-image box whose prompt must not be
 * generated. A stock box (data-gensource="stock") stays: it is filled with a
 * real photo (lib/images/pexels.ts), which is exactly what such subjects need.
 */
export function stripNeverGenerated(html: string): string {
  if (!/data-genimage/i.test(html)) return html;
  return html.replace(GEN_BOX, (tag, prompt: string) =>
    !/\bdata-gensource\s*=\s*"stock"/i.test(tag) && mustNotGenerate(prompt.replace(/&quot;/g, '"')) ? "" : tag,
  );
}
