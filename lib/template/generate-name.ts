// Generates a 2-3 word evocative template name from a deck's brand
// attributes (palette + fonts + language). Used by:
//   • `deck-generate.ts` at first-generation completion — writes
//     the result to `Project.templateName`.
//   • `scripts/backfill-template-names.ts` for legacy decks that
//     pre-date the column.
//
// Naming convention examples (not enforced — Claude's free to deviate):
//   AR: "صحراء ذهبية", "ضباب الفجر", "أرجوان فاخر"
//   EN: "Golden Desert", "Dawn Mist", "Royal Magenta"
//
// The point is to give templates a memorable identity that's about
// the VISUAL BRAND, not the project content — project titles are
// often private ("Q4 Pitch — Client X"), so we never use them as a
// template name. This function returns a deterministic-feeling
// abstraction of the palette + fonts instead.
//
// Best-effort: on any API failure, returns null so the caller can
// fall back gracefully (deterministic placeholder like "قالب #001"
// or leaving Project.templateName null until backfill retries).

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 40; // 2-3 words ≈ ~10 tokens; budget some slack
// Low temperature so the same brand inputs produce a stable name
// across re-runs (helps when a regen accidentally re-fires the
// naming path; the user shouldn't see the name silently shift).
const TEMPERATURE = 0.3;

export type GenerateNameInput = {
  // Palette as hex strings. Order doesn't matter for the name.
  palette: readonly string[];
  fontHeading: string;
  fontBody: string;
  language: "ar" | "en";
};

function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

export async function generateTemplateName(
  input: GenerateNameInput,
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  const isArabic = input.language === "ar";
  const colors = input.palette
    .filter((c): c is string => typeof c === "string" && c.length > 0)
    .slice(0, 6)
    .join(", ");

  // Single-message prompt. No system role needed for this scale —
  // the user message carries instructions + constraints inline.
  // Examples bias the output toward 2-3 word evocative names
  // (not literal "Blue Template" or font-name regurgitations).
  const prompt = isArabic
    ? `أنشئ اسماً مكوناً من كلمتين أو ثلاث لقالب عرض تقديمي بصري.
الألوان: ${colors}
خط العنوان: ${input.fontHeading}
خط النص: ${input.fontBody}

المتطلبات:
- كلمتان أو ثلاث، بالعربية الفصحى
- موحٍ ومجازي (تجنب أسماء الألوان المباشرة مثل "أزرق"؛ تجنب اسم الخط)
- يلتقط مزاج التصميم وشخصيته
- بدون علامات اقتباس، بدون شرح

أمثلة على المخرجات الجيدة: "صحراء ذهبية"، "ضباب الفجر"، "أرجوان فاخر"، "ليل قطبي"

أعد الاسم فقط، لا شيء آخر.`
    : `Generate a 2-3 word evocative name for a presentation template.
Palette: ${colors}
Heading font: ${input.fontHeading}
Body font: ${input.fontBody}

Requirements:
- 2-3 words, in English
- Evocative and abstract (avoid color names like "Blue"; avoid font names)
- Captures the mood and personality of the design
- No quotes, no explanation

Good example outputs: "Golden Desert", "Dawn Mist", "Royal Magenta", "Arctic Night"

Return ONLY the name.`;

  try {
    // 15s per-request timeout — Haiku name generation runs in two
    // hot paths (deck-generate's freeze step + the backfill script)
    // and a provider hang would block both. `{ timeout }` is the
    // SDK's RequestOptions API; on expiry the SDK aborts the request
    // and throws (caught below → null return → caller falls back).
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        messages: [{ role: "user", content: prompt }],
      },
      { timeout: 15_000 },
    );
    // First text block, trimmed. Strip surrounding quotes if Claude
    // included them despite the instruction — defensive.
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return null;
    const raw = block.text.trim().replace(/^["'«»]+|["'«»]+$/g, "").trim();
    if (raw.length === 0 || raw.length > 60) return null; // sanity ceiling
    return raw;
  } catch (err) {
    // Best-effort path — name generation is a nice-to-have, not a
    // critical step of deck creation. Caller falls back to null and
    // either leaves the column null (backfill retries later) or
    // synthesises a placeholder. Log the error for diagnostic
    // visibility but never throw.
    console.error("[generateTemplateName] Haiku call failed:", err);
    return null;
  }
}
