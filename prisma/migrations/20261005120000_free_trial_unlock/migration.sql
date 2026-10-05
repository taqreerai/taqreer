-- Free trial unlock (2026-10-05, owner decision): free accounts get every
-- creation flow; the only gate is the teaser (5 slides built, the rest locked
-- until they subscribe). The slide cap rises so a free user can ASK for a
-- full-length deck (only the first 5 are built and charged). Data-only.
UPDATE "Tier"
SET "flows" = ARRAY['create', 'enhance', 'mimic', 'datasheet', 'social'],
    "slideCap" = 30
WHERE "plan" = 'free';

-- Bump the config version so every server's in-process tier cache refreshes.
UPDATE "PlatformSettings" SET "configVersion" = "configVersion" + 1 WHERE "id" = 'singleton';
