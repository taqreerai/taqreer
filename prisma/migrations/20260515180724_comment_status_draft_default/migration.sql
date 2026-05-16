-- AlterTable
ALTER TABLE "Comment" ALTER COLUMN "status" SET DEFAULT 'draft';

-- CreateIndex
CREATE INDEX "Comment_presentationId_versionId_status_idx" ON "Comment"("presentationId", "versionId", "status");

-- CreateIndex
CREATE INDEX "Comment_slideId_idx" ON "Comment"("slideId");
