// FULL flatten (the editor's structural normal form).
//
// A slide is authored as nested HTML: top-level absolute layers (bg image, scrims,
// chrome) PLUS content layers (.wrap) whose text runs are in flow. Nesting means each
// positioned wrapper is its own STACKING CONTEXT, so a leaf's z-index can only reorder
// it within its wrapper, never relative to the rest of the slide. That breaks global
// restacking, layer-drag, and grouping.
//
// This pass dissolves all of that: every visual element (text run, image, graphic,
// painted shell) becomes a STANDALONE, absolutely-positioned DIRECT CHILD of the
// <section>, in ONE stacking context, carrying:
//   - its measured geometry in canvas (1920x1080) space (left/top/width/height + rotate),
//   - an explicit z-index equal to its ORIGINAL PAINT-ORDER rank (so the flat stack
//     renders identically to the nested original, and is then freely restackable),
//   - the styling its ANCESTORS gave it (inherited values, ancestry-scoped rules like
//     `.row .idx{background:var(--red)}`, ancestor variables) frozen inline as the RESOLVED
//     delta: hoisting drops all of that, so we SIMULATE the hoist (the element's computed
//     style here vs as a bare section child) and bake whatever differs - general over any
//     html, with no per-property allowlist. See diffOwnStyle / applyDiff.
//   - its own inner HTML / scoped classes / data-* / dir preserved (fonts, colours, RTL
//     cascade, and the export pipeline's per-leaf text bodies all stay intact).
//
// Re-flatten is idempotent: geometry is integer-rounded and reproduced from the live
// layout, the paint order of an already-flat section is just its DOM order, and the
// frozen styles re-resolve to the same values.

import { isTextLeaf } from "./leaves";

export type FlattenOptions = {
  // The live editor renders the section inside a CSS-scaled stage (--tqe-scale); pass that
  // scale so measured on-screen geometry maps back to canvas (1920x1080) space. The export
  // path renders at scale 1, where this is a no-op.
  scale?: number;
};

// Geometry / box-placement properties the flatten itself OWNS and rewrites every pass
// (position, size, margins, the rotation transform, stacking, single-line white-space, and
// how the element sized/placed AS A FLEX-or-GRID CHILD). These are never carried by the
// style diff below - the flatten reproduces them from the live layout, so a re-flatten
// stays byte-stable instead of accumulating.
// Properties the flatten OWNS on the ROOT box: it reconstructs them from layout (the measured
// abspos geometry, the net rotation, the rounded-clip mask) rather than from the diff, so the
// diff must skip them or it would double-apply or re-capture them on the next pass. Applies to
// the root box only; descendants get a full diff (they have no `pos`, so their flow geometry
// must live in the delta).
const GEOM_SKIP = new Set([
  "position", "top", "right", "bottom", "left",
  "width", "height", "min-width", "min-height", "max-width", "max-height",
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  // the legacy transform matrix + the Transforms-2 individual props, all rebuilt from the
  // measured geometry / rotation; baking them too would translate / rotate / scale twice.
  "transform", "transform-origin", "perspective-origin", "translate", "rotate", "scale",
  "z-index",
  "box-sizing", // forced border-box below so the measured width IS the rendered size
  "flex-basis", "flex-grow", "flex-shrink", "align-self", "justify-self", "order",
  // the rounded-clip mask: the `clip` step owns border-radius + overflow on the root, so the
  // diff must skip BOTH shorthands' longhands (the 4 physical + 4 logical radius corners,
  // overflow x/y) or they relocate from pos into the delta on re-flatten and break stability.
  "border-top-left-radius", "border-top-right-radius",
  "border-bottom-left-radius", "border-bottom-right-radius",
  "border-start-start-radius", "border-start-end-radius",
  "border-end-start-radius", "border-end-end-radius",
  "overflow", "overflow-x", "overflow-y", "overflow-clip-margin",
  // layout / paint containment hints, meaningless once the box is positioned + flat.
  "contain", "content-visibility",
]);

// Skipped on EVERY node (root + descendants), not just the geometry-owning root. white-space
// is INHERITED and flatten-managed (the single-line detection sets it on the box AFTER the
// diff runs), so a descendant must never bake it: on re-flatten it would inherit the box's
// nowrap, the stripped probe would not, and the diff would re-capture it forever. The
// descendant just inherits white-space from its box, which is correct.
const ALWAYS_SKIP = new Set([
  "white-space", "text-wrap-mode", "text-wrap-style", "white-space-collapse",
]);

// Logical box props (margin / padding / border / inset / size in the block-or-inline axes)
// duplicate the physical longhands getComputedStyle also reports; carrying the physical set
// is enough (direction is preserved as its own property), so the diff skips the twins.
const LOGICAL_RE = /(^|-)(block|inline)(-|$)|block-size|inline-size/;

// getComputedStyle also enumerates engine-internal / derived VENDOR properties (e.g.
// `-webkit-text-decorations-in-effect`, `-webkit-locale`) and CUSTOM properties (`--x`) -
// none of which belong in the persisted slideJson / export HTML: the resolved values that
// USE a `--x` are already baked, and the internal vendor props are meaningless + engine-
// specific. So the diff drops every `-`-prefixed property EXCEPT the handful of vendor ones
// that are genuinely author-visual with no standard twin (gradient-text fill/clip, text
// stroke, line-clamp). It also drops the `text-decoration` SHORTHAND, whose longhands it
// already bakes (Chrome enumerates both) - one, not both.
const VENDOR_KEEP = new Set([
  "-webkit-text-fill-color", "-webkit-background-clip",
  "-webkit-text-stroke-color", "-webkit-text-stroke-width",
  "-webkit-line-clamp", "-webkit-box-orient",
]);

// THE flatten freeze, general form. When a leaf is hoisted out of its wrapper it loses
// everything its ANCESTORS were giving it: inherited values, ancestry-scoped rules
// (`.row .idx{...}`), and variables defined up the tree. Rather than enumerate which
// properties those might be (endless + deck-specific), SIMULATE the hoist and bake the
// difference: the element's style as it renders NOW (csIn, snapshotted) vs as it WOULD render
// as a bare section child (csOut, from applyDiff's probe). Every property that changed IS
// exactly what the ancestry contributed, fully resolved (a `var(--red)` lands as the literal
// colour). `skipGeom` is true only for the ROOT box, whose geometry the measured `pos` owns;
// for descendants applyDiff makes the probe stand in for the post-flatten box, so the diff is
// already just their dropped ancestry (their geometry + inheritance cancel). Logical-alias
// twins are dropped (the physical set covers them); `*-color` props that still follow
// `currentColor` in the probe are pruned (baking `color` carries them); a node's own inline
// `!important` props are re-stamped so a baked value still outranks a surviving rule. This reads
// ANY html; there is no property allowlist to maintain or outgrow.
// The blockified equivalent of a display value (what position:absolute turns it into).
function blockify(d: string): string {
  if (d === "inline" || d === "inline-block") return "block";
  return d.startsWith("inline-") ? d.slice(7) : d;
}

function diffOwnStyle(
  csIn: Map<string, string>,
  csOut: CSSStyleDeclaration,
  skipGeom: boolean,
  important: Set<string>,
): string {
  const color = csIn.get("color");
  let out = "";
  for (const [p, v] of csIn) {
    if (ALWAYS_SKIP.has(p)) continue; // inherited + flatten-managed (white-space family)
    if (skipGeom && GEOM_SKIP.has(p)) continue; // root box: the measured `pos` owns geometry
    // The root box is always position:absolute, which BLOCKIFIES display: inline->block,
    // inline-flex->flex, inline-grid->grid. Skip the bake whenever live and probe agree
    // MODULO blockification - the positioned flat box renders the blockified form either
    // way. Comparing pairs (not just the inline/block family) keeps an inline-flex pill
    // byte-stable: pass 1 leaves the class's inline-flex alone, pass 2 computes flex and
    // would otherwise bake it forever (harness: the gen-deck `.tag` oscillator). A real
    // divergence (live flex vs probe block) still bakes.
    if (skipGeom && p === "display" && blockify(v) === blockify(csOut.getPropertyValue(p))) continue;
    if (LOGICAL_RE.test(p)) continue;
    if (p[0] === "-" && !VENDOR_KEEP.has(p)) continue; // vendor-internal + custom (--x) props
    if (p === "text-decoration") continue; // redundant shorthand; its longhands are baked
    // Transform pivot props are derived from the box size (e.g. auto-resolved
    // "13px 13px" on a 26px span) and shift whenever geometry re-rounds, which made
    // re-flatten byte-UNSTABLE on real decks (harness: 9/12 slides oscillated on
    // exactly these). With no transform in play they are render-inert: skip them.
    if (
      (p === "transform-origin" || p === "perspective-origin") &&
      (csIn.get("transform") ?? "none") === "none" &&
      (csIn.get("rotate") ?? "none") === "none" &&
      (csIn.get("scale") ?? "none") === "none"
    ) {
      continue;
    }
    const cv = csOut.getPropertyValue(p);
    if (v === cv) continue; // unchanged by the hoist
    // currentColor follower: `p` resolves to `color` here AND would STILL follow the post-hoist
    // color in the probe, so baking `color` already carries it - prune the redundant copy (a
    // page can enumerate a dozen such `*-color` props per element). If the probe instead
    // resolves `p` to something other than its own color, a surviving rule set it explicitly:
    // keep it. A `*-color` set to exactly `color` is indistinguishable from a follower (both
    // resolve identically in both contexts) and is treated as one.
    if (
      p !== "color" && p !== "background-color" && p.endsWith("color") &&
      v === color && cv === csOut.color
    ) continue;
    out += `${p}:${v}${important.has(p) ? " !important" : ""};`;
  }
  return out;
}

// Snapshot a live computed style into a plain map, read BEFORE the probe enters the section
// (a live CSSStyleDeclaration would re-resolve once the DOM changes). Also records which
// properties the element set `!important` inline, so diffOwnStyle can preserve that priority.
function snapshotStyle(
  el: Element,
  cs: CSSStyleDeclaration,
): { values: Map<string, string>; important: Set<string> } {
  const values = new Map<string, string>();
  for (let i = 0; i < cs.length; i++) {
    const p = cs[i];
    values.set(p, cs.getPropertyValue(p));
  }
  const important = new Set<string>();
  const inline = (el as HTMLElement).style;
  // Only sweep priorities when the inline style actually declares an !important (rare);
  // `cssText` always serializes the flag, so this never misses one but skips the ~350-property
  // getPropertyPriority scan for the overwhelming majority of elements.
  if (inline && inline.length && inline.cssText.includes("important")) {
    for (const p of values.keys()) {
      if (inline.getPropertyPriority(p) === "important") important.add(p);
    }
  }
  return { values, important };
}

// Simulate the hoist and bake, onto the OUTPUT clone, exactly what the move would drop.
//
// The probe is a clone of `el` dropped as a child of the live section, so getComputedStyle on
// it reflects the POST-hoist cascade (surviving class/section rules + section inheritance, NOT
// the dropped ancestry). It is inserted as a MIDDLE child so positional pseudos (:first/:last/
// :only-child) don't spuriously match it; absolute :nth-child ordinals stay approximate, an
// inherent flat-DOM limit. csIn is snapshotted BEFORE the probe enters so its presence can't
// steal a positional pseudo from a direct-section-child `el`.
//
// Two passes for a full clone:
//   1. ROOT: strip its inline -> the diff vs the bare probe is its dropped ancestry. Geometry
//      is skipped (the measured `pos` owns it); the delta is returned for makeBox.
//   2. DESCENDANTS: bake the root delta + measured size onto the probe root, but KEEP each
//      descendant's own inline. Now a descendant's authored + auto geometry AND its inherited
//      values are IDENTICAL in csIn and the probe, so they cancel; the diff is purely the
//      ancestry-scoped rules above the leaf that targeted it (gone post-hoist). That delta is
//      MERGED onto the kept inline (never replacing authored geometry). This is what keeps
//      re-flatten byte-stable: once flat, nothing is dropped, so the descendant delta is empty
//      and the merge is a no-op (a REPLACE-everything diff instead re-captures inherited values
//      and unstable sub-pixel auto-dimensions every pass).
// SVG internals are left exactly as cloned (own styling model + authored fill/stroke).
// Synchronous, no paint.
function applyDiff(
  el: HTMLElement,
  clone: HTMLElement,
  fullClone: boolean,
  win: Window,
  section: HTMLElement,
  rootW: number,
  rootH: number,
): string {
  const real = fullClone
    ? [el, ...Array.from(el.querySelectorAll<HTMLElement>("*"))]
    : [el];
  const snaps = real.map((r) => snapshotStyle(r, win.getComputedStyle(r)));

  const probe = el.cloneNode(fullClone) as HTMLElement;
  probe.removeAttribute("style"); // strip the ROOT's inline only; descendants keep theirs
  // Insert sandwiched between two existing children when possible so :first/:last/:only-child
  // don't match the probe; with one child, sit BEFORE it (avoids the common :last-child idiom).
  const kids = section.children;
  if (kids.length >= 2) section.insertBefore(probe, kids[kids.length - 1]);
  else if (kids.length === 1) section.insertBefore(probe, kids[0]);
  else section.appendChild(probe);
  try {
    const rootDelta = diffOwnStyle(snaps[0].values, win.getComputedStyle(probe), true, snaps[0].important);
    if (!fullClone) return rootDelta;

    // Make the probe stand in for the post-flatten box: the baked root styling (so descendants
    // inherit what they actually will) + position:absolute + the MEASURED border-box size, so
    // %-lengths resolve against the SAME containing block. position:absolute matches the flat
    // box's own formatting context and, crucially, BLOCKIFIES an inline-display text leaf (a
    // <span>/<a>) whose raw offsetWidth is 0 and which would otherwise ignore the width and
    // collapse descendant %-lengths. rootW/H come from measure() (offsetWidth || rect/scale).
    probe.setAttribute(
      "style",
      `${rootDelta}${rootDelta && !rootDelta.endsWith(";") ? ";" : ""}position:absolute;width:${rootW}px;height:${rootH}px;box-sizing:border-box`,
    );
    const prb = [probe, ...Array.from(probe.querySelectorAll<HTMLElement>("*"))];
    const cln = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>("*"))];
    const n = Math.min(real.length, prb.length, cln.length);
    for (let i = 1; i < n; i++) {
      if (real[i].closest("svg")) continue; // svg subtree: leave as cloned
      const delta = diffOwnStyle(snaps[i].values, win.getComputedStyle(prb[i]), false, snaps[i].important);
      if (!delta) continue; // nothing dropped: the kept authored inline is already correct
      const prior = cln[i].getAttribute("style") || "";
      cln[i].setAttribute(
        "style",
        [prior, delta].filter(Boolean).map((s) => s.replace(/;$/, "")).join(";"),
      );
    }
    return rootDelta;
  } finally {
    section.removeChild(probe);
  }
}

// Net 2D LINEAR transform component (a,b,c,d columns; translation excluded - it is
// captured by the measured centre) of the element's computed `transform` matrix
// COMPOSED with the Transforms-2 `rotate`/`scale` properties, which live OUTSIDE the
// matrix. Re-applying this matrix about the box CENTRE, with the box placed at the
// measured transformed centre, reproduces the original render EXACTLY for any affine
// transform (the centre is the fixed point of the recomposition): rotation, scale,
// skew, and their combinations - not just the rotation the old reconstruction kept
// (a skew's atan2 misread as rotation was the syn-transform-skew harness failure).
// Returns null for identity (no inline transform emitted). matrix3d keeps its 2D
// part; a genuine 3D transform is out of the flat model and degrades to that 2D part.
type Mat2 = { a: number; b: number; c: number; d: number };
function matrixOf2d(transform: string): Mat2 | null {
  if (!transform || transform === "none") return null;
  const m = transform.match(/matrix(3d)?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[2].split(",").map((s) => parseFloat(s.trim()));
  const [a, b, c, d] = m[1] ? [p[0], p[1], p[4], p[5]] : [p[0], p[1], p[2], p[3]];
  if (![a, b, c, d].every(Number.isFinite)) return null;
  return { a, b, c, d };
}
function mul(m1: Mat2, m2: Mat2): Mat2 {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
  };
}
function netMatrix(cs: CSSStyleDeclaration): Mat2 | null {
  let total: Mat2 = { a: 1, b: 0, c: 0, d: 1 };
  // Spec order (css-transforms-2): translate, rotate, scale, then transform.
  const rm = cs.rotate && cs.rotate !== "none" ? cs.rotate.match(/(-?[\d.]+)deg/) : null;
  if (rm) {
    const rad = (parseFloat(rm[1]) * Math.PI) / 180;
    total = mul(total, { a: Math.cos(rad), b: Math.sin(rad), c: -Math.sin(rad), d: Math.cos(rad) });
  }
  if (cs.scale && cs.scale !== "none") {
    const sp = cs.scale.split(/\s+/).map(parseFloat);
    const sx = Number.isFinite(sp[0]) ? sp[0] : 1;
    const sy = Number.isFinite(sp[1]) ? sp[1] : sx;
    total = mul(total, { a: sx, b: 0, c: 0, d: sy });
  }
  const mt = matrixOf2d(cs.transform);
  if (mt) total = mul(total, mt);
  const r4 = (v: number) => Math.round(v * 10000) / 10000;
  const out = { a: r4(total.a), b: r4(total.b), c: r4(total.c), d: r4(total.d) };
  if (out.a === 1 && out.b === 0 && out.c === 0 && out.d === 1) return null;
  return out;
}

// If an element CLIPS its content (overflow hidden/clip) AND has rounded corners, it
// is a rounded MASK: its children render with those rounded corners. Flatten hoists
// those children out of the clipper, so we carry the radius down to them (a photo in
// a rounded card keeps its roundness once it's a standalone box). Returns the radius
// shorthand, or "" when the element doesn't clip / isn't rounded.
function clipRadiusOf(cs: CSSStyleDeclaration): string {
  const clips =
    cs.overflowX === "hidden" || cs.overflowX === "clip" ||
    cs.overflowY === "hidden" || cs.overflowY === "clip";
  if (!clips) return "";
  return hasOwnRadius(cs) ? cs.borderRadius : "";
}

function hasOwnRadius(cs: CSSStyleDeclaration): boolean {
  return [
    cs.borderTopLeftRadius, cs.borderTopRightRadius,
    cs.borderBottomLeftRadius, cs.borderBottomRightRadius,
  ].some((v) => parseFloat(v) > 0);
}

// Does the element paint its own box (fill / gradient / image / visible border / shadow)?
function hasOwnPaint(cs: CSSStyleDeclaration): boolean {
  if (cs.backgroundImage && cs.backgroundImage !== "none") return true;
  const bg = cs.backgroundColor;
  if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") return true;
  if (cs.boxShadow && cs.boxShadow !== "none") return true;
  if (
    cs.borderStyle !== "none" &&
    (cs.borderTopWidth !== "0px" || cs.borderRightWidth !== "0px" ||
      cs.borderBottomWidth !== "0px" || cs.borderLeftWidth !== "0px")
  ) {
    return true;
  }
  return false;
}

// Inherited text/colour properties baked onto a SYNTHETIC text-run box (makeTextBox) - a
// bare <div> we create for a loose text node, which has no element of its own to diff, so
// it carries its parent's resolved text cascade verbatim. Real elements get their inherited
// values through the simulation diff (diffOwnStyle) instead.
const TEXT_INHERIT: readonly string[] = [
  "font-family", "font-size", "font-weight", "font-style", "font-variant",
  "line-height", "letter-spacing", "word-spacing", "text-align",
  "text-transform", "text-decoration", "text-indent", "direction", "unicode-bidi",
  // Inherited and visible: a loose "Page 01" run under a glowing footer lost its glow
  // (harness syn-loose-text-shadow).
  "text-shadow",
];
// Freeze the parent's text cascade onto a synthetic text-run box, MINIMALLY: only the
// props whose parent-resolved value differs from what the bare box would compute as a
// section child (probed live, mirroring the sim-diff makeBox uses). Baking the full
// list unconditionally persisted a dozen no-op declarations per loose text run and
// made a re-flatten re-serialize the box differently.
function freezeInherited(
  parentEl: HTMLElement,
  parentCs: CSSStyleDeclaration,
  box: HTMLElement,
  section: HTMLElement,
  win: Window,
): string {
  const kids = section.children;
  if (kids.length >= 2) section.insertBefore(box, kids[kids.length - 1]);
  else if (kids.length === 1) section.insertBefore(box, kids[0]);
  else section.appendChild(box);
  let out = "";
  try {
    const probeCs = win.getComputedStyle(box);
    for (const p of ["color", ...TEXT_INHERIT]) {
      const v = parentCs.getPropertyValue(p);
      if (v && v !== probeCs.getPropertyValue(p)) out += `${p}:${v};`;
    }
  } finally {
    section.removeChild(box);
  }
  return out;
}

// ── Safety net: content-parity census ─────────────────────────────────────────
// Flatten is lossy AND irreversible (it overwrites the slide in both stores and
// feeds the PPTX export), so before the caller persists we verify the output
// still holds every VISIBLE text word and every image / svg / embed the input
// had. On any shortfall the caller keeps the slide UNFLATTENED (degraded editing,
// but lossless) rather than silently shipping a deck with dropped content. Text
// is a word MULTISET (catches a dropped duplicate); the census is a strict
// non-shrink on visual atoms. Styling fidelity (collapsed lines, lost colour) is
// NOT checked here, only content presence.
type AtomCensus = { img: number; svg: number; embed: number };
export type StyleDrift = {
  fidx: number;      // paint-order rank, pairs the drift to its output box
  prop: string;      // e.g. "color"
  src: string;       // source computed value
  out: string;       // post-flatten computed value
  severity: "high" | "low";
};
export type FlattenParity = {
  ok: boolean;             // the HARD content gate (unchanged)
  missingWords: string[];
  srcCensus: AtomCensus;
  outCensus: AtomCensus;
  // Advisory STYLE-fidelity census - NEVER affects `ok`, it is the observatory signal.
  fidelityScore: number;   // 0..1 (1 = output renders like the source on FIDELITY_PROPS)
  styleDrifts: StyleDrift[]; // capped, high-severity first
  leafCount: number;       // boxes measured (the score denominator)
};

// Visual properties whose post-hoist loss is USER-VISIBLE (the invisible-letters bug was a
// `color` / `background-color` drop). The fidelity census diffs each output box against its
// source on exactly these - NOT all ~350 props (the expensive route) and NOT geometry (the
// flatten owns + measures that). HIGH = "you can see it's wrong"; it weighs the score harder.
// border-radius is deliberately ABSENT: the clip step OWNS it (re-emits own + inherited-mask
// radius), so a mask-child's source own-radius (0) vs its baked output radius is a false drift.
const FIDELITY_PROPS = [
  "color", "background-color", "-webkit-text-fill-color", "opacity", "visibility",
  "font-size", "font-weight", "font-family", "line-height", "letter-spacing",
  "text-align", "text-decoration-line", "text-transform", "box-shadow", "text-shadow",
] as const;
const HIGH_SEVERITY = new Set<string>([
  "color", "background-color", "-webkit-text-fill-color", "opacity", "visibility", "font-size",
]);
function captureFidelity(cs: CSSStyleDeclaration): Record<string, string> {
  const o: Record<string, string> = {};
  for (const p of FIDELITY_PROPS) o[p] = cs.getPropertyValue(p);
  return o;
}

function wordCounts(text: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of text.split(/\s+/)) if (w) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
}

// Word multiset of a subtree, tokenized PER TEXT NODE so adjacent inline runs keep
// their boundaries (`<span>A</span><span>B</span>` stays {A, B}, never "AB"). Counts
// only text that RENDERS (skips display:none / collapsed text via a Range rect, plus
// <style>|<script>), so `root` MUST be in the live layout context. checkParity runs
// this on the source AND on the flattened output once the output is swapped into that
// same context, which keeps the visible-only filter symmetric across both sides.
function collectWords(root: HTMLElement, doc: Document): Map<string, number> {
  const words = new Map<string, number>();
  const range = doc.createRange();
  const tw = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const t = (n.textContent ?? "").trim();
    if (!t) continue;
    if (n.parentElement?.closest("style, script")) continue;
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) continue;
    for (const [w, c] of wordCounts(t)) words.set(w, (words.get(w) ?? 0) + c);
  }
  return words;
}

// Per-box snapshot captured while the source is live: the FIDELITY_PROPS values plus
// the measured canvas-space rect, so checkParity can census STYLE and GEOMETRY drift
// against the output box (the stress harness showed pure-geometry damage - shifted
// text boxes, escaped clips - that a props-only census scored as perfect).
type SrcSnapshot = {
  props: Record<string, string>;
  rect: { l: number; t: number; w: number; h: number };
};

function checkParity(
  section: HTMLElement,
  out: HTMLElement,
  win: Window,
  srcFidelity: Map<number, SrcSnapshot>,
  scale: number,
): FlattenParity {
  const doc = section.ownerDocument;
  const EMBED = "canvas, video, iframe, object, embed";
  // Count atoms that actually RENDER under the live source (a 0x0 / display:none /
  // visibility:hidden atom is not required of the output).
  const visibleCount = (sel: string) =>
    [...section.querySelectorAll(sel)].filter((el) => {
      const cs = win.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return r.width >= 1 && r.height >= 1;
    }).length;

  // SOURCE side, measured on the live (already laid-out + font-loaded) section BEFORE
  // the swap below: only VISIBLE words + atoms count, so flatten is never faulted for
  // correctly omitting invisible content.
  const srcWords = collectWords(section, doc);
  const srcCensus: AtomCensus = {
    img: visibleCount("img"),
    svg: visibleCount("svg"),
    embed: visibleCount(EMBED),
  };

  // OUTPUT WORDS, measured in the SAME live layout context. `out` is a DETACHED tree
  // with no layout (every rect is 0), so censusing it on its own cannot apply the
  // visible-only filter: it would count text the source correctly SKIPS as invisible
  // (a display:none descendant a full-clone leaf carries along; svg off-canvas
  // <text>). Because the word check is a per-word MULTISET (any output occurrence
  // satisfies the source count), such a phantom could MASK a genuinely dropped VISIBLE
  // word, defeating the net. So swap the output in, measure, restore. The swap is
  // synchronous and restored net-zero before this returns (try/finally covers a
  // throwing measure); no paint happens in between, and only innerHTML changes, so the
  // flat boxes lay out exactly as they will once adopted. `out.innerHTML` re-inserts
  // the hoisted <style> blocks the source already has, a no-op on the cascade.
  const savedHtml = section.innerHTML;
  let outWords: Map<string, number>;
  // STYLE-FIDELITY census, accumulated in the SAME swap window (the only moment the output is
  // laid out in the live context). Pair each box to its source by data-tq-fidx + diff the
  // FIDELITY_PROPS. Advisory: it never touches `ok`.
  const drifts: StyleDrift[] = [];
  let weightedDrift = 0;
  let leafCount = 0;
  try {
    section.innerHTML = out.innerHTML;
    outWords = collectWords(section, doc);
    const secRect = section.getBoundingClientRect();
    for (const box of section.querySelectorAll<HTMLElement>("[data-tq-fidx]")) {
      const fidx = Number(box.getAttribute("data-tq-fidx"));
      const snap = srcFidelity.get(fidx);
      if (!snap) continue;
      const src = snap.props;
      leafCount++;
      const cs = win.getComputedStyle(box);
      let high = false;
      let low = false;
      // GEOMETRY census: the output box must sit where the source rendered. Skip
      // transformed boxes (their client rect is the transformed bounding box, not the
      // layout box). 2px/3px slack absorbs measurement rounding; anything past it is
      // the shifted-text / escaped-layout damage class.
      if (!box.style.transform) {
        const r = box.getBoundingClientRect();
        const g = {
          l: (r.left - secRect.left) / scale,
          t: (r.top - secRect.top) / scale,
          w: r.width / scale,
          h: r.height / scale,
        };
        if (
          Math.abs(g.l - snap.rect.l) > 2 || Math.abs(g.t - snap.rect.t) > 2 ||
          Math.abs(g.w - snap.rect.w) > 3 || Math.abs(g.h - snap.rect.h) > 3
        ) {
          high = true;
          drifts.push({
            fidx,
            prop: "geometry",
            src: `${Math.round(snap.rect.l)},${Math.round(snap.rect.t)} ${Math.round(snap.rect.w)}x${Math.round(snap.rect.h)}`,
            out: `${Math.round(g.l)},${Math.round(g.t)} ${Math.round(g.w)}x${Math.round(g.h)}`,
            severity: "high",
          });
        }
      }
      for (const p of FIDELITY_PROPS) {
        const o = cs.getPropertyValue(p);
        if (src[p] === o) continue;
        const isHigh = HIGH_SEVERITY.has(p);
        if (isHigh) high = true;
        else low = true;
        // Always collect HIGH drifts; cap LOW so a flood of low-severity noise can't crowd
        // them out of the list before the high-first sort below.
        if (isHigh || drifts.length < 60) {
          drifts.push({ fidx, prop: p, src: src[p], out: o, severity: isHigh ? "high" : "low" });
        }
      }
      if (high) weightedDrift += 1;
      else if (low) weightedDrift += 0.3;
    }
  } finally {
    section.innerHTML = savedHtml;
  }
  // A leaf with any HIGH drift counts 1.0, a low-only leaf 0.3, a clean leaf 0.
  const fidelityScore = leafCount ? Math.max(0, 1 - weightedDrift / leafCount) : 1;
  drifts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));

  // OUTPUT ATOMS stay a PRESENCE count, NOT measured in the swap on purpose: a
  // freshly-parsed <img> clone has not decoded yet, so a rect-based visibility check
  // would race image decode and could FALSELY fail the net. This guard is only a
  // coarse non-shrink check, so a deterministic presence count is the safe choice (a
  // flatten that drops a VISIBLE atom while carrying an INVISIBLE duplicate is far
  // rarer than the text case, and this is no worse than before).
  const outCensus: AtomCensus = {
    img: out.querySelectorAll("img").length,
    svg: out.querySelectorAll("svg").length,
    embed: out.querySelectorAll(EMBED).length,
  };

  const missingWords: string[] = [];
  for (const [w, count] of srcWords) {
    if ((outWords.get(w) ?? 0) < count) missingWords.push(w);
  }
  const censusShrunk =
    outCensus.img < srcCensus.img ||
    outCensus.svg < srcCensus.svg ||
    outCensus.embed < srcCensus.embed;
  return {
    ok: missingWords.length === 0 && !censusShrunk,
    missingWords: missingWords.slice(0, 25),
    srcCensus,
    outCensus,
    fidelityScore,
    styleDrifts: drifts.slice(0, 20),
    leafCount,
  };
}

// Caller-side gate: reasons NOT to run flatten at all. Checked by SlideEditor before
// flattenSlideSection so the skip shares the same lossless keep-as-is path as a
// parity failure.
//   - "already-flat": every element child is a flatten-emitted box. The flat form IS
//     the structural normal form; re-running only re-measures and re-rounds it. The
//     stress harness showed repeated re-flattens WANDER (up to ~5% pixel drift from
//     the authored render by pass 3, style-attr bloat up to ~3x) and re-persist on
//     every editor entry. Skipping is both the fidelity and the churn fix.
//   - "nth-selector-css": the deck styles rows via :nth-child()/:nth-of-type(); the
//     ordinals cannot survive hoisting into one flat sibling list (documented
//     inherent limit; harness: zebra stripes vanished, 16.7% of the canvas). Keep the
//     nested original: degraded editing beats silent restyling.
//   - "negative-z": a nested negative-z child paints behind its parent's background
//     only while the parent creates NO stacking context; the flat box's explicit
//     z-index creates one, which hoists the child above that background (atomizing
//     the parent was tried and reproduces the same misorder, harness:
//     syn-neg-z-child). Only the nested original renders it faithfully.
export function flattenSkipReason(section: HTMLElement): string | null {
  const kids = Array.from(section.children).filter(
    (el) => !/^(?:style|script)$/i.test(el.tagName),
  );
  if (kids.length > 0 && kids.every((el) => el.getAttribute("data-tq-flat") === "1")) {
    return "already-flat";
  }
  for (const st of Array.from(section.querySelectorAll("style"))) {
    if (st.closest("svg")) continue;
    if (/:nth-(?:child|of-type|last-child|last-of-type)\(/i.test(st.textContent ?? "")) {
      return "nth-selector-css";
    }
  }
  const win = section.ownerDocument.defaultView;
  if (win) {
    for (const el of Array.from(section.querySelectorAll<HTMLElement>("*"))) {
      if (el.closest("svg")) continue;
      // Negative z on a DIRECT section child is fine (the walk orders it first and
      // the section's isolation:isolate armor matches that paint order); only a
      // NESTED one is unrepresentable.
      if (el.parentElement === section) continue;
      const z = parseInt(win.getComputedStyle(el).zIndex, 10);
      if (!Number.isNaN(z) && z < 0) return "negative-z";
    }
  }
  return null;
}

export function flattenSlideSection(
  section: HTMLElement,
  opts: FlattenOptions = {},
): { html: string; parity: FlattenParity } {
  const scale = opts.scale && opts.scale > 0 ? opts.scale : 1;
  const win = section.ownerDocument.defaultView;
  if (!win) throw new Error("flattenSlideSection: section is not attached to a live document");

  const isHidden = (cs: CSSStyleDeclaration) =>
    cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0";

  const originRect = section.getBoundingClientRect();

  // Per-box snapshot of the SOURCE's visual props + measured rect (keyed by paint-order
  // rank), captured in makeBox while the source is still live; checkParity diffs it
  // against the output box.
  const srcFidelity = new Map<number, SrcSnapshot>();

  // Geometry relative to the SECTION. offsetWidth/Height are layout (canvas) px;
  // getBoundingClientRect is on-screen (scaled) px, so its deltas are divided by `scale`.
  // left/top round to INTEGER px: a fractional-precision experiment (0.1px) traded the
  // <=1px placement shift for blurrier subpixel glyph rendering and measured WORSE on
  // the stress harness; integers are crisp, stable, and what the editor's geometry UI
  // expects. The residual <=1px shift vs the authored render is the accepted floor.
  const measure = (el: HTMLElement, cs: CSSStyleDeclaration) => {
    const rect = el.getBoundingClientRect();
    const mtx = netMatrix(cs);
    // TRUE fractional size: offsetWidth rounds to an integer, so a 261.47px flex row
    // ceils to 261 - a box 0.47px too TIGHT whose flex children then shrink (harness:
    // the logo-dot squeeze that broke re-flatten byte-stability). The client rect
    // carries the fraction; it is only unusable under a transform (it measures the
    // transformed bounding box), where the untransformed offset size is correct.
    const w = (mtx ? 0 : rect.width / scale) || el.offsetWidth || rect.width / scale;
    const h = (mtx ? 0 : rect.height / scale) || el.offsetHeight || rect.height / scale;
    const cx = (rect.left + rect.width / 2 - originRect.left) / scale;
    const cy = (rect.top + rect.height / 2 - originRect.top) / scale;
    return {
      left: Math.round(cx - w / 2),
      top: Math.round(cy - h / 2),
      // Ceil the box so a sub-pixel shave can't force single-line text to wrap.
      width: Math.ceil(w),
      height: Math.ceil(h),
      mtx,
    };
  };

  // One standalone absolute box: a clone of `el` (full keeps its subtree; shallow empties
  // it for a painted shell), positioned in section space, with an EXPLICIT global z.
  const makeBox = (
    el: HTMLElement,
    cs: CSSStyleDeclaration,
    z: number,
    fullClone: boolean,
    clipRadius: string,
  ): HTMLElement => {
    const m = measure(el, cs);
    const clone = el.cloneNode(fullClone) as HTMLElement;
    if (!fullClone) while (clone.firstChild) clone.removeChild(clone.firstChild);
    // SIMULATE the hoist + bake the resolved delta - everything the move drops (inherited
    // values, ancestry-scoped rules, ancestor variables) - onto the clone + its
    // descendants. Returns the ROOT element's delta; the geometry below is appended to it.
    const delta = applyDiff(el, clone, fullClone, win, section, m.width, m.height);
    // SINGLE-LINE detection (robust + self-healing): force the live element onto one
    // line and measure the content width. If that fits within the box width, the text
    // is single-line and the fixed box width would otherwise SHAVE-wrap it (sub-pixel)
    // pin white-space:nowrap. Genuine multi-line text has a one-line width far wider
    // than its box, so it keeps wrapping. Because it measures the would-be single-line
    // width (not the current wrapped height), re-flattening a slide whose box already
    // shave-wrapped HEALS it back to one line.
    let nowrap = "";
    if (isTextLeaf(el)) {
      const prevWS = el.style.whiteSpace;
      el.style.whiteSpace = "nowrap";
      const oneLineWidth = el.scrollWidth;
      el.style.whiteSpace = prevWS;
      if (oneLineWidth <= m.width + 4) nowrap = "white-space:nowrap;";
    }
    // Rounded-clip mask. Radius + overflow are flatten-OWNED here (the diff skips their
    // longhands), so re-emit them from the live computed style every pass: a flat mask carries
    // them as its OWN inline, which reads straight back, so re-flatten stays byte-stable. The
    // box rounds if it has its own radius OR a rounded clipping ancestor passed one down (a
    // photo in a rounded card). overflow is added only when the box actually MASKS: it inherits
    // a rounded ancestor's mask (it has no own radius to mask with) OR it already clips its own
    // content. A box that merely has its OWN radius inside a clipping ancestor is NOT force-
    // clipped (that would crop a shadow/outline the ancestor never clipped). The `clip` keyword
    // is preserved when the box uses it.
    const ownR = hasOwnRadius(cs);
    const radius = ownR ? cs.borderRadius : clipRadius;
    const clipsOwn =
      cs.overflowX === "hidden" || cs.overflowX === "clip" ||
      cs.overflowY === "hidden" || cs.overflowY === "clip";
    const masks = (!!clipRadius && !ownR) || clipsOwn;
    const ovKw = clipsOwn && (cs.overflowX === "clip" || cs.overflowY === "clip") ? "clip" : "hidden";
    const clip =
      (radius ? `border-radius:${radius};` : "") +
      (masks ? `overflow:${ovKw};` : "");
    const pos =
      // right:auto / bottom:auto neutralize any class-based right/bottom/inset from the
      // scoped <style> (which we can't strip): an absolute box with our inline left+width
      // AND a class `right` is over-constrained, and dir:rtl then IGNORES `left`.
      `position:absolute;left:${m.left}px;top:${m.top}px;right:auto;bottom:auto;` +
      // box-sizing:border-box so the measured (offset/border-box) width IS the rendered
      // size - immune to padding/border re-applied by a surviving class rule (else a
      // padded box's width would compound across re-flattens).
      `width:${m.width}px;height:${m.height}px;margin:0;box-sizing:border-box;` +
      // The full 2D linear component about the box centre (see netMatrix): exact for
      // rotate AND scale/skew, where the old rotation-only bake turned a class skew
      // into an inline rotate that overrode it.
      (m.mtx
        ? `transform:matrix(${m.mtx.a},${m.mtx.b},${m.mtx.c},${m.mtx.d},0,0);transform-origin:center center;`
        : "") +
      `z-index:${z};` +
      clip +
      nowrap; // single-line text: keep it on one line (the fixed width can't shave-wrap)
    // Strip each fragment's trailing `;` before joining so adjacent self-terminated
    // fragments don't produce `;;` empty declarations in the persisted style.
    clone.setAttribute(
      "style",
      [delta, pos].filter(Boolean).map((s) => s.replace(/;$/, "")).join(";"),
    );
    clone.setAttribute("data-tq-flat", "1");
    // Style-fidelity pairing: stamp the paint-order rank + snapshot the SOURCE's visual props
    // now (it is still live). checkParity re-reads the output box by this rank in its swap; the
    // attribute is census-only, stripped before the html is returned (+ in serialize.ts).
    clone.setAttribute("data-tq-fidx", String(z));
    srcFidelity.set(z, {
      props: captureFidelity(cs),
      rect: { l: m.left, t: m.top, w: m.width, h: m.height },
    });
    return clone;
  };

  // A bare text node directly under a dissolved / painted-shell parent (e.g. the
  // "Page 01" in <div class="pno"><hr>Page 01</div>) is invisible to the element
  // walk below, so it would be silently dropped. Emit each RENDERED run as its own
  // absolute box, frozen with the parent's inherited text styles and positioned by
  // a Range measurement (same section-space geometry as makeBox).
  const makeTextBox = (
    textNode: Node,
    parentEl: HTMLElement,
    parentCs: CSSStyleDeclaration,
    z: number,
  ): HTMLElement | null => {
    const range = section.ownerDocument.createRange();
    range.selectNodeContents(textNode);
    const rect = range.getBoundingClientRect();
    if (rect.width < 1 && rect.height < 1) return null; // not rendered
    const w = Math.ceil(rect.width / scale);
    const h = Math.ceil(rect.height / scale);
    const left = Math.round((rect.left + rect.width / 2 - originRect.left) / scale - w / 2);
    const top = Math.round((rect.top + rect.height / 2 - originRect.top) / scale - h / 2);
    const box = section.ownerDocument.createElement("div");
    box.textContent = (textNode.textContent ?? "").trim();
    const frozen = freezeInherited(parentEl, parentCs, box, section, win);
    // nowrap only for a run that actually rendered on ONE line: forcing it on a
    // wrapped run reflows a whole paragraph onto one overflowing line (harness
    // syn-loose-text-multiline). Line count from the run's height vs line-height,
    // not getClientRects() (BiDi splits one visual line into several rects).
    const lh =
      parseFloat(parentCs.lineHeight) || parseFloat(parentCs.fontSize) * 1.4 || rect.height;
    const singleLine = rect.height / scale <= lh * 1.5;
    box.setAttribute(
      "style",
      `${frozen}position:absolute;left:${left}px;top:${top}px;right:auto;bottom:auto;` +
        `width:${w}px;height:${h}px;margin:0;box-sizing:border-box;z-index:${z};` +
        (singleLine ? "white-space:nowrap;" : ""),
    );
    box.setAttribute("data-tq-flat", "1");
    // Style-fidelity pairing for the SYNTHETIC text-run box: its source is the parent's
    // resolved TEXT props, but a text run paints no box of its own, so background / shadow are
    // the run's own (transparent / none). checkParity reads this box by rank in its swap.
    box.setAttribute("data-tq-fidx", String(z));
    const tsrc = captureFidelity(parentCs);
    tsrc["background-color"] = "rgba(0, 0, 0, 0)";
    tsrc["box-shadow"] = "none";
    srcFidelity.set(z, { props: tsrc, rect: { l: left, t: top, w, h } });
    return box;
  };

  const isLeaf = (el: HTMLElement) =>
    el.tagName === "IMG" || el.tagName.toLowerCase() === "svg" || isTextLeaf(el);

  const zOf = (cs: CSSStyleDeclaration) => {
    const z = parseInt(cs.zIndex, 10);
    return Number.isNaN(z) ? 0 : z;
  };

  // UNSPLITTABLE containers: hoisting their children out breaks compositing or
  // clipping that only exists while they are nested, so the whole subtree is emitted
  // as ONE full-clone box (exact render, coarser per-child editability):
  //   - clip-path / mask: no flat equivalent (harness: a diagonal clip-path panel
  //     flattened into a straight rectangle);
  //   - opacity < 1: GROUP opacity composites the subtree as a unit; hoisted children
  //     re-render at full opacity (harness: both group-opacity fixtures);
  //   - a negative-z child paints BEHIND this element's background, an order the
  //     global flat ranking cannot express (harness: syn-neg-z-child);
  //   - an overflow clip whose content SPILLS past its box: the rounded-mask
  //     carry-down preserves corner radius but not the crop rectangle (harness:
  //     syn-rect-clip-spill).
  const isAtomic = (el: HTMLElement, cs: CSSStyleDeclaration): boolean => {
    if (cs.clipPath && cs.clipPath !== "none") return true;
    const mask =
      cs.getPropertyValue("mask-image") || cs.getPropertyValue("-webkit-mask-image");
    if (mask && mask !== "none") return true;
    if (parseFloat(cs.opacity) < 1) return true;
    const clips =
      cs.overflowX === "hidden" || cs.overflowX === "clip" ||
      cs.overflowY === "hidden" || cs.overflowY === "clip";
    if (clips) {
      const host = el.getBoundingClientRect();
      const slack = 1.5 * scale;
      for (const d of Array.from(el.querySelectorAll<HTMLElement>("*"))) {
        if (d.closest("svg") && d.tagName.toLowerCase() !== "svg") continue; // svg internals
        const r = d.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (
          r.left < host.left - slack || r.top < host.top - slack ||
          r.right > host.right + slack || r.bottom > host.bottom + slack
        ) {
          return true;
        }
      }
    }
    return false;
  };

  // A dissolving wrapper whose ::before/::after actually RENDERS would take that
  // pseudo content down with it - pseudos have no standalone box to hoist (harness:
  // syn-pseudo-dissolved-wrapper). Keeping the ELEMENT as a shell keeps them alive:
  // its classes survive, so the scoped pseudo rules still match the pinned box.
  const hasPseudoContent = (el: HTMLElement): boolean => {
    for (const which of ["::before", "::after"] as const) {
      const c = win.getComputedStyle(el, which).content;
      if (c && c !== "none" && c !== "normal") return true;
    }
    return false;
  };

  // Walk in PAINT ORDER, emitting a standalone box for every visual element. Children of a
  // container are processed in (z-index asc, DOM order), the order they paint, so the
  // running counter `z` reproduces the original stacking as a flat sequence.
  const out = section.cloneNode(false) as HTMLElement;
  // Carry ALL <style> blocks (not just direct children): a nested <style> in a
  // wrapper that dissolves would otherwise lose its @font-face / :root vars /
  // keyframes. They are global once hoisted. SVG-internal <style> stays in its svg.
  for (const style of Array.from(section.querySelectorAll("style"))) {
    if (style.closest("svg")) continue;
    out.appendChild(style.cloneNode(true));
  }
  let z = 1;
  // `clip` = the rounded-mask radius inherited from a clipping ANCESTOR (a rounded
  // card / framed photo). It flows down to every box hoisted out of that ancestor so
  // the mask survives flattening as the box's own border-radius.
  const collect = (parent: HTMLElement, clip: string) => {
    const kids = (Array.from(parent.children) as HTMLElement[])
      .filter((el) => {
        const low = el.tagName.toLowerCase();
        if (low === "style" || low === "script") return false;
        const cs = win.getComputedStyle(el);
        if (isHidden(cs)) return false;
        // Cull on LAYOUT px: offsetWidth/Height are scale-invariant (fall back to
        // rect/scale for inline boxes where offset is 0), with a 0.5px floor so a
        // genuine 1px hairline survives at any editor zoom and the result is
        // deterministic across zoom levels.
        const r = el.getBoundingClientRect();
        const w = el.offsetWidth || r.width / scale;
        const h = el.offsetHeight || r.height / scale;
        return w >= 0.5 && h >= 0.5;
      })
      .map((el, i) => ({ el, i, z: zOf(win.getComputedStyle(el)) }))
      .sort((a, b) => a.z - b.z || a.i - b.i)
      .map((x) => x.el);
    for (const el of kids) {
      const cs = win.getComputedStyle(el);
      // This element's OWN clip radius takes over for its descendants (a nested mask).
      const childClip = clipRadiusOf(cs) || clip;
      if (isLeaf(el)) {
        out.appendChild(makeBox(el, cs, z++, true, clip)); // text / image / graphic, whole
      } else if (isAtomic(el, cs)) {
        out.appendChild(makeBox(el, cs, z++, true, clip)); // unsplittable subtree, one box
      } else if (hasOwnPaint(cs) || hasPseudoContent(el)) {
        out.appendChild(makeBox(el, cs, z++, false, clip)); // painted shell (scrim / fill / card)
        // ALWAYS recurse: gating on text/img content dropped painted-but-content-free
        // children, e.g. a progress-bar FILL div inside its painted track (harness
        // gen-en-social-s4) - invisible to the word/atom census too. Empty children
        // are culled by the size filter above, so this is a no-op for true leaves.
        collect(el, childClip); // its content paints ON TOP, as its own boxes
      } else {
        collect(el, childClip); // transparent wrapper → dissolve, hoist its children
      }
    }
    // Bare text nodes directly under this dissolved / shell parent (siblings of the
    // element kids above) - emit each so mixed text+element content is never dropped.
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType !== 3 /* TEXT_NODE */ || !(node.textContent ?? "").trim()) continue;
      const box = makeTextBox(node, parent, win.getComputedStyle(parent), z);
      if (box) {
        out.appendChild(box);
        z++;
      }
    }
  };
  collect(section, "");

  const parity = checkParity(section, out, win, srcFidelity, scale);
  // data-tq-fidx is census-only: strip it so the returned html (and the live editor DOM) never
  // carry it, which keeps re-flatten byte-stable. serialize.ts strips it too as defense.
  for (const b of Array.from(out.querySelectorAll<HTMLElement>("[data-tq-fidx]"))) {
    b.removeAttribute("data-tq-fidx");
  }
  return { html: out.outerHTML, parity };
}
