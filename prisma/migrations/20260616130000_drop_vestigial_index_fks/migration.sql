-- Drop vestigial, unused tables (each 0 rows, 0 code references):
--   * Account, Session  - NextAuth-era tables; this app uses Supabase Auth.
--     (Account also held OAuth tokens, the "Sensitive Columns Exposed" advisory.)
--   * File              - unused; uploads go to Supabase Storage, not this table.
ALTER TABLE "Account" DROP CONSTRAINT IF EXISTS "Account_userId_fkey";
ALTER TABLE "Session" DROP CONSTRAINT IF EXISTS "Session_userId_fkey";
ALTER TABLE "File" DROP CONSTRAINT IF EXISTS "File_projectId_fkey";

DROP TABLE IF EXISTS "Account";
DROP TABLE IF EXISTS "Session";
DROP TABLE IF EXISTS "File";

-- Index the foreign-key columns Prisma leaves uncovered (Supabase advisor:
-- "Unindexed foreign keys"). Index names match Prisma's @@index convention so
-- the schema and migration history stay drift-free.
CREATE INDEX "Project_brandKitId_idx" ON "Project"("brandKitId");
CREATE INDEX "Project_folderId_idx" ON "Project"("folderId");
CREATE INDEX "Comment_versionId_idx" ON "Comment"("versionId");
CREATE INDEX "Job_projectId_idx" ON "Job"("projectId");
CREATE INDEX "Folder_userId_idx" ON "Folder"("userId");
CREATE INDEX "Notification_actorUserId_idx" ON "Notification"("actorUserId");
CREATE INDEX "Notification_projectId_idx" ON "Notification"("projectId");
