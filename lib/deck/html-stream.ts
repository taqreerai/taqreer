// Streaming `<section>` deck parser (replaces the JSON `StreamingSlideParser`).
//
// Why this exists: forcing slide HTML through a JSON *string* (or a constrained
// `output_config.format` grammar) made the model write code (`"a"+"b"`,
// `[...].map().join()`) or stub-and-quit. The cure — confirmed by how
// claude.ai/design authors decks — is to let the model write **static HTML**:
// one `<section>` per slide, against a PROVIDED + cached design-system `<style>`
// scaffold (server-side, not model-emitted). See
// context/plan-create-agent-pivot.md.
//
// Wire format the model produces (just the slide bodies — the scaffold `<style>`
// is injected by us):
//
//   <section data-label="الغلاف" data-role="cover"> … static HTML … </section>
//   <section data-label="جدول المحتوى" data-role="content"> … </section>
//   …
//
// Each slide CLOSES at its own `</section>` (a clean boundary — no waiting for a
// sentinel). The caller prepends the cached scaffold to each section to form a
// self-contained slide for the existing per-slide pipeline. Dependency-free +
// pure so it's trivially unit-testable.

export type ParsedSlide = {
  slideId: string;
  role?: string;
  // The slide's `<section …>…</section>` outerHTML. The caller wraps it with the
  // shared scaffold `<style>` to render/store a self-contained slide.
  html: string;
};

// Matches a `<section …>` opening tag OR a `</section>` closing tag.
const SECTION_TOKEN = /<section\b[^>]*>|<\/section\s*>/gi;

type SectionSpan = { start: number; end: number; openTag: string };

// Walk the buffer tracking `<section>` nesting depth. A TOP-LEVEL section spans
// from its opening tag (depth 0→1) to the matching `</section>` (1→0). Returns
// every fully-closed top-level span plus the start index of an in-flight
// (still-open) top-level section, or -1.
function scanSections(buffer: string): {
  spans: SectionSpan[];
  openStart: number;
  openTag: string;
} {
  const spans: SectionSpan[] = [];
  let depth = 0;
  let curStart = -1;
  let curOpenTag = "";
  SECTION_TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SECTION_TOKEN.exec(buffer)) !== null) {
    const isOpen = m[0][1] !== "/"; // "<section…" vs "</section>"
    if (isOpen) {
      if (depth === 0) {
        curStart = m.index;
        curOpenTag = m[0];
      }
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0 && curStart >= 0) {
        spans.push({ start: curStart, end: m.index + m[0].length, openTag: curOpenTag });
        curStart = -1;
      }
    }
  }
  return {
    spans,
    openStart: depth > 0 ? curStart : -1,
    openTag: depth > 0 ? curOpenTag : "",
  };
}

function attr(openTag: string, name: string): string | undefined {
  const m = openTag.match(
    new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  const v = m ? (m[2] ?? m[3] ?? m[4] ?? "").trim() : "";
  return v.length ? v : undefined;
}

function toSlide(openTag: string, html: string, index: number): ParsedSlide {
  const role = attr(openTag, "data-role");
  // slideId: stable + unique. Labels are Arabic (not slug-safe), so index-based;
  // the human label rides along inside the `<section data-label=…>` markup.
  return { slideId: `slide-${index + 1}`, role, html };
}

// Incremental splitter. Feed chunks via `push()`; it returns slides whose
// `</section>` has just arrived. Call `flush()` once at stream end to close a
// final section that was truncated mid-stream (no closing tag).
//
// Mirrors the surface the streaming loop expects:
//   push() ≈ advance() — yields newly-closed slides
export class StreamingHtmlSplitter {
  private buffer = "";
  private yielded = 0; // count of top-level sections already closed + returned
  private emittedSyntheticTail = false; // flush() synthesized the truncated tail

  push(chunk: string): ParsedSlide[] {
    this.buffer += chunk;
    const { spans } = scanSections(this.buffer);
    const closed: ParsedSlide[] = [];
    for (let i = this.yielded; i < spans.length; i++) {
      const s = spans[i];
      closed.push(toSlide(s.openTag, this.buffer.slice(s.start, s.end), i));
    }
    this.yielded = spans.length;
    return closed;
  }

  // Close a final still-open section at stream end (truncated final slide). If
  // the open section has any real content, ship it with a synthetic
  // `</section>`; otherwise nothing. Idempotent after the last real close.
  flush(): ParsedSlide[] {
    const { spans, openStart, openTag } = scanSections(this.buffer);
    if (spans.length > this.yielded) {
      // A push closed sections we haven't returned (e.g. END arrived in the same
      // chunk as flush) — return those first.
      const out: ParsedSlide[] = [];
      for (let i = this.yielded; i < spans.length; i++) {
        const s = spans[i];
        out.push(toSlide(s.openTag, this.buffer.slice(s.start, s.end), i));
      }
      this.yielded = spans.length;
      return out;
    }
    // Already synthesized the truncated tail on a prior flush — stay idempotent
    // (the buffer + openStart are unchanged, so without this guard a second
    // flush() would re-emit the same final slide under a new id).
    if (this.emittedSyntheticTail) return [];
    if (openStart >= 0) {
      const raw = this.buffer.slice(openStart).trimEnd();
      const body = raw.replace(/^<section\b[^>]*>/i, "");
      if (body.replace(/\s+/g, "").length > 0) {
        const html = raw.endsWith("</section>") ? raw : `${raw}</section>`;
        const slide = toSlide(openTag || "<section>", html, this.yielded);
        this.yielded += 1;
        this.emittedSyntheticTail = true;
        return [slide];
      }
    }
    return [];
  }

  // The top-level section still being written (from its `<section` on), or
  // null when none is open. Feeds the live build (lib/deck/live-build): the
  // studio shows this slide being built before it closes.
  getOpenSection(): string | null {
    const { spans, openStart } = scanSections(this.buffer);
    if (openStart < 0 || spans.length > this.yielded) return null;
    return this.buffer.slice(openStart);
  }

  // Everything the model streamed BEFORE the first top-level `<section>` — i.e.
  // its design-system `<style>`(s), in the Claude-authored model. Stable once the
  // first section opens (the `<style>` is complete by then). "" before that, or
  // when the model leads straight with a section. (A `section{…}` CSS selector
  // inside the `<style>` can't false-match — SECTION_TOKEN requires the `<`.)
  getLeadingHtml(): string {
    const { spans, openStart } = scanSections(this.buffer);
    const firstStart = spans.length > 0 ? spans[0].start : openStart;
    return firstStart > 0 ? this.buffer.slice(0, firstStart) : "";
  }

  // Everything streamed OUTSIDE top-level sections so far - the leading
  // design-system `<style>` PLUS anything emitted between sections.
  // Models drifting off the "one leading stylesheet" contract (seen
  // 2026-06-12: a thinking-off run defined later classes in
  // between-section style blocks, leaving slides unstyled) put real CSS
  // here; the generation loop re-extracts styles from this as slides
  // arrive instead of capturing only once. Excludes the currently-open
  // section's bytes.
  getInterstitialHtml(): string {
    const { spans, openStart } = scanSections(this.buffer);
    const parts: string[] = [];
    let cursor = 0;
    for (const s of spans) {
      if (s.start > cursor) parts.push(this.buffer.slice(cursor, s.start));
      cursor = s.end;
    }
    const tailEnd = openStart >= 0 ? openStart : this.buffer.length;
    if (tailEnd > cursor) parts.push(this.buffer.slice(cursor, tailEnd));
    return parts.join("\n");
  }
}
