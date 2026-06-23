-- CreateTable
CREATE TABLE "Preset" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "thinking" BOOLEAN NOT NULL DEFAULT false,
    "effort" TEXT,
    "maxTokens" INTEGER NOT NULL DEFAULT 128000,
    "baseCredits" INTEGER NOT NULL,
    "perSlideCredits" INTEGER NOT NULL,
    "secsPerSlide" INTEGER NOT NULL,
    "baseOverheadSecs" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "autoInactive" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Preset_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Tier" (
    "plan" TEXT NOT NULL,
    "priceUsd" INTEGER NOT NULL,
    "monthlyAllotment" INTEGER NOT NULL,
    "signupGrant" INTEGER NOT NULL,
    "slideCap" INTEGER NOT NULL,
    "unlockedPresetKeys" TEXT[],
    "flows" TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tier_pkey" PRIMARY KEY ("plan")
);

-- CreateTable
CREATE TABLE "PlatformSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "configVersion" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Preset_sortOrder_idx" ON "Preset"("sortOrder");
