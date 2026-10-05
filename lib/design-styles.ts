// The deck design styles (client-safe). `label` is the English name AND the
// deck-generate DESIGN_STYLE_DIRECTIVES key (the prompt anchor stored on the
// brief), so never rename one without migrating that map. `key` indexes the
// dictionary (flows.stylePicker.names / descs / info) and the thumbnail.
// `photos` = the look leans on imagery, so picking it switches AI photos on.

export const DECK_STYLES = [
  { key: "swiss", label: "Swiss / Grid", photos: false },
  { key: "corporate", label: "Corporate / Data", photos: false },
  { key: "minimal", label: "Minimal / Keynote", photos: true },
  { key: "editorial", label: "Editorial", photos: true },
  { key: "bold", label: "Bold / Display", photos: false },
  { key: "duotone", label: "Duotone / Full-bleed", photos: true },
  { key: "playful", label: "Playful / Dopamine", photos: true },
  { key: "brutalist", label: "Brutalist", photos: false },
  { key: "classroom", label: "Classroom / Academic", photos: false },
  { key: "official", label: "Official / Government", photos: false },
  { key: "heritage", label: "Heritage / Geometric", photos: false },
  { key: "luxury", label: "Luxury / Dark", photos: false },
  { key: "techglass", label: "Tech / Glass", photos: false },
  { key: "startup", label: "Startup / Modern", photos: false },
  { key: "infographic", label: "Infographic / Icons", photos: false },
  { key: "sketch", label: "Hand-drawn / Sketch", photos: false },
  { key: "organic", label: "Organic / Nature", photos: true },
  { key: "retro", label: "Retro / Vintage", photos: false },
  { key: "collage", label: "Collage / Scrapbook", photos: true },
] as const;

export type DeckStyleKey = (typeof DECK_STYLES)[number]["key"];
