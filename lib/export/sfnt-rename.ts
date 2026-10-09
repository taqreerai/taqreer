// Rename a TrueType/OpenType font by rewriting ONLY its `name` table.
//
// WHY (2026-10-08): PowerPoint binds a run to a font by name, and a font
// INSTALLED on the viewer's machine beats the copy embedded in the .pptx when
// the names match. Proven on the owner's PC: the official Noto release of
// "Noto Sans Arabic" (Arabic + digits, NO Latin letters) is installed, so the
// Regular/Bold runs of an English deck rendered as boxes even though the
// embedded Google build carries full Latin. Giving every embedded weight a
// name no installed font uses (see embedAlias in embed-fonts-client.ts) makes
// PowerPoint always take the embedded bytes.
//
// HOW: every other table is copied byte-for-byte, so the OpenType layout
// tables Arabic shaping needs (GSUB/GPOS/GDEF) survive untouched - unlike
// fonteditor-core's Font.write, which drops them. The family / full / typo
// family names all become `typeface` and the subfamily becomes "Regular",
// matching the one-regular-slot-per-weight embed model. Pure JS, no fontforge,
// so it also runs on local dev.
//
// Returns null for anything it can't safely rewrite (collections, WOFF,
// truncated data); the caller then embeds the original bytes.

// Name IDs replaced: family, subfamily, full name, PostScript name, typographic
// family + subfamily, WWS family + subfamily.
const REPLACED_IDS = new Set([1, 2, 4, 6, 16, 17, 21, 22]);

type NameRecord = {
  platformID: number;
  encodingID: number;
  languageID: number;
  nameID: number;
  bytes: Uint8Array;
};

function utf16be(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    out[i * 2] = c >> 8;
    out[i * 2 + 1] = c & 0xff;
  }
  return out;
}

function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

// Big-endian u32 sum of a table, zero-padded to a 4-byte boundary.
function tableChecksum(bytes: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    const word =
      ((bytes[i] ?? 0) << 24) |
      ((bytes[i + 1] ?? 0) << 16) |
      ((bytes[i + 2] ?? 0) << 8) |
      (bytes[i + 3] ?? 0);
    sum = (sum + (word >>> 0)) >>> 0;
  }
  return sum;
}

function buildNameTable(original: Uint8Array, typeface: string): Uint8Array | null {
  const dv = new DataView(original.buffer, original.byteOffset, original.byteLength);
  if (original.length < 6) return null;
  const count = dv.getUint16(2);
  const storageOffset = dv.getUint16(4);
  if (6 + count * 12 > original.length) return null;

  const records: NameRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    const at = 6 + i * 12;
    const rec = {
      platformID: dv.getUint16(at),
      encodingID: dv.getUint16(at + 2),
      languageID: dv.getUint16(at + 4),
      nameID: dv.getUint16(at + 6),
    };
    // Format-1 language-tag records (languageID >= 0x8000) are dropped: the
    // rebuilt table is format 0, which has no tag list.
    if (REPLACED_IDS.has(rec.nameID) || rec.languageID >= 0x8000) continue;
    const length = dv.getUint16(at + 8);
    const start = storageOffset + dv.getUint16(at + 10);
    if (start + length > original.length) return null;
    records.push({ ...rec, bytes: original.slice(start, start + length) });
  }

  const psName = typeface.replace(/[^A-Za-z0-9-]/g, "").slice(0, 63) || "EmbeddedFont";
  const names: Array<[number, string]> = [
    [1, typeface],
    [2, "Regular"],
    [4, typeface],
    [6, psName],
    [16, typeface],
    [17, "Regular"],
  ];
  for (const [nameID, value] of names) {
    records.push({ platformID: 3, encodingID: 1, languageID: 0x409, nameID, bytes: utf16be(value) });
  }
  // Mac Roman records only when the name is plain ASCII.
  if (/^[\x20-\x7e]*$/.test(typeface)) {
    for (const [nameID, value] of names) {
      if (nameID > 6) continue;
      records.push({ platformID: 1, encodingID: 0, languageID: 0, nameID, bytes: ascii(value) });
    }
  }
  records.sort(
    (a, b) =>
      a.platformID - b.platformID ||
      a.encodingID - b.encodingID ||
      a.languageID - b.languageID ||
      a.nameID - b.nameID,
  );

  const headerSize = 6 + records.length * 12;
  const storageSize = records.reduce((n, r) => n + r.bytes.length, 0);
  const out = new Uint8Array(headerSize + storageSize);
  const ov = new DataView(out.buffer);
  ov.setUint16(0, 0);
  ov.setUint16(2, records.length);
  ov.setUint16(4, headerSize);
  let strAt = 0;
  records.forEach((r, i) => {
    const at = 6 + i * 12;
    ov.setUint16(at, r.platformID);
    ov.setUint16(at + 2, r.encodingID);
    ov.setUint16(at + 4, r.languageID);
    ov.setUint16(at + 6, r.nameID);
    ov.setUint16(at + 8, r.bytes.length);
    ov.setUint16(at + 10, strAt);
    out.set(r.bytes, headerSize + strAt);
    strAt += r.bytes.length;
  });
  return out;
}

export function renameSfnt(font: Uint8Array, typeface: string): Uint8Array | null {
  try {
    if (font.length < 12) return null;
    const dv = new DataView(font.buffer, font.byteOffset, font.byteLength);
    const version = dv.getUint32(0);
    // TrueType (0x00010000 / 'true') or CFF ('OTTO'); not a collection or WOFF.
    if (version !== 0x00010000 && version !== 0x74727565 && version !== 0x4f54544f) return null;
    const numTables = dv.getUint16(4);
    const dirEnd = 12 + numTables * 16;
    if (dirEnd > font.length) return null;

    const tables: Array<{ tag: string; data: Uint8Array }> = [];
    for (let i = 0; i < numTables; i += 1) {
      const at = 12 + i * 16;
      const tag = String.fromCharCode(font[at], font[at + 1], font[at + 2], font[at + 3]);
      const offset = dv.getUint32(at + 8);
      const length = dv.getUint32(at + 12);
      if (offset + length > font.length) return null;
      tables.push({ tag, data: font.slice(offset, offset + length) });
    }
    const name = tables.find((t) => t.tag === "name");
    const head = tables.find((t) => t.tag === "head");
    if (!name || !head || head.data.length < 12) return null;
    const renamed = buildNameTable(name.data, typeface);
    if (!renamed) return null;
    name.data = renamed;
    // checkSumAdjustment is zeroed for the per-table checksum, then set from
    // the whole-file sum below.
    new DataView(head.data.buffer).setUint32(8, 0);

    let size = dirEnd;
    for (const t of tables) size += (t.data.length + 3) & ~3;
    const out = new Uint8Array(size);
    const ov = new DataView(out.buffer);
    out.set(font.slice(0, 12), 0);
    let dataAt = dirEnd;
    tables.forEach((t, i) => {
      const at = 12 + i * 16;
      for (let k = 0; k < 4; k += 1) out[at + k] = t.tag.charCodeAt(k);
      ov.setUint32(at + 4, tableChecksum(t.data));
      ov.setUint32(at + 8, dataAt);
      ov.setUint32(at + 12, t.data.length);
      out.set(t.data, dataAt);
      dataAt += (t.data.length + 3) & ~3;
    });
    const headAt = ov.getUint32(12 + tables.indexOf(head) * 16 + 8);
    ov.setUint32(headAt + 8, (0xb1b0afba - tableChecksum(out)) >>> 0);
    return out;
  } catch {
    return null;
  }
}
