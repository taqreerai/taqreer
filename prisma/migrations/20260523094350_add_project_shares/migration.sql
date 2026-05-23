-- CreateEnum
CREATE TYPE "ProjectAccessLevel" AS ENUM ('view', 'comment', 'edit');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "hideBrandingBadge" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicAccessLevel" "ProjectAccessLevel";

-- CreateTable
CREATE TABLE "ProjectShare" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "accessLevel" "ProjectAccessLevel" NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "inviteToken" TEXT,

    CONSTRAINT "ProjectShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectShare_inviteToken_key" ON "ProjectShare"("inviteToken");

-- CreateIndex
CREATE INDEX "ProjectShare_userId_idx" ON "ProjectShare"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectShare_projectId_email_key" ON "ProjectShare"("projectId", "email");

-- AddForeignKey
ALTER TABLE "ProjectShare" ADD CONSTRAINT "ProjectShare_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
