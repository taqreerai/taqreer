// One-off: bake the white e-bars mark (icon-white.svg) to a transparent PNG
// for emails (Gmail/Outlook don't render SVG <img>). Sits in the black tile.
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const svg = fs.readFileSync(path.join(__dirname, "..", "public", "icon-white.svg"), "utf8");
const out = path.join(__dirname, "..", "public", "email", "icon-white.png");

const html = `<!doctype html><html><body style="margin:0">
<div id="a" style="width:120px;height:120px;">${svg.replace("<svg ", '<svg width="120" height="120" ')}</div>
</body></html>`;

const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 120, height: 120, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: "networkidle0" });
await (await page.$("#a")).screenshot({ path: out, omitBackground: true });
await browser.close();
console.log("baked", out);
