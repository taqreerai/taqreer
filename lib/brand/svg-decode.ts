// Decode SVG logo bytes to a clean UTF-8 string, honouring a byte-order mark.
//
// Some design tools (Illustrator, CorelDRAW, a few Windows exporters) save
// SVGs as UTF-16. Read as UTF-8 those bytes become `<\0s\0v\0g…` — every
// `includes("<svg")` guard and colour scan downstream then silently fails,
// which is exactly how a real flag logo got mis-routed (its `readLogoSvgMarkup`
// returned null, so it fell to the hand-copied-URL path and corrupted). Sniff
// the BOM, decode with the matching TextDecoder, and drop the leading BOM
// char. TextDecoder ships in both Node 20+ and the browser, so this is
// client- and server-safe.
export function decodeSvgBytes(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let encoding = "utf-8";
  if (b[0] === 0xff && b[1] === 0xfe) encoding = "utf-16le";
  else if (b[0] === 0xfe && b[1] === 0xff) encoding = "utf-16be";
  // A UTF-8 BOM is stripped by TextDecoder itself; a UTF-16 BOM decodes to a
  // leading U+FEFF, so trim it unconditionally.
  return new TextDecoder(encoding).decode(buf).replace(/^﻿/, "");
}
