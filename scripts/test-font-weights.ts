// Verifies the named-weight font embed (lib/export/embed-fonts-client.ts):
//   1. weightedTypeface maps CSS weights → PowerPoint's named typefaces.
//   2. embedConvertedFontsInPptx splices ONE <p:embeddedFont> per weight, each
//      with a <p:regular> slot and NO <p:bold> (the bold flag is the bug).
// Run: npx tsx scripts/test-font-weights.ts
import { JSDOM } from "jsdom";
import JSZip from "jszip";
import {
  weightedTypeface,
  normalizeWeight,
  embedConvertedFontsInPptx,
} from "../lib/export/embed-fonts-client";
import { extractFontSourcesByWeight } from "../lib/export/embed-fonts";

const jsdom = new JSDOM("<!DOCTYPE html><html></html>");
const g = globalThis as unknown as { DOMParser: unknown; XMLSerializer: unknown };
g.DOMParser = jsdom.window.DOMParser;
g.XMLSerializer = jsdom.window.XMLSerializer;

let pass = 0;
let fail = 0;
const ck = (n: string, c: boolean) => {
  if (c) {
    pass++;
    console.log("✓ " + n);
  } else {
    fail++;
    console.error("✗ " + n);
  }
};

// ── 1. weight → named typeface (matches PowerPoint's own output) ──────
console.log("weightedTypeface:");
const cases: [number | string, string][] = [
  [100, "Cairo Thin"],
  [200, "Cairo ExtraLight"],
  [300, "Cairo Light"],
  [400, "Cairo"],
  [500, "Cairo Medium"],
  [600, "Cairo SemiBold"],
  [700, "Cairo Bold"],
  [800, "Cairo ExtraBold"],
  [900, "Cairo Black"],
  ["700", "Cairo Bold"], // numeric string from getComputedStyle
  [650, "Cairo Bold"], // 650 rounds half-up to 700
  [1000, "Cairo Black"], // clamped to 900
];
for (const [w, expected] of cases) {
  ck(`(${w}) → "${weightedTypeface("Cairo", w)}"`, weightedTypeface("Cairo", w) === expected);
}
ck(`normalizeWeight(650) === 700`, normalizeWeight(650) === 700);
ck(`multi-word base: ("Noto Sans Arabic", 600) → "Noto Sans Arabic SemiBold"`,
  weightedTypeface("Noto Sans Arabic", 600) === "Noto Sans Arabic SemiBold");

// ── 1b. parser reads EVERY weight off the CSS, picks the Arabic subset ──
// Mirrors Google css2's real shape: per weight, blocks emit in order
// arabic → latin-ext → latin (Arabic first), so first-per-weight dedup grabs
// the Arabic woff2. A variable-range block (`font-weight: 200 1000;`) must be
// skipped (the parser only embeds discrete static weights).
console.log("\nextractFontSourcesByWeight:");
function subsetBlock(subset: string, weight: number) {
  return (
    `/* ${subset} */\n@font-face {\n  font-family: 'Cairo';\n  font-style: normal;\n` +
    `  font-weight: ${weight};\n  font-display: swap;\n` +
    `  src: url(https://fonts.gstatic.com/s/cairo/${subset}-${weight}.woff2) format('woff2');\n` +
    `  unicode-range: U+0600-06FF;\n}`
  );
}
const sampleCss =
  [400, 600, 700]
    .flatMap((w) => ["arabic", "latin-ext", "latin"].map((s) => subsetBlock(s, w)))
    .join("\n") +
  // a variable-range block that must NOT be read as a discrete weight
  `\n/* arabic */\n@font-face {\n  font-family: 'Cairo';\n  font-weight: 200 1000;\n` +
  `  src: url(https://fonts.gstatic.com/s/cairo/variable.woff2) format('woff2');\n}`;
const parsed = extractFontSourcesByWeight(sampleCss);
ck(`reads exactly 3 discrete weights`, parsed.length === 3);
ck(`weights are [400,600,700]`,
  parsed.map((p) => p.weight).join(",") === "400,600,700");
ck(`picks the ARABIC-subset woff2 per weight (not latin)`,
  parsed.every((p) => p.src.url.includes(`arabic-${p.weight}.woff2`)));
ck(`skips the variable-range (200 1000) block`,
  !parsed.some((p) => p.src.url.includes("variable.woff2")));

// ── 2. splice: one named <p:embeddedFont> per weight, regular slot only ─
async function main() {
console.log("\nembedConvertedFontsInPptx:");
const eot = Buffer.from("EOTDUMMY").toString("base64");
const presentation =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
  `<p:sldIdLst/><p:defaultTextStyle/></p:presentation>`;
const rels =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;
const cts =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`;

const srcZip = new JSZip();
srcZip.file("ppt/presentation.xml", presentation);
srcZip.file("ppt/_rels/presentation.xml.rels", rels);
srcZip.file("[Content_Types].xml", cts);
const srcBlob = (await srcZip.generateAsync({ type: "blob" })) as Blob;

const converted = [
  {
    name: "Cairo",
    files: [
      { weight: 400, eotBase64: eot },
      { weight: 600, eotBase64: eot },
      { weight: 700, eotBase64: eot },
      { weight: 900, eotBase64: eot },
    ],
  },
  // Heading + body both "Cairo" at 400 must dedup to one "Cairo" entry.
  { name: "Cairo", files: [{ weight: 400, eotBase64: eot }] },
];

const outBlob = await embedConvertedFontsInPptx(
  srcBlob,
  converted,
  JSZip,
  { attempted: 0, embedded: 0, failed: 0 },
);
const outZip = await JSZip.loadAsync(await outBlob.arrayBuffer());
const outPres = await outZip.file("ppt/presentation.xml")!.async("string");
const doc = new jsdom.window.DOMParser().parseFromString(outPres, "application/xml");
const fonts = Array.from(doc.getElementsByTagName("p:embeddedFont"));
const typefaces = fonts.map(
  (f) => f.getElementsByTagName("p:font")[0]?.getAttribute("typeface"),
);

ck(`4 distinct weight entries (deduped)`, fonts.length === 4);
for (const expected of ["Cairo", "Cairo SemiBold", "Cairo Bold", "Cairo Black"]) {
  ck(`has <p:embeddedFont typeface="${expected}">`, typefaces.includes(expected));
}
ck(`every entry has a <p:regular> slot`,
  fonts.every((f) => f.getElementsByTagName("p:regular").length === 1));
ck(`NO entry has a <p:bold> slot (the bug)`,
  fonts.every((f) => f.getElementsByTagName("p:bold").length === 0));
ck(`embeddedFontLst inserted before <p:defaultTextStyle>`,
  /<p:embeddedFontLst>[\s\S]*<\/p:embeddedFontLst><p:defaultTextStyle\/>/.test(outPres));
ck(`saveSubsetFonts + embedTrueTypeFonts set`,
  /saveSubsetFonts="true"/.test(outPres) && /embedTrueTypeFonts="true"/.test(outPres));
}

main().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
