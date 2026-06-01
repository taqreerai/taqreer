// Coverage for the images-mode box helpers (lib/images/slide-images.ts).
//   npx tsx scripts/test-slide-images.ts
// These two pure functions are load-bearing for Phase 2: the server
// reconcile step + the client realtime swap both inject image URLs into
// slide HTML by data-genid, and the deck-images function scans boxes out
// of slide HTML. No network / no Claude — pure string assertions.

import { scanGenImages, injectImgSrc } from "../lib/images/slide-images";

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean) => {
  console.log(`${cond ? "✅" : "❌"} ${label}`);
  if (cond) pass += 1;
  else fail += 1;
};

// 1) Typical box, attrs in prompt order.
const a = `<div style="position:relative"><img data-genimage="a wide shot of a Riyadh skyline at dusk" data-genrole="bg" data-genaspect="landscape" data-genid="img-1" alt="" style="width:100%;height:100%;object-fit:cover;background:linear-gradient(#111,#222);"/><h1>عنوان</h1></div>`;
const sa = scanGenImages(a);
ok("scan finds 1 box", sa.length === 1);
ok("genid", sa[0]?.genid === "img-1");
ok("prompt", sa[0]?.prompt === "a wide shot of a Riyadh skyline at dusk");
ok("role=bg", sa[0]?.role === "bg");
ok("aspect=landscape", sa[0]?.aspect === "landscape");

// 2) Reordered attrs + entities + a '>' inside the prompt value.
const b = `<img data-genid="hero_2" style="object-fit:cover" data-genaspect="portrait" data-genrole="hero" data-genimage="growth &amp; momentum, an arrow pointing up &gt; horizon"/>`;
const sb = scanGenImages(b);
ok("reordered: 1 box", sb.length === 1);
ok("entities decoded + '>' kept", sb[0]?.prompt === "growth & momentum, an arrow pointing up > horizon");
ok("role=hero", sb[0]?.role === "hero");
ok("aspect=portrait", sb[0]?.aspect === "portrait");

// 3) Missing role/aspect → defaults; empty prompt + missing genid skipped.
const c = `<img data-genimage="x" data-genid="g3"/><img data-genimage="" data-genid="g4"/><img data-genimage="no id"/><img src="/logo.svg"/>`;
const sc = scanGenImages(c);
ok("only the valid box (g3) survives", sc.length === 1 && sc[0].genid === "g3");
ok("defaults role=hero aspect=landscape", sc[0]?.role === "hero" && sc[0]?.aspect === "landscape");

// 3b) Unsafe genids (path-traversal / slashes / over-length) are rejected
//     so they can't escape the storage-path prefix; safe ones pass.
const unsafe = `<img data-genimage="p" data-genid="../../evil"/><img data-genimage="p" data-genid="a/b"/><img data-genimage="p" data-genid="ok_id-1.png"/>`;
const su = scanGenImages(unsafe);
ok("only the safe genid survives", su.length === 1 && su[0].genid === "ok_id-1.png");

// 4) Inject src when absent.
const inj1 = injectImgSrc(a, "img-1", "https://cdn.example.com/p/gen/img-1.png");
ok("inject adds src", /<img src="https:\/\/cdn\.example\.com\/p\/gen\/img-1\.png"/.test(inj1));
ok("inject keeps other attrs", inj1.includes('data-genid="img-1"') && inj1.includes("object-fit:cover"));
ok("inject keeps rest of slide", inj1.includes("<h1>عنوان</h1>"));

// 5) Inject replaces an existing src (regenerate case) + escapes &.
const d = `<img data-genid="img-9" src="https://old/x.png" style="x"/>`;
const inj2 = injectImgSrc(d, "img-9", "https://cdn/y.png?a=1&b=2");
ok("replace src value", inj2.includes('src="https://cdn/y.png?a=1&amp;b=2"'));
ok("no double src", (inj2.match(/\bsrc=/g) || []).length === 1);

// 6) Unknown genid → unchanged.
ok("unknown genid no-ops", injectImgSrc(a, "nope", "https://z") === a);

// 7) Two boxes in one slide, inject one leaves the other.
const e = `<img data-genimage="p1" data-genid="x1"/><img data-genimage="p2" data-genid="x2"/>`;
ok("scan 2 boxes", scanGenImages(e).length === 2);
const inj3 = injectImgSrc(e, "x2", "https://u/2.png");
// Extract each <img> tag by its genid and assert on its contents — order-
// independent, so a reversed attribute order (genid before src) can't let a
// stray src on x1 slip past.
const x1Tag = inj3.match(/<img[^>]*\bdata-genid="x1"[^>]*>/)?.[0] ?? "";
const x2Tag = inj3.match(/<img[^>]*\bdata-genid="x2"[^>]*>/)?.[0] ?? "";
ok("inject only x2", x2Tag.includes('src="https://u/2.png"') && !x1Tag.includes("src="));

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
