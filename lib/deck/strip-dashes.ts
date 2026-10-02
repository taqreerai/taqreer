// Deterministic em/en-dash cleanup for generated slide HTML (2026-10-02).
//
// House style bans the em and en dash in every piece of copy, generated
// slides included. The models are told so, but Sonnet 5.5 still writes them,
// and the Opus review pass then rewrites a WHOLE slide just to drop one dash
// (half its revisions on a test deck). Doing it in code is free and certain,
// so the review only spends tokens on real design problems.
//
// Only visible text is touched: tags, attributes, and <style>/<script>
// bodies pass through byte-for-byte. Within text:
//   - a dash between two digits is a range -> "-" (e.g. 2020 U+2013 2024 becomes 2020-2024)
//   - a dash at the start or end of a text run is dropped (list-bullet style)
//   - a dash after punctuation is dropped (no doubled marks)
//   - any other dash becomes a comma: "، " in Arabic text, ", " otherwise

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
const DASH_ENTITIES = /&(?:mdash|ndash|#8212|#8211|#x2014|#x2013);/gi;
const TOKEN = /<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<[^>]*>|[^<]+/gi;

function cleanText(text: string): string {
  if (!/[\u2013\u2014]|&(?:mdash|ndash|#8212|#8211|#x2014|#x2013);/i.test(text)) {
    return text;
  }
  const comma = ARABIC.test(text) ? "\u060C " : ", ";
  return (
    text
      .replace(DASH_ENTITIES, (m) => (/mdash|8212|2014/i.test(m) ? "\u2014" : "\u2013"))
      // Number ranges keep a plain hyphen.
      .replace(/(\d)\s*[\u2013\u2014]\s*(\d)/g, "$1-$2")
      // Leading / trailing dash of a text run (bullet or dangling).
      .replace(/^(\s*)[\u2013\u2014]\s*/, "$1")
      .replace(/\s*[\u2013\u2014](\s*)$/, "$1")
      // After existing punctuation the dash is redundant.
      .replace(/([\u060C,.;:\u061B!?\u061F])\s*[\u2013\u2014]\s*/g, "$1 ")
      // Everything else reads as a pause -> comma.
      .replace(/\s*[\u2013\u2014]\s*/g, comma)
  );
}

/** Replace em/en dashes in the visible text of a slide's HTML. */
export function stripTextDashes(html: string): string {
  if (!/[\u2013\u2014]|&(?:mdash|ndash|#8212|#8211|#x2014|#x2013);/i.test(html)) return html;
  return html.replace(TOKEN, (token) => (token.startsWith("<") ? token : cleanText(token)));
}
