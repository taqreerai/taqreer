-- AdminBroadcast goes bilingual: replace the single title/message with EN + AR
-- columns. Each user's bell renders the version matching their locale (the
-- notification payload carries both). Clear rows first so the NOT NULL adds
-- succeed - the table is new and holds only disposable test data (empty on prod).
DELETE FROM "AdminBroadcast";

ALTER TABLE "AdminBroadcast"
  DROP COLUMN "title",
  DROP COLUMN "message",
  ADD COLUMN "titleEn" TEXT NOT NULL,
  ADD COLUMN "messageEn" TEXT NOT NULL,
  ADD COLUMN "titleAr" TEXT NOT NULL,
  ADD COLUMN "messageAr" TEXT NOT NULL;
