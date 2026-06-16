-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "featuredOrder" INTEGER;

-- CreateIndex
CREATE INDEX "Template_featuredOrder_idx" ON "Template"("featuredOrder");

-- Cutover backfill: feature all of the curator account's CURRENT public
-- templates, preserving the existing landing order (publishedAt DESC), so the
-- landing marquee/grid and welcome-email strip are unchanged at deploy. The
-- admin then curates (feature/unfeature/reorder) from this baseline. Only the
-- curator's templates get a featuredOrder, matching the curator-only policy.
WITH ranked AS (
  SELECT t.id,
         (ROW_NUMBER() OVER (
            ORDER BY t."publishedAt" DESC NULLS LAST, t."createdAt" DESC
          ) - 1) AS ord
  FROM "Template" t
  JOIN "User" u ON u.id = t."ownerId"
  WHERE u.email = 'dev@taqreer.ai' AND t."isPublic" = true
)
UPDATE "Template" SET "featuredOrder" = ranked.ord
FROM ranked
WHERE "Template".id = ranked.id;
