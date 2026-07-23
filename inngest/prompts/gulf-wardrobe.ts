// Gulf wardrobe spec for the image-prompt layer. Source: the user's
// gulf_wardrobe_spec.md, transcribed verbatim EXCEPT (1) em/en dashes are
// normalized to comma / colon / hyphen (house rule: no em/en dash anywhere in
// the repo) and (2) a short adapter preamble reconciles the spec with our
// attribute-based prompt model (Claude writes image prompts inline as
// data-genimage / data-bg-prompt strings; there is no separate image-prompt
// call). Garment vocabulary and transliterations are kept verbatim - they are
// what steers gpt-image.
//
// This block is injected as a SEPARATE, cache-controlled system block placed
// FIRST (a stable static prefix) whenever a generation is images-mode AND the
// request's region is Gulf/Khaleeji or unknown (see `isGulfImageContext` in
// lib/geo/image-region.ts). Because the text is byte-identical across every
// Gulf image gen, its prompt-cache entry is shared across decks, formats,
// languages, and the generation / regen / freeze-bake calls.

import { isGulfImageContext } from "@/lib/geo/image-region";

// Structural shape of a cache-controlled system text block (assignable to the
// SDK's `system: Array<TextBlockParam>`). Kept local so the helper does not
// depend on the SDK's type namespace export.
type SystemTextBlock = {
  type: "text";
  text: string;
  cache_control: { type: "ephemeral" };
};

export const GULF_WARDROBE_SPEC = `GULF WARDROBE SPEC, image-prompt rules.

HOW TO USE THIS (Taqreer image-prompt layer): you write image prompts inline as data-genimage / data-bg-prompt attribute strings; the system feeds each string to the image model and strips any text/logos server-side. When an image depicts Gulf people, resolve the outfit through this spec, and resolve the ATTIRE REGISTER (section 0.5) FIRST: national dress is ONE register among several, NOT the default for every Gulf person. A job uniform, a creative/tech/startup setting, or a lifestyle/social/sport scene usually means NO national dress; only business, government, institutional, and formal/ceremonial scenes default to it. Whenever you write attire, NAME the exact garments (national dress OR modern clothing), never vague terms like "traditional attire", "Gulf outfit", "Arab dress", or "professional Saudi clothing". When national dress applies, fold ONLY the relevant negatives concisely into that one prompt (do NOT paste the whole negatives block into every attribute), one country block per person, never mixed. This applies ONLY to images that depict Gulf people: abstract, landscape, product, and texture shots, and scenes explicitly set elsewhere or calling for a global cast, are untouched.

0. RESOLUTION ORDER (before writing an image prompt with a person in a Gulf setting)
1. Resolve country from deck context. If the deck is generic "Gulf/GCC" with no country, default to KSA styling if the deck language is Saudi-dialect Arabic, otherwise use the NEUTRAL GULF fallback (section 8).
2. Resolve the ATTIRE REGISTER FIRST (section 0.5). This decides WHETHER national dress applies at all. Do not skip it: national dress is not the default for every person in a Gulf scene, it is one register among several.
3. Resolve gender and age (man / woman / boy / girl).
4. Resolve formality: CASUAL (street, home, lifestyle), PROFESSIONAL (office, business meeting, conference, corporate), FORMAL/CEREMONIAL (National Day, weddings, Eid, royal/VIP, award ceremonies).
5. Resolve season if the scene implies it (winter = darker, heavier fabrics for men in KSA/Kuwait/UAE).
6. Copy the exact garment description from the matching block below into the image prompt. Always name the garments and how they are worn.
7. Fold the relevant global negatives (section 1) plus the country-specific negatives concisely into the prompt (only when national dress applies).
8. Nationals vs expats: this applies ONLY once the register (step 2 / section 0.5) has resolved to NATIONAL DRESS. When it has, a local/national wears their country block and expat colleagues may wear Western business wear (a realistic mixed office in UAE/Qatar/Kuwait/Bahrain). Nationality decides WHICH country block, never THAT national dress is worn: a local electrician, developer, athlete, or cafe customer follows the resolved register (uniform / smart casual / casual), not a country block.

Core rule: national dress is a complete system, not a costume accessory. The robe, the headwear, and the way the headwear is worn must all come from the SAME country block. Never mix blocks.

0.5 ATTIRE REGISTER RESOLUTION (run this BEFORE picking any country block)
National dress signals business, status, and formality in the Gulf. Forcing it onto every scene is its own cultural error: a Saudi scrolling a phone at a cafe is not in a bisht, and an electrician on a ladder is not in a thobe. Resolve the register in this priority order.
Priority 1, JOB UNIFORM OVERRIDES EVERYTHING. If the character has an occupation with functional workwear, the uniform wins over national dress, always:
- Electrician / mechanic / technician / construction / factory worker: "work uniform, a coverall or work shirt and trousers in the trade's color, safety boots, hard hat or cap where relevant." NO thobe, NO headdress with agal.
- Engineer on site: "long-sleeve shirt or company polo, work trousers, high-vis vest, white hard hat." (An office engineer uses the office register.)
- Doctor: "white coat over modest professional clothing, stethoscope." Nurse: scrubs. (A Saudi male doctor MAY wear a thobe under the white coat, that is realistic, but the coat is the defining garment.)
- Chef / kitchen: chef whites. Barista / retail / delivery: branded polo or apron uniform.
- Police / military / security: leave generic ("uniformed officer") unless the user specifies; never invent detailed real insignia.
- Pilot, flight crew, hospitality front desk: their professional uniforms.
Priority 2, SCENE REGISTER (when there is no uniform):
- BUSINESS / PROFESSIONAL / INSTITUTIONAL (corporate office, business meeting, government, banking, law, keynote, teacher in a classroom, executive portrait): the NATIONAL DRESS register. Use the country block's Professional section. A teacher, professor, or manager in a thobe/kandura is correct and expected.
- FORMAL / CEREMONIAL (National Day, Eid, weddings, VIP): the country block's Formal section.
- CREATIVE / TECH / STARTUP / FREELANCE (graphic designer, developer, content creator, marketer, studio, coworking space): SMART CASUAL register by default: "smart casual, a clean shirt or polo or modest knitwear with chinos or dark jeans, sneakers or loafers, no headwear for men." A thobe WITHOUT headwear is an equally correct alternative for a Saudi man in this register, pick one and vary across a deck. Women keep their country's head covering (e.g. the KSA tarha) per their block, the "no headwear" note is for men only.
- LIFESTYLE / SOCIAL / EVERYDAY (social media themes, cafes, malls, gyms, home, friends, students on campus, someone using a phone or laptop casually): CASUAL register: modern casual clothing (t-shirt or polo or hoodie, jeans or chinos, sneakers), styled modestly. Gulf-casual grooming and styling keep it locally believable without any national dress. National dress is OPTIONAL here, use it for at most one person in a group shot for local flavor, never the whole cast.
- SPORT / FITNESS: men wear athletic wear. Women in KSA: modest sportswear with a sports hijab and full coverage; outdoor or public scenes REQUIRE a sporty abaya-style outer layer over it (consistent with the abaya-always rule below), omit it only in private or women-only settings.
Women across registers:
- KSA, ALL public scenes, every NON-UNIFORM register (business, creative, tech, lifestyle, cafe, mall, campus, social media): the abaya is ALWAYS worn. The register changes the STYLING of the abaya, never its presence: business = a closed black or dark abaya + tarha per the KSA block; casual/creative/lifestyle = "a loose closed abaya in black or a muted tone, relaxed everyday styling, black tarha covering her hair, casual flats or clean sneakers, a handbag or phone in hand." Hair covered by the tarha in all public renders. Only private home/family scenes drop the abaya, and decks essentially never need those.
- KSA women in a functional JOB UNIFORM (Priority 1) are the exception: a doctor, nurse, lab or factory worker wears the clinical or safety uniform (white coat, scrubs, coverall) with modest full coverage and a hijab or headscarf, NOT an abaya layered over an incompatible uniform. The abaya-always rule governs only non-uniform public scenes.
- Other countries: apply the register logic on top of their women's blocks (Kuwait and Bahrain allow more variation per their sections; Qatar and UAE default to abaya + shayla in public).
Rule of thumb: ask "what is this slide actually about?" The attire follows the TOPIC and the CHARACTER'S ROLE, not the country. Country decides HOW national dress looks WHEN it applies, it does not decide THAT it applies.

1. GLOBAL NEGATIVE CONSTRAINTS (fold the relevant ones into any prompt with Gulf national dress)
- No Western suit jacket, blazer, sport coat, waistcoat, or necktie worn over or under a thobe, kandura, or dishdasha. The robe is the complete professional garment on its own.
- No shemagh or ghutra paired with a Western business suit. If the character wears a suit, he wears no Gulf headwear at all.
- Headwear sits ON THE HEAD, draped over it, never around the neck like a scarf, never on the shoulders only, never as a sash.
- The agal (black double cord) sits flat on top of the ghutra/shemagh on the crown of the head, level, not tilted like a hat brim. Never on the bare head without the cloth underneath.
- No agal in Oman. Ever.
- The robe is ankle-length, clean, and pressed. Trousers are not visible below it. Shoes: leather sandals (na'al) or clean dress loafers, never sneakers with formal national dress, never bare feet.
- No mixing of country signatures (e.g. Emirati tarboosh tassel on a Saudi collared thobe, Omani kuma cap with an agal, Qatari cobra ghutra on a Kuwaiti dishdasha).
- Women: no niqab, battoulah (face mask), or gloves unless the user explicitly requests them. Default face is visible.
- Hijab/shayla, when worn, covers the hair and is neatly wrapped, not a loose scarf hanging off the back of the head with the full hairline exposed, and not covering the face.
- Young girls (pre-teen): no headscarf by default.
- No turbans styled like South Asian pagri, no keffiyeh styled like Levantine/Palestinian wrap (different drape and context), no jambiya daggers outside explicitly Omani ceremonial scenes.
- Avoid orientalist cliches: no scimitars, no belly-dance styling, no "desert nomad" rags in modern business contexts.

2. SAUDI ARABIA (KSA)
Men, Professional (offices, meetings, government, corporate):
"A Saudi man in a crisp white thobe, tailored slim fit, ankle-length, with a two-button band collar and buttoned shirt-style cuffs with cufflinks, no side slits. On his head a white ghutra or a red-and-white checkered shemagh draped over the head, held in place by a black agal (double black cord) resting flat on the crown. Leather dress sandals or dark loafers. No jacket, no tie."
- Headwear ON is the professional default for Saudi men (national dress with ghutra/shemagh is the formal workplace standard in KSA). Thobe without headwear = casual/startup contexts only, not the default business render.
- Winter variant: "a dark wool thobe in charcoal grey / navy / brown, same Saudi collar and cuffs" and prefer the red-and-white shemagh.
- Expat men in Saudi offices: formal Western business suit, NO Gulf headwear of any kind.
Men, Casual (pick one, do not blend):
- "White thobe, shemagh draped loosely over the head without an agal, casual leather sandals."
- "White thobe, white taqiyah skullcap only."
- Modern youth casual: "polo shirt or T-shirt with trousers/jeans, sneakers, no headwear", correct for gyms, malls, gaming.
Men, Formal / Ceremonial (weddings, Eid, National Day, VIP, royalty-adjacent):
"White thobe with a sheer bisht cloak over it, black, brown, or cream, edged with gold zari embroidery along the front opening, white ghutra or red-and-white shemagh with black agal, polished appearance."
Women, Professional (DEFAULT, use this):
"A Saudi professional woman in a modest, loose-fitting abaya worn CLOSED, buttoned or zipped down the front, or an over-the-head cut, in black or a muted dark tone, ankle-length, non-transparent, non-tight, fabric flowing loosely over the body. Her hair is fully covered by a black tarha (the Saudi headscarf) draped in the Saudi style, soft folds framing the face, wrapped over the head and falling over the shoulders. Subtle professional makeup, face fully visible, confident posture. Closed-toe modest shoes."
- CRITICAL: the closed abaya IS the outfit as rendered. Do NOT show a styled blouse-and-trousers outfit through an open abaya, that is a UAE fashion-editorial look, not a Saudi office look.
- The head covering is the Saudi tarha, draped with soft volume, NOT the sleek tight-wrapped Emirati shayla style.
- Colors: black is the professional default; deep muted tones (dark grey, deep brown, navy) acceptable. Avoid pastels and fashion colors in business scenes.
- Expat women in Saudi offices: modest Western business wear, long sleeves, high neckline, loose trousers or below-knee skirt, nothing tight or sheer; headscarf optional for expats.
Women, Casual:
"Loose closed abaya in black or a soft muted color with light embroidery detail, tarha covering the hair, stylish handbag, flats." (Casual for a Saudi woman in public still means abaya; only home/family scenes drop it.)
Women, Formal:
"Luxurious embellished closed abaya in rich fabric with fine embroidery, elegantly draped tarha, refined gold jewelry." Heritage/celebration scenes may use a jalabiya (long embroidered gown) in a family setting.
Kids:
- Boys: "a young Saudi boy in a small white thobe with a white taqiyah cap" (occasions: add mini shemagh and agal).
- Girls: "a young Saudi girl in a colorful embroidered jalabiya dress, hair styled naturally, no headscarf."
KSA-specific negatives:
- The Saudi thobe HAS a collar and shirt cuffs, never render it collarless with a hanging tassel (that is Emirati/Omani).
- Never render a Saudi woman's abaya open with a visible fashion outfit underneath in professional scenes; the abaya is closed and IS the garment.
- No tight, fitted, sheer, or body-contouring abayas; the silhouette is loose.
- Never the Emirati sleek shayla wrap on a Saudi woman; use the softer Saudi tarha drape.
- Never default women to niqab (common in reality, but never assume it in imagery; face visible unless requested).
- Saudi men in business scenes are not bareheaded by default; headwear on.

3. UNITED ARAB EMIRATES (UAE)
Men, Professional:
"An Emirati man in a pristine white kandura, collarless with a round neckline, a long loose tarboosh (cord tassel) hanging from the neckline down the chest, subtle matching embroidery at the neckline and sleeve ends, side slits. On his head a white ghutra draped over the head, held by a black agal with thin black tassels hanging down the back. Leather sandals."
- Winter: kandura in beige, grey, or light brown is correct.
- Red-and-white checkered ghutra is also correct, white is the everyday default.
Men, Casual:
- "White kandura with the ghutra wrapped in the hamdaniyya style, the cloth wound around the head like a neat wrap, no agal" (signature young-Emirati casual look).
- Or kandura + white ghutra + agal as usual; or modern casual Western wear for youth scenes.
Men, Formal / Ceremonial:
"White kandura with a bisht cloak (black or camel with gold trim) over it, white ghutra and black agal, dignified posture." Used for weddings, National Day, receiving dignitaries.
Women, Professional:
"An Emirati woman in a flowing black abaya, elegantly tailored with subtle luxury detailing, worn over modest clothing, with a black shayla neatly wrapped over her hair, refined makeup, designer handbag."
- Dubai/Abu Dhabi corporate: open-front modern abaya over a blouse and trousers is very current and correct.
Women, Casual / Home / Gatherings:
"Colorful embroidered jalabiya (loose ornamented gown)" for home and family gatherings; in public, abaya + shayla as above.
Women, Formal:
"Couture-level embellished black abaya with metallic embroidery, silk shayla, statement gold jewelry."
Kids:
- Boys: "a young Emirati boy in a small white kandura with the tarboosh tassel, either bareheaded or with a small white ghutra and agal for occasions."
- Girls: "a young Emirati girl in a bright festive jalabiya dress, no headscarf."
UAE-specific negatives:
- The kandura has NO collar and NO cufflinks. If the render shows a shirt collar, it is wrong.
- The tarboosh tassel hangs center-front from the neckline, it is not a necklace and not a tie.

4. KUWAIT
Men, Professional:
"A Kuwaiti man in a white dishdasha, slim tailored fit in fine lightweight fabric, with a one-button band collar (no full shirt collar, no cufflink cuffs), ankle-length. White ghutra draped over the head, balanced symmetrically over both shoulders, held by a black agal. A white ga7fiya skullcap worn underneath the ghutra. Leather sandals or loafers."
- Winter: "a wool dishdasha in dark grey, brown, or navy, with a red-and-white checkered ghutra", the seasonal switch is a strong Kuwaiti signature.
Men, Casual:
"White dishdasha with only the white ga7fiya skullcap, no ghutra" or dishdasha with ghutra worn relaxed. Youth casual Western wear also correct.
Men, Formal:
"White dishdasha with a bisht (black or beige, gold-trimmed) over it, white ghutra and agal." (Diwaniya gatherings, weddings, national occasions.)
Women, Professional (Kuwait is one of the most style-forward and liberal Gulf societies, two equally correct renders):
- "A Kuwaiti woman in a sophisticated modern abaya in black or muted tones with designer tailoring, shayla neatly over her hair."
- "A Kuwaiti woman in elegant modest Western business attire, tailored blazer over a long-sleeve blouse and trousers, with styled uncovered hair OR a neat hijab." (Uncovered hair is genuinely common among Kuwaiti professional women; do not force hijab in every Kuwaiti scene, vary it.)
Women, Casual / Formal:
Casual: chic abaya or modest contemporary fashion. Formal: "glamorous embellished evening abaya or daraa'a (traditional loose embroidered Kuwaiti gown) for heritage occasions."
Kids:
- Boys: "small white dishdasha with a white ga7fiya cap."
- Girls: "colorful daraa'a-style dress with gold embroidery for occasions; regular modern kidswear otherwise, no headscarf."
Kuwait-specific negatives:
- One-button band collar only: no Saudi-style two-button shirt collar, no Emirati tassel.
- Do not render every Kuwaiti woman in hijab; mix is realistic.

5. BAHRAIN
Men, Professional:
"A Bahraini man in a white thobe with a relaxed, loose fit and a soft shirt-style collar, sometimes with a chest pocket and a visible button placket down the front. White or red-and-white ghutra worn in a relaxed way, draped casually, often falling loosely to the sides or back, with or without a black agal. Leather sandals."
- The relaxed drape of the ghutra is the Bahraini signature; it should look easy, not starched.
Men, Casual:
"White thobe with the ghutra tossed loosely back over the shoulders-and-head or just a skullcap; relaxed, informal energy." Western casual also very common in Bahrain.
Men, Formal:
"White thobe with a gold-trimmed bisht, ghutra and agal worn more neatly than everyday."
Women, Professional (like Kuwait, Bahrain is comparatively liberal, both renders are correct):
- "A Bahraini woman in a refined black or colored abaya with a neatly wrapped shayla."
- "A Bahraini woman in modest professional Western attire, hair uncovered or in hijab."
Women, Formal / Heritage:
"Traditional Bahraini thobe al-nashal, a sheer, wide, richly gold-embroidered overdress, for heritage and wedding contexts; otherwise an embellished evening abaya."
Kids:
- Boys: "small white thobe, bareheaded or small ghutra for occasions."
- Girls: "colorful embroidered dress (bukhnaq-style for heritage scenes), no headscarf."
Bahrain-specific negatives:
- Do not render the Bahraini thobe slim and starched like the Saudi cut; it is looser and softer.
- The loose ghutra without agal is correct in Bahrain, not sloppy.

6. QATAR
Men, Professional:
"A Qatari man in a white thobe made of slightly glossy, crisply starched fabric, with a stiff shirt collar and a button placket extending partway down the chest, a chest pocket, and cufflink cuffs. His white ghutra is starched and shaped in the distinctive Qatari 'cobra' style, a stiff, raised, pointed peak at the front of the head, held by a black agal, sometimes with a thin cord tassel (karkusha) hanging from the agal down the back. Leather sandals or loafers."
- The glossy fabric + cobra ghutra combination is the unmistakable Qatari signature. If either is missing, it reads as generic.
Men, Casual:
"White thobe with the ghutra draped normally (not cobra-styled) or a simple skullcap." Western casual for youth scenes.
Men, Formal:
"Glossy white Qatari thobe with a black or camel gold-trimmed bisht, cobra-styled ghutra and agal." (National Day, weddings, official ceremonies.)
Women, Professional:
"A Qatari woman in an elegantly tailored black abaya, Qatari abayas are known for luxurious fabric (nidha) and refined minimal embellishment, with a black shayla wrapped neatly over her hair, polished professional look."
- Black abaya + shayla is the strong default for Qatari nationals in public and office contexts.
Women, Casual / Formal:
Casual: same abaya system, lighter styling. Formal: "couture embellished abaya with metallic threadwork, silk shayla, fine gold jewelry."
Kids:
- Boys: "small glossy white thobe, bareheaded or with a small ghutra and agal."
- Girls: "bright festive jalabiya dress with embroidery, no headscarf."
Qatar-specific negatives:
- Battoulah (the metallic-look face mask) only for elderly heritage portraits when explicitly requested, never default.
- The cobra ghutra peak points forward and up; it is not a turban and not a hood.

7. OMAN (most distinctive, highest error risk)
Men, Professional / Everyday:
"An Omani man in a dishdasha, a collarless ankle-length robe with a short cord tassel called a furakha hanging at the neckline (traditionally lightly perfumed), in white or a soft color such as lavender, beige, light blue, or brown (colored dishdashas are normal in Oman). On his head an embroidered Omani kuma, a round, brimless, intricately patterned cap. NO agal, NO shemagh. Leather sandals."
- For government, business-formal, and official contexts: replace the kuma with "a massar, a finely wrapped turban of patterned cashmere/pashmina fabric, wound neatly around the head with soft folds." The massar is required dress for Omani government employees.
Men, Casual:
"Colored dishdasha with the embroidered kuma cap", this IS the casual national look. Western casual also fine for youth.
Men, Formal / Ceremonial:
"White dishdasha with a massar turban, a shal (waist sash), and the ceremonial silver khanjar, the curved Omani dagger in an ornate silver sheath, worn at the front of the waist. For the highest formality, a black or camel bisht with gold trim over the dishdasha."
- The khanjar appears ONLY in explicitly ceremonial/heritage/national-pride scenes, never in an office.
Women, Professional (urban):
"An Omani woman in a graceful abaya, often with colorful Omani embroidery accents, and a neatly wrapped shayla (in Oman often called lihaf), modest and elegant."
Women, Traditional / Heritage scenes:
"Traditional Omani dress: a brightly colored, richly embroidered knee-to-ankle tunic worn over matching sirwal trousers gathered at the ankle, with a vividly patterned headscarf (waqaya/lihaf), colors like fuchsia, gold, emerald, and turquoise are authentic." Regional styles vary; keep it colorful and layered.
Women, Formal:
"Luxurious embroidered Omani gown with silver jewelry (Oman is famous for silver, not only gold)."
Kids:
- Boys: "a young Omani boy in a small colored dishdasha with a mini embroidered kuma cap."
- Girls: "a young Omani girl in a bright traditional embroidered dress with sirwal trousers, no headscarf."
Oman-specific negatives (critical):
- NEVER an agal in Oman. NEVER a shemagh/ghutra draped Saudi-style. Omani headwear is only the kuma cap or the massar turban.
- The Omani dishdasha is collarless; no shirt collar, no cufflinks.
- The furakha tassel is short and sits near the neckline, not the long center tarboosh of the UAE.

8. NEUTRAL GULF FALLBACK (country unknown)
When the deck is pan-GCC and no single country can be inferred, avoid strong national signatures that would misfire:
"A Gulf Arab businessman in a plain white ankle-length thobe with a simple band collar, a white ghutra draped over the head with a black agal, leather sandals", the white-on-white combination is the safest cross-Gulf professional render. For women: "an elegant black abaya with a neatly wrapped black shayla."
Never use the Qatari cobra style, Emirati tarboosh, or Omani kuma/massar in a neutral render, those pin the image to one country.

9. SCENE-LEVEL RULES
- Mixed offices (UAE, Qatar, Kuwait, Bahrain especially): rendering nationals in national dress working alongside expat colleagues in Western business wear is accurate and adds realism. In KSA corporate scenes, a mix of thobes and Western business casual is realistic.
- Conferences/keynotes: the speaker being a national in full national dress (with bisht for high-prestige keynotes) is a strong, correct visual.
- Women's representation: default to confident, professional, visible-face portrayals. Vary hijab presence realistically by country (see Kuwait/Bahrain notes). Never sexualized, never faceless.
- Group shots: every individual must be internally consistent (one full country block per person). A group may contain different nationalities, each correctly dressed.
- Seasons: if the slide implies winter (December-February), switch KSA/Kuwait/UAE men to darker wool robes and prefer red-checkered headwear in KSA/Kuwait.
- Grooming: modern Gulf professionals, neat short beard or clean-shaven, contemporary glasses/watches are fine and add realism. Avoid the "long beard + weathered face" stereotype for business contexts.

10. PROMPT ASSEMBLY
[Scene/composition] + [exact garment description copied from the country block] + [action/pose] + [environment] + [lighting/style] + [the relevant global + country negatives, folded in concisely].
Example, before (bad): "Professional Saudi businessman presenting in a modern office, photorealistic."
Example, after (good): "A confident Saudi executive in his 30s presenting to colleagues in a modern Riyadh office. He wears a crisp white tailored thobe with a two-button band collar and cufflink cuffs, a white ghutra draped over his head held by a black agal resting flat on the crown, leather loafers. Floor-to-ceiling windows, warm natural light, photorealistic corporate photography. He does NOT wear a suit jacket, blazer, or tie; the headwear is on his head, not his neck or shoulders; no Emirati tassel, no Qatari cobra styling."
Example, KSA mixed meeting (good, compressed): "Photorealistic Riyadh office meeting. Two Saudi men in tailored white thobes with band collars and cufflinks, ghutra and red-white shemagh draped over their heads with black agals flat on the crown. A Saudi woman presenting in a loose closed black abaya, buttoned to the floor, black tarha softly draped covering her hair, face visible, confident. Riyadh skyline, warm daylight. No suit jackets or ties on thobes, no open abaya showing clothes underneath, headwear on heads."`;

/**
 * Build the Anthropic `system` array for an image-authoring call, prepending the
 * Gulf wardrobe spec as its own cache-controlled block WHEN the generation is
 * images-mode and the region is Gulf/Khaleeji or unknown. The wardrobe block is
 * placed FIRST so it forms a byte-identical static prefix that caches across
 * decks; the caller's existing system text keeps its own breakpoint after it.
 *
 * When the gate does not apply, returns the unchanged single-block array (exact
 * pre-feature behaviour, so non-Gulf and non-image gens are untouched).
 */
export function gulfWardrobeSystemBlocks(
  baseSystemText: string,
  opts: { imagesMode: boolean; imageRegion: string | null | undefined },
): SystemTextBlock[] {
  const base: SystemTextBlock = {
    type: "text",
    text: baseSystemText,
    cache_control: { type: "ephemeral" },
  };
  if (!opts.imagesMode || !isGulfImageContext(opts.imageRegion ?? null)) {
    return [base];
  }
  return [
    {
      type: "text",
      text: GULF_WARDROBE_SPEC,
      cache_control: { type: "ephemeral" },
    },
    base,
  ];
}
