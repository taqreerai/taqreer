-- Brings `Project.colorTags` in line with the Prisma model
-- `colorTags String[] @default([])` — a non-null array column with
-- empty-array default.
--
-- Three steps in order so a clean DB rebuild lands at the same
-- final state as our incrementally-patched live one:
--   1. Set the column default to an empty TEXT[]. New inserts get
--      `{}` (matches what Prisma writes when a field is omitted).
--   2. Backfill any existing NULL values to `{}` so the next
--      ALTER ... SET NOT NULL doesn't fail.
--   3. Add the NOT NULL constraint. Matches the non-null contract
--      Prisma derives from the schema.
--
-- Without step 3 (the original committed version) the DB column was
-- still nullable even though the Prisma client treated colorTags
-- as non-null — caught by CR 2026-05-21. The local DB was patched
-- in place; this migration brings clean rebuilds to the same state.
ALTER TABLE "Project" ALTER COLUMN "colorTags" SET DEFAULT ARRAY[]::TEXT[];
UPDATE "Project" SET "colorTags" = ARRAY[]::TEXT[] WHERE "colorTags" IS NULL;
ALTER TABLE "Project" ALTER COLUMN "colorTags" SET NOT NULL;
