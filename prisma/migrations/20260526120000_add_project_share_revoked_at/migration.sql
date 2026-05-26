-- AlterTable: add soft-delete column for revoked shares.
-- Filled in by app/api/projects/[id]/share/[shareId]/route.ts DELETE
-- (sets to now() instead of hard-deleting the row). The access
-- resolver in lib/api/project-access.ts then denies any caller whose
-- share row has a non-null revokedAt, blocking the public-link
-- fallback for previously-revoked users.
ALTER TABLE "ProjectShare" ADD COLUMN "revokedAt" TIMESTAMP(3);
