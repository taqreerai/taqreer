// Extra authoring rules for the low-cost Haiku tier (2026-11-05). On its own
// Haiku wrote an outline: a brief that asked to explain 12 topics came back as
// their names in one repeated two-card layout, and one picture in ten slides.
// Enhance is exempt: it rebuilds the user's own slides one to one.

const CONTENT_RULES = `DECK DEPTH (required):
- Every slide after the cover teaches something. A content slide carries its title plus at least two full sentences, or three short points of real explanation: what the idea means, why it matters, and what it looks like in practice. A slide that only names a topic is a failure.
- Do this even when the source is only a list of headings. Expand each heading from general knowledge. Never invent numbers, statistics, names, dates or quotes.
- Explain the topic in general terms. Never state how the user's own organisation works unless the source says so: no invented owners, teams, schedules, tool names, prices or policies, and no table of made-up rows. Write "a good program usually...", not "our program does...".
- Say each thing once. After one overview slide, do not list the same items again. Never add a recap slide of bare numbers or labels. If there are more topics than slides, group related topics on one slide and explain each group.
- The last slide carries real content too: a takeaway, next steps or discussion questions. Never a title alone.
- 40 to 80 words on a content slide, never above 90.
- Use space fully. The content reaches at least three quarters of the way down the slide, so no slide leaves its lower part empty. Short text gets bigger type and taller blocks, never small text at the top.
- Text on a coloured ground is white or near-black. It is never the same colour or a near colour of the ground behind it, including small subtitles.`;

const LAYOUT_RULES = `LAYOUT VARIETY (required):
- Never use the same layout on more than two slides in a row, and never on more than three slides in the deck.
- A deck of 8 or more slides uses at least four clearly different layouts, such as photo beside text, a timeline or steps, comparison columns, an icon grid, a big statement with supporting points.`;

const PICTURE_RULES = `PICTURES (required):
- Put a picture on at least four slides of a ten-slide deck, and in that proportion for other sizes.
- Unless the deck's image style is illustration, cartoon, 3D or flat art, make the pictures real photos: add data-gensource="stock" to each box, or data-bg-source="stock" on a background, with a short ENGLISH search query of 2 to 4 common words. Search for what a stock library really holds ("teacher in classroom", "team planning meeting"), not a detailed scene.
- Each query names the slide's own point: the person, action or thing the slide talks about ("mother reading to child", "glass of water", "family walk in park"). Never only a mood, light or empty room ("quiet room", "soft light", "living room sofa").
- Never use two pictures of the same kind of scene.
- A picture about one specific real person or a named landmark: add data-genname="<exact English Wikipedia title>" (e.g. "Lionel Messi") to its box. Its stock query still shows their world WITHOUT any person ("football stadium night", "golden trophy"), never a stranger standing in for them.`;

const PEOPLE_RULE = "- Prefer people doing the slide's activity over empty rooms.";

// Stock libraries hold few people from these audiences, and a wrong face reads
// worse than a good object (2026-11-06, Saudi school deck).
const audiencePeopleRule = (audience: string) =>
  `- The audience is ${audience}. Search for objects, places, tools and hands at work rather than faces, and never for children; the object or the hands still show the slide's point ("hands holding tea cup", "parent and child hands drawing"), never an empty room. At most two pictures may need people: give those a normal image prompt, not a stock query.`;

// A post is read in a feed, so the deck rules (40 to 80 words a slide, teach on
// every slide) would ruin it. prod 2026-11-05: three cards, three different
// looks, the headline over the bottle, a card with no picture.
const POST_RULES = `POST RULES (required):
- All cards are one design: the same ground, type scale and accent colour.
- One idea per card, at most 25 words.
- Text never sits on the product or the main subject of a photo: put it on an empty part of the picture, or beside it.
- Every card after the first has a picture or a strong graphic, and its content fills the card.
- A picture shows what the post is about, not a loose mood.`;

export function haikuPostRules(imagesOn: boolean, audience?: string | null): string {
  return [POST_RULES, ...(imagesOn && audience ? [audiencePeopleRule(audience)] : [])].join("\n");
}

export function haikuDeckRules(imagesOn: boolean, audience?: string | null): string {
  const pictures = `${PICTURE_RULES}\n${audience ? audiencePeopleRule(audience) : PEOPLE_RULE}`;
  return [CONTENT_RULES, LAYOUT_RULES, ...(imagesOn ? [pictures] : [])].join("\n\n");
}

// Last in the user message. The brief's fidelity line ("never invent or drop
// content") made Haiku leave a list of headings as bare headings; its own
// reasoning said it would not invent facts to fill space.
export const HAIKU_DEPTH_REMINDER = `DECK DEPTH OVERRIDE: when the content above is a list of headings or short notes, "never invent" means no made-up facts, numbers, names or quotes. It does not stop you explaining each topic in general, widely known terms, and you must do so: at least 40 words of real explanation on every slide after the cover. Keep it general: do not describe the user's own organisation unless the content above does. When the user gave full text, keep to their text.

BEFORE WRITING EACH SLIDE, check: body and card text at least 26px, headlines at least 56px; 40 to 80 words; content reaches three quarters of the way down the slide; no text the same colour as its ground.`;
