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

// Education levels (2026-10-26): a second chip row under "Education" narrows
// the education looks by audience. A style can sit in several levels.
export const EDU_LEVELS = ["kg", "primary", "middle", "high", "university", "educators"] as const;
export type EduLevel = (typeof EDU_LEVELS)[number];

type DeckStyle = {
  key: string;
  label: string;
  photos: boolean;
  sectors: readonly StyleSector[];
  levels?: readonly EduLevel[];
};

export const DECK_STYLES = [
  { key: "swiss", label: "Swiss / Grid", photos: false, sectors: ["creative", "tech", "business"] },
  { key: "corporate", label: "Corporate / Data", photos: false, sectors: ["business", "government"] },
  { key: "minimal", label: "Minimal / Keynote", photos: true, sectors: ["business", "marketing", "tech"] },
  { key: "editorial", label: "Editorial", photos: true, sectors: ["culture", "creative", "marketing"] },
  { key: "bold", label: "Bold / Display", photos: false, sectors: ["marketing", "creative"] },
  { key: "duotone", label: "Duotone / Full-bleed", photos: true, sectors: ["marketing", "lifestyle", "culture"] },
  { key: "playful", label: "Playful / Dopamine", photos: true, sectors: ["education", "marketing", "lifestyle"], levels: ["kg", "primary"] },
  { key: "brutalist", label: "Brutalist", photos: false, sectors: ["creative", "tech"] },
  { key: "classroom", label: "Classroom / Academic", photos: false, sectors: ["education"], levels: ["primary", "middle", "high", "educators"] },
  { key: "earlyyears", label: "Early Years / KG", photos: false, sectors: ["education"], levels: ["kg"] },
  { key: "primary", label: "Primary School", photos: false, sectors: ["education"], levels: ["primary"] },
  { key: "middleschool", label: "Middle School", photos: false, sectors: ["education"], levels: ["middle"] },
  { key: "highschool", label: "High School", photos: false, sectors: ["education"], levels: ["high"] },
  { key: "university", label: "University Lecture", photos: false, sectors: ["education"], levels: ["university"] },
  { key: "official", label: "Official / Government", photos: false, sectors: ["government", "business"] },
  { key: "heritage", label: "Heritage / Geometric", photos: false, sectors: ["culture", "government"] },
  { key: "luxury", label: "Luxury / Dark", photos: false, sectors: ["lifestyle", "marketing"] },
  { key: "techglass", label: "Tech / Glass", photos: false, sectors: ["tech"] },
  { key: "startup", label: "Startup / Modern", photos: false, sectors: ["business", "tech"] },
  { key: "infographic", label: "Infographic / Icons", photos: false, sectors: ["education", "business", "government"], levels: ["middle", "high", "university", "educators"] },
  { key: "sketch", label: "Hand-drawn / Sketch", photos: false, sectors: ["education", "creative"], levels: ["primary", "middle"] },
  { key: "organic", label: "Organic / Nature", photos: true, sectors: ["lifestyle"] },
  { key: "retro", label: "Retro / Vintage", photos: false, sectors: ["creative", "lifestyle"] },
  { key: "collage", label: "Collage / Scrapbook", photos: true, sectors: ["creative", "lifestyle", "education"], levels: ["middle", "high"] },
  { key: "whiteboard", label: "Whiteboard / Sticky Notes", photos: false, sectors: ["business", "tech", "education", "creative"], levels: ["high", "university", "educators"] },
  // 2026-10-26: 35 more looks (20 general and expressive, 15 education).
  { key: "fintech", label: "Fintech / Ledger", photos: false, sectors: ["business", "tech"] },
  { key: "clinical", label: "Clinical Clean", photos: false, sectors: ["lifestyle", "business"] },
  { key: "architectural", label: "Architectural", photos: true, sectors: ["business", "lifestyle"] },
  { key: "annualreport", label: "Annual Report", photos: true, sectors: ["business", "government"] },
  { key: "mihrab", label: "Mihrab / Arch", photos: false, sectors: ["culture", "government"] },
  { key: "festive", label: "Festive / Occasion", photos: false, sectors: ["culture", "lifestyle"] },
  { key: "impact", label: "Impact Story", photos: true, sectors: ["culture", "education"], levels: ["high", "university"] },
  { key: "legal", label: "Legal / Brief", photos: false, sectors: ["government", "business"] },
  { key: "magazine", label: "Magazine Cover", photos: true, sectors: ["marketing", "lifestyle"] },
  { key: "lookbook", label: "Fashion Lookbook", photos: true, sectors: ["lifestyle", "creative"] },
  { key: "risograph", label: "Risograph", photos: false, sectors: ["creative", "culture"] },
  { key: "menu", label: "Menu Card", photos: true, sectors: ["lifestyle", "marketing"] },
  { key: "blueprint", label: "Blueprint", photos: false, sectors: ["tech", "business"] },
  { key: "techreport", label: "Technical Report", photos: false, sectors: ["government", "education", "tech"], levels: ["university"] },
  { key: "command", label: "Command Center", photos: false, sectors: ["tech", "business", "government"] },
  { key: "journey", label: "Journey Map", photos: false, sectors: ["business", "education"], levels: ["high", "university", "educators"] },
  { key: "pastel", label: "Soft Pastel UI", photos: false, sectors: ["lifestyle", "marketing", "tech"] },
  { key: "papercut", label: "Paper Cut", photos: false, sectors: ["creative", "education"], levels: ["kg", "primary"] },
  { key: "aurora", label: "Aurora", photos: false, sectors: ["marketing", "tech"] },
  { key: "sports", label: "Sports / Energy", photos: true, sectors: ["marketing", "lifestyle"] },
  { key: "storybook", label: "Storybook", photos: false, sectors: ["education"], levels: ["kg"] },
  { key: "felt", label: "Felt & Craft", photos: false, sectors: ["education"], levels: ["kg", "primary"] },
  { key: "chalkboard", label: "Chalkboard", photos: false, sectors: ["education"], levels: ["primary", "middle"] },
  { key: "gamequest", label: "Game Quest", photos: false, sectors: ["education", "marketing"], levels: ["primary", "middle"] },
  { key: "mathgrid", label: "Math Grid", photos: false, sectors: ["education"], levels: ["primary", "middle", "high"] },
  { key: "sciencelab", label: "Science Lab", photos: false, sectors: ["education"], levels: ["middle", "high"] },
  { key: "comic", label: "Comic Panels", photos: false, sectors: ["education", "creative"], levels: ["primary", "middle", "high"] },
  { key: "cornell", label: "Cornell Notes", photos: false, sectors: ["education"], levels: ["high", "university"] },
  { key: "flashcard", label: "Flashcard Revision", photos: false, sectors: ["education"], levels: ["middle", "high", "university"] },
  { key: "posterfair", label: "Poster Fair", photos: true, sectors: ["education"], levels: ["middle", "high", "university"] },
  { key: "thesis", label: "Thesis Defense", photos: false, sectors: ["education"], levels: ["university"] },
  { key: "casestudy", label: "Case Study / Seminar", photos: true, sectors: ["education", "business"], levels: ["university", "educators"] },
  { key: "workshop", label: "Teacher Workshop", photos: false, sectors: ["education", "business"], levels: ["educators"] },
  { key: "languagelab", label: "Language Lab", photos: false, sectors: ["education"], levels: ["primary", "middle", "high", "educators"] },
  { key: "schoolreport", label: "School Report", photos: true, sectors: ["education", "government"], levels: ["educators"] },
] as const satisfies readonly DeckStyle[];

export type DeckStyleKey = (typeof DECK_STYLES)[number]["key"];
