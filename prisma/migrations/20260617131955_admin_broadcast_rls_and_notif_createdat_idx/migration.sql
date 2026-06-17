-- Two follow-ups for the admin-broadcast batch (CodeRabbit PR #77):
--
-- 1. Enable Row Level Security on the new public `AdminBroadcast` table. Every
--    Prisma-managed table in Supabase's `public` schema is auto-exposed through
--    PostgREST (the anon/publishable key), so a new table without RLS is a
--    public-data exposure. The app connects via Prisma as the table-owner
--    `postgres` role, which BYPASSES RLS, so enabling it with NO policies is a
--    pure default-deny for the API roles and a no-op for the app. This matches
--    the baseline set by 20260616120000_enable_rls_public, whose header flags
--    that every NEW public table must enable RLS in its own migration.
--    `AND NOT rowsecurity` keeps it idempotent (re-running on the live DB, where
--    it may already be on, is a no-op).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'AdminBroadcast' AND NOT rowsecurity
  ) THEN
    EXECUTE 'ALTER TABLE public."AdminBroadcast" ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- 2. Standalone createdAt index on Notification for the daily TTL cleanup cron,
--    which range-deletes by createdAt alone. The existing composite index leads
--    with recipientUserId, so it can't serve that scan.
CREATE INDEX IF NOT EXISTS "Notification_createdAt_idx" ON "Notification"("createdAt");
