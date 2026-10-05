// Free trial (2026-10-05, owner decision): a free account can try EVERY
// feature - all creation flows, all non-premium templates, logo upload, AI
// edits after generation and every export format. The only free-plan gate is
// the teaser (5 slides built, the rest locked until they subscribe; see
// app/api/projects/route.ts), plus the 400 signup credits and the quiet
// watermark. Premium AI models stay paid (tier unlockedPresetKeys).
//
// The per-feature free locks are kept behind this switch rather than deleted,
// so the paid gates can be restored in one place.
export const FREE_PLAN_FEATURE_LOCKS = false;

// AI edits after generation (slide / selection regen in the studio) are paid
// again (owner decision 2026-10-05), independent of the switch above. Retrying
// a FAILED generation stays open to free users (regenerate route).
export const FREE_AI_EDIT_LOCK = true;
