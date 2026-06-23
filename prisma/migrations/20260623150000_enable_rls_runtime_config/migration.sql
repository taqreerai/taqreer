-- Enable Row Level Security on the runtime-config tables (Preset, Tier,
-- PlatformSettings) added in 20260623100948_add_runtime_config.
--
-- Per the standing rule in 20260616120000_enable_rls_public: every NEW table in
-- the `public` schema MUST enable RLS, because Supabase auto-exposes public
-- tables through PostgREST (reachable with the anon/publishable key). The app
-- connects via Prisma as the table-owner role (which BYPASSES RLS), so enabling
-- RLS with no policies is default-deny for the API roles WITHOUT affecting the
-- app. Without this, the pricing/tier/preset business config (Tier.priceUsd /
-- monthlyAllotment / signupGrant / slideCap / unlockedPresetKeys / flows and
-- Preset.model / baseCredits / perSlideCredits) would be publicly readable.
--
-- Idempotent (the `AND NOT rowsecurity` filter skips already-enabled tables), so
-- re-running against a DB where RLS is already on is a no-op.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('Preset', 'Tier', 'PlatformSettings')
      AND NOT rowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;
