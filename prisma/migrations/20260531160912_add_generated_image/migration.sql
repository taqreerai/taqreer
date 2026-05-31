-- CreateTable
CREATE TABLE "GeneratedImage" (
    "id" TEXT NOT NULL,
    "presentationVersionId" TEXT NOT NULL,
    "slideKey" TEXT NOT NULL,
    "genid" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "aspect" TEXT NOT NULL,
    "size" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "storageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GeneratedImage_presentationVersionId_status_idx" ON "GeneratedImage"("presentationVersionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedImage_presentationVersionId_genid_key" ON "GeneratedImage"("presentationVersionId", "genid");

-- AddForeignKey
ALTER TABLE "GeneratedImage" ADD CONSTRAINT "GeneratedImage_presentationVersionId_fkey" FOREIGN KEY ("presentationVersionId") REFERENCES "PresentationVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
