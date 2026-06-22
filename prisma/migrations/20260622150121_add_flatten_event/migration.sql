-- CreateTable
CREATE TABLE "FlattenEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "slideId" TEXT NOT NULL,
    "parityOk" BOOLEAN NOT NULL,
    "missingCount" INTEGER NOT NULL DEFAULT 0,
    "fidelityScore" DOUBLE PRECISION,
    "leafCount" INTEGER NOT NULL DEFAULT 0,
    "highDrift" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlattenEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FlattenEvent_userId_createdAt_idx" ON "FlattenEvent"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "FlattenEvent_projectId_parityOk_idx" ON "FlattenEvent"("projectId", "parityOk");

-- CreateIndex
CREATE INDEX "FlattenEvent_fidelityScore_idx" ON "FlattenEvent"("fidelityScore");

-- CreateIndex
CREATE INDEX "FlattenEvent_createdAt_idx" ON "FlattenEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "FlattenEvent" ADD CONSTRAINT "FlattenEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlattenEvent" ADD CONSTRAINT "FlattenEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
