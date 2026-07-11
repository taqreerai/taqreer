-- CreateEnum
CREATE TYPE "TemplateReviewStatus" AS ENUM ('PRIVATE', 'PENDING', 'APPROVED');

-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "reviewStatus" "TemplateReviewStatus" NOT NULL DEFAULT 'PRIVATE';

-- Backfill: everything already live in the community feed (isPublic = true,
-- e.g. the curator's featured templates) is treated as already-approved so it
-- stays visible. Everything else keeps the PRIVATE default. This preserves the
-- isPublic === true  <=>  reviewStatus === APPROVED invariant on existing rows.
UPDATE "Template" SET "reviewStatus" = 'APPROVED' WHERE "isPublic" = true;

-- CreateIndex
CREATE INDEX "Template_reviewStatus_idx" ON "Template"("reviewStatus");
