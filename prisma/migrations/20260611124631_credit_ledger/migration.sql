-- CreateTable
CREATE TABLE "CreditAccount" (
    "userId" TEXT NOT NULL,
    "subscriptionBalance" INTEGER NOT NULL DEFAULT 0,
    "monthlyAllotment" INTEGER NOT NULL DEFAULT 0,
    "allotmentResetAt" TIMESTAMP(3),
    "signupGrantedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditAccount_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "TopupGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountGranted" INTEGER NOT NULL,
    "amountRemaining" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TopupGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditHold" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "amountHeld" INTEGER NOT NULL,
    "amountCharged" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'held',
    "fromSubscription" INTEGER NOT NULL DEFAULT 0,
    "topupTakes" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TopupGrant_sourceKey_key" ON "TopupGrant"("sourceKey");

-- CreateIndex
CREATE INDEX "TopupGrant_userId_expiresAt_idx" ON "TopupGrant"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditHold_jobKey_key" ON "CreditHold"("jobKey");

-- CreateIndex
CREATE INDEX "CreditHold_userId_status_idx" ON "CreditHold"("userId", "status");

-- AddForeignKey
ALTER TABLE "CreditAccount" ADD CONSTRAINT "CreditAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopupGrant" ADD CONSTRAINT "TopupGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditHold" ADD CONSTRAINT "CreditHold_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
