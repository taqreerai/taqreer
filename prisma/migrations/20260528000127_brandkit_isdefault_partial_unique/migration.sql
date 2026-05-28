-- Enforce "at most one default BrandKit per user" at the DB level.
--
-- The earlier migration (20260527155437) added the `isDefault` column
-- and a non-unique `(userId, isDefault)` index, with app-level
-- transactional logic in `app/api/brand-kits/[id]/default/route.ts`
-- to clear other defaults before flipping. CodeRabbit flagged the
-- transaction as still race-prone under concurrent "set default"
-- calls (Prisma's default isolation level is READ COMMITTED, which
-- allows the two-step UPDATE pattern to interleave and leave the
-- table with multiple defaults). The schema.prisma comment claiming
-- Postgres can't express the constraint was wrong — partial unique
-- indexes do exactly this.
--
-- Step 1 dedupes existing rows so the unique-index creation in step 2
-- doesn't fail on legacy data: for any user with >1 default, keep the
-- most-recently-updated row as the default and demote the rest.
-- Safe to run even if no duplicates exist (the UPDATE matches zero
-- rows).
--
-- Step 2 creates the partial unique index. Subsequent attempts to
-- have two `isDefault = true` rows per `userId` will fail at the DB
-- with a unique-constraint violation, which the API route catches
-- and translates to 409 for the client.

-- Dedupe: keep the most-recent default per user; demote the rest.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "userId"
           ORDER BY "updatedAt" DESC, "id" DESC
         ) AS rn
  FROM "BrandKit"
  WHERE "isDefault" = true
)
UPDATE "BrandKit"
SET "isDefault" = false
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Partial unique index enforces the invariant going forward.
CREATE UNIQUE INDEX "BrandKit_userId_default_unique"
  ON "BrandKit" ("userId")
  WHERE "isDefault" = true;
