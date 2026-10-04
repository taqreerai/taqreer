// Curated colour templates (2026-10-02; 48 since 2026-10-04). One list shared by the /create
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
  // 2026-10-04: 36 more (48 total), grouped so most school subjects and deck
  // topics have a fitting option. Contrast-checked: primary vs light surface
  // >= 3:1 and dark ink vs light surface >= 10:1, like the originals above.
  // ── Maths and engineering ──
  {
    id: "chalkboard",
    name: { ar: "سبورة", en: "Chalkboard" },
    colors: ["#2F4F3E", "#C99A1E", "#3F8F8B", "#F4F1E8", "#1B2A22"],
  },
  {
    id: "blueprint",
    name: { ar: "مخطط هندسي", en: "Blueprint" },
    colors: ["#1E4E8C", "#3C8DBC", "#E07A1F", "#EEF4FA", "#0C1E36"],
  },
  // ── Sciences and health ──
  {
    id: "lab",
    name: { ar: "مختبر", en: "Lab" },
    colors: ["#00695C", "#26A69A", "#E39B00", "#EFF8F6", "#0D2B27"],
  },
  {
    id: "chemistry",
    name: { ar: "كيمياء", en: "Chemistry" },
    colors: ["#6A1B9A", "#0097A7", "#9E9D24", "#F6F1FA", "#1F0F2B"],
  },
  {
    id: "physics",
    name: { ar: "فيزياء", en: "Physics" },
    colors: ["#0D47A1", "#E65100", "#78909C", "#F1F5FA", "#0A1A33"],
  },
  {
    id: "biology",
    name: { ar: "أحياء", en: "Biology" },
    colors: ["#2E7D32", "#7CB342", "#8D6E63", "#F3F8EF", "#142A16"],
  },
  {
    id: "space",
    name: { ar: "فضاء", en: "Space" },
    colors: ["#2A1F6B", "#6C4AB6", "#E0A21E", "#EEEDF7", "#0B0820"],
  },
  {
    id: "medical",
    name: { ar: "طبي", en: "Medical" },
    colors: ["#0277BD", "#00A5BC", "#D84343", "#F0F7FB", "#0A2233"],
  },
  {
    id: "wellness",
    name: { ar: "صحة وعافية", en: "Wellness" },
    colors: ["#3F7A5E", "#6FB58C", "#E08A3C", "#F5FAF6", "#17291F"],
  },
  // ── Humanities, languages and religion ──
  {
    id: "heritage",
    name: { ar: "تراث", en: "Heritage" },
    colors: ["#8C2F1B", "#B8834F", "#3E5C76", "#F8F1E5", "#2A1810"],
  },
  {
    id: "manuscript",
    name: { ar: "مخطوطة", en: "Manuscript" },
    colors: ["#5C4033", "#A07C45", "#6F8064", "#F5EEDC", "#231912"],
  },
  {
    id: "islamic",
    name: { ar: "زخارف إسلامية", en: "Islamic art" },
    colors: ["#0F5E4E", "#B8952F", "#1E6F8E", "#F6F3EA", "#0B241E"],
  },
  {
    id: "geography",
    name: { ar: "جغرافيا", en: "Geography" },
    colors: ["#1F6F78", "#C9951F", "#A44A3F", "#F1F6F3", "#10292C"],
  },
  {
    id: "literature",
    name: { ar: "أدب", en: "Literature" },
    colors: ["#4A2C5E", "#B5738A", "#D98A55", "#F8F3F6", "#1E1226"],
  },
  {
    id: "history",
    name: { ar: "تاريخ", en: "History" },
    colors: ["#4E3B2A", "#9C6B30", "#7B2D26", "#F4ECDD", "#1E150D"],
  },
  // ── Kids and early years ──
  {
    id: "playful",
    name: { ar: "مرح", en: "Playful" },
    colors: ["#E04848", "#E8B400", "#3D7FE0", "#FFFBF2", "#2B2B3A"],
  },
  {
    id: "kindergarten",
    name: { ar: "روضة", en: "Kindergarten" },
    colors: ["#D9686A", "#5F8C7E", "#E0A030", "#FFF8F0", "#3A2E2E"],
  },
  // ── Business and technology ──
  {
    id: "corporate",
    name: { ar: "رسمي للشركات", en: "Corporate" },
    colors: ["#1F3A5F", "#3E7CB1", "#E0922A", "#F4F6F9", "#0F1C2E"],
  },
  {
    id: "finance",
    name: { ar: "مالي", en: "Finance" },
    colors: ["#0B3D2E", "#1F8A70", "#9CBF8F", "#F3F7F4", "#06201A"],
  },
  {
    id: "startup",
    name: { ar: "شركة ناشئة", en: "Startup" },
    colors: ["#5B21B6", "#DB2777", "#D97706", "#FAF7FF", "#1A0B33"],
  },
  {
    id: "cyber",
    name: { ar: "أمن سيبراني", en: "Cyber" },
    colors: ["#00897B", "#2563EB", "#E11D48", "#EEF6F6", "#0A1220"],
  },
  {
    id: "ai",
    name: { ar: "ذكاء اصطناعي", en: "AI" },
    colors: ["#4F46E5", "#0891B2", "#9333EA", "#F5F6FE", "#0F0F2A"],
  },
  {
    id: "data",
    name: { ar: "بيانات", en: "Data" },
    colors: ["#2563EB", "#059669", "#D97706", "#F5F8FC", "#0F172A"],
  },
  {
    id: "minimal",
    name: { ar: "بسيط", en: "Minimal" },
    colors: ["#111827", "#6B7280", "#2563EB", "#FAFAFA", "#030712"],
  },
  {
    id: "marketing",
    name: { ar: "تسويق", en: "Marketing" },
    colors: ["#C2185B", "#7B1FA2", "#F57C00", "#FFF6F9", "#2A0E1C"],
  },
  // ── Gulf, nature and seasons ──
  {
    id: "oasis",
    name: { ar: "واحة", en: "Oasis" },
    colors: ["#2D6A4F", "#C9A13B", "#40916C", "#F5F7EE", "#13281E"],
  },
  {
    id: "dates",
    name: { ar: "تمور", en: "Dates" },
    colors: ["#6F3B1F", "#B07A4A", "#C99A2E", "#FAF3E8", "#2A1609"],
  },
  {
    id: "pearl",
    name: { ar: "لؤلؤ وبحر", en: "Pearl & sea" },
    colors: ["#145374", "#3E8DB0", "#C8A979", "#F7F9FA", "#0B2536"],
  },
  {
    id: "spring",
    name: { ar: "ربيع", en: "Spring" },
    colors: ["#3A7D44", "#D9799A", "#D9A82E", "#F9FBF4", "#1C2B1E"],
  },
  {
    id: "autumn",
    name: { ar: "خريف", en: "Autumn" },
    colors: ["#9C3D20", "#C47F04", "#6B705C", "#FAF3E6", "#2A1A10"],
  },
  {
    id: "forest",
    name: { ar: "غابة", en: "Forest" },
    colors: ["#1B4332", "#52A27A", "#9C7656", "#F2F7F3", "#0B1F17"],
  },
  // ── Mood and occasions ──
  {
    id: "luxury",
    name: { ar: "فاخر", en: "Luxury" },
    colors: ["#1A1A1A", "#B0904F", "#7D5A50", "#F7F3EC", "#0A0A0A"],
  },
  {
    id: "pastel",
    name: { ar: "باستيل", en: "Pastel" },
    colors: ["#6D5BD0", "#D9739B", "#4FA88F", "#FBF9FE", "#2C2541"],
  },
  {
    id: "charity",
    name: { ar: "عمل خيري", en: "Charity" },
    colors: ["#1D7874", "#E0893F", "#D35A3F", "#F5FAF9", "#0F2E2D"],
  },
  {
    id: "sport",
    name: { ar: "رياضي", en: "Sport" },
    colors: ["#C00000", "#E0A000", "#2F78B5", "#F7F7F7", "#1A1A1A"],
  },
  {
    id: "art",
    name: { ar: "فنون", en: "Art" },
    colors: ["#B0101C", "#003049", "#E0A93A", "#FDF8F0", "#1B1B1B"],
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
