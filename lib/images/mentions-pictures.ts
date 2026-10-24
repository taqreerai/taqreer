// True when a brief asks for pictures (Arabic or English). The create and
// mimic pages use it to point at the "Smart photos" switch when it is off:
// a deck written without images keeps empty picture boxes (owner, 2026-10-23,
// a mimic deck asked for "real photos" with the switch off and came out with
// only placeholders).
const PICTURE_WORDS = /صور[ةه]?|الصور|photos?\b|pictures?\b|images?\b|illustrations?\b/i;

export function mentionsPictures(text: string): boolean {
  return PICTURE_WORDS.test(text);
}
