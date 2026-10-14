// The deck design styles (client-safe). `label` is the English name AND the
// deck-generate DESIGN_STYLE_DIRECTIVES key (the prompt anchor stored on the
// brief), so never rename one without migrating that map. `key` indexes the
// dictionary (flows.stylePicker.names / descs / info) and the thumbnail.
// `photos` = the look leans on imagery, so picking it switches AI photos on.
// `sectors` drive the style-filter chips (a style can sit in several).

export const STYLE_SECTORS = [
  "education",
  "business",
  "government",
  "marketing",
  "tech",
  "creative",
  "culture",
  "lifestyle",
] as const;
export type StyleSector = (typeof STYLE_SECTORS)[number];

type DeckStyle = {
  key: string;
  label: string;
  photos: boolean;
  sectors: readonly StyleSector[];
};

export const DECK_STYLES = [
  { key: "swiss", label: "Swiss / Grid", photos: false, sectors: ["creative", "tech", "business"] },
  { key: "corporate", label: "Corporate / Data", photos: false, sectors: ["business", "government"] },
  { key: "minimal", label: "Minimal / Keynote", photos: true, sectors: ["business", "marketing", "tech"] },
  { key: "editorial", label: "Editorial", photos: true, sectors: ["culture", "creative", "marketing"] },
  { key: "bold", label: "Bold / Display", photos: false, sectors: ["marketing", "creative"] },
  { key: "duotone", label: "Duotone / Full-bleed", photos: true, sectors: ["marketing", "lifestyle", "culture"] },
  { key: "playful", label: "Playful / Dopamine", photos: true, sectors: ["education", "marketing", "lifestyle"] },
  { key: "brutalist", label: "Brutalist", photos: false, sectors: ["creative", "tech"] },
  { key: "classroom", label: "Classroom / Academic", photos: false, sectors: ["education"] },
  { key: "earlyyears", label: "Early Years / KG", photos: false, sectors: ["education"] },
  { key: "primary", label: "Primary School", photos: false, sectors: ["education"] },
  { key: "middleschool", label: "Middle School", photos: false, sectors: ["education"] },
  { key: "highschool", label: "High School", photos: false, sectors: ["education"] },
  { key: "university", label: "University Lecture", photos: false, sectors: ["education"] },
  { key: "official", label: "Official / Government", photos: false, sectors: ["government", "business"] },
  { key: "heritage", label: "Heritage / Geometric", photos: false, sectors: ["culture", "government"] },
  { key: "luxury", label: "Luxury / Dark", photos: false, sectors: ["lifestyle", "marketing"] },
  { key: "techglass", label: "Tech / Glass", photos: false, sectors: ["tech"] },
  { key: "startup", label: "Startup / Modern", photos: false, sectors: ["business", "tech"] },
  { key: "infographic", label: "Infographic / Icons", photos: false, sectors: ["education", "business", "government"] },
  { key: "sketch", label: "Hand-drawn / Sketch", photos: false, sectors: ["education", "creative"] },
  { key: "organic", label: "Organic / Nature", photos: true, sectors: ["lifestyle"] },
  { key: "retro", label: "Retro / Vintage", photos: false, sectors: ["creative", "lifestyle"] },
  { key: "collage", label: "Collage / Scrapbook", photos: true, sectors: ["creative", "lifestyle", "education"] },
  { key: "whiteboard", label: "Whiteboard / Sticky Notes", photos: false, sectors: ["business", "tech", "education", "creative"] },
] as const satisfies readonly DeckStyle[];

export type DeckStyleKey = (typeof DECK_STYLES)[number]["key"];
