-- One-time deck unlock purchases (2026-10-08).
ALTER TABLE "Project" ADD COLUMN "purchasedAt" TIMESTAMP(3);

CREATE TABLE "DeckPurchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "stripeSessionId" TEXT NOT NULL,
    "paymentIntentId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "bracket" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refundedAt" TIMESTAMP(3),
    CONSTRAINT "DeckPurchase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeckPurchase_stripeSessionId_key" ON "DeckPurchase"("stripeSessionId");
CREATE INDEX "DeckPurchase_projectId_idx" ON "DeckPurchase"("projectId");
CREATE INDEX "DeckPurchase_userId_idx" ON "DeckPurchase"("userId");
CREATE INDEX "DeckPurchase_paymentIntentId_idx" ON "DeckPurchase"("paymentIntentId");

ALTER TABLE "DeckPurchase" ADD CONSTRAINT "DeckPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeckPurchase" ADD CONSTRAINT "DeckPurchase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
