-- AlterTable
ALTER TABLE "Presentation" ADD COLUMN     "savedVersionId" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "dominantColor" TEXT,
ADD COLUMN     "isFavorite" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "slideCount" INTEGER,
ADD COLUMN     "thumbnailUrls" TEXT[];

-- CreateTable
CREATE TABLE "SlideState" (
    "id" TEXT NOT NULL,
    "presentationId" TEXT NOT NULL,
    "slideKey" TEXT NOT NULL,
    "currentVersionNumber" INTEGER NOT NULL DEFAULT 1,
    "lockedAt" TIMESTAMP(3),
    "cachedComments" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlideState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlideVersion" (
    "id" TEXT NOT NULL,
    "slideStateId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "slideJson" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'create',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlideVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SlideState_presentationId_slideKey_key" ON "SlideState"("presentationId", "slideKey");

-- CreateIndex
CREATE INDEX "SlideVersion_slideStateId_createdAt_idx" ON "SlideVersion"("slideStateId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "SlideVersion_slideStateId_versionNumber_key" ON "SlideVersion"("slideStateId", "versionNumber");

-- CreateIndex
CREATE INDEX "Project_userId_isFavorite_idx" ON "Project"("userId", "isFavorite");

-- AddForeignKey
ALTER TABLE "SlideState" ADD CONSTRAINT "SlideState_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "Presentation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlideVersion" ADD CONSTRAINT "SlideVersion_slideStateId_fkey" FOREIGN KEY ("slideStateId") REFERENCES "SlideState"("id") ON DELETE CASCADE ON UPDATE CASCADE;
