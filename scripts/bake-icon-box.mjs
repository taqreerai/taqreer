// One-off: bake the FULL logo box (our white e-bars mark centered in a dark
// rounded tile with a muted hairline border) to a single transparent PNG.
// Baking the box + mark together means it's an image, so email dark-mode
// "flips" can't invert it to white-on-white (the icon-white.png on an HTML
// tile vanished when the tile flipped). Resend-style: one PNG for the logo.
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const svg = fs.readFileSync(
  path.join(__dirname, "..", "public", "icon-white.svg"),
  "utf8",
);
const out = path.join(__dirname, "..", "public", "email", "icon-box.png");

// 62x62 tile (matches the email): #0A0A0A fill, 1px rgba(255,255,255,.1)
// border, 16px radius, the 30x30 white mark centered. Transparent corners.
const html = `<!doctype html><html><body style="margin:0">
<div id="a" style="width:62px;height:62px;box-sizing:border-box;background:#0A0A0A;border:1px solid rgba(255,255,255,0.10);border-radius:16px;display:flex;align-items:center;justify-content:center;">
  <div style="width:30px;height:30px;line-height:0;">${svg.replace("<svg ", '<svg width="30" height="30" ')}</div>
</div>
</body></html>`;

const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 80, height: 80, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: "networkidle0" });
await (await page.$("#a")).screenshot({ path: out, omitBackground: true });
await browser.close();
console.log("baked", out);
