-- AlterTable
ALTER TABLE "LlmUsage" ADD COLUMN     "costMicros" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sourceKey" TEXT,
ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "LlmUsage_projectId_idx" ON "LlmUsage"("projectId");

-- CreateIndex
CREATE INDEX "LlmUsage_sourceKey_idx" ON "LlmUsage"("sourceKey");
