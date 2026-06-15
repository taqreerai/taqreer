-- Enable Row Level Security on every table in the `public` schema.
--
-- These tables are Prisma-managed and live in Supabase's `public` schema, which
-- Supabase auto-exposes through its PostgREST API (reachable with the PUBLIC
-- anon/publishable key). The app does NOT use PostgREST: it connects via Prisma
-- as the table-owner `postgres` role, which BYPASSES RLS. So enabling RLS with
-- no policies blocks the anon/authenticated API roles (default-deny) WITHOUT
-- affecting the app, closing the public-data exposure that hosting a Prisma
-- schema on Supabase otherwise opens (Supabase advisor: "RLS Disabled in
-- Public" / "Sensitive Columns Exposed", both CRITICAL).
--
-- The `AND NOT rowsecurity` filter makes this idempotent (already-enabled tables
-- are skipped), so re-running against the live DB (where RLS is already on) is a
-- no-op.
--
-- ‼️ Any NEW table added to `public` in a later migration MUST also enable RLS
-- (add `ALTER TABLE "public"."X" ENABLE ROW LEVEL SECURITY;` to that migration).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND NOT rowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;
