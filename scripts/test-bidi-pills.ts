// Verifies the PASS-3 UNIFORM-STACK guard in lib/export/bidi-postprocess.ts:
// a styled pill that shares its x+width with sibling pills (a vertical stack,
// e.g. slide-3's problem rows) must NOT be widened even when its own text is
// tight — otherwise it ends up wider than its siblings. A STANDALONE tight
// pill (unique x+width) must still get the slack widen. Run:
//   npx tsx scripts/test-bidi-pills.ts
import { JSDOM } from "jsdom";
import { injectBiDiMarkers, makeStats } from "../lib/export/bidi-postprocess";

const jsdom = new JSDOM("<!DOCTYPE html><html></html>");
// injectBiDiMarkers uses the global DOMParser/XMLSerializer at call time.
const g = globalThis as unknown as {
  DOMParser: unknown;
  XMLSerializer: unknown;
};
g.DOMParser = jsdom.window.DOMParser;
g.XMLSerializer = jsdom.window.XMLSerializer;

const NS = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`;

function pill(id: number, x: number, y: number, cx: number, text: string) {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="381000"/></a:xfrm>` +
    `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 20000"/></a:avLst></a:prstGeom>` +
    `<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln/></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square" lIns="133350" tIns="104775" rIns="133350" bIns="104775" rtlCol="0" anchor="ctr"><a:spAutoFit/></a:bodyPr><a:lstStyle/>` +
    `<a:p><a:pPr algn="r" indent="0" marL="0" rtl="1"><a:lnSpc><a:spcPts val="1350"/></a:lnSpc><a:buNone/></a:pPr>` +
    `<a:r><a:rPr lang="ar-SA" sz="900" b="1" dirty="0"><a:solidFill><a:srgbClr val="030D01"/></a:solidFill><a:latin typeface="Cairo"/></a:rPr><a:t>${text}</a:t></a:r>` +
    `<a:endParaRPr lang="ar-SA" sz="900" dirty="0"/></a:p></p:txBody></p:sp>`
  );
}

// A 2-paragraph text block (heading + muted sub-line). `styled` adds a fill so
// it reads as a badge. Models the slide-2 feature blocks (non-styled).
function block(id: number, x: number, cx: number, heading: string, sub: string, styled: boolean) {
  const fill = styled ? `<a:solidFill><a:srgbClr val="0B1A07"/></a:solidFill>` : "";
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="B${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="700000"/><a:ext cx="${cx}" cy="423862"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}<a:ln/></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="t"><a:spAutoFit/></a:bodyPr><a:lstStyle/>` +
    `<a:p><a:pPr algn="r" indent="0" marL="0" rtl="1"><a:buNone/></a:pPr><a:r><a:rPr lang="ar-SA" sz="1280" b="1"><a:solidFill><a:srgbClr val="0BF446"/></a:solidFill><a:latin typeface="Cairo"/></a:rPr><a:t>${heading}</a:t></a:r></a:p>` +
    `<a:p><a:pPr algn="r" indent="0" marL="0" rtl="1"><a:spcBef><a:spcPts val="300"/></a:spcBef><a:buNone/></a:pPr><a:r><a:rPr lang="ar-SA" sz="750"><a:solidFill><a:srgbClr val="D3E3CA"/></a:solidFill><a:latin typeface="Cairo"/></a:rPr><a:t>${sub}</a:t></a:r></a:p>` +
    `</p:txBody></p:sp>`
  );
}

// 5 stacked pills: same x=4762500, same cx=4000500. Pills 1-4 short text,
// pill 5 long+tight (the slide-3 case). Plus a STANDALONE tight pill with a
// unique x+cx as the control (should still be widened).
const STACK_X = 4762500;
const STACK_CX = 4000500;
const BLOCK_CX = 901256;
const slide =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<p:sld ${NS}><p:cSld><p:spTree>` +
  `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
  pill(2, STACK_X, 1962596, STACK_CX, "تأخر الرد على الاستفسارات.") +
  pill(3, STACK_X, 2429321, STACK_CX, "ضياع العملاء خارج أوقات العمل.") +
  pill(4, STACK_X, 2896046, STACK_CX, "ضعف المتابعة بعد أول تواصل.") +
  pill(5, STACK_X, 3362771, STACK_CX, "ارتفاع نسبة عدم حضور المواعيد.") +
  pill(6, STACK_X, 3829496, STACK_CX, "غياب نظام موحد لإدارة العملاء والحجوزات.") +
  // Control: standalone tight pill, unique x+cx → must widen.
  pill(7, 381000, 700000, 1200000, "إدارة المحتوى") +
  // #1: a NON-styled heading + sub-line block → must widen (heading wraps in
  // PPT otherwise). A STYLED 2-paragraph badge → must NOT widen.
  block(8, 2000000, BLOCK_CX, "الرد الفوري", "على مدار الساعة", false) +
  block(9, 200000, BLOCK_CX, "الحجز التلقائي", "دون تدخل بشري", true) +
  `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;

const out = injectBiDiMarkers(slide, makeStats(), undefined, 9144000);

const doc = new jsdom.window.DOMParser().parseFromString(out, "application/xml");
const sps = Array.from(doc.getElementsByTagName("p:sp"));
function read(id: string) {
  const sp = sps.find(
    (s) => s.getElementsByTagName("p:cNvPr")[0]?.getAttribute("id") === id,
  )!;
  const ext = sp.getElementsByTagName("a:ext")[0];
  const off = sp.getElementsByTagName("a:off")[0];
  const pPr = sp.getElementsByTagName("a:pPr")[0];
  return {
    cx: parseInt(ext.getAttribute("cx") ?? "0", 10),
    x: parseInt(off.getAttribute("x") ?? "0", 10),
    algn: pPr?.getAttribute("algn") ?? "",
  };
}

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

for (const id of ["2", "3", "4", "5", "6"]) {
  const p = read(id);
  ck(`stack pill ${id}: width unchanged (${p.cx} == ${STACK_CX})`, p.cx === STACK_CX);
  ck(`stack pill ${id}: x unchanged (${p.x} == ${STACK_X})`, p.x === STACK_X);
  ck(`stack pill ${id}: stays right-aligned (algn="${p.algn}")`, p.algn === "r");
}
const ctrl = read("7");
ck(`control standalone pill: widened (${ctrl.cx} > 1200000)`, ctrl.cx > 1200000);

const nonStyled = read("8");
ck(`#1 non-styled heading+sub-line block: WIDENED (${nonStyled.cx} > ${BLOCK_CX})`, nonStyled.cx > BLOCK_CX);
const styledBadge = read("9");
ck(`#1 styled 2-line badge: NOT widened (${styledBadge.cx} == ${BLOCK_CX})`, styledBadge.cx === BLOCK_CX);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
