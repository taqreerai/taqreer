-- AlterTable
ALTER TABLE "BrandKit" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "BrandKit_userId_isDefault_idx" ON "BrandKit"("userId", "isDefault");
