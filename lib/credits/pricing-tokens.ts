// Fill {credits}/{slides}/{model} tokens in a pricing dict string with live
// config numbers. Latin numerals + thousands grouping (brand rule: "2,000", not
// Arabic digits). Pure + client-safe, so PricingTiers (marketing) and
// BillingSection (in-app) share it. A token with no value provided is left
// intact, so callers must always pass the relevant value for a surface that
// shows it. {model} is the generation-model name (a preset LABEL, e.g.
// "Opus 4.8") and stays Latin in both locales, like the brand name.
export function fillPricingTokens(
  text: string,
  vals: {
    credits?: number | null;
    slides?: number | null;
    model?: string | null;
    // {levels}: the tier's model families ("Sonnet / Opus") as design-level
    // names ("Basic and Advanced"), joined with the dictionary's separators.
    levels?: { names: Record<string, string>; sep: string; lastSep: string } | null;
  },
): string {
  let out = text;
  if (vals.model && vals.levels && (out.includes("{levels}") || out.includes("{topLevel}"))) {
    const names = [
      ...new Set(
        vals.model
          .split("/")
          .map((f) => vals.levels!.names[f.trim().toLowerCase()])
          .filter((n): n is string => !!n),
      ),
    ];
    const joined =
      names.length <= 1
        ? (names[0] ?? vals.model)
        : names.slice(0, -1).join(vals.levels.sep) + vals.levels.lastSep + names[names.length - 1];
    out = out.replaceAll("{levels}", joined);
    // {topLevel}: only the highest level (the English card, where the full
    // list overflows the Max card).
    out = out.replaceAll("{topLevel}", names[names.length - 1] ?? vals.model);
  }
  if (vals.credits != null) {
    out = out.replaceAll("{credits}", vals.credits.toLocaleString("en-US"));
  }
  if (vals.model) {
    out = out.replaceAll("{model}", vals.model);
  }
  if (vals.slides != null) {
    out = out.replaceAll("{slides}", vals.slides.toLocaleString("en-US"));
    // Arabic counted-noun agreement (تمييز العدد): 3-10 take the plural شرائح,
    // 11+ the singular accusative شريحة. English pluralizes "slides" the same
    // for every value, so the EN template fixes its noun and only the Arabic
    // slide-cap string carries this {slidesNoun} token.
    out = out.replaceAll(
      "{slidesNoun}",
      vals.slides >= 3 && vals.slides <= 10 ? "شرائح" : "شريحة",
    );
  }
  return out;
}

/**
 * The yearly-billing discount % implied by the ACTUAL prices (monthly vs
 * per-month-when-yearly), so the "Save {pct}%" chip can never drift from
 * what Stripe charges. Uses the largest per-tier discount (uniform today;
 * max keeps the claim honest if they ever diverge). Null when no paid tier
 * has both cadences resolved - callers fall back or hide the chip.
 */
export function yearlyDiscountPct(
  tierPrices:
    | readonly { plan: string; monthly: number; yearly: number }[]
    | undefined,
): number | null {
  let best: number | null = null;
  for (const t of tierPrices ?? []) {
    if (t.monthly > 0 && t.yearly > 0 && t.yearly < t.monthly) {
      const pct = Math.round((1 - t.yearly / t.monthly) * 100);
      if (best === null || pct > best) best = pct;
    }
  }
  return best;
}

// Per-tier display values shipped to the cards. `credits` is the free tier's
// signup grant or a paid tier's monthly allotment; `slides` is the per-tier cap;
// `model` is the LABEL of the top preset that tier unlocks, so the advertised
// generation model tracks admin Settings instead of a hardcoded dict literal.
// Plan-keyed so consumers look up by plan, not array position.
export type TierDisplayNumber = {
  plan: string;
  credits: number;
  slides: number;
  model: string;
};

/**
 * The label of the highest preset a tier unlocks: the LAST active entry of
 * `ladder` (ascending sortOrder) whose key the tier unlocks. That is what the
 * tier is really selling, so it is the name the pricing card should advertise.
 * Returns null when nothing resolves; callers must supply their own fallback
 * so a card never renders a raw {model} token.
 */
export function topUnlockedPresetLabel(
  ladder: readonly { key: string; label: string; active: boolean }[],
  unlockedKeys: readonly string[],
): string | null {
  let best: string | null = null;
  for (const p of ladder) {
    if (p.active && unlockedKeys.includes(p.key)) best = p.label;
  }
  return best;
}

// Model families in the order a card lists them (cheapest first).
const MODEL_FAMILY_ORDER = ["haiku", "sonnet", "opus", "fable"];

/** "Opus 5.5" -> "Opus": the family name, so a card never goes stale on a version bump. */
export function modelFamilyName(label: string): string {
  return label.replace(/\s*v?\d+(?:\.\d+)*\s*$/i, "").trim() || label;
}

/**
 * The model FAMILIES a tier offers, for the card's model line ("Sonnet / Opus /
 * Fable"): the distinct families of every ACTIVE preset the tier unlocks, ordered
 * cheapest first. `alsoKeyPrefix` adds active presets outside the tier's unlock
 * list (the Free card advertises Haiku, which region-limited free accounts run).
 * Null when nothing resolves; callers supply their own fallback.
 */
export function unlockedModelNames(
  ladder: readonly { key: string; label: string; active: boolean }[],
  unlockedKeys: readonly string[],
  alsoKeyPrefix?: string,
): string | null {
  const families: string[] = [];
  for (const p of ladder) {
    if (!p.active) continue;
    const included =
      unlockedKeys.includes(p.key) ||
      (!!alsoKeyPrefix && p.key.startsWith(alsoKeyPrefix));
    if (!included) continue;
    const name = modelFamilyName(p.label);
    if (!families.includes(name)) families.push(name);
  }
  if (families.length === 0) return null;
  const rank = (n: string) => {
    const i = MODEL_FAMILY_ORDER.indexOf(n.toLowerCase());
    return i === -1 ? MODEL_FAMILY_ORDER.length : i;
  };
  return [...families].sort((a, b) => rank(a) - rank(b)).join(" / ");
}

/** Look up a tier's display numbers by plan, tolerating an absent list. */
export function tierNumberFor(
  list: readonly TierDisplayNumber[] | undefined,
  plan: string,
): TierDisplayNumber | undefined {
  return list?.find((t) => t.plan === plan);
}
