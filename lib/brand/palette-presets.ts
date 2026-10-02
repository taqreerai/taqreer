// Curated colour templates (2026-10-02). One list shared by the /create
// Design step (a preset fills the palette Claude designs with) and the studio
// recolor menu (a preset re-skins a finished deck, lib/deck/recolor.ts).
//
// Every preset has the same five ROLES, in this order:
//   [0] primary  [1] secondary  [2] accent  [3] light surface  [4] dark ink
// The order matters: /create sends the array as-is (palette[0] becomes
// var(--primary)), and the recolor maps a deck's light / dark / chromatic
// palette entries onto the matching roles so contrast survives the swap.

export type PalettePreset = {
  id: string;
  name: { ar: string; en: string };
  colors: readonly [string, string, string, string, string];
};

export const PALETTE_PRESETS: readonly PalettePreset[] = [
  {
    id: "royal",
    name: { ar: "كحلي وذهبي", en: "Navy & gold" },
    colors: ["#14304D", "#C9A24B", "#2E6F95", "#F7F2E7", "#0E1A2B"],
  },
  {
    id: "emerald",
    name: { ar: "زمردي", en: "Emerald" },
    colors: ["#0B6E4F", "#C8A951", "#2FA37C", "#F2F5EF", "#0A2A20"],
  },
  {
    id: "desert",
    name: { ar: "رمال الصحراء", en: "Desert sand" },
    colors: ["#B8662B", "#D9A441", "#6B8F71", "#F6EEDF", "#2B1D14"],
  },
  {
    id: "electric",
    name: { ar: "أزرق تقني", en: "Electric blue" },
    colors: ["#0057FF", "#00A3FF", "#7C5CFF", "#F3F6FB", "#0A0F1E"],
  },
  {
    id: "burgundy",
    name: { ar: "عنابي", en: "Burgundy" },
    colors: ["#7A1F2B", "#C9A24B", "#1F4E5F", "#F5EFE3", "#2B1A1C"],
  },
  {
    id: "coral",
    name: { ar: "فيروزي ومرجاني", en: "Teal & coral" },
    colors: ["#0F5257", "#EE6A4C", "#F2B134", "#F4F1EA", "#10292B"],
  },
  {
    id: "ocean",
    name: { ar: "محيط", en: "Ocean" },
    colors: ["#0E4D92", "#2A9D8F", "#E9C46A", "#EEF5F9", "#0B1F33"],
  },
  {
    id: "plum",
    name: { ar: "بنفسجي", en: "Plum" },
    colors: ["#5B3E96", "#E07A9B", "#F2B880", "#F6F2FA", "#1E1630"],
  },
  {
    id: "sunset",
    name: { ar: "غروب", en: "Sunset" },
    colors: ["#D1495B", "#EDAE49", "#00798C", "#FBF6EF", "#2A1B1F"],
  },
  {
    id: "olive",
    name: { ar: "زيتوني وطيني", en: "Olive & clay" },
    colors: ["#5F6F52", "#C2703D", "#A9B388", "#F7F3EA", "#232A1E"],
  },
  {
    id: "graphite",
    name: { ar: "رمادي فحمي", en: "Graphite" },
    colors: ["#262626", "#737373", "#D4A017", "#F5F5F4", "#0A0A0A"],
  },
  {
    id: "rose",
    name: { ar: "وردي دافئ", en: "Warm rose" },
    colors: ["#B23A48", "#F28F3B", "#6C9A8B", "#FCF5F2", "#2D1E22"],
  },
];

export function findPalettePreset(id: string): PalettePreset | null {
  return PALETTE_PRESETS.find((p) => p.id === id) ?? null;
}

/** Case-insensitive palette equality (used to mark the active preset). */
export function samePalette(a: readonly string[], b: readonly string[]): boolean {
  return (
    a.length === b.length &&
    a.every((c, i) => c.toLowerCase() === b[i].toLowerCase())
  );
}
