-- CreateTable
CREATE TABLE "ExportEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "format" TEXT NOT NULL,
    "slideCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExportEvent_userId_createdAt_idx" ON "ExportEvent"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ExportEvent_projectId_idx" ON "ExportEvent"("projectId");

-- AddForeignKey
ALTER TABLE "ExportEvent" ADD CONSTRAINT "ExportEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportEvent" ADD CONSTRAINT "ExportEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
