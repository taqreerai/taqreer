// One-off: bake the brand aurora glow to a PNG for transactional emails.
// Gmail/Outlook drop CSS blur + position, so the production email shells use
// this image as a bottom-anchored background over a solid #111111 cell.
// Rendered at 1200x700 (2x retina; displayed ~600px wide in the email).
import puppeteer from "puppeteer";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dirname, "..", "public", "email", "aurora.png");

const html = `<!doctype html><html><body style="margin:0">
<div id="a" style="width:1200px;height:700px;background:#111111;position:relative;overflow:hidden;">
  <div style="position:absolute;left:-15%;right:-15%;bottom:0;height:72%;filter:blur(128px) saturate(1.3);
    background:
      radial-gradient(60% 100% at 30% 100%, rgba(0,87,255,0.85) 0%, transparent 72%),
      radial-gradient(66% 100% at 60% 100%, rgba(51,128,255,0.80) 0%, transparent 74%),
      radial-gradient(54% 92% at 47% 100%, rgba(0,66,224,0.70) 0%, transparent 70%);"></div>
</div></body></html>`;

const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 700, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "networkidle0" });
await (await page.$("#a")).screenshot({ path: out });
await browser.close();
console.log("baked", out);
