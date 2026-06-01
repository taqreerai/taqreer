// Verifies lib/export/scrim.ts (FIX-3) against a synthetic replica of the
// real cover slide: an RTL slide whose two stacked full-bleed scrims (a div
// CSS gradient + an SVG linearGradient) both point their DARK end at the LEFT
// while the text sits on the RIGHT. Run: npx tsx scripts/test-scrim.ts
import { JSDOM } from "jsdom";
import { applyScrimFixes } from "../lib/export/scrim";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

function root(html: string) {
  const dom = new JSDOM(`<!DOCTYPE html><div>${html}</div>`);
  return dom.window.document.body.firstElementChild!
    .firstElementChild as unknown as Parameters<typeof applyScrimFixes>[0] & {
    querySelector(s: string): { getAttribute(n: string): string | null } | null;
    getAttribute(n: string): string | null;
  };
}
const styleOf = (el: { getAttribute(n: string): string | null } | undefined) =>
  el?.getAttribute("style") ?? "";

// ── 1. RTL cover: dark-left div(270deg) + dark-left svg(x1=1→x2=0) ──────
console.log("RTL cover — both layers dark-left, text on right:");
{
  const slide = root(`
    <div dir="rtl" style="position:relative;width:1920px;height:1080px;">
      <img data-genimage="city skyline at dusk" data-genid="hero1"
           style="position:absolute;inset:0;object-fit:cover;" />
      <div style="position:absolute;inset:0;background:linear-gradient(270deg, transparent 0%, #030D01 62%);"></div>
      <svg style="position:absolute;top:0;left:0;width:100%;height:100%;">
        <defs><linearGradient id="g" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stop-color="#030D01" stop-opacity="0"/>
          <stop offset="1" stop-color="#030D01" stop-opacity="1"/>
        </linearGradient></defs>
        <rect width="100%" height="100%" fill="url(#g)"/>
      </svg>
      <div style="position:absolute;top:0;bottom:0;right:120px;width:700px;">عنوان</div>
    </div>`);
  const changed = applyScrimFixes(slide, "rtl");
  check("returns changed=true", changed === true);

  const div = slide.querySelector("div[style*='linear-gradient']")!;
  const ds = styleOf(div);
  check("div gradient flipped 270deg→90deg (dark now on right)", /90deg/.test(ds) && !/270deg/.test(ds));
  check("div opacity capped to 0.9", /opacity:\s*0\.9/.test(ds));

  const lg = slide.querySelector("linearGradient")!;
  check("svg x1 swapped 1→0", lg.getAttribute("x1") === "0");
  check("svg x2 swapped 0→1", lg.getAttribute("x2") === "1");
  const svgEl = slide.querySelector("svg")!;
  check("svg opacity capped to 0.9", /opacity:\s*0\.9/.test(styleOf(svgEl)));
}

// ── 2. RTL already-correct (dark-right) → no flip, opacity still capped ──
console.log("RTL already dark-right — keep orientation, just soften:");
{
  const slide = root(`
    <div dir="rtl" style="position:relative;width:1920px;height:1080px;">
      <img data-genimage="x" data-genid="h" style="position:absolute;inset:0;" />
      <div style="position:absolute;inset:0;background:linear-gradient(90deg, transparent 0%, #000 60%);"></div>
    </div>`);
  const changed = applyScrimFixes(slide, "rtl");
  const ds = styleOf(slide.querySelector("div[style*='linear-gradient']")!);
  check("returns changed=true (opacity softened)", changed === true);
  check("kept 90deg (no needless flip)", /90deg/.test(ds) && !/270deg/.test(ds));
  check("opacity capped to 0.9", /opacity:\s*0\.9/.test(ds));
}

// ── 3. Partial (non-full-bleed) scrim is left alone ─────────────────────
console.log("Partial scrim (half-width) — untouched:");
{
  const slide = root(`
    <div dir="rtl" style="position:relative;width:1920px;height:1080px;">
      <img data-genimage="x" data-genid="h" style="position:absolute;inset:0;" />
      <div style="position:absolute;top:0;left:0;width:50%;height:100%;background:linear-gradient(270deg, transparent, #000);"></div>
    </div>`);
  const before = styleOf(slide.querySelector("div[style*='linear-gradient']")!);
  const changed = applyScrimFixes(slide, "rtl");
  const after = styleOf(slide.querySelector("div[style*='linear-gradient']")!);
  check("returns changed=false", changed === false);
  check("style untouched", before === after);
}

// ── 4. No generated image → hard no-op ──────────────────────────────────
console.log("No generated image — no-op:");
{
  const slide = root(`
    <div dir="rtl" style="position:relative;width:1920px;height:1080px;">
      <div style="position:absolute;inset:0;background:linear-gradient(270deg, transparent, #000);"></div>
    </div>`);
  check("returns changed=false", applyScrimFixes(slide, "rtl") === false);
}

// ── 5. LTR slide → dark end belongs on the LEFT ─────────────────────────
console.log("LTR slide — dark-right div should flip to left:");
{
  const slide = root(`
    <div dir="ltr" style="position:relative;width:1920px;height:1080px;">
      <img data-genimage="x" data-genid="h" style="position:absolute;inset:0;" />
      <div style="position:absolute;inset:0;background:linear-gradient(90deg, transparent 0%, #000 60%);"></div>
    </div>`);
  const changed = applyScrimFixes(slide, "ltr");
  const ds = styleOf(slide.querySelector("div[style*='linear-gradient']")!);
  check("returns changed=true", changed === true);
  check("flipped 90deg→270deg (dark now on left)", /270deg/.test(ds) && !/90deg/.test(ds));
  check("opacity capped to 0.9", /opacity:\s*0\.9/.test(ds));
}

// ── 6. Vertical scrim (to bottom) — orientation untouched, opacity capped ─
console.log("Vertical (bottom-band) scrim — don't re-orient, only soften:");
{
  const slide = root(`
    <div dir="rtl" style="position:relative;width:1920px;height:1080px;">
      <img data-genimage="x" data-genid="h" style="position:absolute;inset:0;" />
      <div style="position:absolute;inset:0;background:linear-gradient(180deg, transparent 40%, #000 100%);"></div>
    </div>`);
  const changed = applyScrimFixes(slide, "rtl");
  const ds = styleOf(slide.querySelector("div[style*='linear-gradient']")!);
  check("returns changed=true (softened)", changed === true);
  check("kept 180deg (vertical not re-oriented)", /180deg/.test(ds));
  check("opacity capped to 0.9", /opacity:\s*0\.9/.test(ds));
}

// ── 7. Slide-3 case: accent image (NOT full-screen) + decorative full-bleed
//      gradient → must be a no-op (gradient is not a scrim) ───────────────
console.log("Accent image + decorative full-bleed gradient — no-op:");
{
  const slide = root(`
    <div dir="rtl" style="position:relative;width:1920px;height:1080px;">
      <div style="position:absolute;inset:0;background:linear-gradient(270deg, #0b1f3a, #030d01);"></div>
      <img data-genimage="product shot" data-genid="acc1"
           style="position:absolute;top:200px;right:140px;width:480px;height:320px;object-fit:cover;" />
      <div style="position:absolute;top:0;bottom:0;left:120px;width:700px;">عنوان</div>
    </div>`);
  const before = styleOf(slide.querySelector("div[style*='linear-gradient']")!);
  const changed = applyScrimFixes(slide, "rtl");
  const after = styleOf(slide.querySelector("div[style*='linear-gradient']")!);
  check("returns changed=false (no full-screen image)", changed === false);
  check("decorative gradient untouched", before === after);
}

// ── 8. Cover with a stacked FLAT solid-tint layer → opacity still capped ──
console.log("Cover with a flat solid-tint layer — every layer softened:");
{
  // Select by stable id — touching el.style re-serializes the attribute
  // (#hex→rgb(), 0→0px), so matching on raw background values is unreliable.
  const slide = root(`
    <div dir="rtl" style="position:relative;width:1920px;height:1080px;">
      <img data-genimage="x" data-genid="h" style="position:absolute;inset:0;object-fit:cover;" />
      <div id="tint" style="position:absolute;inset:0;background-color:#030D01;"></div>
      <div id="grad" style="position:absolute;inset:0;background:linear-gradient(270deg, transparent, #000);"></div>
      <div id="content" style="position:absolute;top:0;bottom:0;right:120px;width:700px;">عنوان</div>
    </div>`);
  const changed = applyScrimFixes(slide, "rtl");
  check("returns changed=true", changed === true);
  const byId = (id: string) => slide.querySelector(`#${id}`) ?? undefined;
  const tint = byId("tint");
  const grad = byId("grad");
  const content = byId("content");
  check("flat tint layer opacity capped to 0.9", /opacity:\s*0\.9/.test(styleOf(tint)));
  check("gradient layer opacity capped to 0.9", /opacity:\s*0\.9/.test(styleOf(grad)));
  check("gradient layer re-oriented to right (270deg→90deg)", /90deg/.test(styleOf(grad)) && !/270deg/.test(styleOf(grad)));
  check("text-content layer left untouched (no opacity)", !/opacity/.test(styleOf(content)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
