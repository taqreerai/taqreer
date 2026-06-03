// Shared core for the grid-stacking guard — imported by BOTH the browser
// (lib/export/sanitize.ts, DOMParser) and server (sanitize-server.ts, JSDOM)
// rewriter twins, exactly as scrim.ts / `applyScrimFixes` is shared. Only uses
// Element APIs, so it's DOM-backend-agnostic and stays in sync in one place.
//
// THE BUG: a row of stat/feature cells often pins each child to columns
// (`grid-column:9/13`, `5/9`, `1/5`) with NO `grid-row`. When those columns are
// declared in non-ascending order, CSS Grid's DEFAULT (sparse) auto-placement —
// whose cursor can only move forward — can't put the 2nd/3rd cell back on row 1,
// so it pushes each onto a NEW row. The cells stack vertically (e.g. 3 rows ≈
// 553px instead of 1 row ≈ 206px), overflow the slide height, and overlap
// whatever sits below (observed 2026-06-03 slide-2: the stat grid ran off the
// 1080 canvas into the footer message). Fix: switch the container to
// `grid-auto-flow: … dense` so the placer backtracks to fill the holes and the
// cells land side by side. Applied to any grid with ≥2 children that set
// `grid-column` without `grid-row`. Safe: `dense` only changes how AUTO-placed
// items fill gaps — anything pinned with an explicit `grid-row` is untouched,
// and a genuine multi-row grid still fills row 1 then row 2. Renders wrong in
// the browser too, so this runs in the preview path, not just export.

const GRID_DISPLAY = /display\s*:\s*(?:inline-)?grid\b/i;
const GRID_COLUMN = /grid-column\s*:/i;
const GRID_ROW = /grid-row\s*:/i;
const GRID_AUTO_FLOW = /grid-auto-flow\s*:/i;
const GRID_AUTO_FLOW_DENSE = /grid-auto-flow\s*:[^;]*\bdense\b/i;

// Cheap byte-level precheck so the caller can skip the whole DOM parse on the
// (overwhelming) majority of slides that have no column-pinned grid. The render
// path re-runs the full sanitize chain per slide per image-fill poll, so this
// avoids a parse + querySelectorAll walk when there's nothing to do.
export function gridNeedsDense(html: string): boolean {
  return GRID_COLUMN.test(html) && GRID_DISPLAY.test(html);
}

// Mutates `slideRoot` in place; returns true if any grid was switched to dense.
export function applyGridDenseFixes(slideRoot: Element): boolean {
  const grids: Element[] = [
    slideRoot,
    ...Array.from(slideRoot.querySelectorAll("[style]")),
  ];
  let changed = false;
  for (const grid of grids) {
    const style = grid.getAttribute("style") ?? "";
    if (!GRID_DISPLAY.test(style) || GRID_AUTO_FLOW_DENSE.test(style)) continue;
    // Count direct children that pin a column but leave the row to
    // auto-placement — the pattern that stacks.
    let pinned = 0;
    for (const child of Array.from(grid.children)) {
      const cs = child.getAttribute("style") ?? "";
      if (GRID_COLUMN.test(cs) && !GRID_ROW.test(cs)) pinned++;
    }
    if (pinned < 2) continue;
    const next = GRID_AUTO_FLOW.test(style)
      ? // keep any existing row/column direction, just add `dense`
        style.replace(
          /grid-auto-flow\s*:\s*([^;]*)/i,
          (_m, val: string) => `grid-auto-flow:${val.trim()} dense`,
        )
      : `${style.replace(/;?\s*$/, "")};grid-auto-flow:dense;`;
    grid.setAttribute("style", next);
    changed = true;
  }
  return changed;
}
