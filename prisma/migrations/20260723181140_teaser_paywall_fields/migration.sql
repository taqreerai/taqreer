-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "teaserLockedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "teaserUnlockedAt" TIMESTAMP(3);
