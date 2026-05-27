-- Mid-stream cancellation signal for deck-generate runs.
-- See prisma/schema.prisma Job.cancelRequestedAt for the column's role.
ALTER TABLE "Job" ADD COLUMN "cancelRequestedAt" TIMESTAMP(3);
