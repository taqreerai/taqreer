// Brand-logo injection for the POLYCHROME path (+ the mono-without-SVG
// fallback). A flag / full-colour mark must keep its real colours, so the
// generation prompt has Claude place a BARE marker (`<span data-tq-logo></span>`)
// on every slide with nothing inside it, and after the manifest is built we
// replace each marker's inner with a true-colour `<img>` of the logo.
//
// (MONOCHROME wordmarks take a different path entirely — Claude inlines the SVG
// and recolours it per slide for contrast — so they carry no marker and these
// helpers no-op on them. See buildLogoBlock.)
//
// Injecting in code instead of letting the model hand-copy the logo's long
// signed Supabase URL removes a class of bugs:
//   - it can't miscopy the ~600-char `?token=<JWT>` (one dropped char ⇒ a
//     dead signed URL ⇒ the logo silently fails to load on that slide);
//   - it can't be lured by a flag-shaped filename into sourcing the logo from
//     somewhere else (e.g. the flagcdn rule) — it never sees the URL or name.

// Matches a logo marker (span OR div carrying `data-tq-logo`) and its inner.
// `\2` backreferences the tag name so we close the SAME element. Global +
// case-insensitive; the inner is non-greedy so adjacent markers don't merge.
const LOGO_MARKER_RE =
  /(<(span|div)\b[^>]*\bdata-tq-logo\b[^>]*>)[\s\S]*?(<\/\2>)/gi;

// Single-match variant (no `g`) for reading one marker's inner out.
const LOGO_MARKER_READ_RE =
  /<(span|div)\b[^>]*\bdata-tq-logo\b[^>]*>([\s\S]*?)<\/\1>/i;

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** The logo `<img>` to inject — fills its marker box, keeps real colours. */
export function logoImgTag(url: string): string {
  return (
    `<img src="${escapeAttr(url)}" alt="" ` +
    `style="width:100%;height:100%;object-fit:contain;display:block"/>`
  );
}

/**
 * Replace the inner of every `data-tq-logo` marker in `html` with `innerHtml`.
 * Idempotent: re-running over already-injected HTML just overwrites the inner
 * with the same content (which is how a partial-regen self-heals a marker the
 * model copied from a sibling). Returns the html unchanged when no marker is
 * present (slides where Claude intentionally omitted the logo).
 */
export function injectLogoMarkers(html: string, innerHtml: string): string {
  return html.replace(
    LOGO_MARKER_RE,
    (_full, open: string, _tag: string, close: string) =>
      `${open}${innerHtml}${close}`,
  );
}

/**
 * Pull the already-injected logo inner (the `<img>`) out of the first slide
 * that has a filled marker. Partial-regen uses this to re-fill a regenerated
 * slide from the source deck itself — so a logo the model copied out of a
 * sibling excerpt is overwritten with the deck's real one, no brief needed.
 * Returns null when no slide carries a filled logo marker (e.g. a deck
 * generated before this marker convention existed).
 */
export function findInjectedLogoInner(slidesHtml: string[]): string | null {
  for (const html of slidesHtml) {
    if (typeof html !== "string") continue;
    const inner = html.match(LOGO_MARKER_READ_RE)?.[2]?.trim();
    if (inner && /<img\b/i.test(inner)) return inner;
  }
  return null;
}
