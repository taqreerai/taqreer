// Repair a JSON string before `JSON.parse()`.
//
// Specifically targets the two failure modes Claude (especially
// Sonnet 4.6 with thinking disabled) hits when emitting 30+ KB of
// structured output:
//
//   1. **Trailing commas** — `{ "a": 1, }` or `[ "x", "y", ]`. JSON
//      doesn't allow these; Claude occasionally appends one before a
//      closing brace/bracket on dense outputs.
//
//   2. **Missing comma between adjacent properties** — `"a": 1 "b": 2`
//      (close-quote, whitespace, open-quote → missing `,`). Harder to
//      detect reliably; the repair only fires on a tight pattern that
//      can't be ambiguous with valid JSON.
//
// Critically the repair is **string-aware**: characters inside JSON
// string literals are left untouched. An HTML attribute like
// `<div class="x">` inside a `"html"` value contains commas + quotes
// + braces that look like structural tokens but are content. The
// walker tracks `inString` + `escapeNext` exactly like the upstream
// `StreamingSlideParser` so we never damage payload.
//
// Observed in production 2026-05-25: a `sonnet-fast` 9-slide enhance
// run failed `JSON.parse` 3 times at position ~31417 — likely a
// missing comma or stray trailing comma in the 8th/9th slide's HTML
// envelope. Adding this repair as a pre-parse pass should recover
// the run instead of bouncing through 3 retries and ~30k wasted
// output tokens per attempt.
//
// What the repair does NOT handle (intentionally — too risky to
// auto-fix):
//
//   • Unescaped quotes inside strings (`"html": "<div class="x">"`).
//     Ambiguous — we can't tell which quote is the string terminator
//     without semantic context.
//   • Unescaped newlines inside strings (raw `\n` in source between
//     `"..."`). Valid JSON allows escaped `\\n`, not raw newlines;
//     auto-replacing every raw newline inside a string would shift
//     byte offsets in ways that break HTML content.
//   • Truncation mid-stream (response cut at max_tokens). Caller
//     should re-attempt the model call, not patch this here.
//
// If the input is already well-formed JSON, this returns it unchanged.

// Collapse JavaScript-style string CONCATENATION back into single JSON
// strings. Claude emits long `html` values as `"<chunk1>"+"<chunk2>"+…` —
// valid JS, but INVALID JSON (JSON has no `+` operator), so `JSON.parse`
// dies at the first `+` with "Expected ',' or '}' after property value".
// Observed 2026-06-04 on /create image decks with the design-style engine:
// the long, multi-block slide HTML pushes Claude to break each `html` value
// into concatenated literals — one 11-slide deck contained 44 such joins and
// recovered 0 slides. A join is an UNESCAPED closing quote, `+` (any
// surrounding whitespace/newlines), then an UNESCAPED opening quote. Raw `"`
// only appears at string boundaries — content quotes are `\"` — so a raw
// `"+"` is unambiguously a concat seam; the `(?<!\\)` guard skips escaped
// quotes so we never splice content. Splicing the seam out rejoins the two
// chunks into the one string the model meant. Idempotent + a no-op on JSON
// that has no such joins. Runs FIRST in repairJson so the comma walkers below
// operate on clean single strings.
export function collapseJsConcat(input: string): string {
  return input.replace(/(?<!\\)"\s*\+\s*"/g, "");
}

export function repairJson(rawInput: string): string {
  const input = collapseJsConcat(rawInput);
  let out = "";
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < input.length; i++) {
    const c = input[i];

    if (escapeNext) {
      out += c;
      escapeNext = false;
      continue;
    }

    if (inString) {
      if (c === "\\") {
        escapeNext = true;
        out += c;
        continue;
      }
      if (c === '"') {
        inString = false;
      }
      out += c;
      continue;
    }

    // ─── Outside any string ──────────────────────────────────────

    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }

    // FIX 1: drop a trailing comma if the next non-whitespace char
    // is `}` or `]`. Look ahead, skip whitespace, peek the closing
    // delimiter — and silently drop the comma.
    if (c === ",") {
      let j = i + 1;
      while (j < input.length && isWhitespace(input[j])) j++;
      if (j < input.length && (input[j] === "}" || input[j] === "]")) {
        // Comma is trailing — skip it. Whitespace + the closer stay.
        continue;
      }
    }

    out += c;
  }

  // ─── Pass 2: inject missing commas between adjacent properties ──
  // Done as a second pass so we can use the cleaned trailing-comma
  // output as input. Regex catches `}` or `]` or `"` or `digit`
  // followed by whitespace then `"` (opening a new property).
  // String-aware via a second walker — we can't naively regex this
  // because string content might contain `}\s"` patterns.
  //
  // Sequential single-pass with state:
  let pass2 = "";
  inString = false;
  escapeNext = false;
  for (let i = 0; i < out.length; i++) {
    const c = out[i];

    if (escapeNext) {
      pass2 += c;
      escapeNext = false;
      continue;
    }
    if (inString) {
      if (c === "\\") {
        escapeNext = true;
        pass2 += c;
        continue;
      }
      if (c === '"') {
        inString = false;
        pass2 += c;
        // After closing a string, check ahead for the missing-comma pattern:
        // <closing quote> <ws...> <opening quote of new key>
        let j = i + 1;
        while (j < out.length && isWhitespace(out[j])) j++;
        if (j < out.length && out[j] === '"') {
          // Insert a comma before the whitespace + next key opens.
          pass2 += ",";
        }
        continue;
      }
      pass2 += c;
      continue;
    }

    if (c === '"') {
      inString = true;
      pass2 += c;
      continue;
    }

    pass2 += c;

    // Outside string: check for `}`/`]`/digit → ws → `"` pattern.
    if (c === "}" || c === "]" || (c >= "0" && c <= "9")) {
      let j = i + 1;
      while (j < out.length && isWhitespace(out[j])) j++;
      if (j < out.length && out[j] === '"') {
        pass2 += ",";
      }
    }
  }

  return pass2;
}

function isWhitespace(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r";
}
